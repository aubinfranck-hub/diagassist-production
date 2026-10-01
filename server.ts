import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, Modality, StartSensitivity, EndSensitivity } from "@google/genai";
import dotenv from "dotenv";
import twilio from "twilio";
import nodemailer from "nodemailer";
import { Pool } from "pg";
import crypto from "crypto";
import { WebSocketServer } from "ws";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { XMLParser } from "fast-xml-parser";
import { registerScreening } from "./src/modules/screening/screening.routes";
import { registerJekoPayments } from "./src/modules/payments/jeko.routes";
import { planLiveDiagnostic as planLiveDiagnosticLocal } from "./src/modules/live/liveDiagnosticPlanner";
import { importCategory, fetchCategory, import3hCategory, fetch3hProducts, fetch3hCategories } from "./src/modules/shop/supplierImport";
import { registerHpWebRoutes } from "./src/modules/vehicle/hpweb.routes";
import { searchHpWeb, hpWebNav, formatHpWebPage, type HpWebPage } from "./src/modules/vehicle/hpwebClient";
import { getGeminiKeys } from "./src/utils/geminiKeys";

// Navigation HP-Web : l'extension du navigateur de l'utilisateur (sa session, sa licence) est
// prioritaire ; le gateway serveur ne sert que de repli, Cloudflare le bloque souvent.
const HP_NAV_TIMEOUT_MS = 35000;
function hpWebNavViaClient(clientWs: any, action: string, args: Record<string, unknown>): Promise<HpWebPage> {
  return new Promise((resolve, reject) => {
    const pending: Map<string, (m: any) => void> = (clientWs._hpPending ||= new Map());
    const id = crypto.randomBytes(6).toString("hex");
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Extension HP-Web sans réponse")); }, HP_NAV_TIMEOUT_MS);
    pending.set(id, (m) => {
      clearTimeout(timer);
      if (m.ok && m.page) resolve(m.page as HpWebPage);
      else reject(new Error(m.error || "Échec de la navigation HP-Web"));
    });
    clientWs.send(JSON.stringify({ type: "hpwebCommand", id, action, args }));
  });
}


dotenv.config();

// A temporary server-side storage for active OTPs (expires in 10 minutes)
const otpStorage = new Map<string, { code: string; expiresAt: number }>();

// Sessions actives : token -> { phone, plan, createdAt }
const sessions = new Map<string, { phone: string; plan: string; createdAt: number }>();

// Dernière position connue par numéro : soit précise (GPS navigateur, avec consentement),
// soit estimative (dérivée de l'IP côté serveur quand le client refuse/échoue le GPS).
const lastKnownLocation = new Map<string, { latitude: number; longitude: number; accuracy?: number; updatedAt: number; source: "gps" | "ip" }>();

// Historique des connexions (login réussis), limité aux 500 dernières entrées pour éviter une fuite mémoire.
// Persisté en base (voir loadPersistedData) pour ne pas être perdu à chaque redéploiement du serveur.
const connectionHistory: { phone: string; timestamp: number }[] = [];
function logConnectionEvent(phone: string): void {
  const entry = { phone, timestamp: Date.now() };
  connectionHistory.push(entry);
  if (connectionHistory.length > 500) connectionHistory.shift();
  if (dbPool) {
    dbPool
      .query("INSERT INTO connection_history (phone, timestamp) VALUES ($1, $2)", [entry.phone, entry.timestamp])
      .catch((err: any) => console.error("[DB] Échec de l'enregistrement de l'historique de connexion:", err.message));
  }
}

// Bannières / publicités configurées par l'admin, affichées côté client
interface Banner {
  id: string;
  imageUrl: string;
  linkUrl?: string;
  displayType: "banner" | "floating";
  active: boolean;
  createdAt: number;
}
const banners = new Map<string, Banner>();

// Réseau de partenaires ajoutés manuellement par l'admin : mécaniciens agréés et
// vendeurs de pièces détachées. Affichés aux propriétaires dans deux sections distinctes.
interface Mechanic {
  id: string;
  type: "mechanic" | "parts_vendor";
  name: string;
  garageName?: string;
  phone: string;
  city: string;
  area?: string;
  specialties?: string;
  hasScanner: boolean;
  certified: boolean;
  active: boolean;
  createdAt: number;
}
const mechanics = new Map<string, Mechanic>();

// Nombre de tentatives de vérification OTP par numéro (anti brute-force)
const otpAttempts = new Map<string, { count: number; windowStart: number }>();
const otpSendLog = new Map<string, number[]>();

// Captcha simple (question arithmétique) pour la création de compte directe, sans dépendance
// à un service SMS/WhatsApp externe. À usage unique, expire après 10 minutes.
const captchaStorage = new Map<string, { answer: number; expiresAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of captchaStorage) {
    if (now > entry.expiresAt) captchaStorage.delete(id);
  }
}, 5 * 60 * 1000).unref();

// --- Forfait persistant PAR NUMÉRO DE TÉLÉPHONE (et non par session) ---
// BUG CORRIGÉ : avant, le plan était stocké uniquement dans la session en mémoire et
// réinitialisé à "free_trial" à CHAQUE nouvelle connexion (nouvelle vérification OTP).
// Un client Premium qui fermait l'app et se reconnectait perdait donc son forfait payant !
// Désormais le forfait est stocké par numéro de téléphone et relu à chaque connexion/requête.
const userPlans = new Map<string, { plan: string; activatedAt: number; customDurationMs?: number }>();

// Durée de validité PAR DÉFAUT de chaque forfait à partir de son activation (ms). Au-delà, le
// forfait expire automatiquement et repasse à "free_expired". L'admin peut aussi fixer une durée
// personnalisée (jour/semaine/mois) au moment de la création du compte, qui prime sur ces valeurs.
const PLAN_DURATIONS_MS: Record<string, number> = {
  free_trial: 72 * 60 * 60 * 1000,        // 72h
  payg_active: 24 * 60 * 60 * 1000,       // pass 24h (mécaniciens)
  owner_week: 7 * 24 * 60 * 60 * 1000,    // pass semaine 500F (propriétaires de véhicules)
  lite: 30 * 24 * 60 * 60 * 1000,         // 30 jours
  premium: 30 * 24 * 60 * 60 * 1000,      // 30 jours
};

// Convertit une durée admin (valeur + unité) en millisecondes
const EUR_TO_XOF = 655.957;
function euroToRoundedFcfa(value: number): number {
  return Math.ceil((Number(value) * EUR_TO_XOF) / 1000) * 1000;
}

function computeDurationMs(value: number, unit: string): number | undefined {
  const DAY_MS = 24 * 60 * 60 * 1000;
  if (!value || value <= 0) return undefined;
  if (unit === "jour") return value * DAY_MS;
  if (unit === "semaine") return value * 7 * DAY_MS;
  if (unit === "mois") return value * 30 * DAY_MS;
  return undefined;
}

// Renvoie le forfait EFFECTIF et à jour d'un numéro : initialise l'essai gratuit à la première
// connexion, et rétrograde automatiquement vers "free_expired" si la durée du forfait est dépassée.
// Un compte admin est toujours traité comme "premium" (accès illimité, sans expiration ni minuterie),
// quel que soit le forfait éventuellement attribué par ailleurs (ex: pass 24h après un paiement test).
function getEffectivePlan(phone: string): string {
  if (userAccounts.get(phone)?.isAdmin) {
    return "premium";
  }
  let record = userPlans.get(phone);
  if (!record) {
    record = { plan: "free_trial", activatedAt: Date.now() };
    userPlans.set(phone, record);
    return record.plan;
  }
  const duration = record.customDurationMs ?? PLAN_DURATIONS_MS[record.plan];
  if (duration && Date.now() - record.activatedAt > duration && record.plan !== "free_expired") {
    record = { plan: "free_expired", activatedAt: Date.now() };
    userPlans.set(phone, record);
  }
  return record.plan;
}

function setUserPlan(phone: string, plan: string, customDurationMs?: number): void {
  userPlans.set(phone, { plan, activatedAt: Date.now(), customDurationMs });
  persistPlan(phone).catch(() => {});
}


function createSession(phone: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  const plan = getEffectivePlan(phone);
  sessions.set(token, { phone, plan, createdAt: Date.now() });
  persistSession(token).catch(() => {});
  return token;
}

// Durée de vie maximale d'une session (appliquée à chaque requête, pas seulement au rechargement).
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Comparaison de secrets en temps constant (le hash égalise les longueurs).
function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Révoque les sessions d'un numéro (changement/réinitialisation de mot de passe), sauf éventuellement une.
function revokeSessionsFor(phone: string, exceptToken?: string): number {
  let n = 0;
  for (const [t, s] of sessions) {
    if (s.phone === phone && t !== exceptToken) {
      sessions.delete(t);
      deleteSessionFromDb(t).catch(() => {});
      n++;
    }
  }
  return n;
}

// Numéro de téléphone : chiffres uniquement (8 à 15), "+" initial optionnel.
function normalizeShopPhone(raw: unknown): string | null {
  const v = String(raw ?? "").replace(/[\s.()-]/g, "");
  return /^\+?\d{8,15}$/.test(v) ? v : null;
}

// Code à 6 chiffres cryptographiquement sûr.
const secureCode6 = () => crypto.randomInt(100000, 1000000).toString();

// --- Comptes client par numéro + mot de passe (créés manuellement par l'admin) ---
// Alternative à l'OTP WhatsApp : l'admin crée le compte du client (numéro + mot de passe) sur son
// interface, et le lui communique directement. Aucune dépendance à un fournisseur SMS/WhatsApp.
// --- Persistance PostgreSQL (Render) ---
// BUG CRITIQUE CORRIGÉ : avant, comptes/forfaits/bannières n'existaient qu'en mémoire (Map) et
// disparaissaient à CHAQUE redémarrage du serveur (redéploiement, ou mise en veille sur le plan
// gratuit). Désormais, ces données sont sauvegardées dans une vraie base PostgreSQL et rechargées
// au démarrage — les Maps en mémoire restent utilisées pour des lectures instantanées partout
// ailleurs dans le code (aucun autre changement nécessaire), mais chaque écriture est aussi
// répercutée dans la base pour survivre aux redémarrages.
const dbPool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

async function initDatabase(): Promise<void> {
  if (!dbPool) {
    console.warn("[DB] DATABASE_URL non configuré — les données ne survivront PAS aux redémarrages du serveur.");
    return;
  }
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      phone TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT false,
      email TEXT
    );
    CREATE TABLE IF NOT EXISTS usage_tracking (
      phone TEXT PRIMARY KEY,
      diagnosis_count INTEGER NOT NULL DEFAULT 0,
      period_start BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS live_usage (
      phone TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      used_ms BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS plans (
      phone TEXT PRIMARY KEY,
      plan TEXT NOT NULL,
      activated_at BIGINT NOT NULL,
      custom_duration_ms BIGINT
    );
    CREATE TABLE IF NOT EXISTS banners (
      id TEXT PRIMARY KEY,
      image_url TEXT NOT NULL,
      link_url TEXT,
      display_type TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      plan TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS connection_history (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      timestamp BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_connection_history_timestamp ON connection_history (timestamp DESC);
    -- État persistant de l'Agent Live : permet de reprendre un diagnostic après coupure/reconnexion.
    CREATE TABLE IF NOT EXISTS live_agent_sessions (
      session_id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      state JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_live_agent_sessions_phone ON live_agent_sessions (phone, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_live_agent_sessions_active ON live_agent_sessions (phone, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS live_diagnostics (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      vehicle_summary TEXT,
      symptom TEXT,
      probable_cause TEXT,
      recommended_action TEXT,
      whatsapp_sent BOOLEAN NOT NULL DEFAULT false,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_live_diagnostics_phone ON live_diagnostics (phone);
    CREATE INDEX IF NOT EXISTS idx_live_diagnostics_created ON live_diagnostics (created_at DESC);
    CREATE TABLE IF NOT EXISTS mechanics (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      garage_name TEXT,
      phone TEXT NOT NULL,
      city TEXT NOT NULL,
      area TEXT,
      specialties TEXT,
      has_scanner BOOLEAN NOT NULL DEFAULT true,
      certified BOOLEAN NOT NULL DEFAULT true,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at BIGINT NOT NULL
    );
    -- Migration sûre : ajoute le type de partenaire sans casser les enregistrements existants
    ALTER TABLE mechanics ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'mechanic';
    -- Base véhicules importée depuis l'API Auto-Data.net (marque > modèle > génération > motorisation)
    CREATE TABLE IF NOT EXISTS vehicles (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      brand_id INTEGER NOT NULL,
      model TEXT NOT NULL,
      model_id INTEGER NOT NULL,
      generation TEXT NOT NULL,
      generation_id INTEGER NOT NULL,
      year_start INTEGER,
      year_stop INTEGER,
      engine_code TEXT,
      engine_displacement INTEGER,
      power_hp INTEGER,
      fuel_system TEXT,
      cylinders INTEGER,
      image_url TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_vehicles_brand ON vehicles (brand);
    CREATE INDEX IF NOT EXISTS idx_vehicles_brand_model ON vehicles (brand, model);
    CREATE INDEX IF NOT EXISTS idx_vehicles_bmg ON vehicles (brand, model, generation);

    -- === BOUTIQUE / CRM (section separee du diagnostic, cahier des charges DiagAssist) ===
    CREATE TABLE IF NOT EXISTS shop_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'produit', -- produit | mise_a_jour | piece
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS shop_products (
      id SERIAL PRIMARY KEY,
      category_id INTEGER REFERENCES shop_categories(id),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      price_fcfa INTEGER,
      description TEXT,
      specs TEXT,
      compatibility TEXT,
      box_contents TEXT,
      warranty TEXT,
      availability TEXT DEFAULT 'disponible', -- disponible | rupture | sur_commande
      photos JSONB DEFAULT '[]',
      videos JSONB DEFAULT '[]',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS brand TEXT;
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS model TEXT;
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS price_eur NUMERIC(12,2);
    CREATE INDEX IF NOT EXISTS idx_shop_products_category ON shop_products (category_id);
    CREATE INDEX IF NOT EXISTS idx_shop_products_brand_model ON shop_products (brand, model);
    -- Produits repris d'un fournisseur (ex : ivoirelite) ; sert au suivi de la commission reversee a la main
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS supplier TEXT;
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS supplier_ref TEXT;
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS supplier_url TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_products_supplier_ref ON shop_products (supplier, supplier_ref) WHERE supplier IS NOT NULL;
    -- Clients CRM: identifies par numero de telephone
    CREATE TABLE IF NOT EXISTS shop_customers (
      phone TEXT PRIMARY KEY,
      name TEXT,
      city TEXT,
      categories JSONB DEFAULT '[]', -- ex: ["scanner","diagzone","pieces"]
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_interaction_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS shop_orders (
      id SERIAL PRIMARY KEY,
      customer_phone TEXT NOT NULL REFERENCES shop_customers(phone),
      product_id INTEGER REFERENCES shop_products(id),
      product_name_snapshot TEXT,
      unit_price_snapshot INTEGER,
      status TEXT NOT NULL DEFAULT 'nouvelle', -- nouvelle | a_contacter | contactee | confirmee | en_traitement | prete | livree | annulee | client_injoignable
      quantity INTEGER DEFAULT 1,
      order_ref TEXT, -- regroupe les lignes d'une meme commande panier (ex: DA-2026-000001)
      shipping_city TEXT,
      shipping_address TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_shop_orders_customer ON shop_orders (customer_phone);
    CREATE INDEX IF NOT EXISTS idx_shop_orders_status ON shop_orders (status);
    -- Produits importes sur commande (ex : scanners AliExpress) : acompte % verse dans nos locaux, delai en jours ouvrables
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS deposit_pct INTEGER DEFAULT 0;
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS lead_time_days INTEGER;
    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS deposit_fcfa INTEGER DEFAULT 0;
    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS deposit_status TEXT DEFAULT 'non_requis'; -- non_requis | en_attente | recu
    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS deposit_received_at TIMESTAMP;
    -- Compteur pour generer les references de commande DA-AAAA-NNNNNN sans collision
    CREATE TABLE IF NOT EXISTS shop_order_counter (
      year INTEGER PRIMARY KEY,
      last_value INTEGER NOT NULL DEFAULT 0
    );
    -- Demandes de pieces a l'etranger (avec carte grise)
    CREATE TABLE IF NOT EXISTS shop_part_requests (
      id SERIAL PRIMARY KEY,
      customer_phone TEXT NOT NULL REFERENCES shop_customers(phone),
      part_description TEXT NOT NULL,
      part_photo_base64 TEXT,
      carte_grise_base64 TEXT,
      extra_info TEXT,
      status TEXT NOT NULL DEFAULT 'nouvelle', -- nouvelle | recherche | devis_envoye | devis_accepte | commandee | en_transit | recue | livree | annulee
      quote_fcfa INTEGER,
      quote_details TEXT,
      estimated_days INTEGER DEFAULT 15,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_part_requests_customer ON shop_part_requests (customer_phone);
    -- Relances (historique + programmation)
    CREATE TABLE IF NOT EXISTS shop_followups (
      id SERIAL PRIMARY KEY,
      customer_phone TEXT NOT NULL REFERENCES shop_customers(phone),
      message TEXT,
      channel TEXT DEFAULT 'whatsapp', -- whatsapp | appel | sms
      scheduled_for TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'programmee', -- programmee | envoyee | client_joint | commande_confirmee | echec
      related_order_ref TEXT,
      kind TEXT DEFAULT 'manual', -- manual | order | part_request
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_followups_customer ON shop_followups (customer_phone);
    CREATE INDEX IF NOT EXISTS idx_followups_scheduled ON shop_followups (scheduled_for);

    -- Sessions de coaching/Screening V2 : persistance pour survivre aux redémarrages Render.
    CREATE TABLE IF NOT EXISTS screening_sessions (
      id TEXT PRIMARY KEY,
      technician_phone TEXT NOT NULL,
      coach_phone TEXT,
      pairing_code TEXT NOT NULL,
      pairing_expires_at BIGINT NOT NULL,
      coach_type TEXT NOT NULL DEFAULT 'gemini',
      human_coach_requested BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      frame_count INTEGER NOT NULL DEFAULT 0
    );
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS name TEXT;
    ALTER TABLE screening_sessions ADD COLUMN IF NOT EXISTS technician_device_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_screening_sessions_technician ON screening_sessions (technician_phone);
    CREATE INDEX IF NOT EXISTS idx_screening_sessions_coach ON screening_sessions (coach_phone);
    CREATE INDEX IF NOT EXISTS idx_screening_sessions_created ON screening_sessions (created_at DESC);

    -- Derniers résultats du Scanner DiagAssist (Autopilot) par profil : persistés pour que l'agent
    -- live s'en souvienne après un redémarrage ou d'une session à l'autre.
    CREATE TABLE IF NOT EXISTS scanner_results (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      dtcs JSONB NOT NULL DEFAULT '[]',
      summary TEXT,
      completed_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scanner_results_phone ON scanner_results (phone, completed_at DESC);

    -- Paiements d'abonnement via Jèko (Mobile Money / carte) : persistance pour que le webhook
    -- retrouve la commande même si le serveur a redémarré entre la création et la confirmation.
    CREATE TABLE IF NOT EXISTS jeko_payments (
      reference TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      plan TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL
    );
    ALTER TABLE jeko_payments ADD COLUMN IF NOT EXISTS jeko_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_jeko_payments_phone ON jeko_payments (phone);
  `);
  console.log("[DB] Tables PostgreSQL vérifiées/créées avec succès.");

  // Élargit shop_orders pour les nouvelles colonnes (panier multi-produits, suivi) sur une
  // table qui existait déjà avant leur ajout.
  try {
    await dbPool.query(`
      ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS unit_price_snapshot INTEGER;
      ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS order_ref TEXT;
      ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS shipping_city TEXT;
      ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS shipping_address TEXT;
      ALTER TABLE shop_followups ADD COLUMN IF NOT EXISTS related_order_ref TEXT;
      ALTER TABLE shop_followups ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'manual';
      ALTER TABLE shop_followups ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE shop_followups ADD COLUMN IF NOT EXISTS last_error TEXT;
      ALTER TABLE shop_followups ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP;
    `);
    // L'index sur order_ref ne peut être créé qu'une fois la colonne garantie présente —
    // d'où sa place ici plutôt que dans le bloc de création de schéma principal.
    await dbPool.query(`CREATE INDEX IF NOT EXISTS idx_shop_orders_ref ON shop_orders (order_ref)`);
  } catch (err: any) {
    console.warn("[DB] Élargissement shop_orders échoué :", err.message);
  }
}

async function loadPersistedData(): Promise<void> {
  if (!dbPool) return;
  const accountsRes = await dbPool.query("SELECT * FROM accounts");
  for (const row of accountsRes.rows) {
    userAccounts.set(row.phone, {
      passwordHash: row.password_hash,
      salt: row.salt,
      createdAt: Number(row.created_at),
      isAdmin: row.is_admin,
      email: row.email || undefined,
      name: row.name || undefined,
    });
  }
  const plansRes = await dbPool.query("SELECT * FROM plans");
  for (const row of plansRes.rows) {
    userPlans.set(row.phone, {
      plan: row.plan,
      activatedAt: Number(row.activated_at),
      customDurationMs: row.custom_duration_ms ? Number(row.custom_duration_ms) : undefined,
    });
  }
  const usageRes = await dbPool.query("SELECT * FROM usage_tracking");
  for (const row of usageRes.rows) {
    // Map.prototype.set d'origine : ne pas réécrire en base ce qu'on vient de lire
    Map.prototype.set.call(usageTracking, row.phone, { diagnosisCount: Number(row.diagnosis_count), periodStart: Number(row.period_start) });
  }
  const bannersRes = await dbPool.query("SELECT * FROM banners");
  for (const row of bannersRes.rows) {
    banners.set(row.id, {
      id: row.id,
      imageUrl: row.image_url,
      linkUrl: row.link_url || undefined,
      displayType: row.display_type,
      active: row.active,
      createdAt: Number(row.created_at),
    });
  }
  // Sessions : on ne recharge que celles de moins de 30 jours (au-delà, on considère l'utilisateur
  // parti de toute façon — pas la peine de garder des tokens abandonnés indéfiniment en mémoire).
  const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const mechanicsRes = await dbPool.query("SELECT * FROM mechanics");
  for (const row of mechanicsRes.rows) {
    mechanics.set(row.id, {
      id: row.id,
      type: row.type === "parts_vendor" ? "parts_vendor" : "mechanic",
      name: row.name,
      garageName: row.garage_name || undefined,
      phone: row.phone,
      city: row.city,
      area: row.area || undefined,
      specialties: row.specialties || undefined,
      hasScanner: row.has_scanner,
      certified: row.certified,
      active: row.active,
      createdAt: Number(row.created_at),
    });
  }

  const sessionsRes = await dbPool.query("SELECT * FROM sessions");
  let loadedSessions = 0;
  for (const row of sessionsRes.rows) {
    const createdAt = Number(row.created_at);
    if (Date.now() - createdAt <= SESSION_MAX_AGE_MS) {
      sessions.set(row.token, { phone: row.phone, plan: row.plan, createdAt });
      loadedSessions++;
    }
  }

  const historyRes = await dbPool.query("SELECT phone, timestamp FROM connection_history ORDER BY timestamp DESC LIMIT 500");
  // Réinséré du plus ancien au plus récent pour respecter l'ordre chronologique attendu par logConnectionEvent (push en fin de tableau)
  for (const row of [...historyRes.rows].reverse()) {
    connectionHistory.push({ phone: row.phone, timestamp: Number(row.timestamp) });
  }

  console.log(`[DB] Données rechargées : ${accountsRes.rows.length} compte(s), ${plansRes.rows.length} forfait(s), ${bannersRes.rows.length} bannière(s), ${loadedSessions} session(s), ${historyRes.rows.length} historique(s) de connexion.`);
}

// --- Synchronisation base véhicules depuis l'API Auto-Data.net ---
// Récupère le flux XML marques > modèles > générations > motorisations et le stocke en base,
// pour alimenter des menus déroulants en cascade côté app (au lieu de la saisie libre).
async function syncVehiclesFromAutoData(apiCode: string): Promise<{ inserted: number; brands: number }> {
  if (!dbPool) throw new Error("Base de données non configurée.");

  const response = await fetch(`https://api.auto-data.net/?code=${encodeURIComponent(apiCode)}`);
  if (!response.ok) throw new Error(`Auto-Data.net a répondu ${response.status}`);
  const xmlText = await response.text();

  const parser = new XMLParser({ ignoreAttributes: true, isArray: (name) => ["brand", "model", "generation", "modification"].includes(name) });
  const parsed = parser.parse(xmlText);
  const brandsRaw = parsed?.brands?.brand || [];

  let inserted = 0;
  for (const brand of brandsRaw) {
    const brandName = brand.name;
    const brandId = Number(brand.id);
    const models = brand.models?.model || [];
    for (const model of models) {
      const modelName = model.name;
      const modelId = Number(model.id);
      const generations = model.generations?.generation || [];
      for (const gen of generations) {
        const genName = gen.name;
        const genId = Number(gen.id);
        const imageUrl = gen.images?.image?.[0]?.big || gen.images?.image?.big || null;
        const modifications = gen.modifications?.modification || [];
        for (const mod of modifications) {
          await dbPool.query(
            `INSERT INTO vehicles (brand, brand_id, model, model_id, generation, generation_id, year_start, year_stop, engine_code, engine_displacement, power_hp, fuel_system, cylinders, image_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              brandName, brandId, modelName, modelId, genName, genId,
              mod.yearstart ? Number(mod.yearstart) : null,
              mod.yearstop ? Number(mod.yearstop) : null,
              mod.engineCode || null,
              mod.engineDisplacement ? Number(mod.engineDisplacement) : null,
              mod.powerHp ? Number(mod.powerHp) : null,
              mod.fuelSystem || null,
              mod.cilinders ? Number(mod.cilinders) : null,
              imageUrl,
            ]
          );
          inserted++;
        }
      }
    }
  }
  return { inserted, brands: brandsRaw.length };
}

async function persistMechanic(m: Mechanic): Promise<void> {
  if (!dbPool) return;
  try {
    await dbPool.query(
      `INSERT INTO mechanics (id, name, garage_name, phone, city, area, specialties, has_scanner, certified, active, created_at, type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET name=$2, garage_name=$3, phone=$4, city=$5, area=$6, specialties=$7, has_scanner=$8, certified=$9, active=$10, type=$12`,
      [m.id, m.name, m.garageName || null, m.phone, m.city, m.area || null, m.specialties || null, m.hasScanner, m.certified, m.active, m.createdAt, m.type]
    );
  } catch (err: any) {
    console.error("[DB] Échec de la sauvegarde du mécanicien:", err.message);
  }
}

async function deleteMechanicFromDb(id: string): Promise<void> {
  if (!dbPool) return;
  try {
    await dbPool.query("DELETE FROM mechanics WHERE id = $1", [id]);
  } catch (err: any) {
    console.error("[DB] Échec de la suppression du mécanicien:", err.message);
  }
}

async function persistSession(token: string): Promise<void> {
  if (!dbPool) return;
  const s = sessions.get(token);
  if (!s) return;
  try {
    await dbPool.query(
      `INSERT INTO sessions (token, phone, plan, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (token) DO UPDATE SET plan = $3`,
      [token, s.phone, s.plan, s.createdAt]
    );
  } catch (err: any) {
    console.error("[DB] Échec de la sauvegarde de la session:", err.message);
  }
}

async function deleteSessionFromDb(token: string): Promise<void> {
  if (!dbPool) return;
  try {
    await dbPool.query("DELETE FROM sessions WHERE token = $1", [token]);
  } catch (err: any) {
    console.error("[DB] Échec de la suppression de la session:", err.message);
  }
}

async function persistAccount(phone: string): Promise<void> {
  if (!dbPool) return;
  const acc = userAccounts.get(phone);
  if (!acc) return;
  try {
    await dbPool.query(
      `INSERT INTO accounts (phone, password_hash, salt, created_at, is_admin, email, name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (phone) DO UPDATE SET password_hash = $2, salt = $3, is_admin = $5, email = $6, name = $7`,
      [phone, acc.passwordHash, acc.salt, acc.createdAt, acc.isAdmin, acc.email || null, acc.name || null]
    );
  } catch (err: any) {
    console.error("[DB] Échec de la sauvegarde du compte:", err.message);
  }
}

async function persistPlan(phone: string): Promise<void> {
  if (!dbPool) return;
  const record = userPlans.get(phone);
  if (!record) return;
  try {
    await dbPool.query(
      `INSERT INTO plans (phone, plan, activated_at, custom_duration_ms)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (phone) DO UPDATE SET plan = $2, activated_at = $3, custom_duration_ms = $4`,
      [phone, record.plan, record.activatedAt, record.customDurationMs || null]
    );
  } catch (err: any) {
    console.error("[DB] Échec de la sauvegarde du forfait:", err.message);
  }
}

async function persistBanner(banner: Banner): Promise<void> {
  if (!dbPool) return;
  try {
    await dbPool.query(
      `INSERT INTO banners (id, image_url, link_url, display_type, active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET image_url = $2, link_url = $3, display_type = $4, active = $5`,
      [banner.id, banner.imageUrl, banner.linkUrl || null, banner.displayType, banner.active, banner.createdAt]
    );
  } catch (err: any) {
    console.error("[DB] Échec de la sauvegarde de la bannière:", err.message);
  }
}

async function deleteBannerFromDb(id: string): Promise<void> {
  if (!dbPool) return;
  try {
    await dbPool.query("DELETE FROM banners WHERE id = $1", [id]);
  } catch (err: any) {
    console.error("[DB] Échec de la suppression de la bannière:", err.message);
  }
}

const userAccounts = new Map<string, { passwordHash: string; salt: string; createdAt: number; isAdmin: boolean; email?: string; name?: string }>();

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function createAccount(phone: string, password: string, isAdmin: boolean = false, email?: string, name?: string): void {
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  const existing = userAccounts.get(phone);
  userAccounts.set(phone, {
    passwordHash,
    salt,
    createdAt: existing?.createdAt ?? Date.now(),
    isAdmin,
    email: email ?? existing?.email,
    name: name ?? existing?.name,
  });
  persistAccount(phone).catch(() => {});
}

function getNameInstruction(phone?: string): string {
  const name = phone ? userAccounts.get(phone)?.name : undefined;
  return name
    ? `\nLe mécanicien s'appelle ${name}. Appelle-le par son prénom quand c'est naturel, sans le forcer à chaque phrase.\n`
    : "";
}

// Change uniquement le rôle admin d'un compte existant, sans toucher au mot de passe déjà en
// place (on ne connaît que son hash, pas sa valeur en clair, donc createAccount ne convient pas ici).
function setAccountAdmin(phone: string, isAdmin: boolean): boolean {
  const existing = userAccounts.get(phone);
  if (!existing) return false;
  userAccounts.set(phone, { ...existing, isAdmin });
  persistAccount(phone).catch(() => {});
  return true;
}

function verifyAccountPassword(phone: string, password: string): boolean {
  const account = userAccounts.get(phone);
  if (!account) return false;
  const candidateHash = hashPassword(password, account.salt);
  // Comparaison en temps constant pour éviter les attaques par mesure de timing
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(account.passwordHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Anti brute-force sur la connexion par mot de passe (même logique que pour l'OTP)
const loginAttempts = new Map<string, { count: number; windowStart: number }>();

// Compte admin "de démarrage" créé automatiquement au lancement du serveur si ces variables
// d'environnement sont définies. Permet de créer le premier compte administrateur sans jamais
// avoir besoin d'appeler l'application déployée depuis l'extérieur.
// BUG CORRIGÉ : ce bloc s'exécutait à CHAQUE redémarrage du serveur (chaque redéploiement), et
// écrasait systématiquement le mot de passe — même si l'admin l'avait changé lui-même entre-temps
// via le changement de mot de passe self-service. Désormais, on ne crée le compte "graine" que
// s'il n'existe pas encore (vérifié APRÈS le rechargement depuis la base — voir startServer()),
// pour ne jamais écraser un mot de passe déjà personnalisé ni un compte déjà persisté.
function seedAdminAccountIfNeeded(): void {
  if (process.env.ADMIN_SEED_PHONE && process.env.ADMIN_SEED_PASSWORD && !userAccounts.has(process.env.ADMIN_SEED_PHONE)) {
    createAccount(process.env.ADMIN_SEED_PHONE, process.env.ADMIN_SEED_PASSWORD, true, process.env.ADMIN_SEED_EMAIL);
    setUserPlan(process.env.ADMIN_SEED_PHONE, "premium");
    console.log(`[Démarrage] Compte administrateur "graine" créé pour ${process.env.ADMIN_SEED_PHONE} (première fois).`);
  }
}

// --- Récupération de mot de passe par email (SMTP Gmail) ---
// Codes de réinitialisation : email -> { code, phone, expiresAt }
const passwordResetCodes = new Map<string, { code: string; phone: string; expiresAt: number; attempts?: number }>();

function getEmailTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_APP_PASSWORD,
    },
  });
}

// Recherche le numéro de téléphone associé à un email (les comptes sont indexés par téléphone)
function findPhoneByEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  for (const [phone, account] of userAccounts) {
    if (account.email && account.email.trim().toLowerCase() === normalized) {
      return phone;
    }
  }
  return null;
}

function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  const session = sessions.get(token);
  if (!token || !session) {
    return res.status(401).json({ success: false, message: "Session invalide ou expirée. Veuillez vous reconnecter." });
  }
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    deleteSessionFromDb(token).catch(() => {});
    return res.status(401).json({ success: false, message: "Session invalide ou expirée. Veuillez vous reconnecter." });
  }
  // Toujours resynchroniser le plan de la session avec le forfait persistant à jour
  // (reflète immédiatement une activation admin ou une expiration, sans attendre une reconnexion).
  session.plan = getEffectivePlan(session.phone);
  req.session = session;
  req.sessionToken = token;
  next();
}

// --- Administration : protection par secret serveur (jamais exposé au client) ---
// Définissez ADMIN_SECRET dans vos variables d'environnement en production.
// Sans ADMIN_SECRET configuré, toutes les routes admin refusent l'accès (fail-closed).
function requireAdminAuth(req: any, res: any, next: any) {
  const adminSecret = process.env.ADMIN_SECRET;
  const providedCode = req.headers["x-admin-code"] || req.body?.code;

  // Voie 1 : code admin serveur (ADMIN_SECRET) — utilisable sans être connecté.
  if (adminSecret && safeEqual(providedCode, adminSecret)) {
    return next();
  }

  // Voie 2 : session utilisateur valide dont le compte est marqué isAdmin — permet d'utiliser le
  // tableau de bord admin directement depuis l'app une fois connecté, sans retaper le code.
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  const session = token ? sessions.get(token) : undefined;
  if (session && Date.now() - session.createdAt <= SESSION_TTL_MS && userAccounts.get(session.phone)?.isAdmin) {
    return next();
  }

  if (!adminSecret && !session) {
    return res.status(503).json({ success: false, message: "Accès admin non configuré sur le serveur (ADMIN_SECRET manquant)." });
  }
  return res.status(401).json({ success: false, message: "Accès administrateur refusé." });
}


const PLAN_LIMITS: Record<string, number> = {
  free_trial: 1,         // 1 diagnostic par jour pendant les 72h d'essai
  free_expired: 0,
  payg_active: Infinity, // payé à l'usage, facturé ailleurs
  owner_week: 15,        // Pass Semaine propriétaire (500F) — plafonné pour maîtriser le coût IA
  lite: 30,              // par mois
  premium: Infinity,
};

// Fenêtre de remise à zéro du quota, par forfait. free_trial se réinitialise chaque JOUR
// (1 diagnostic/jour) ; les forfaits payants se réinitialisent tous les 30 jours.
const PLAN_RESET_PERIOD_MS: Record<string, number> = {
  free_trial: 24 * 60 * 60 * 1000,        // 1 jour
};
const DEFAULT_RESET_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

// phone -> { diagnosisCount, periodStart }
const usageTracking = new Map<string, { diagnosisCount: number; periodStart: number }>();
// Les compteurs sont persistés : sans cela, chaque redéploiement remettait les quotas à zéro.
{
  const baseSet = usageTracking.set.bind(usageTracking);
  usageTracking.set = (phone: string, u: { diagnosisCount: number; periodStart: number }) => {
    const r = baseSet(phone, u);
    if (dbPool) {
      dbPool.query(
        `INSERT INTO usage_tracking (phone, diagnosis_count, period_start) VALUES ($1,$2,$3)
         ON CONFLICT (phone) DO UPDATE SET diagnosis_count = $2, period_start = $3`,
        [phone, u.diagnosisCount, u.periodStart]
      ).catch((err: any) => console.error("[DB] Sauvegarde du quota échouée:", err.message));
    }
    return r;
  };
}

function checkAndIncrementUsage(phone: string, plan: string): { allowed: boolean; message?: string } {
  const limit = PLAN_LIMITS[plan] ?? 0;
  const usage = usageTracking.get(phone) || { diagnosisCount: 0, periodStart: Date.now() };

  const resetPeriod = PLAN_RESET_PERIOD_MS[plan] ?? DEFAULT_RESET_PERIOD_MS;
  if (Date.now() - usage.periodStart > resetPeriod) {
    usage.diagnosisCount = 0;
    usage.periodStart = Date.now();
  }

  if (usage.diagnosisCount >= limit) {
    return { allowed: false, message: "Quota atteint pour votre forfait actuel. Veuillez passer à un forfait supérieur." };
  }

  usage.diagnosisCount += 1;
  usageTracking.set(phone, usage);
  return { allowed: true };
}

// Support de plusieurs clés Gemini (rotation automatique en cas de quota dépassé sur l'une
// d'elles) : GEMINI_API_KEY peut contenir une seule clé, ou plusieurs séparées par des virgules ;
// GEMINI_API_KEY_2 est acceptée en plus pour plus de clarté côté variables d'environnement Render.
let currentGeminiKeyIndex = 0;
const aiInstancesByKey = new Map<string, GoogleGenAI>();

function getAIClient(): GoogleGenAI {
  const keys = getGeminiKeys();
  if (keys.length === 0) {
    throw new Error("La clé API Gemini (GEMINI_API_KEY) n'est pas configurée. Veuillez l'ajouter dans les Paramètres d'AI Studio pour activer le diagnostic IA.");
  }
  const apiKey = keys[currentGeminiKeyIndex % keys.length];
  let instance = aiInstancesByKey.get(apiKey);
  if (!instance) {
    instance = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    aiInstancesByKey.set(apiKey, instance);
  }
  return instance;
}

// Fait passer à la clé Gemini suivante (round-robin) — appelé quand la clé active renvoie une
// erreur de quota/rate-limit. Renvoie false s'il n'y a qu'une seule clé (rien à changer).
function rotateGeminiKey(): boolean {
  const keys = getGeminiKeys();
  if (keys.length <= 1) return false;
  currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % keys.length;
  console.warn(`[Gemini API] Rotation vers la clé #${currentGeminiKeyIndex + 1}/${keys.length} (quota dépassé sur la précédente).`);
  return true;
}

// --- Suivi de l'usage/quota des clés Gemini (affiché dans l'admin) ---
// Google n'expose pas le quota restant d'une clé API : on affiche l'état OBSERVÉ (succès, erreurs
// 429, quota de la recherche web) depuis le démarrage du serveur, complété par un test à la demande.
type GeminiKeyStats = {
  calls: number; ok: number; quotaErrors: number; otherErrors: number;
  lastOkAt: number | null; lastQuotaAt: number | null; lastErrorAt: number | null; lastError: string | null;
  searchQuotaAt: number | null; promptTokens: number; outputTokens: number;
};
const geminiKeyStats = new Map<string, GeminiKeyStats>();
const serverStartedAt = Date.now();

function getGeminiStats(apiKey: string): GeminiKeyStats {
  let st = geminiKeyStats.get(apiKey);
  if (!st) {
    st = { calls: 0, ok: 0, quotaErrors: 0, otherErrors: 0, lastOkAt: null, lastQuotaAt: null, lastErrorAt: null, lastError: null, searchQuotaAt: null, promptTokens: 0, outputTokens: 0 };
    geminiKeyStats.set(apiKey, st);
  }
  return st;
}

function currentGeminiKey(): string {
  const keys = getGeminiKeys();
  return keys.length ? keys[currentGeminiKeyIndex % keys.length] : "";
}

function recordGeminiResult(
  apiKey: string,
  r: { ok: boolean; quota?: boolean; error?: string; searchQuota?: boolean; promptTokens?: number; outputTokens?: number }
): void {
  if (!apiKey) return;
  const st = getGeminiStats(apiKey);
  const now = Date.now();
  if (r.searchQuota) { st.searchQuotaAt = now; return; }
  st.calls += 1;
  if (r.ok) {
    st.ok += 1;
    st.lastOkAt = now;
    st.promptTokens += r.promptTokens || 0;
    st.outputTokens += r.outputTokens || 0;
  } else if (r.quota) {
    st.quotaErrors += 1;
    st.lastQuotaAt = now;
    st.lastErrorAt = now;
    st.lastError = String(r.error || "quota").slice(0, 200);
  } else {
    st.otherErrors += 1;
    st.lastErrorAt = now;
    st.lastError = String(r.error || "erreur").slice(0, 200);
  }
}

function isGeminiQuotaError(error: any): boolean {
  if (!error) return false;
  if (error.status === 429) return true;
  const msg = String(error.message || "").toLowerCase();
  return msg.includes("quota") || msg.includes("resource_exhausted") || msg.includes("rate limit");
}

/**
 * Retry helper with exponential backoff for transient errors
 */
async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3, initialDelayMs = 1000): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      const isTransient = 
        !error.status || // standard network errors
        error.status === 503 || 
        error.status === 429 || 
        error.status === 504 ||
        error.status === 500 ||
        error.message?.includes("503") ||
        error.message?.includes("429") ||
        error.message?.includes("UNAVAILABLE") ||
        error.message?.includes("high demand") ||
        error.message?.includes("overloaded");
      
      // Quota épuisé (pas un simple pic) : réessayer sur la même clé est inutile, on laisse l'appelant
      // tourner vers une autre clé / retirer la recherche web.
      const quotaExhausted = /exceeded your current quota|check your plan and billing/i.test(String(error.message || ""));
      if (!isTransient || quotaExhausted || attempt >= maxRetries) {
        throw error;
      }
      const delay = initialDelayMs * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4);
      console.warn(`[Gemini API] Transient error (attempt ${attempt}/${maxRetries}). Retrying in ${Math.round(delay)}ms... Error:`, error.message || error);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Executes a generateContent call with automatic fallback models and retries
 */
// Extrait les vraies sources citées par le grounding Google Search (URL + titre), pour les
// afficher côté client plutôt qu'un simple badge "vérifié" sans preuve consultable.
function extractGroundingSources(response: any): { title: string; uri: string }[] {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const seen = new Set<string>();
  const sources: { title: string; uri: string }[] = [];
  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({ title: chunk?.web?.title || uri, uri });
  }
  return sources.slice(0, 6);
}

// --- Outils de l'agent vocal live (function calling Gemini Live) ---
// Gardés volontairement en LECTURE SEULE : le live ne doit jamais pouvoir déclencher une action
// qui touche l'argent ou les comptes clients (bonus, mot de passe, etc.) de façon autonome à la
// voix — seulement chercher de l'information pour répondre au mécanicien plus vite/mieux.

// Recherche technique concise pour l'agent vocal — une seule requête (pas de second appel de
// structuration JSON comme /api/diagnose/technical-lookup) pour limiter la latence perçue à l'oral.
async function liveToolSearchTechnicalInfo(query: string): Promise<string> {
  try {
    const searchResult = await getAIClient().models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Recherche des données techniques fiables et vérifiées pour : ${query}. Cherche l'emplacement précis du composant, les valeurs de référence multimètre (résistance en ohms, tension) si c'est électrique, le couple de serrage en Nm si applicable, et tout bulletin technique constructeur pertinent. Réponds en 2-3 phrases courtes et factuelles, adaptées à être lues à voix haute. Ne devine JAMAIS une valeur que tu n'as pas trouvée — dis-le clairement si l'info n'est pas disponible.`,
      config: { tools: [{ googleSearch: {} }] },
    });
    return searchResult.text?.trim() || "Aucune information technique fiable trouvée pour cette recherche.";
  } catch (err) {
    console.warn("[Live Tool] Recherche technique indisponible:", err);
    return "La recherche technique est momentanément indisponible.";
  }
}

// Consulte la base véhicules locale (Auto-Data.net synchronisée par l'admin) — sans marque+modèle,
// liste les modèles connus de la marque ; avec les deux, détaille motorisations/générations.
async function liveToolCheckVehicleDatabase(brand: string, model?: string): Promise<string> {
  if (!dbPool) return "La base véhicules n'est pas configurée sur ce serveur.";
  try {
    if (!model) {
      const { rows } = await dbPool.query(
        "SELECT DISTINCT model FROM vehicles WHERE brand ILIKE $1 ORDER BY model ASC LIMIT 15",
        [brand]
      );
      if (rows.length === 0) return `Aucun modèle trouvé dans la base pour la marque "${brand}".`;
      return `Modèles disponibles pour ${brand} dans la base : ${rows.map((r: any) => r.model).join(", ")}.`;
    }
    const { rows } = await dbPool.query(
      `SELECT DISTINCT generation, engine_code, engine_displacement, power_hp, fuel_system, year_start, year_stop
       FROM vehicles WHERE brand ILIKE $1 AND model ILIKE $2
       ORDER BY year_start DESC NULLS LAST LIMIT 8`,
      [brand, `%${model}%`]
    );
    if (rows.length === 0) return `Aucune motorisation trouvée dans la base pour "${brand} ${model}".`;
    const lines = rows.map((r: any) => {
      const period = `${r.year_start || "?"}-${r.year_stop || "présent"}`;
      const engine = [r.engine_code, r.engine_displacement ? `${r.engine_displacement}cc` : null, r.power_hp ? `${r.power_hp}ch` : null, r.fuel_system]
        .filter(Boolean)
        .join(" ");
      return `${r.generation || "génération inconnue"} (${period}) : ${engine || "détails moteur non renseignés"}`;
    });
    return `Motorisations trouvées pour ${brand} ${model} : ${lines.join(" | ")}.`;
  } catch (err) {
    console.warn("[Live Tool] Erreur requête base véhicules:", err);
    return "Erreur lors de la consultation de la base véhicules.";
  }
}

// Cherche un mécanicien ou vendeur de pièces agréé par ville — permet au live de recommander un
// vrai contact (nom, téléphone, spécialités) au lieu d'un conseil générique "voyez un mécanicien".
function liveToolFindMechanic(city: string, type?: "mechanic" | "parts_vendor"): string {
  const cityLower = city.toLowerCase();
  let list = Array.from(mechanics.values()).filter(
    (m) => m.active && (m.city.toLowerCase().includes(cityLower) || (m.area || "").toLowerCase().includes(cityLower))
  );
  if (type) list = list.filter((m) => m.type === type);
  if (list.length === 0) {
    return `Aucun ${type === "parts_vendor" ? "vendeur de pièces" : "mécanicien"} agréé trouvé dans le réseau DiagAssist pour "${city}".`;
  }
  const lines = list.slice(0, 5).map((m) => {
    const label = m.type === "parts_vendor" ? "Vendeur de pièces" : "Mécanicien";
    return `${label} ${m.name}${m.garageName ? ` (${m.garageName})` : ""}, ${m.city}${m.area ? ` - ${m.area}` : ""}, tél. ${m.phone}${m.specialties ? `, spécialités : ${m.specialties}` : ""}${m.hasScanner ? ", équipé d'une valise de diagnostic" : ""}`;
  });
  return `Contacts trouvés : ${lines.join(" | ")}.`;
}

// Vérifie le prix et la disponibilité d'une pièce dans la boutique DiagAssist.
// Si la pièce est introuvable ou en rupture, enregistre automatiquement une demande de
// commande dans shop_part_requests et génère un lien WhatsApp de confirmation au client.
async function liveToolCheckPartAvailability(
  query: string,
  phone?: string,
  vehicule?: string
): Promise<{ text: string; orderRequestCreated: boolean; waConfirmUrl?: string; cards?: any[] }> {
  if (!dbPool) return { text: "La boutique de pièces n'est pas configurée sur ce serveur.", orderRequestCreated: false };
  try {
    // Recherche par mots (singulier/pluriel indifférents) sur le nom, la marque et la compatibilité :
    // « bougie Peugeot 406 » trouve « BOUGIE ... » même si le nom ne contient pas tous les mots.
    const tokens = query.toLowerCase().split(/[^a-z0-9àâçéèêëîïôûùüÿœ]+/i).filter((t) => t.length >= 3)
      .map((t) => (t.length > 4 && /[sx]$/.test(t) ? t.slice(0, -1) : t)).slice(0, 5);
    const searchSql = (patterns: string[]) => dbPool!.query(
      `SELECT name, slug, price_fcfa, availability, photos, warranty, compatibility FROM shop_products
        WHERE is_active = true AND (name || ' ' || COALESCE(brand, '') || ' ' || COALESCE(compatibility, '')) ILIKE ALL($1::text[])
        ORDER BY (availability = 'disponible') DESC, name ASC LIMIT 5`,
      [patterns]
    );
    let { rows } = await searchSql((tokens.length ? tokens : [query]).map((t) => `%${t}%`));
    // Rien avec tous les mots : on retombe sur le premier mot (le type de pièce) seul.
    if (rows.length === 0 && tokens.length > 1) ({ rows } = await searchSql([`%${tokens[0]}%`]));
    // Cartes affichées à l'écran du mécanicien (photo, prix, disponibilité) — 3 max. Les photos
    // en data-URL très lourdes sont ignorées pour ne pas saturer le WebSocket.
    const cards = rows.slice(0, 3).map((r: any) => {
      const photo = Array.isArray(r.photos) ? r.photos.find((u: any) => typeof u === "string" && u.length < 400000) : undefined;
      return {
        name: r.name,
        slug: r.slug,
        priceFcfa: r.price_fcfa ?? null,
        availability: r.availability,
        photo: photo || null,
        warranty: r.warranty || null,
        compatibility: r.compatibility ? String(r.compatibility).slice(0, 200) : null,
      };
    });
    const availabilityLabel: Record<string, string> = {
      disponible: "disponible",
      rupture: "en rupture de stock",
      sur_commande: "disponible sur commande",
    };

    // Pièces disponibles — retour simple
    const dispo = rows.filter((r: any) => r.availability === "disponible" || r.availability === "sur_commande");
    if (dispo.length > 0) {
      const lines = dispo.map((r: any) => `${r.name} : ${r.price_fcfa ? `${r.price_fcfa} F CFA` : "prix non renseigné"} (${availabilityLabel[r.availability] || r.availability})`);
      return { text: `Pièces trouvées dans la boutique : ${lines.join(" | ")}. Une carte avec la photo et le prix est affichée à l'écran du mécanicien. Annonce la pièce et son prix en une phrase, sans formule de politesse.`, orderRequestCreated: false, cards };
    }

    // Pièce introuvable ou en rupture — enregistrer une demande de commande
    const pieceLabel = rows.length > 0 ? rows[0].name : query;
    const extraInfo = vehicule ? `Véhicule : ${vehicule}` : undefined;
    let waConfirmUrl: string | undefined;

    if (phone) {
      // S'assurer que le client existe dans shop_customers
      await dbPool.query(
        "INSERT INTO shop_customers (phone, name) VALUES ($1, $2) ON CONFLICT (phone) DO NOTHING",
        [phone, phone]
      );
      // Insérer la demande de commande
      await dbPool.query(
        "INSERT INTO shop_part_requests (customer_phone, part_description, extra_info, status) VALUES ($1, $2, $3, 'nouvelle')",
        [phone, pieceLabel, extraInfo || null]
      );
      // Lien WhatsApp de confirmation vers le client
      const WA_SHOP = "2250707312797";
      const msg = `Bonjour, nous avons bien noté votre demande pour la pièce : ${pieceLabel}${vehicule ? ` (${vehicule})` : ""}.\nNous allons la commander pour vous et vous recontacterons dès qu'elle est disponible. DiagAssist.`;
      waConfirmUrl = `https://wa.me/${WA_SHOP}?text=${encodeURIComponent(msg)}`;
    }

    const notFoundMsg = rows.length === 0
      ? `La pièce "${query}" n'est pas encore en stock à la boutique DiagAssist.`
      : `La pièce "${pieceLabel}" est actuellement en rupture de stock.`;

    return {
      text: `${notFoundMsg} AUCUNE fiche ni carte n'est affichée à l'écran : ne dis JAMAIS que la pièce est affichée. ` +
        (phone ? `Une demande de commande a été enregistrée pour le ${phone}. ` : "Aucune demande n'a pu être enregistrée (numéro inconnu). ") +
        `Réponds en une ou deux phrases : pièce pas en stock, recommande de nous contacter au 0707312797 pour une pièce garantie.` +
        (vehicule ? "" : " Le véhicule n'est pas connu : demande uniquement « Véhicule ? »."),
      orderRequestCreated: true,
      waConfirmUrl,
      cards,
    };
  } catch (err) {
    console.warn("[Live Tool] Erreur requête boutique pièces:", err);
    return { text: "Erreur lors de la consultation de la boutique de pièces.", orderRequestCreated: false };
  }
}

// Table locale des codes OBD2 standards (P/C/B/U) pour un lookup instantané sans réseau.
const OBD_CODES: Record<string, { cause: string; action: string }> = {
  P0010: { cause: "Actuateur de calage d'arbre à cames (admission) — circuit défaillant", action: "Vérifier connecteur VVT, huile moteur et pression d'huile" },
  P0011: { cause: "Calage arbre à cames (admission) trop avancé ou en blocage", action: "Vérifier niveau et qualité d'huile, solénoïde VVT, arbre à cames" },
  P0012: { cause: "Calage arbre à cames (admission) trop retardé", action: "Vérifier solénoïde VVT, pression huile, distribution" },
  P0016: { cause: "Désynchronisation arbre à cames / vilebrequin (rang A)", action: "Vérifier courroie/chaîne de distribution, capteurs PMH et ACM" },
  P0017: { cause: "Désynchronisation arbre à cames échappement / vilebrequin", action: "Vérifier courroie/chaîne de distribution, capteur ACM" },
  P0030: { cause: "Sonde lambda amont — circuit chauffage défaillant", action: "Vérifier alimentation chauffage sonde, résistance sonde" },
  P0031: { cause: "Sonde lambda amont — circuit chauffage trop bas", action: "Vérifier alimentation 12V, masse, sonde lambda" },
  P0032: { cause: "Sonde lambda amont — circuit chauffage trop haut", action: "Vérifier court-circuit, sonde lambda" },
  P0037: { cause: "Sonde lambda aval — circuit chauffage trop bas", action: "Vérifier alimentation, sonde lambda aval" },
  P0038: { cause: "Sonde lambda aval — circuit chauffage trop haut", action: "Vérifier court-circuit sonde lambda aval" },
  P0100: { cause: "Circuit débitmètre air (MAF) — défaillance générale", action: "Vérifier connecteur MAF, nettoyer ou remplacer capteur MAF" },
  P0101: { cause: "Signal débitmètre air hors plage", action: "Nettoyer le MAF, vérifier les fuites d'air admission" },
  P0102: { cause: "Circuit débitmètre air — signal trop bas", action: "Vérifier alimentation MAF, rechercher fuite admission importante" },
  P0103: { cause: "Circuit débitmètre air — signal trop haut", action: "Vérifier court-circuit, remplacement MAF" },
  P0105: { cause: "Circuit capteur pression absolue collecteur (MAP) — défaillance", action: "Vérifier connecteur MAP, durite dépression" },
  P0106: { cause: "Signal capteur MAP hors plage", action: "Vérifier durite dépression, capteur MAP" },
  P0107: { cause: "Circuit capteur MAP — signal trop bas", action: "Vérifier alimentation MAP, durite dépression percée" },
  P0108: { cause: "Circuit capteur MAP — signal trop haut", action: "Vérifier court-circuit MAP" },
  P0110: { cause: "Circuit capteur température air admission (IAT)", action: "Vérifier connecteur IAT, résistance capteur" },
  P0112: { cause: "Capteur IAT — signal trop bas (court-circuit masse)", action: "Vérifier câblage IAT, remplacement capteur" },
  P0113: { cause: "Capteur IAT — signal trop haut (circuit ouvert)", action: "Vérifier câblage IAT, connecteur, remplacement capteur" },
  P0115: { cause: "Circuit capteur température liquide refroidissement (ECT)", action: "Vérifier connecteur ECT, résistance capteur" },
  P0116: { cause: "Signal capteur ECT hors plage", action: "Vérifier thermostat, capteur ECT" },
  P0117: { cause: "Capteur ECT — signal trop bas", action: "Court-circuit masse — vérifier câblage, remplacer capteur" },
  P0118: { cause: "Capteur ECT — signal trop haut", action: "Circuit ouvert — vérifier câblage, remplacer capteur" },
  P0120: { cause: "Circuit capteur position papillon (TPS) A", action: "Vérifier connecteur TPS, tension alimentation, remplacer si nécessaire" },
  P0121: { cause: "Signal TPS A hors plage de performance", action: "Vérifier câble accélérateur, nettoyer/remplacer papillon" },
  P0122: { cause: "Capteur TPS A — signal trop bas", action: "Vérifier alimentation, court-circuit TPS" },
  P0123: { cause: "Capteur TPS A — signal trop haut", action: "Vérifier court-circuit, remplacer TPS" },
  P0125: { cause: "Température insuffisante pour correction carburant en boucle fermée", action: "Vérifier thermostat, capteur ECT" },
  P0128: { cause: "Thermostat — température inférieure à la normale", action: "Remplacer thermostat (reste ouvert)" },
  P0130: { cause: "Sonde lambda amont — signal hors plage", action: "Vérifier sonde lambda, fuites d'échappement" },
  P0131: { cause: "Sonde lambda amont — signal trop bas (mélange riche non détecté)", action: "Vérifier sonde, fuites d'air admission, pression carburant" },
  P0132: { cause: "Sonde lambda amont — signal trop haut (mélange pauvre non détecté)", action: "Vérifier sonde, injecteurs encrassés, pression carburant" },
  P0133: { cause: "Sonde lambda amont — réponse lente", action: "Vérifier fuites d'échappement amont, remplacer sonde lambda" },
  P0134: { cause: "Sonde lambda amont — pas d'activité", action: "Vérifier alimentation, masse, chauffage sonde" },
  P0135: { cause: "Chauffage sonde lambda amont — défaillance", action: "Vérifier résistance chauffage, alimentation sonde" },
  P0136: { cause: "Sonde lambda aval — signal hors plage", action: "Vérifier sonde lambda aval, catalyseur" },
  P0138: { cause: "Sonde lambda aval — signal trop haut", action: "Vérifier catalyseur, sonde aval" },
  P0140: { cause: "Sonde lambda aval — pas d'activité", action: "Vérifier alimentation sonde aval, catalyseur défaillant" },
  P0141: { cause: "Chauffage sonde lambda aval — défaillance", action: "Vérifier résistance chauffage sonde aval" },
  P0171: { cause: "Mélange trop pauvre cylindre 1 (banc 1) — correction additive max", action: "Vérifier fuites d'air admission, injecteurs encrassés, pression carburant, débit MAF" },
  P0172: { cause: "Mélange trop riche cylindre 1 (banc 1) — correction soustractive max", action: "Vérifier injecteurs fuyards, pression carburant excessive, capteur MAP/MAF" },
  P0174: { cause: "Mélange trop pauvre banc 2", action: "Même que P0171, banc 2 — vérifier fuites, injecteurs, pression" },
  P0175: { cause: "Mélange trop riche banc 2", action: "Même que P0172, banc 2" },
  P0180: { cause: "Circuit capteur température carburant", action: "Vérifier connecteur capteur température carburant" },
  P0190: { cause: "Circuit capteur pression carburant rail", action: "Vérifier connecteur capteur rail, pression carburant" },
  P0191: { cause: "Signal capteur pression rail hors plage", action: "Vérifier pompe haute pression, régulateur pression, capteur rail" },
  P0192: { cause: "Pression carburant rail trop basse", action: "Vérifier pompe HP, filtre carburant, régulateur pression" },
  P0193: { cause: "Pression carburant rail trop haute", action: "Vérifier régulateur pression, capteur rail" },
  P0200: { cause: "Circuit commande injecteurs — défaillance générale", action: "Vérifier fusibles injecteurs, câblage, ECU" },
  P0201: { cause: "Circuit injecteur cylindre 1 — défaillance", action: "Vérifier résistance injecteur 1, câblage, connecteur" },
  P0202: { cause: "Circuit injecteur cylindre 2 — défaillance", action: "Vérifier résistance injecteur 2, câblage, connecteur" },
  P0203: { cause: "Circuit injecteur cylindre 3 — défaillance", action: "Vérifier résistance injecteur 3, câblage, connecteur" },
  P0204: { cause: "Circuit injecteur cylindre 4 — défaillance", action: "Vérifier résistance injecteur 4, câblage, connecteur" },
  P0205: { cause: "Circuit injecteur cylindre 5 — défaillance", action: "Vérifier résistance injecteur 5, câblage, connecteur" },
  P0206: { cause: "Circuit injecteur cylindre 6 — défaillance", action: "Vérifier résistance injecteur 6, câblage, connecteur" },
  P0216: { cause: "Circuit synchronisation injection — défaillance", action: "Vérifier capteur PMH, capteur ACM, câblage" },
  P0217: { cause: "Moteur en surchauffe", action: "Vérifier niveau liquide refroidissement, thermostat, radiateur, pompe eau" },
  P0218: { cause: "Surchauffe boîte de vitesses automatique", action: "Vérifier niveau et état huile BVA, refroidisseur BVA" },
  P0219: { cause: "Régime moteur excessif", action: "Vérifier papillon, câble accélérateur, débitmètre" },
  P0220: { cause: "Circuit capteur TPS B", action: "Vérifier connecteur TPS B, câblage" },
  P0230: { cause: "Circuit commande pompe carburant primaire", action: "Vérifier relais pompe carburant, câblage, pompe" },
  P0231: { cause: "Circuit commande pompe carburant — signal trop bas", action: "Vérifier alimentation pompe, relais" },
  P0232: { cause: "Circuit commande pompe carburant — signal trop haut", action: "Vérifier court-circuit pompe, relais" },
  P0261: { cause: "Circuit injecteur 1 — trop bas (court-circuit masse)", action: "Vérifier câblage injecteur 1, bobine injecteur" },
  P0262: { cause: "Circuit injecteur 1 — trop haut (court-circuit +)", action: "Vérifier câblage injecteur 1" },
  P0263: { cause: "Contribution/déséquilibre cylindre 1", action: "Vérifier injecteur 1, compression cylindre 1" },
  P0264: { cause: "Circuit injecteur 2 — trop bas", action: "Vérifier câblage injecteur 2" },
  P0265: { cause: "Circuit injecteur 2 — trop haut", action: "Vérifier câblage injecteur 2" },
  P0266: { cause: "Contribution/déséquilibre cylindre 2", action: "Vérifier injecteur 2, compression cylindre 2" },
  P0267: { cause: "Circuit injecteur 3 — trop bas", action: "Vérifier câblage injecteur 3" },
  P0268: { cause: "Circuit injecteur 3 — trop haut", action: "Vérifier câblage injecteur 3" },
  P0269: { cause: "Contribution/déséquilibre cylindre 3", action: "Vérifier injecteur 3, compression cylindre 3" },
  P0270: { cause: "Circuit injecteur 4 — trop bas", action: "Vérifier câblage injecteur 4" },
  P0271: { cause: "Circuit injecteur 4 — trop haut", action: "Vérifier câblage injecteur 4" },
  P0272: { cause: "Contribution/déséquilibre cylindre 4", action: "Vérifier injecteur 4, compression cylindre 4" },
  P0300: { cause: "Ratés d'allumage aléatoires/multiples détectés", action: "Vérifier bougies, bobines, injecteurs, compression, fuite vide admission" },
  P0301: { cause: "Ratés d'allumage cylindre 1", action: "Vérifier bougie 1, bobine 1, injecteur 1, compression cylindre 1" },
  P0302: { cause: "Ratés d'allumage cylindre 2", action: "Vérifier bougie 2, bobine 2, injecteur 2, compression cylindre 2" },
  P0303: { cause: "Ratés d'allumage cylindre 3", action: "Vérifier bougie 3, bobine 3, injecteur 3, compression cylindre 3" },
  P0304: { cause: "Ratés d'allumage cylindre 4", action: "Vérifier bougie 4, bobine 4, injecteur 4, compression cylindre 4" },
  P0305: { cause: "Ratés d'allumage cylindre 5", action: "Vérifier bougie 5, bobine 5, injecteur 5, compression cylindre 5" },
  P0306: { cause: "Ratés d'allumage cylindre 6", action: "Vérifier bougie 6, bobine 6, injecteur 6, compression cylindre 6" },
  P0315: { cause: "Capteur PMH — absence d'apprentissage de position", action: "Réaliser la procédure d'apprentissage PMH (valise), vérifier capteur PMH" },
  P0320: { cause: "Circuit capteur allumage/PMH — défaillance", action: "Vérifier connecteur, câblage capteur PMH" },
  P0325: { cause: "Circuit capteur cliquetis (banc 1) — défaillance", action: "Vérifier connecteur capteur cliquetis, câblage, résistance capteur" },
  P0326: { cause: "Signal capteur cliquetis hors plage", action: "Vérifier vissage capteur cliquetis, câblage" },
  P0327: { cause: "Capteur cliquetis banc 1 — signal trop bas", action: "Vérifier masse capteur cliquetis, câblage" },
  P0328: { cause: "Capteur cliquetis banc 1 — signal trop haut", action: "Vérifier court-circuit, remplacer capteur" },
  P0335: { cause: "Circuit capteur PMH (vilebrequin) A — défaillance", action: "Vérifier connecteur, câblage, entrefer, roue phonique capteur PMH" },
  P0336: { cause: "Signal capteur PMH hors plage", action: "Vérifier roue phonique (dents manquantes), entrefer, capteur PMH" },
  P0337: { cause: "Capteur PMH — signal trop bas", action: "Vérifier masse, câblage capteur PMH" },
  P0338: { cause: "Capteur PMH — signal trop haut", action: "Vérifier court-circuit, remplacement capteur PMH" },
  P0340: { cause: "Circuit capteur arbre à cames (ACM) banc 1 — défaillance", action: "Vérifier connecteur ACM, câblage, roue phonique ACM" },
  P0341: { cause: "Signal capteur ACM hors plage", action: "Vérifier calage distribution, roue phonique ACM" },
  P0342: { cause: "Capteur ACM — signal trop bas", action: "Vérifier masse, câblage ACM" },
  P0343: { cause: "Capteur ACM — signal trop haut", action: "Vérifier court-circuit ACM" },
  P0344: { cause: "Capteur ACM — signal intermittent", action: "Vérifier connexion ACM, roue phonique, courroie de distribution" },
  P0380: { cause: "Circuit préchauffage bougies de préchauffage A", action: "Vérifier résistance bougies de préchauffage, relais, câblage" },
  P0381: { cause: "Voyant bougies de préchauffage — circuit défaillant", action: "Vérifier câblage voyant, module préchauffage" },
  P0400: { cause: "Système EGR — débit hors plage", action: "Vérifier vanne EGR (encrassée ou bloquée), durites EGR, capteur MAP" },
  P0401: { cause: "Débit EGR insuffisant détecté", action: "Nettoyer ou remplacer vanne EGR, vérifier durites et capteur différentiel" },
  P0402: { cause: "Débit EGR excessif détecté", action: "Vérifier vanne EGR bloquée ouverte, capteur MAP" },
  P0403: { cause: "Circuit vanne EGR — défaillance", action: "Vérifier connecteur EGR, résistance solénoïde EGR" },
  P0404: { cause: "Circuit vanne EGR — hors plage", action: "Vérifier capteur position EGR, câblage" },
  P0405: { cause: "Capteur position EGR A — signal trop bas", action: "Vérifier alimentation, masse capteur EGR" },
  P0406: { cause: "Capteur position EGR A — signal trop haut", action: "Vérifier court-circuit capteur EGR" },
  P0410: { cause: "Système injection d'air secondaire — défaillance", action: "Vérifier pompe air secondaire, clapets anti-retour, durites" },
  P0420: { cause: "Catalyseur banc 1 — efficacité en dessous du seuil", action: "Vérifier sondes lambda amont/aval, fuites d'échappement, remplacer catalyseur si confirmé" },
  P0421: { cause: "Catalyseur banc 1 — efficacité chauffage en dessous du seuil", action: "Vérifier sondes lambda, catalyseur" },
  P0430: { cause: "Catalyseur banc 2 — efficacité en dessous du seuil", action: "Vérifier sondes lambda banc 2, catalyseur banc 2" },
  P0440: { cause: "Système contrôle évaporation carburant (EVAP) — défaillance générale", action: "Vérifier bouchon réservoir, canister, solénoïde purge, durites EVAP" },
  P0441: { cause: "Flux de purge EVAP incorrect", action: "Vérifier solénoïde purge canister, durites EVAP" },
  P0442: { cause: "Fuite détectée système EVAP (petite)", action: "Vérifier bouchon réservoir, joints durites EVAP, canister" },
  P0443: { cause: "Circuit solénoïde purge canister — défaillance", action: "Vérifier connecteur solénoïde purge, résistance, câblage" },
  P0446: { cause: "Circuit commande ventilation canister — défaillance", action: "Vérifier solénoïde ventilation canister, câblage" },
  P0447: { cause: "Circuit ventilation canister — ouvert", action: "Vérifier câblage, solénoïde ventilation canister" },
  P0448: { cause: "Circuit ventilation canister — fermé", action: "Vérifier solénoïde ventilation coincé fermé" },
  P0449: { cause: "Circuit solénoïde valve évent canister — défaillance", action: "Vérifier connecteur, solénoïde" },
  P0455: { cause: "Fuite détectée système EVAP (importante)", action: "Vérifier bouchon réservoir manquant/desserré, gros joints durites EVAP" },
  P0456: { cause: "Fuite détectée système EVAP (très petite)", action: "Contrôle pression EVAP — vérifier tous les joints, bouchon réservoir" },
  P0460: { cause: "Circuit capteur niveau carburant — défaillance", action: "Vérifier connecteur capteur jauge, câblage, potentiomètre jauge" },
  P0461: { cause: "Signal capteur niveau carburant hors plage", action: "Vérifier potentiomètre jauge, flotteur" },
  P0480: { cause: "Circuit commande ventilateur refroidissement 1 — défaillance", action: "Vérifier relais ventilateur, câblage, moteur ventilateur" },
  P0481: { cause: "Circuit commande ventilateur refroidissement 2 — défaillance", action: "Vérifier relais ventilateur 2, câblage" },
  P0500: { cause: "Circuit capteur vitesse véhicule (VSS)", action: "Vérifier connecteur VSS, câblage, capteur de vitesse" },
  P0501: { cause: "Signal VSS hors plage", action: "Vérifier capteur VSS, câblage, roue phonique boîte" },
  P0505: { cause: "Système régulation ralenti — défaillance", action: "Nettoyer corps papillon, vérifier valve IAC/IACV, durite de vide" },
  P0506: { cause: "Régulation ralenti — régime trop bas", action: "Nettoyer corps papillon, vérifier valve IAC, fuites de vide" },
  P0507: { cause: "Régulation ralenti — régime trop haut", action: "Vérifier fuite d'air, valve IAC coincée ouverte, câble accélérateur" },
  P0510: { cause: "Circuit interrupteur papillon fermé — défaillance", action: "Vérifier interrupteur TPS, câblage" },
  P0520: { cause: "Circuit capteur pression d'huile moteur — défaillance", action: "Vérifier capteur pression huile, câblage, niveau huile" },
  P0521: { cause: "Signal capteur pression huile hors plage", action: "Vérifier capteur pression huile, pression réelle" },
  P0522: { cause: "Capteur pression huile — signal trop bas", action: "Vérifier câblage, capteur pression huile, pression réelle (risque sérieux)" },
  P0523: { cause: "Capteur pression huile — signal trop haut", action: "Vérifier court-circuit, capteur pression huile" },
  P0560: { cause: "Circuit tension batterie système — défaillance", action: "Vérifier batterie, alternateur, connexions" },
  P0562: { cause: "Tension système trop basse", action: "Vérifier batterie (tension repos < 12V), courroie alternateur, régulateur" },
  P0563: { cause: "Tension système trop haute", action: "Vérifier régulateur alternateur (surtension)" },
  P0571: { cause: "Circuit interrupteur frein — défaillance", action: "Vérifier interrupteur pédale de frein, câblage" },
  P0600: { cause: "Liaison série — défaillance", action: "Vérifier réseau CAN, câblage, ECU" },
  P0601: { cause: "ECU — erreur mémoire interne", action: "Réinitialiser ECU, reprogram si persistant" },
  P0604: { cause: "ECU — erreur RAM interne", action: "Réinitialiser ECU, reprogram si persistant" },
  P0605: { cause: "ECU — erreur ROM interne", action: "Reprogram ou remplacer ECU" },
  P0606: { cause: "ECU — défaillance processeur", action: "Reprogram ou remplacer ECU" },
  P0607: { cause: "Module de contrôle — performance", action: "Vérifier alimentation ECU, masses, reprogram" },
  P0615: { cause: "Circuit relais démarreur — défaillance", action: "Vérifier relais démarreur, câblage, contacteur" },
  P0616: { cause: "Circuit relais démarreur — signal trop bas", action: "Vérifier alimentation relais démarreur" },
  P0617: { cause: "Circuit relais démarreur — signal trop haut", action: "Vérifier court-circuit relais démarreur" },
  P0620: { cause: "Circuit commande alternateur — défaillance", action: "Vérifier câblage alternateur, régulateur" },
  P0625: { cause: "Circuit commande champ alternateur — signal trop bas", action: "Vérifier câblage alternateur, régulateur" },
  P0626: { cause: "Circuit commande champ alternateur — signal trop haut", action: "Vérifier court-circuit alternateur" },
  P0627: { cause: "Circuit commande pompe carburant — ouvert", action: "Vérifier relais pompe carburant, câblage, fusible" },
  P0628: { cause: "Circuit commande pompe carburant — trop bas", action: "Vérifier relais, alimentation pompe" },
  P0629: { cause: "Circuit commande pompe carburant — trop haut", action: "Vérifier court-circuit pompe" },
  P0641: { cause: "Tension de référence capteur A — circuit ouvert", action: "Vérifier alimentation 5V capteurs (MAP, TPS, etc.), câblage ECU" },
  P0642: { cause: "Tension de référence capteur A — trop basse", action: "Vérifier court-circuit masse sur circuit 5V, ECU" },
  P0643: { cause: "Tension de référence capteur A — trop haute", action: "Vérifier court-circuit + sur circuit 5V" },
  P0651: { cause: "Tension de référence capteur B — circuit ouvert", action: "Vérifier alimentation 5V capteurs B, câblage ECU" },
  P0700: { cause: "Demande de voyant défaut transmis par module BVA", action: "Lire les codes du module BVA séparément avec la valise" },
  P0705: { cause: "Circuit capteur position sélecteur BVA (PRNDL) — défaillance", action: "Vérifier capteur position sélecteur, câblage BVA" },
  P0706: { cause: "Signal capteur position sélecteur hors plage", action: "Vérifier câblage, capteur position BVA" },
  P0710: { cause: "Circuit capteur température fluide BVA — défaillance", action: "Vérifier capteur température BVA, câblage" },
  P0711: { cause: "Signal capteur température BVA hors plage", action: "Vérifier capteur température BVA" },
  P0712: { cause: "Capteur température BVA — signal trop bas", action: "Vérifier câblage, capteur température BVA" },
  P0713: { cause: "Capteur température BVA — signal trop haut", action: "Vérifier court-circuit, capteur température BVA" },
  P0715: { cause: "Circuit capteur vitesse turbine (entrée BVA) — défaillance", action: "Vérifier capteur vitesse turbine BVA, câblage" },
  P0720: { cause: "Circuit capteur vitesse sortie BVA — défaillance", action: "Vérifier capteur vitesse sortie BVA, câblage" },
  P0725: { cause: "Circuit signal régime moteur (BVA) — défaillance", action: "Vérifier câblage entre ECM et TCM" },
  P0730: { cause: "Rapport BVA incorrect", action: "Vérifier niveau huile BVA, solénoïdes BVA" },
  P0731: { cause: "Rapport 1 BVA incorrect", action: "Vérifier solénoïdes rapport 1, pression BVA, niveau huile" },
  P0732: { cause: "Rapport 2 BVA incorrect", action: "Vérifier solénoïdes rapport 2" },
  P0733: { cause: "Rapport 3 BVA incorrect", action: "Vérifier solénoïdes rapport 3" },
  P0734: { cause: "Rapport 4 BVA incorrect", action: "Vérifier solénoïdes rapport 4" },
  P0735: { cause: "Rapport 5 BVA incorrect", action: "Vérifier solénoïdes rapport 5" },
  P0740: { cause: "Circuit solénoïde convertisseur de couple (TCC) — défaillance", action: "Vérifier solénoïde TCC, niveau huile BVA" },
  P0741: { cause: "Solénoïde TCC — performance/coincé ouvert", action: "Vérifier solénoïde TCC, huile BVA, pression" },
  P0743: { cause: "Circuit solénoïde TCC — défaillance électrique", action: "Vérifier câblage solénoïde TCC" },
  P0748: { cause: "Circuit solénoïde pression de ligne A — défaillance électrique", action: "Vérifier câblage solénoïde pression BVA" },
  P0750: { cause: "Circuit solénoïde A transmission — défaillance", action: "Vérifier solénoïde A BVA, câblage, huile BVA" },
  P0751: { cause: "Solénoïde A transmission — performance/coincé ouvert", action: "Vérifier solénoïde A, huile BVA" },
  P0755: { cause: "Circuit solénoïde B transmission — défaillance", action: "Vérifier solénoïde B BVA, câblage" },
  P0760: { cause: "Circuit solénoïde C transmission — défaillance", action: "Vérifier solénoïde C BVA, câblage" },
  P0770: { cause: "Circuit solénoïde E transmission — défaillance", action: "Vérifier solénoïde E BVA" },
  P0780: { cause: "Défaillance changement de rapport BVA", action: "Vérifier niveau/état huile BVA, solénoïdes, pression ligne" },
  P0800: { cause: "Demande transfert commande — circuit défaillant", action: "Vérifier câblage boîte de transfert, module" },
  P0826: { cause: "Interrupteur sélection montée/descente rapport — défaillance", action: "Vérifier interrupteur palettes, câblage" },
  P0840: { cause: "Circuit capteur pression transmission A — défaillance", action: "Vérifier capteur pression BVA, câblage" },
  P0850: { cause: "Interrupteur point mort BVA — défaillance", action: "Vérifier interrupteur position neutre BVA" },
  P0A00: { cause: "Moteur électrique/générateur A — défaillance", action: "Vérifier système hybride/électrique, consulter spécialiste HV" },
  P0A08: { cause: "Convertisseur DC-DC — défaillance", action: "Vérifier système hybride, convertisseur DC-DC" },
  P1000: { cause: "Tests OBD II non complets (cycles de conduite incomplets)", action: "Effectuer des cycles de conduite pour compléter les moniteurs OBD" },
  // Toyota / Lexus codes spécifiques (fréquents en CI)
  P1300: { cause: "[Toyota] Circuit allumeur défaillant (banc 1)", action: "Vérifier bobines d'allumage, signal IGF, câblage vers ECU" },
  P1301: { cause: "[Toyota] Circuit allumeur cylindre 1 défaillant", action: "Vérifier bobine cyl.1, signal IGF, câblage" },
  P1302: { cause: "[Toyota] Circuit allumeur cylindre 2 défaillant", action: "Vérifier bobine cyl.2, signal IGF" },
  P1303: { cause: "[Toyota] Circuit allumeur cylindre 3 défaillant", action: "Vérifier bobine cyl.3, signal IGF" },
  P1304: { cause: "[Toyota] Circuit allumeur cylindre 4 défaillant", action: "Vérifier bobine cyl.4, signal IGF" },
  P1349: { cause: "[Toyota] Système VVT-i défaillant — calage variable arbre à cames", action: "Vérifier solénoïde OCV (huile souvent encrassé), pression huile, qualité huile" },
  P1400: { cause: "[Toyota] Capteur température EGR / sous-papillon — circuit défaillant", action: "Vérifier capteur température EGR, câblage" },
  P1401: { cause: "[Toyota] Capteur différentiel pression EGR", action: "Vérifier capteur différentiel EGR, durites" },
  P1455: { cause: "[Toyota] Grande fuite système EVAP", action: "Vérifier bouchon réservoir, canister, joints durites EVAP" },
  P1500: { cause: "[Toyota] Circuit signal démarreur — défaillance", action: "Vérifier contacteur de démarrage, câblage signal STA" },
  P1520: { cause: "[Toyota] Circuit interrupteur stop — défaillance", action: "Vérifier contacteur pédale de frein" },
  P1600: { cause: "[Toyota] Défaillance mémoire ECU / communication série", action: "Réinitialiser ECU, vérifier alimentation ECU (masse propre)" },
  P1780: { cause: "[Toyota] Circuit interrupteur position boîte (P/N) — défaillance", action: "Vérifier contacteur neutre BVA, câblage" },
  // Peugeot / Citroën codes spécifiques
  P1315: { cause: "[Peugeot] Pré-allumage détecté", action: "Vérifier bougies, qualité carburant, capteur cliquetis" },
  P1336: { cause: "[Peugeot/Citroën] Apprentissage capteur PMH non effectué", action: "Réaliser procédure d'apprentissage PMH avec valise Peugeot/PP2000" },
  P1340: { cause: "[Peugeot/Citroën] Capteur position arbre à cames — défaillance", action: "Vérifier capteur ACM, roue phonique, câblage" },
  P1351: { cause: "[Peugeot] Bobine allumage groupe A — défaillance", action: "Vérifier bobine allumage, câblage HT" },
  P1352: { cause: "[Peugeot] Bobine allumage groupe B — défaillance", action: "Vérifier bobine allumage groupe B" },
  P1380: { cause: "[Peugeot] Défaillance gestion bougies de préchauffage", action: "Vérifier bougies de préchauffage, relais préchauffage" },
  P1600: { cause: "[Peugeot/Citroën] Défaillance communication ECU injection", action: "Vérifier alimentation ECU, masse carrosserie, connecteur ECU" },
  P1618: { cause: "[Peugeot] Tension alimentation capteurs ECU — trop basse", action: "Vérifier batterie, alternateur, connexion masse ECU" },
  P1629: { cause: "[Peugeot] Coupure alimentation 5V capteurs", action: "Vérifier court-circuit sur circuit 5V ECU" },
  // Renault / Dacia codes spécifiques
  P1100: { cause: "[Renault] Signal régime moteur absent ou incohérent", action: "Vérifier capteur PMH, câblage, roue phonique" },
  P1110: { cause: "[Renault] Débit air (MAF) — circuit ouvert ou déconnecté", action: "Vérifier connecteur MAF, nettoyer ou remplacer" },
  P1335: { cause: "[Renault] Signal capteur PMH — absence ou intermittence", action: "Vérifier capteur PMH, entrefer, roue phonique" },
  P1609: { cause: "[Renault] Défaillance communication injection/carrosserie", action: "Vérifier câblage entre calculateur injection et BSI/UCH" },
  P1625: { cause: "[Renault] Tension alimentation ECU insuffisante (batterie)", action: "Vérifier batterie, alternateur, masse carrosserie" },
  P1750: { cause: "[Renault] Unité de contrôle boîte automatique — défaillance", action: "Vérifier module BVA, câblage CAN vers TCM" },
  // Codes diesel courants (HDi, CDTi, dCi — très répandus en CI)
  P2002: { cause: "Filtre à particules DPF — efficacité sous le seuil", action: "Forcer régénération DPF avec valise, vérifier conditions de regen (températures)" },
  P2003: { cause: "Filtre à particules — trop plein / obstruction grave", action: "Régénération forcée requise, vérifier capteur différentiel pression DPF" },
  P2004: { cause: "Volet d'admission (swirl flap) coincé ouvert", action: "Vérifier volet d'admission, actionneur, câblage" },
  P2006: { cause: "Volet d'admission (swirl flap) coincé fermé", action: "Vérifier volet d'admission, actionneur" },
  P2008: { cause: "Circuit commande volet d'admission — défaillance", action: "Vérifier câblage volet d'admission, résistance actionneur" },
  P2015: { cause: "Capteur position volet d'admission — hors plage", action: "Vérifier capteur position volet, câblage" },
  P2200: { cause: "Capteur NOx banc 1 — circuit défaillant", action: "Vérifier capteur NOx, câblage, module SCR" },
  P2263: { cause: "Turbo — suralimentation insuffisante (géométrie variable / wastegate)", action: "Vérifier actionneur turbo, durites de vide, nettoyer géométrie variable" },
  P2265: { cause: "Capteur eau dans carburant — signal trop haut", action: "Purger filtre carburant, vérifier capteur eau" },
  P2266: { cause: "Capteur eau dans carburant — signal trop bas", action: "Vérifier capteur eau dans carburant, câblage" },
  P246C: { cause: "Filtre à particules DPF — température régénération non atteinte", action: "Vérifier capteur température DPF, conditions de régénération (autoroute requise)" },
  C0031: { cause: "Capteur vitesse roue avant droite — défaillance", action: "Vérifier capteur ABS roue avant droite, câblage, roue phonique" },
  C0034: { cause: "Capteur vitesse roue avant gauche — défaillance", action: "Vérifier capteur ABS roue avant gauche, câblage, roue phonique" },
  C0037: { cause: "Capteur vitesse roue arrière droite — défaillance", action: "Vérifier capteur ABS roue arrière droite, câblage, roue phonique" },
  C0040: { cause: "Capteur vitesse roue arrière gauche — défaillance", action: "Vérifier capteur ABS roue arrière gauche, câblage, roue phonique" },
  C0044: { cause: "Capteur pression maître-cylindre — défaillance", action: "Vérifier capteur pression freinage, câblage" },
  C0050: { cause: "Capteur vitesse roue — défaillance générale", action: "Identifier la roue avec valise ABS, vérifier capteur et roue phonique" },
  C0060: { cause: "Actionneur frein avant gauche — défaillance", action: "Vérifier électrovanne ABS avant gauche, câblage" },
  C0065: { cause: "Actionneur frein avant droit — défaillance", action: "Vérifier électrovanne ABS avant droit" },
  C0070: { cause: "Actionneur frein arrière gauche — défaillance", action: "Vérifier électrovanne ABS arrière gauche" },
  C0075: { cause: "Actionneur frein arrière droit — défaillance", action: "Vérifier électrovanne ABS arrière droit" },
  C0110: { cause: "Moteur pompe ABS — défaillance", action: "Vérifier moteur pompe ABS, relais, alimentation" },
  C0121: { cause: "Électrovanne ABS — défaillance", action: "Vérifier électrovanne ABS, alimentation, câblage" },
  C0131: { cause: "Capteur pression ABS/ESP — défaillance", action: "Vérifier capteur pression circuit de freinage" },
  C0245: { cause: "Fréquence capteur vitesse roue hors plage", action: "Vérifier roue phonique (rouille, dents manquantes), capteur ABS" },
  B0001: { cause: "Airbag conducteur — circuit défaillant", action: "Vérifier connecteur spirale de contact, câblage airbag volant" },
  B0002: { cause: "Airbag passager — circuit défaillant", action: "Vérifier connecteur airbag tableau de bord" },
  B0003: { cause: "Airbag latéral gauche — circuit défaillant", action: "Vérifier connecteur airbag siège gauche" },
  B0004: { cause: "Airbag latéral droit — circuit défaillant", action: "Vérifier connecteur airbag siège droit" },
  B0010: { cause: "Prétensionneur ceinture conducteur — circuit défaillant", action: "Vérifier connecteur prétensionneur, câblage" },
  B0020: { cause: "Prétensionneur ceinture passager — circuit défaillant", action: "Vérifier connecteur prétensionneur passager" },
  B0051: { cause: "Module airbag — tension alimentation trop basse", action: "Vérifier batterie, fusible alimentation module airbag" },
  B0052: { cause: "Module airbag — tension alimentation trop haute", action: "Vérifier régulateur alternateur" },
  B0064: { cause: "Capteur crash — défaillance", action: "Vérifier capteur impact, câblage" },
  B0081: { cause: "Capteur occupation siège passager — défaillance", action: "Vérifier capteur poids siège passager, câblage" },
  U0001: { cause: "Bus CAN haute vitesse — défaillance communication", action: "Vérifier terminaisons réseau CAN (120 ohms), câblage CAN H/L" },
  U0010: { cause: "Bus CAN vitesse moyenne — défaillance communication", action: "Vérifier câblage CAN M, terminaisons" },
  U0073: { cause: "Bus de contrôle — communication perdue (CAN)", action: "Vérifier câblage CAN, terminaisons, modules" },
  U0100: { cause: "Communication perdue avec ECM/PCM A", action: "Vérifier câblage CAN vers ECU, alimentation ECU" },
  U0101: { cause: "Communication perdue avec TCM (boîte)", action: "Vérifier câblage CAN vers module BVA" },
  U0121: { cause: "Communication perdue avec module ABS", action: "Vérifier câblage CAN vers module ABS, alimentation ABS" },
  U0140: { cause: "Communication perdue avec module carrosserie (BCM)", action: "Vérifier câblage CAN vers BCM" },
  U0155: { cause: "Communication perdue avec tableau de bord (cluster)", action: "Vérifier câblage CAN vers combiné instruments" },
  U0164: { cause: "Communication perdue avec module climatisation HVAC", action: "Vérifier câblage CAN vers module clim" },
};

// Recherche instantanée d'un code OBD dans la table locale embarquée.
function liveToolLookupOBDCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  const entry = OBD_CODES[normalized];
  if (entry) {
    return `Code ${normalized} : ${entry.cause}. Action : ${entry.action}.`;
  }
  // Recherche partielle si le code exact n'est pas dans la table
  const partialMatches = Object.entries(OBD_CODES).filter(([k]) => k.startsWith(normalized.slice(0, 3)));
  if (partialMatches.length > 0) {
    const lines = partialMatches.slice(0, 3).map(([k, v]) => `${k} : ${v.cause}`);
    return `Code ${normalized} non trouvé exactement. Codes proches : ${lines.join(" | ")}. Utilise rechercher_fiche_technique pour plus de précision.`;
  }
  return `Code ${normalized} non trouvé dans la base locale. Utilise l'outil rechercher_fiche_technique pour une recherche approfondie.`;
}

// Génère un lien WhatsApp pré-rempli pour commander une pièce identifiée dans la boutique.
function liveToolOrderPart(pieceName: string, priceFcfa: number | null, vehicule: string, phone: string): string {
  const WA_SHOP = "2250707312797";
  const priceStr = priceFcfa ? `${priceFcfa} F CFA` : "prix à confirmer";
  const msg = `Bonjour DiagAssist, je souhaite commander la pièce suivante :\n- Pièce : ${pieceName}\n- Véhicule : ${vehicule}\n- Prix indiqué : ${priceStr}\n- Mon numéro : ${phone || "non renseigné"}`;
  return `https://wa.me/${WA_SHOP}?text=${encodeURIComponent(msg)}`;
}

// Procédures de réparation structurées pour les 20 pannes les plus fréquentes en CI.
const REPAIR_PROCEDURES: Record<string, { titre: string; etapes: string[]; conseil_ci: string }> = {
  rates_allumage: { titre: "Ratés d'allumage (P0300-P030x)", etapes: ["1. Identifier le ou les cylindres fautifs (valise — données live)", "2. Permuter les bougies entre cylindres adjacents — le raté se déplace ? → bougie défectueuse", "3. Permuter les bobines — le raté se déplace ? → bobine défectueuse", "4. Vérifier la résistance des injecteurs (12-14 Ω essence)", "5. Compression cylindre suspect : < 10 bar → problème mécanique (soupapes, segment)", "6. Vérifier fuites de vide sur les durites d'admission (spray carbu moteur chaud)"], conseil_ci: "À Abidjan : carburant de mauvaise qualité = cause fréquente. Faire remplir dans une station Total/Shell. Bougies NGK ou Denso recommandées (éviter les copies chinoises)." },
  melange_pauvre: { titre: "Mélange pauvre P0171/P0174", etapes: ["1. Vérifier fuites d'air admission (durite principale, joints papillon, raccords collecteur)", "2. Nettoyer le débitmètre MAF (spray nettoyant MAF — ne pas toucher le fil)", "3. Mesurer pression carburant (3,0-3,8 bar essence — moteur tournant)", "4. Vérifier les sondes lambda (oscilloscope ou valise — doit alterner 0,1-0,9V)", "5. Vérifier filtre à carburant (colmaté si vieux > 2 ans en CI)", "6. Mesurer débit injecteurs (balance test valise)"], conseil_ci: "Fuites d'admission très fréquentes en CI à cause de la chaleur qui abîme les durites. Inspecter toutes les durites noires sous le capot." },
  surchauffe: { titre: "Surchauffe moteur", etapes: ["1. ARRÊTER le moteur immédiatement — ne pas continuer à rouler", "2. Laisser refroidir 30 min AVANT d'ouvrir le bouchon radiateur", "3. Vérifier niveau liquide refroidissement (réservoir + radiateur froid)", "4. Vérifier thermostat (ouvre-t-il à 80-90°C ?)", "5. Tester pompe à eau (jeu / bruit / débit)", "6. Inspecter courroie / courroie accessoire", "7. Vérifier ventilateur de refroidissement (électrique : test direct 12V)", "8. Contrôler joints de culasse (bulles dans radiateur, huile crémeuse, eau dans huile)"], conseil_ci: "Chaleur ambiante d'Abidjan aggrave tout défaut de refroidissement. Thermostat à remettre systématiquement si > 150 000 km. Utiliser eau + antigel 50/50 même en CI (protège les joints)." },
  alternateur: { titre: "Alternateur / batterie", etapes: ["1. Mesurer tension batterie à vide : doit être 12,5-12,8V (< 12V → batterie faible/morte)", "2. Démarrer moteur, mesurer aux bornes batterie : doit être 13,8-14,5V (sinon alternateur défaillant)", "3. Vérifier courroie alternateur (tension, état)", "4. Vérifier connecteur régulateur alternateur et masse carrosserie", "5. Test de charge : allumer phares + clim → tension doit rester > 13V", "6. Si tension OK mais voyant allumé : vérifier câblage voyant charge, diode de tableau"], conseil_ci: "Alternateurs Valeo ou Denso recommandés. Éviter les alternateurs reconstruits de mauvaise qualité — durée de vie très courte sous la chaleur." },
  demarreur: { titre: "Démarreur ne tourne pas / tourne mais ne démarre pas", etapes: ["1. Vérifier tension batterie (doit être > 12V)", "2. Vérifier la borne + et masse du démarreur (câbles gros section)", "3. Tester signal commande démarreur (50V sur solénoïde à la clé)", "4. Si cliquetis : solénoïde OK mais démarreur bloqué — retirer et tester hors voiture", "5. Si silence total : vérifier fusible principal, relais démarreur, contacteur de démarrage", "6. Si tourne sans accrocher : couronne d'entraînement usée ou bendix hors service"], conseil_ci: "Problème de masse très fréquent. Nettoyer et resserrer la tresse de masse moteur/carrosserie en premier." },
  capteur_pmh: { titre: "Capteur PMH (P0335-P0338)", etapes: ["1. Vérifier l'entrefer entre capteur et roue phonique (0,5-1,5 mm selon constructeur)", "2. Inspecter la roue phonique (dents manquantes = P0336)", "3. Mesurer résistance capteur PMH inductif : 500-1000 Ω (capteur Hall : 3 fils — vérifier alimentation 5V)", "4. Mesurer tension de sortie (oscilloscope) — signal sinusoïdal ou carré selon type", "5. Vérifier câblage blindé sans coupure ni court-circuit", "6. Nettoyer la roue phonique (rouille fréquente en CI à cause de la boue)"], conseil_ci: "Roue phonique rouillée = cause courante à Abidjan. Nettoyer à la brosse métallique avant de changer le capteur." },
  maf_encrase: { titre: "Débitmètre MAF encrassé / défaillant (P0100-P0103)", etapes: ["1. Débrancher le MAF et démarrer le moteur — amélioration visible ? → MAF défaillant", "2. Nettoyer avec spray nettoyant MAF spécifique (ne jamais toucher le fil avec les doigts)", "3. Vérifier les durites d'admission en aval du MAF (fuites = lectures faussées)", "4. Mesurer tension de sortie : 0,5V à vide, 4,5V pleine charge (environ)", "5. Vérifier filtre à air (colmaté = sous-alimentation MAF)", "6. Si nettoyage insuffisant : remplacer MAF"], conseil_ci: "Filtre à air colmaté très fréquent en CI (poussière rouge latérite). Changer le filtre à air tous les 15 000 km minimum." },
  bougies_prechauffage: { titre: "Bougies de préchauffage diesel (P0380)", etapes: ["1. Mesurer résistance chaque bougie : doit être 0,5-2 Ω (circuit ouvert = bougie HS)", "2. Vérifier alimentation relais bougies (tension batterie à la commande)", "3. Mesurer courant de chauffe (ampèremètre sur câble bougies) : 15-25A normal par bougie", "4. Vérifier durée de chauffe via valise (voyant / temps de préchauffage)", "5. Injecter huile moteur dans les alésages bougies pour faciliter le dévissage (éviter la casse)", "6. Remplacer toutes les bougies en même temps"], conseil_ci: "Bougies de préchauffage HS = démarrage difficile le matin en saison sèche ou en altitude (Man, Korhogo). Marques Beru, Bosch, NGK recommandées." },
  egr_bouche: { titre: "Vanne EGR bouchée diesel (P0401/P0403)", etapes: ["1. Inspecter la vanne EGR — retirer et vérifier encrassement carbone", "2. Nettoyer à la brosse + nettoyant carburateur (ou remplacement si trop bouchée)", "3. Vérifier durites EGR (fissures, flexibles bouchés)", "4. Mesurer capteur différentiel pression EGR (valeur > 2 kPa lors d'ouverture EGR)", "5. Tester solénoïde EGR (résistance 20-40 Ω)", "6. Après nettoyage : effacer le code et faire route pour valider"], conseil_ci: "Carburant diesel de mauvaise qualité en CI = EGR s'encrasse très vite. Conseiller entretien EGR tous les 60 000 km." },
  turbo: { titre: "Turbo diesel insuffisant / fumée (P2263)", etapes: ["1. Vérifier durites turbo (fissures, joints toriques côté pression)", "2. Vérifier actionneur géométrie variable (VNT) : se déplace librement ? Nettoyer tiges", "3. Vérifier niveau et état huile moteur (huile dégradée détruit le turbo)", "4. Mesurer pression suralimentation avec valise (turbo doit atteindre 1,5-2 bar selon moteur)", "5. Vérifier filtre à air (colmaté = turbo sous-alimenté)", "6. Avant remplacement : vérifier retour huile turbo (colmaté = nouveau turbo brûlé en < 1000 km)"], conseil_ci: "Ne jamais éteindre moteur à chaud sans laisser tourner 2 min — détruit le turbo. Huile de qualité 5W40 minimum." },
  courroie_distribution: { titre: "Courroie de distribution / chaîne", etapes: ["1. Repérer marque constructeur pour l'intervalle (Renault/Peugeot 1.9D : 120 000 km / Toyota : chaîne mais surveiller tendeur)", "2. Vérifier galet tendeur (grince, jeu), galet enrouleur, pompe à eau (si commandée par courroie)", "3. Contrôle calage distribution (marques sur poulie vilebrequin + arbre à cames)", "4. Vérifier niveau huile moteur (huile basse = usure chaîne accélérée)", "5. En cas de saut de distribution : contrôler jeu soupapes avant redémarrage (risque choc piston/soupape)"], conseil_ci: "Courroie de distribution = panne gravissime si elle casse. Recommander remplacement préventif à 120 000 km ou 5 ans. Éviter les courroies 'made in China' sans marque." },
  abs_capteur: { titre: "ABS / capteur de roue (C0031-C0050)", etapes: ["1. Identifier la roue fautive avec le code (C0031=AVD, C0034=AVG, C0037=ARD, C0040=ARG)", "2. Inspecter la roue phonique (rouille, boue, dent manquante — roue phonique dans la roulement en acier souvent rouillée en CI)", "3. Mesurer résistance capteur inductif : 900-2000 Ω selon marque", "4. Mesurer entrefer : max 1,5 mm (roue phonique souvent voilée après choc)", "5. Vérifier câblage capteur (coupure sous la voiture très fréquente sur les pistes en CI)", "6. Si roulement intégré : remplacer roulement complet"], conseil_ci: "Pistes latéritiques d'Abidjan et de l'intérieur = câblage coupé et roue phonique rouillée très fréquent. Inspecter systématiquement le câblage avant de commander un capteur." },
  injecteurs_diesel: { titre: "Injecteurs diesel (P0201-P0206, déséquilibre)", etapes: ["1. Test balance injecteurs avec valise (contribution de chaque cylindre)", "2. Mesurer résistance bobine injecteur common rail : 0,5-1 Ω (piezo) ou 0,3-1 Ω (solénoïde)", "3. Test retour injecteurs (mesurer débit retour à la pompe — injecteur fuyant = débit retour élevé)", "4. Vérifier pression rail carburant (doit tenir à 1600-2000 bar selon moteur)", "5. Nettoyage ultrason avant remplacement (économise 80% du coût)", "6. Après remplacement : reprogrammation codes IMA/QR avec valise"], conseil_ci: "Diesel de mauvaise qualité = usure prématurée injecteurs. Recommander filtre à carburant changé tous les 30 000 km et séparateur eau/huile." },
  can_communication: { titre: "Défaut réseau CAN / communication (U0xxx)", etapes: ["1. Vérifier alimentation et masse de TOUS les calculateurs (ECU, ABS, BSI, BVA)", "2. Mesurer résistance réseau CAN entre CAN H et CAN L : doit être 60 Ω (deux terminaisons 120 Ω en parallèle)", "3. Identifier le module déconnecté (valise — liste des modules communicants)", "4. Vérifier connecteurs humides ou oxydés (fréquent sous les ailes et sous plancher en CI)", "5. Chercher court-circuit sur CAN H ou CAN L (masse ou +12V)", "6. Contrôler fusibles alimentation calculateurs"], conseil_ci: "Eau dans les connecteurs = cause numéro 1 des pannes CAN à Abidjan (saison des pluies). Protéger les connecteurs avec de la graisse diélectrique." },
  pompe_eau: { titre: "Pompe à eau", etapes: ["1. Vérifier jeu axial de la pompe (agiter la poulie — jeu = roulement usé)", "2. Écouter bruit de frottement au démarrage (roulement à sec)", "3. Vérifier fuite au niveau du joint (trace blanche calcaire autour de la pompe)", "4. Inspecter les ailettes de la turbine (aluminium corrodé = débit insuffisant)", "5. Si commandée par courroie de distribution : remplacer SYSTÉMATIQUEMENT avec la courroie", "6. Remplacer joint d'étanchéité + liquide refroidissement complet"], conseil_ci: "Pompes en aluminium à éviter — préférer pompe d'origine ou marque Gates/GMB. Toujours remplacer en même temps que la courroie." },
  thermostat: { titre: "Thermostat défaillant (P0128)", etapes: ["1. P0128 = thermostat reste ouvert (moteur n'atteint pas 90°C)", "2. Vérifier avec valise la température moteur en route (doit monter à 85-95°C)", "3. Tester le thermostat : plonger dans eau chaude (> 85°C) — doit s'ouvrir", "4. Vérifier capteur ECT (peut donner une fausse indication de basse température)", "5. Remplacer thermostat + joint — opération peu coûteuse", "6. Vider et remplir liquide refroidissement après remplacement"], conseil_ci: "Thermostat souvent retiré par les mécaniciens 'pour éviter la surchauffe' — grave erreur qui empêche le moteur d'atteindre sa température de fonctionnement et augmente la consommation." },
};

function liveToolGetRepairProcedure(faultType: string, make?: string): string {
  const normalized = faultType.trim().toLowerCase()
    .replace(/é|è|ê/g, "e").replace(/à/g, "a").replace(/ô/g, "o").replace(/î|ï/g, "i");

  const KEY_MAP: Record<string, string> = {
    rate: "rates_allumage", misfir: "rates_allumage", "p0300": "rates_allumage",
    pauvre: "melange_pauvre", lean: "melange_pauvre", "p0171": "melange_pauvre", "p0174": "melange_pauvre",
    surchauffe: "surchauffe", chauffe: "surchauffe", temperature: "surchauffe",
    alternateur: "alternateur", batterie: "alternateur", charge: "alternateur",
    demarreur: "demarreur", starter: "demarreur", demarre: "demarreur",
    pmh: "capteur_pmh", vilebrequin: "capteur_pmh", "p0335": "capteur_pmh",
    maf: "maf_encrase", debitmetre: "maf_encrase", "p0100": "maf_encrase",
    prechauffage: "bougies_prechauffage", bougie: "bougies_prechauffage", diesel_start: "bougies_prechauffage",
    egr: "egr_bouche", "p0401": "egr_bouche",
    turbo: "turbo", suralimentation: "turbo", "p2263": "turbo",
    distribution: "courroie_distribution", courroie: "courroie_distribution", chaine: "courroie_distribution",
    abs: "abs_capteur", capteur_roue: "abs_capteur", "c003": "abs_capteur",
    injecteur: "injecteurs_diesel", injection: "injecteurs_diesel",
    can: "can_communication", "u0": "can_communication", communication: "can_communication",
    pompe_eau: "pompe_eau", "water pump": "pompe_eau",
    thermostat: "thermostat", "p0128": "thermostat",
  };

  let key: string | undefined;
  for (const [k, v] of Object.entries(KEY_MAP)) {
    if (normalized.includes(k)) { key = v; break; }
  }

  if (!key) {
    return `Procédure non trouvée pour "${faultType}". Procédures disponibles : ratés d'allumage, mélange pauvre, surchauffe, alternateur, démarreur, capteur PMH, MAF encrassé, bougies préchauffage, EGR bouché, turbo, courroie distribution, ABS capteur, injecteurs diesel, réseau CAN, pompe à eau, thermostat.`;
  }

  const proc = REPAIR_PROCEDURES[key];
  const makeNote = make ? ` (${make})` : "";
  return `Procédure${makeNote} — ${proc.titre}\n${proc.etapes.join("\n")}\nConseil Côte d'Ivoire : ${proc.conseil_ci}`;
}

// Récupère les N derniers diagnostics enregistrés pour un numéro de téléphone donné.
// Utilisé au démarrage de l'appel live pour injecter le contexte historique dans systemInstruction,
// et exposé comme outil consulter_historique_diagnostic pour les requêtes en cours d'appel.
async function liveGetRecentDiagnostics(phone: string, limit = 3): Promise<string> {
  if (!dbPool) return "";
  try {
    const { rows } = await dbPool.query(
      `SELECT vehicle_summary, symptom, probable_cause, recommended_action, created_at
       FROM live_diagnostics WHERE phone = $1 ORDER BY created_at DESC LIMIT $2`,
      [phone, limit]
    );
    if (rows.length === 0) return "";
    const lines = rows.map((r: any, i: number) => {
      const date = new Date(Number(r.created_at)).toLocaleDateString("fr-FR");
      return `Appel ${i + 1} (${date}) — Véhicule : ${r.vehicle_summary} | Symptôme : ${r.symptom} | Cause : ${r.probable_cause} | Action : ${r.recommended_action}`;
    });
    return lines.join("\n");
  } catch (err) {
    console.warn("[Live] Erreur lecture historique diagnostics:", err);
    return "";
  }
}

type ScannerResult = { dtcs: string[]; summary: string; completedAt: number };

async function persistScannerResult(phone: string, r: ScannerResult): Promise<void> {
  if (!dbPool || !phone) return;
  try {
    await dbPool.query(
      `INSERT INTO scanner_results (phone, dtcs, summary, completed_at) VALUES ($1, $2::jsonb, $3, $4)`,
      [phone, JSON.stringify(r.dtcs || []), r.summary || "", r.completedAt]
    );
    // Garde seulement les 20 derniers scans par profil.
    await dbPool.query(
      `DELETE FROM scanner_results WHERE phone = $1 AND id NOT IN (SELECT id FROM scanner_results WHERE phone = $1 ORDER BY completed_at DESC LIMIT 20)`,
      [phone]
    );
  } catch (err) {
    console.warn("[Scanner] Échec de l'enregistrement du résultat de scan:", err);
  }
}

// Dernier scan du profil (mémoire d'abord, sinon base), au plus maxAgeMs.
async function getLatestScannerResult(phone: string, memory: Map<string, ScannerResult>, maxAgeMs: number): Promise<ScannerResult | undefined> {
  if (!phone) return undefined;
  const mem = memory.get(phone);
  if (mem && Date.now() - mem.completedAt < maxAgeMs) return mem;
  if (!dbPool) return undefined;
  try {
    const { rows } = await dbPool.query(
      `SELECT dtcs, summary, completed_at FROM scanner_results WHERE phone = $1 AND completed_at > $2 ORDER BY completed_at DESC LIMIT 1`,
      [phone, Date.now() - maxAgeMs]
    );
    if (rows.length === 0) return undefined;
    const r = rows[0];
    return { dtcs: Array.isArray(r.dtcs) ? r.dtcs : [], summary: r.summary || "", completedAt: Number(r.completed_at) };
  } catch (err) {
    console.warn("[Scanner] Erreur lecture dernier scan:", err);
    return undefined;
  }
}

// Enregistre le diagnostic établi pendant l'appel live. Pas d'envoi WhatsApp automatique côté
// serveur (choix explicite : pas de Twilio) — un lien wa.me prérempli est renvoyé pour que le
// mécanicien l'envoie lui-même en un tap depuis son propre WhatsApp (voir dispatch de toolCall).
async function liveToolSaveDiagnostic(
  phone: string,
  vehicule: string,
  symptome: string,
  causeProbable: string,
  actionRecommandee: string
): Promise<{ toolResult: string; whatsappUrl: string }> {
  const message = `Bonjour, voici le récapitulatif de votre diagnostic DiagAssist :\n\nVéhicule : ${vehicule}\nSymptôme : ${symptome}\nCause probable : ${causeProbable}\nAction recommandée : ${actionRecommandee}\n\n— L'équipe DiagAssist 🚗🔧\nhttps://www.diagassist.app`;
  const whatsappUrl = `https://wa.me/${phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(message)}`;

  if (dbPool) {
    try {
      await dbPool.query(
        `INSERT INTO live_diagnostics (phone, vehicle_summary, symptom, probable_cause, recommended_action, whatsapp_sent, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [phone, vehicule, symptome, causeProbable, actionRecommandee, false, Date.now()]
      );
    } catch (err) {
      console.warn("[Live Tool] Échec de l'enregistrement du diagnostic:", err);
      return { toolResult: "Le diagnostic n'a pas pu être enregistré en base (erreur serveur).", whatsappUrl };
    }
  }

  return {
    toolResult: "Diagnostic enregistré. Un lien WhatsApp prérempli avec le récapitulatif a été affiché au mécanicien pour qu'il l'envoie lui-même au client en un tap.",
    whatsappUrl,
  };
}


// Guide scanner local ultra-léger : aucune recherche réseau/DB pendant un tour vocal.
const SCANNER_GUIDES: Array<{ family: string; aliases: string[]; capabilities: string[]; menu: string[]; actions: string[]; bench: boolean; note: string }> = [
  { family:"Launch X-431", aliases:["launch","x431","x-431","pro5","pro 5","pro3","pro 3","pad","diagun","easydiag","dbscar","smartbox","xpro5","x-pro5","xdiag","diagzone"], capabilities:["DTC","Freeze Frame","Live Data","Active Test","Service Functions","Codage selon modèle"], menu:["Diagnostic > constructeur > véhicule > système/ECU","ECU > Read Codes / Data Stream / Actuation Test"], actions:["Actionneur : chercher Actuation Test / Active Test dans l'ECU.","Mesure : ouvrir Data Stream / Live Data et sélectionner seulement les PIDs utiles."], bench:true, note:"Menus selon modèle X-431, VCI, logiciel et véhicule." },
  { family:"Autel Maxi", aliases:["autel","maxisys","maxisys pro","maxisys elite","maxicheck","maxidiag","maxidas","ms906","ms908","ms909","ms919","maxi ultra"], capabilities:["DTC","Freeze Frame","Live Data","Active Test","Service Functions","Codage selon modèle"], menu:["Diagnostics > constructeur > véhicule > système > Function Menu","Function Menu > Live Data / Active Test"], actions:["Actionneur : Active Test puis observation physique.","Mesure : relever les paramètres demandés dans Live Data."], bench:true, note:"Active Tests variables selon appareil et véhicule." },
  { family:"Thinkcar / ThinkDiag", aliases:["thinkcar","thinkdiag","thinkdiag 2","thinkdiag2","thinkscan","thinktool"], capabilities:["DTC","Freeze Frame","Live Data","Active Test","Service Functions"], menu:["Diagnostic > AutoVIN/sélection véhicule > ECU","ECU > Fault Code / Data Stream / Actuation Test"], actions:["Chercher Active Test / Actuation Test.","Sélectionner seulement les PIDs utiles."], bench:false, note:"Dépend du modèle, de l'application et de l'abonnement." },
  { family:"TOPDON", aliases:["topdon","topscan","artidiag","phoenix"], capabilities:["DTC","Freeze Frame","Live Data","Active Test","Service Functions"], menu:["Diagnostic > constructeur > véhicule > ECU","ECU > Data Stream / Active Test / Special Functions"], actions:["Utiliser Active Test lorsqu'il est disponible et confirmer par observation/mesure."], bench:true, note:"Vérifier le modèle exact." },
  { family:"XTOOL", aliases:["xtool","x-tool","d5","d6","d7","d8","d9","ip508","ip608","ip616","ip819","ip919","a30","a80"], capabilities:["DTC","Freeze Frame","Live Data","Active Test","Service Functions"], menu:["Diagnosis > constructeur > modèle > système/ECU","ECU > Data Stream / Actuation Test / Special Functions"], actions:["Chercher Actuation Test/Active Test.","Relever le PID demandé dans les conditions du test."], bench:true, note:"Ne pas supposer une fonction à partir de la famille seule." },
  { family:"KINGBOLEN", aliases:["kingbolen","ediag","ediag elite","ediag plus","k6","k6 pro","k7","k8","k10","soloscan"], capabilities:["DTC","Freeze Frame","Live Data","Active Test","Service Functions","AutoVIN","CAN-FD selon modèle"], menu:["EDIAG > AutoVIN/sélection véhicule > Diagnostic > ECU","ECU > Fault Code / Data Stream / Active Test"], actions:["Chercher Active Test/Bidirectional Test.","Data Stream : relever les valeurs demandées."], bench:false, note:"EDIAG ELITE : diagnostic tous systèmes et bidirectionnel ; fonctions véhicule/modèle dépendantes." },
  { family:"Bosch", aliases:["bosch","kts","esi tronic","esitronic"], capabilities:["DTC","Freeze Frame","Live Data","Tests composants","Fonctions guidées"], menu:["Diagnostic > véhicule > système > fonction/test","ESI[tronic] > valeurs réelles / tests composants"], actions:["Privilégier les conditions de test guidées."], bench:false, note:"Dépend de l'équipement et de la licence." },
  { family:"Foxwell", aliases:["foxwell","nt630","nt650","nt680","nt809","nt1000"], capabilities:["DTC","Freeze Frame","Live Data","Service Functions","Active Test selon modèle"], menu:["Diagnostics > constructeur > système > fonction"], actions:["Chercher Live Data ou Active Test dans le système."], bench:false, note:"Vérifier le modèle exact." },
  { family:"iCarsoft", aliases:["icarsoft","cr max","cr pro","cr ultra"], capabilities:["DTC","Live Data","Freeze Frame","Service Functions selon modèle"], menu:["Diagnose > constructeur > système > Read Codes / Live Data / Special Functions"], actions:["Les fonctions bidirectionnelles ne sont pas disponibles sur tous les modèles."], bench:false, note:"Modèle exact indispensable." },
  { family:"Delphi / DS", aliases:["delphi","ds150e","ds150","autocom","wow"], capabilities:["DTC","Live Data","Tests d'actionneurs selon logiciel","Service Functions"], menu:["Diagnostic > véhicule > système > paramètres / activations"], actions:["Sélectionner le calculateur puis la fonction disponible."], bench:false, note:"Versions logicielles/interfaces différentes." }
,
  { family:"VCDS / Ross-Tech", aliases:["vcds","ross-tech","hex v2","hex-net"], capabilities:["DTC","Measuring Values","Output Tests","Basic Settings","Adaptation","Coding"], menu:["Select Control Module > module > Fault Codes / Measuring Values","Output Tests / Basic Settings / Adaptation / Coding"], actions:["Output Tests commandent des sorties ; Basic Settings et Adaptation exigent la procédure appropriée.","Conserver les valeurs originales avant modification."], bench:false, note:"Outil spécialisé VAG ; fonctions selon calculateur." },
  { family:"OBDeleven", aliases:["obdeleven","obd eleven","nextgen"], capabilities:["DTC","Live Data","Basic Settings","Adaptations","Coding"], menu:["Control Units > ECU > Faults / Live Data / Basic Settings / Adaptation","Coding / One-Click Apps"], actions:["Sauvegarder les valeurs avant modification.","Ne pas exécuter une adaptation sans procédure et conditions."], bench:false, note:"Principalement orienté VAG ; certaines fonctions nécessitent une licence." },
  { family:"Generic OBD-II", aliases:["obd2","obd ii","eobd","elm327","elm 327","vgate","vlinker","konnwei","kw902"], capabilities:["DTC moteur/émissions","Freeze Frame","Live Data","Readiness","OBD Modes"], menu:["OBD/EOBD > Read Codes / Freeze Frame / Live Data / I/M Readiness","Mode 06 / Mode 08 / Vehicle Information si supportés"], actions:["Un OBD générique ne donne pas forcément accès à ABS/SRS/BCM.","Ne pas confondre code moteur générique et diagnostic constructeur."], bench:false, note:"Capacités selon protocole, véhicule et application." },
  { family:"OBDLink", aliases:["obdlink","obdlink mx+","obdlink lx","obdlink ex","obdlink cx"], capabilities:["OBD-II","Live Data","DTC","J2534 selon modèle"], menu:["Application > OBD-II > Codes / Live Data / Vehicle Information"], actions:["Vérifier l'application utilisée avant de donner un chemin précis.","Pour une panne constructeur, passer à un outil tous systèmes si nécessaire."], bench:true, note:"Fonctions selon interface et logiciel." },
  { family:"Snap-on", aliases:["snap-on","snap on","solus","ethos","modis","verus","apollo","zeus","triton"], capabilities:["DTC","Live Data","Functional Tests","Actuation Tests","Service Functions"], menu:["Scanner > constructeur > véhicule > système","Codes / Data / Functional Tests / Actuation"], actions:["Utiliser Functional/Actuation Tests avec les conditions affichées.","Enregistrer les données avant d'effacer les codes."], bench:true, note:"Menus variables selon plateforme." },
  { family:"Hella Gutmann", aliases:["hella gutmann","gutmann","mega macs","mega macs x"], capabilities:["DTC","Live Data","Guided Diagnosis","Actuator Tests","Service Functions"], menu:["Diagnostic > véhicule > système > Guided Diagnosis / Values / Actuator Test"], actions:["Privilégier Guided Diagnosis lorsque disponible.","Compléter par mesure physique si résultat ambigu."], bench:false, note:"Fonctions selon équipement et véhicule." },
  { family:"Truck diagnostic", aliases:["nexiq","usb-link","texa","navigator","axone","jaltest"], capabilities:["Diagnostic véhicules lourds","DTC","Live Data","Tests actionneurs","Service Functions"], menu:["Truck/Commercial > constructeur > système > diagnostic/test","Live Data / Actuation / Service Functions"], actions:["Vérifier alimentation et protocole avant connexion.","Ne pas appliquer une procédure VL à un véhicule lourd sans validation."], bench:false, note:"Couverture dépend du logiciel." }
,
  { family:"MUCAR", aliases:["mucar","mucar bt max","mucar btmax","mucar cs6","mucar cs4","mucar cde","mucar 892bt"], capabilities:["DTC","Live Data","Freeze Frame","Service Functions selon modèle","Bidirectionnel selon modèle"], menu:["Diagnostic > constructeur > véhicule > système/ECU","ECU > Fault Code / Data Stream / Special Functions","Active Test si proposé"], actions:["Confirmer le modèle exact avant d'annoncer un test bidirectionnel.","Pour une valeur moteur, relever le PID dans les conditions demandées."], bench:false, note:"Les capacités varient selon modèle et application." },
  { family:"HUMZOR", aliases:["humzor","z100","z100 elite","z100 pro","zscan"], capabilities:["DTC","Live Data","Freeze Frame","Service Functions selon modèle","Active Test selon modèle"], menu:["Diagnostic > marque > véhicule > système/ECU","Fault Code / Live Data / Special Functions"], actions:["Si Active Test est présent, suivre les conditions affichées et confirmer par observation.","Sinon utiliser Data Stream et mesure physique."], bench:false, note:"Vérifier le modèle exact et la couverture du véhicule." },
  { family:"UDIAG", aliases:["udiag","udiag x50","x50","x50 pro","x431 clone"], capabilities:["DTC","Live Data","Freeze Frame","Service Functions selon modèle"], menu:["Diagnostic > constructeur > véhicule > système","Fault Code / Live Data / Special Functions"], actions:["Ne pas déduire une fonction à partir du nom seul.","Demander une photo de l'écran si le chemin est incertain."], bench:false, note:"Modèle et logiciel exacts nécessaires." },
  { family:"BlueDriver", aliases:["bluedriver","blue driver"], capabilities:["OBD-II","DTC","Freeze Frame","Live Data","Rapports"], menu:["Vehicle > Scan for Trouble Codes > Enhanced Data / Live Data selon véhicule"], actions:["Utiliser les données améliorées lorsqu'elles existent.","Pour ABS/SRS ou fonctions constructeur, vérifier la couverture avant de conclure."], bench:false, note:"Outil principalement orienté diagnostic OBD et données améliorées." },
  { family:"Carista", aliases:["carista","carista obd"], capabilities:["OBD","Live Data","DTC","Coding/Customizations selon véhicule"], menu:["Diagnostics > ECU > Faults / Live Data","Service / Customize / Coding selon véhicule"], actions:["Sauvegarder les réglages avant personnalisation.","Ne pas appliquer une adaptation sans connaître son effet."], bench:false, note:"Fonctions selon véhicule et abonnement." },
  { family:"FIXD", aliases:["fixd","fixd sensor"], capabilities:["OBD-II","DTC","Live Data selon application","Maintenance"], menu:["Vehicle > Scan > Codes / Live Data / Maintenance"], actions:["Traiter les codes comme point de départ ; confirmer par tests physiques.","Un lecteur OBD générique ne remplace pas un diagnostic tous systèmes."], bench:false, note:"Orientation OBD grand public." }
];

// === AGENT CENTRAL DE DIAGNOSTIC : état léger et local, sans appel IA supplémentaire ===
type LiveAgentPhase = "historique" | "symptome" | "inspection" | "outils" | "tests" | "validation" | "conclusion";
interface LiveAgentState {
  sessionId: string;
  phase: LiveAgentPhase;
  tour: number;
  vehicle: string;
  symptom: string;
  dtcs: string[];
  evidence: string[];
  hypotheses: string[];
  testsDone: string[];
  currentTest: string | null;
  repaired: boolean;
  concluded: boolean;
  contradictions: string[];
  lastResult: string;
}
const liveAgentStates = new Map<string, LiveAgentState>();

// Planificateur local déterministe : zéro appel IA, zéro réseau, zéro DB.
// Objectif : choisir UNE seule prochaine action sans ajouter de latence au Live vocal.
function planLiveDiagnosticLocal(input: {
  vehicle: string;
  symptom: string;
  dtcs: string[];
  evidence: string[];
  hypotheses: string[];
  contradictions: string[];
  currentTest: string | null;
  repaired: boolean;
  concluded: boolean;
  phase: LiveAgentPhase;
}): { priorite: "securite" | "critique" | "prioritaire" | "confirmation"; action: string; raison: string; attendu: string } {
  const has = (needle: string) => input.evidence.some(e => e.toLowerCase().includes(needle));
  if (input.concluded) return { priorite:"confirmation", action:"Diagnostic clôturé", raison:"La session est déjà clôturée.", attendu:"Aucune nouvelle action." };
  if (input.currentTest) return { priorite:"prioritaire", action:"Attendre le résultat du test en cours", raison:"Un seul test doit être exécuté à la fois.", attendu:"Résultat objectif, mesure ou observation." };
  if (!input.vehicle) return { priorite:"critique", action:"Identifier précisément le véhicule", raison:"Une procédure dépend du modèle, de l'année et de la motorisation.", attendu:"Marque, modèle, année et motorisation." };
  if (/hybride|électrique|ev|phev|bev/i.test(input.vehicle) && !has("sécurité haute tension") && !has("consignation")) {
    return { priorite:"securite", action:"Confirmer la procédure de sécurité haute tension", raison:"Les procédures HT varient selon le véhicule.", attendu:"Modèle/motorisation confirmés et circuit HT sécurisé avant intervention." };
  }
  if (!input.symptom) return { priorite:"critique", action:"Caractériser le symptôme", raison:"Sans symptôme reproductible, les hypothèses restent trop larges.", attendu:"Conditions d'apparition et comportement précis." };
  if (input.phase === "historique") return { priorite:"prioritaire", action:"Vérifier l'historique d'intervention récent", raison:"Une intervention récente peut être directement liée à la panne.", attendu:"Ce qui a été remplacé, débranché, nettoyé ou réparé et quand." };
  if (input.phase === "symptome") return { priorite:"prioritaire", action:"Reproduire et caractériser le symptôme", raison:"Il faut établir les conditions exactes avant le test.", attendu:"Froid/chaud, démarrage/roulage, charge, régime ou fréquence." };
  if (input.phase === "inspection") return { priorite:"prioritaire", action:"Faire une inspection visuelle rapide", raison:"Connecteurs, fusibles, faisceaux, fuites et niveaux sont des prérequis simples.", attendu:"Observation visuelle positive ou anomalie trouvée." };
  if (input.phase === "outils" && input.dtcs.length === 0) return { priorite:"prioritaire", action:"Lire les codes défauts et données figées", raison:"Sans DTC ni données objectives, la piste reste trop large.", attendu:"DTC, freeze frame et seulement les données utiles." };
  if (input.contradictions.length > 0) return { priorite:"critique", action:"Résoudre la contradiction avec un test discriminant", raison:"Une preuve contredit la piste actuelle.", attendu:"Résultat permettant d'écarter ou de renforcer une hypothèse." };
  if (input.hypotheses.length === 0) return { priorite:"prioritaire", action:"Construire les hypothèses à partir des preuves", raison:"Il faut relier le symptôme et les observations avant de choisir une pièce.", attendu:"Une ou plusieurs causes candidates à vérifier." };
  if (input.evidence.length < 2 && input.dtcs.length > 0) return { priorite:"prioritaire", action:"Obtenir une preuve technique supplémentaire", raison:"Un DTC seul ne condamne pas une pièce.", attendu:"Mesure, donnée scanner, inspection ou test physique." };
  if (input.repaired) return { priorite:"confirmation", action:"Effectuer la validation post-réparation et rescanner", raison:"Une réparation n'est pas confirmée tant que le symptôme et les DTC ne sont pas vérifiés.", attendu:"Symptôme absent et aucun nouveau DTC pertinent." };
  return { priorite:"confirmation", action:"Choisir un seul test discriminant", raison:"Le test doit séparer les hypothèses restantes avant toute condamnation de pièce.", attendu:"Résultat mesurable ou observation permettant la prochaine décision." };
}

function createLiveAgentState(sessionId: string, context = ""): LiveAgentState {
  const text = String(context || "");
  const dtcs = Array.from(text.matchAll(/\\b[PBCU][0-9]{4}\\b/gi)).map(m => m[0].toUpperCase()).filter((v,i,a)=>a.indexOf(v)===i);
  const state: LiveAgentState = {
    sessionId, phase: "historique", tour: 0, vehicle: "", symptom: text.slice(0, 500),
    dtcs, evidence: [], hypotheses: [], testsDone: [], currentTest: null,
    repaired: false, concluded: false, contradictions: [], lastResult: "",
  };
  liveAgentStates.set(sessionId, state);
  return state;
}

function liveAgentNextStep(state: LiveAgentState): string {
  if (state.concluded) return "CONCLUSION: diagnostic clôturé. Si une réparation a été faite, confirmer l'essai final et l'absence de nouveau DTC.";
  if (!state.vehicle) return "IDENTIFICATION: demander marque, modèle, année et motorisation avant de condamner une pièce.";
  if (!state.symptom) return "SYMPTÔME: faire décrire le symptôme et ses conditions d'apparition.";
  if (state.phase === "historique") return "HISTORIQUE: vérifier intervention récente, batterie, pièce remplacée, câblage ou événement déclencheur.";
  if (state.phase === "symptome") return "VÉRIFICATION: reproduire le symptôme et préciser froid/chaud, charge, régime ou conditions d'apparition.";
  if (state.phase === "inspection") return "INSPECTION: contrôler visuellement fusibles, connecteurs, faisceaux, fuites et niveaux avant un démontage.";
  if (state.phase === "outils") return "OUTILS: utiliser le scanner et relever DTC, freeze frame et uniquement les données utiles.";
  if (state.phase === "tests") return state.currentTest
    ? `TEST EN COURS: ${state.currentTest}. Attendre le résultat avant de proposer une autre action.`
    : "TEST: choisir UN SEUL test discriminant, expliquer pourquoi, puis attendre son résultat.";
  if (state.phase === "validation") return state.repaired
    ? "VALIDATION: effectuer l'essai final, vérifier le symptôme initial et rescanner les DTC avant de conclure."
    : "VALIDATION: ne pas condamner la pièce sans preuve ; confirmer la cause par une mesure ou un test.";
  return "CONCLUSION: résumer cause confirmée ou probable, preuve obtenue, réparation et contrôle post-réparation.";
}

function pilotLiveDiagnostic(args: any, state: LiveAgentState): string {
  const event = String(args?.event || "").trim().toLowerCase();
  const vehicle = String(args?.vehicule || "").trim();
  const symptom = String(args?.symptome || "").trim();
  const evidence = String(args?.preuve || "").trim();
  const test = String(args?.test || "").trim();
  const result = String(args?.resultat || "").trim();
  const hypothesis = String(args?.hypothese || "").trim();

  if (vehicle) state.vehicle = vehicle;
  if (symptom) state.symptom = symptom;
  if (hypothesis && !state.hypotheses.includes(hypothesis)) state.hypotheses.push(hypothesis);
  if (evidence) state.evidence.push(evidence);
  if (result) state.lastResult = result;
  if (test && !state.testsDone.includes(test) && result) {
    state.testsDone.push(test + " => " + result);
    state.currentTest = null;
  }
  if (result && /incohérent|contradic|ne correspond|anormal|hors plage|impossible/i.test(result)) {
    const contradiction = test ? test + " : " + result : result;
    if (!state.contradictions.includes(contradiction)) state.contradictions.push(contradiction);
  }
  if (test && !result) state.currentTest = test;

  if (event === "historique") state.phase = "historique";
  else if (event === "symptome") state.phase = "symptome";
  else if (event === "inspection") state.phase = "inspection";
  else if (event === "scan") state.phase = "outils";
  else if (event === "test") { state.phase = "tests"; if (result) state.currentTest = null; }
  else if (event === "reparation") { state.repaired = true; state.phase = "validation"; state.currentTest = null; }
  else if (event === "validation") { state.phase = "validation"; state.repaired = true; }
  else if (event === "conclusion") { state.phase = "conclusion"; state.concluded = true; state.currentTest = null; }

  state.tour++;
  return JSON.stringify({
    agent: "DiagAssist Agent",
    session_id: state.sessionId,
    phase: state.phase,
    tour: state.tour,
    vehicule: state.vehicle || null,
    dtcs: state.dtcs,
    hypotheses: state.hypotheses.slice(-5),
    preuves: state.evidence.slice(-5),
    tests_realises: state.testsDone.slice(-5),
    contradictions: state.contradictions.slice(-5),
    dernier_resultat: state.lastResult || null,
    test_en_cours: state.currentTest,
    plan_local: planLiveDiagnosticLocal({
      vehicle: state.vehicle,
      symptom: state.symptom,
      dtcs: state.dtcs,
      evidence: state.evidence,
      hypotheses: state.hypotheses,
      contradictions: state.contradictions,
      currentTest: state.currentTest,
      repaired: state.repaired,
      concluded: state.concluded,
      phase: state.phase,
    }),
    prochaine_etape: liveAgentNextStep(state),
    regle: "Une seule action/test à la fois. Aucun remplacement de pièce sans preuve. Plan local sans appel réseau."
  });
}

async function saveLiveAgentState(phone: string, state: LiveAgentState): Promise<void> {
  if (!dbPool || !phone) return;
  const status = state.concluded ? "closed" : "active";
  try {
    await dbPool.query(
      `INSERT INTO live_agent_sessions (session_id, phone, state, status, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)
       ON CONFLICT (session_id) DO UPDATE SET state = EXCLUDED.state, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
      [state.sessionId, phone, JSON.stringify(state), status, Date.now(), Date.now()]
    );
  } catch (err) {
    console.warn("[Live Agent] Échec persistance état:", err);
  }
}

async function resumeLiveAgentState(phone: string, newSessionId: string, context = ""): Promise<LiveAgentState> {
  const fresh = createLiveAgentState(newSessionId, context);
  if (!dbPool || !phone) return fresh;
  try {
    const { rows } = await dbPool.query(
      `SELECT state FROM live_agent_sessions
       WHERE phone = $1 AND status = 'active' AND updated_at > $2
       ORDER BY updated_at DESC LIMIT 1`,
      [phone, Date.now() - 24 * 60 * 60 * 1000]
    );
    if (!rows[0]?.state) return fresh;
    const restored = rows[0].state as LiveAgentState;
    if (!restored || typeof restored !== "object") return fresh;
    restored.sessionId = newSessionId;
    liveAgentStates.set(newSessionId, restored);
    return restored;
  } catch (err) {
    console.warn("[Live Agent] Échec reprise état:", err);
    return fresh;
  }
}

const scannerGuideCache = new Map<string,string>();
function liveToolGetScannerGuide(scanner: string): string {
  const key = scanner.toLowerCase().trim();
  const cached = scannerGuideCache.get(key);
  if (cached) return cached;
  const hit = SCANNER_GUIDES.find(g => g.aliases.some(a => key === a || key.includes(a) || a.includes(key)));
  const result = hit
    ? JSON.stringify({ scanner, famille:hit.family, capacites:hit.capabilities, chemins_menu:hit.menu, actions:hit.actions, bench:hit.bench, note:hit.note })
    : JSON.stringify({ scanner, reconnu:false, instruction:"Demander le modèle exact et, si nécessaire, une photo de l'écran avant de donner un chemin de menu." });
  scannerGuideCache.set(key,result);
  return result;
}

const LIVE_AGENT_TOOL_DECLARATIONS = [
  {
    name: "piloter_diagnostic",
    description: "Pilote l'état local de l'Agent DiagAssist sans appel réseau. À utiliser après un symptôme, une observation, un résultat de test, une réparation ou une validation. Le planificateur local détermine la prochaine action sans appel IA supplémentaire. Une seule action/test à la fois.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        event: { type: Type.STRING, description: "historique | symptome | inspection | scan | test | reparation | validation | conclusion" },
        vehicule: { type: Type.STRING, description: "Véhicule exact si connu." },
        symptome: { type: Type.STRING, description: "Symptôme initial ou actuel." },
        preuve: { type: Type.STRING, description: "Observation, mesure, photo décrite ou résultat objectif." },
        test: { type: Type.STRING, description: "Test unique réalisé ou proposé." },
        resultat: { type: Type.STRING, description: "Résultat du test, si disponible." },
        hypothese: { type: Type.STRING, description: "Hypothèse actuelle, clairement présentée comme probable tant qu'elle n'est pas confirmée." }
      },
      required: ["event"],
    },
  },
  {
    name: "consulter_guide_scanner",
    description: "Consulte instantanément l'index local des guides de scanners. À utiliser seulement lorsqu'un scanner précis est cité et qu'un chemin de menu ou une action de test est nécessaire. Aucun appel réseau.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        scanner: { type: Type.STRING, description: "Modèle exact si possible : KINGBOLEN EDIAG ELITE, Launch X431 Pro5, Autel MS906BT, ThinkDiag 2, XTOOL D9, TOPDON Phoenix, etc." }
      },
      required: ["scanner"],
    },
  },
  {
    name: "rechercher_fiche_technique",
    description: "Recherche sur le web des données techniques fiables (emplacement d'un composant, valeurs multimètre, couple de serrage, bulletin constructeur) pour aider au diagnostic ou à la réparation. À utiliser quand le mécanicien demande une valeur précise que tu n'es pas certain de connaître.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        requete: { type: Type.STRING, description: "Ce qu'il faut chercher, incluant marque/modèle/année et le composant ou problème précis, ex: 'Toyota Corolla 2015 résistance capteur PMH'." },
      },
      required: ["requete"],
    },
  },
  {
    name: "rechercher_vehicule_hpweb",
    description: "Recherche le véhicule dans HP-Web par VIN, marque, modèle, année ou motorisation. À utiliser pour identifier précisément le véhicule avant une procédure technique. La recherche est côté serveur et mise en cache ; ne demande jamais les identifiants HP-Web à l'utilisateur.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        vin: { type: Type.STRING, description: "VIN complet si disponible." },
        marque: { type: Type.STRING, description: "Marque du véhicule." },
        modele: { type: Type.STRING, description: "Modèle du véhicule." },
        annee: { type: Type.STRING, description: "Année du véhicule." },
        moteur: { type: Type.STRING, description: "Motorisation ou code moteur." },
        q: { type: Type.STRING, description: "Recherche libre HP-Web si les autres critères ne suffisent pas." },
      },
      required: [],
    },
  },
  {
    name: "hpweb_page",
    description: "Ouvre HP-Web dans le navigateur du mécanicien (ou relit la page courante) et renvoie son contenu et ses éléments numérotés. À appeler en premier pour naviguer dans HP-Web : marque, modèle, année, moteur, puis rubrique demandée. Réponds uniquement avec ce que la page contient réellement, sans rien inventer. Si HP-Web demande une connexion, dis au mécanicien de se connecter lui-même ; ne demande jamais son mot de passe.",
    parameters: { type: Type.OBJECT, properties: {}, required: [] },
  },
  {
    name: "hpweb_cliquer",
    description: "Clique sur un élément de la page HP-Web courante (menu, lien, bouton) par son numéro de référence, puis renvoie la nouvelle page.",
    parameters: {
      type: Type.OBJECT,
      properties: { ref: { type: Type.NUMBER, description: "Numéro de l'élément dans la dernière page reçue." } },
      required: ["ref"],
    },
  },
  {
    name: "hpweb_saisir",
    description: "Saisit du texte dans un champ de la page HP-Web courante (par exemple la recherche véhicule) et valide si demandé.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        ref: { type: Type.NUMBER, description: "Numéro du champ dans la dernière page reçue." },
        texte: { type: Type.STRING, description: "Texte à saisir." },
        valider: { type: Type.BOOLEAN, description: "Appuyer sur Entrée après la saisie." },
      },
      required: ["ref", "texte"],
    },
  },
  {
    name: "hpweb_choisir",
    description: "Choisit une option dans une liste déroulante de la page HP-Web courante (marque, modèle, année, moteur, rubrique).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        ref: { type: Type.NUMBER, description: "Numéro de la liste dans la dernière page reçue." },
        libelle: { type: Type.STRING, description: "Libellé de l'option à choisir." },
      },
      required: ["ref", "libelle"],
    },
  },
  {
    name: "hpweb_retour",
    description: "Revient à la page HP-Web précédente.",
    parameters: { type: Type.OBJECT, properties: {}, required: [] },
  },
  {
    name: "verifier_base_vehicules",
    description: "Consulte la base véhicules locale de DiagAssist pour vérifier les modèles ou motorisations disponibles d'une marque. À utiliser pour confirmer un modèle/génération/motorisation exact avant de donner un diagnostic technique.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        marque: { type: Type.STRING, description: "Marque du véhicule, ex: 'Toyota'." },
        modele: { type: Type.STRING, description: "Modèle du véhicule, ex: 'Corolla'. Omettre pour lister tous les modèles connus de la marque." },
      },
      required: ["marque"],
    },
  },
  {
    name: "chercher_mecanicien_pres",
    description: "Cherche un mécanicien agréé ou un vendeur de pièces dans le réseau de partenaires DiagAssist, par ville. À utiliser pour recommander un vrai contact (nom, téléphone) plutôt qu'un conseil générique, notamment en mode propriétaire de véhicule.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        ville: { type: Type.STRING, description: "Ville ou quartier où chercher, ex: 'Abidjan' ou 'Yopougon'." },
        type: { type: Type.STRING, description: "'mechanic' pour un mécanicien, 'parts_vendor' pour un vendeur de pièces. Omettre pour chercher les deux." },
      },
      required: ["ville"],
    },
  },
  {
    name: "verifier_disponibilite_piece",
    description: "Vérifie le prix et la disponibilité réels d'une pièce dans la boutique DiagAssist. Si la pièce est disponible, retourne le prix. Si elle est en rupture ou introuvable, enregistre automatiquement une demande de commande pour le client et génère un message de confirmation WhatsApp — dans ce cas, dis au mécanicien que nous allons commander la pièce et qu'il sera recontacté.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        piece: { type: Type.STRING, description: "Nom de la pièce recherchée, ex: 'capteur PMH' ou 'plaquettes de frein'." },
      },
      required: ["piece"],
    },
  },
  {
    name: "consulter_historique_diagnostic",
    description: "Consulte les derniers diagnostics enregistrés pour ce mécanicien/client lors de ses appels précédents. Utilise cet outil si le mécanicien mentionne un problème récurrent, demande un suivi, ou si tu veux vérifier si ce véhicule a déjà été diagnostiqué.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        limite: { type: Type.NUMBER, description: "Nombre de diagnostics récents à récupérer (1 à 5). Par défaut 3." },
      },
      required: [],
    },
  },
  {
    name: "rechercher_code_obd",
    description: "Consulte instantanément la base locale de codes OBD2 standards (P, C, B, U). À utiliser EN PREMIER dès qu'un code défaut est mentionné — aucun appel réseau, réponse immédiate. Donne la cause probable et l'action de diagnostic recommandée.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        code: { type: Type.STRING, description: "Le code OBD exact ou partiel, ex: 'P0300', 'C0031', 'U0100'. Majuscules ou minuscules." },
      },
      required: ["code"],
    },
  },
  {
    name: "commander_piece",
    description: "Génère un lien WhatsApp pré-rempli pour commander une pièce précise à la boutique DiagAssist (0707312797). À utiliser quand une pièce est confirmée défectueuse et que le mécanicien veut l'acheter. Nécessite le nom exact de la pièce, le prix (s'il a été vérifié), et le véhicule.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        piece: { type: Type.STRING, description: "Nom exact de la pièce à commander, ex: 'Capteur PMH Toyota Corolla 2015'." },
        prix_fcfa: { type: Type.NUMBER, description: "Prix en F CFA si connu (via verifier_disponibilite_piece). Laisser vide si inconnu." },
        vehicule: { type: Type.STRING, description: "Marque, modèle et année, ex: 'Toyota Corolla 2015'." },
      },
      required: ["piece", "vehicule"],
    },
  },
  {
    name: "obtenir_procedure_reparation",
    description: "Retourne instantanément une procédure de réparation étape par étape pour les 16 pannes les plus fréquentes en Côte d'Ivoire (ratés allumage, surchauffe, alternateur, démarreur, PMH, MAF, EGR, turbo, courroie distribution, ABS, injecteurs diesel, réseau CAN, etc.). À utiliser dès qu'une panne ou un code est identifié pour guider le mécanicien pas à pas.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        panne: { type: Type.STRING, description: "Type de panne ou code DTC, ex: 'surchauffe', 'P0300', 'capteur PMH', 'EGR bouché', 'turbo', 'courroie distribution'." },
        marque: { type: Type.STRING, description: "Marque du véhicule si connue, ex: 'Toyota', 'Peugeot'. Omettre si inconnu." },
      },
      required: ["panne"],
    },
  },
  {
    name: "lire_resultats_scanner",
    description: "Lit les résultats du dernier diagnostic effectué par l'Autopilot Scanner DiagAssist sur la tablette. Retourne les codes DTC trouvés et le résumé. À utiliser quand le mécanicien a déjà fait un scan avec la tablette et que tu veux connaître les codes trouvés sans qu'il te les dicte.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },
  {
    name: "enregistrer_diagnostic",
    description: "Enregistre le diagnostic établi pendant cet appel et envoie automatiquement un récapitulatif par WhatsApp au client. À utiliser UNE SEULE FOIS, vers la fin de la conversation, une fois qu'un diagnostic clair a été établi (pas pour une simple question technique ponctuelle).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        vehicule: { type: Type.STRING, description: "Marque, modèle et année du véhicule, ex: 'Toyota Corolla 2015'." },
        symptome: { type: Type.STRING, description: "Le symptôme ou code défaut initial rapporté." },
        cause_probable: { type: Type.STRING, description: "La cause probable identifiée pendant l'appel." },
        action_recommandee: { type: Type.STRING, description: "L'action recommandée au mécanicien (vérification, réparation, pièce à changer...)." },
      },
      required: ["vehicule", "symptome", "cause_probable", "action_recommandee"],
    },
  },
];

// Décrit un responseSchema Gemini (POJO {type, properties, items, description, required}, pas la
// classe SDK) en une forme JSON lisible, pour demander à DeepSeek de produire la même structure —
// DeepSeek (API compatible OpenAI) n'accepte pas le typage Schema natif de Gemini.
function schemaToPromptHint(schema: any, indent = ""): string {
  if (!schema) return "";
  const type = String(schema.type || "").toUpperCase();
  if (type === "OBJECT") {
    const required: string[] = schema.required || [];
    const lines = Object.entries(schema.properties || {}).map(([key, val]: [string, any]) => {
      const optionalTag = required.includes(key) ? "" : " (optionnel)";
      const desc = val?.description ? ` // ${val.description}` : "";
      return `${indent}  "${key}": ${schemaToPromptHint(val, indent + "  ")}${optionalTag}${desc}`;
    });
    return `{\n${lines.join(",\n")}\n${indent}}`;
  }
  if (type === "ARRAY") {
    return `[ ${schemaToPromptHint(schema.items, indent)} ]`;
  }
  return `"<${type.toLowerCase() || "string"}>"`;
}

// Repli DeepSeek quand TOUS les modèles Gemini ont échoué. Depuis DeepSeek-V4.1-Flash (modèle
// "deepseek-flash"), l'API accepte aussi des images (format vision compatible OpenAI) — donc un
// diagnostic avec photo jointe peut désormais aussi basculer sur ce repli, pas seulement le texte.
// NB : "deepseek-chat"/"deepseek-reasoner" sont des noms hérités en cours de dépréciation, on utilise
// directement "deepseek-flash". Nécessite DEEPSEEK_API_KEY ; échoue proprement sinon, pour que
// l'appelant retombe sur l'erreur Gemini d'origine plutôt qu'un plantage différent.
async function callDeepSeekFallback(userContent: string | any[], config: any): Promise<any> {
  const apiKey = (process.env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY non configuré.");

  const schemaHintText = config?.responseSchema
    ? `\n\nRéponds STRICTEMENT avec un unique objet JSON valide (rien avant, rien après) respectant exactement cette forme :\n${schemaToPromptHint(config.responseSchema)}`
    : "";

  let finalContent: string | any[];
  if (typeof userContent === "string") {
    finalContent = userContent + schemaHintText;
  } else {
    finalContent = schemaHintText ? [...userContent, { type: "text", text: schemaHintText }] : userContent;
  }

  const messages: any[] = [];
  if (config?.systemInstruction) {
    messages.push({ role: "system", content: String(config.systemInstruction) });
  }
  if (Array.isArray(config?.history)) {
    for (const h of config.history) messages.push(h);
  }
  messages.push({ role: "user", content: finalContent });

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "deepseek-flash",
      messages,
      response_format: config?.responseSchema ? { type: "json_object" } : undefined,
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`DeepSeek API a répondu ${res.status} : ${errText.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("Réponse DeepSeek vide.");
  return { text, modelUsedForGeneration: "deepseek-flash (repli)" };
}

// Construit le contenu du repli DeepSeek depuis `contents` (format Gemini) : texte simple, ou
// tableau de parts façon vision OpenAI (texte + images en data URL base64). Renvoie null si le
// contenu comprend de l'audio/vidéo (non supporté par DeepSeek) ou une forme trop complexe
// (historique de chat en tableau de tours), pour que l'appelant abandonne proprement le repli.
function buildDeepSeekContent(contents: any): string | any[] | null {
  if (typeof contents === "string") return contents;
  if (!contents || !Array.isArray(contents.parts)) return null;

  const hasUnsupportedMedia = contents.parts.some(
    (p: any) => p.inlineData && !String(p.inlineData.mimeType || "").startsWith("image/")
  );
  if (hasUnsupportedMedia) return null;

  const outParts: any[] = [];
  for (const p of contents.parts) {
    if (p.text) {
      outParts.push({ type: "text", text: p.text });
    } else if (p.inlineData && String(p.inlineData.mimeType || "").startsWith("image/")) {
      outParts.push({ type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } });
    }
  }
  if (outParts.length === 0) return null;
  if (outParts.length === 1 && outParts[0].type === "text") return outParts[0].text;
  return outParts;
}

async function generateContentWithFallbackAndRetry(
  contents: any,
  config: any,
  primaryModel: string = "gemini-3.5-flash"
): Promise<any> {
  const modelsToTry = [primaryModel, "gemini-3.1-flash-lite", "gemini-flash-latest"];
  let lastError: any = null;
  // Le quota de la recherche web (grounding) est distinct du quota de génération : quand il est
  // épuisé, tous les modèles répondent 429 alors que la même requête sans recherche passe.
  // On retire alors l'outil googleSearch et on retente (une seule fois) au lieu d'échouer.
  let activeConfig = config;
  let searchStripped = false;
  const stripSearchTool = (): boolean => {
    const tools = activeConfig?.tools;
    if (searchStripped || !Array.isArray(tools) || !tools.some((t: any) => t && t.googleSearch)) return false;
    const rest = tools.filter((t: any) => !(t && t.googleSearch));
    activeConfig = { ...activeConfig, tools: rest.length > 0 ? rest : undefined };
    searchStripped = true;
    console.warn("[Gemini API] Quota de la recherche web épuisé : nouvelle tentative sans googleSearch.");
    return true;
  };

  for (const modelName of modelsToTry) {
    // Une erreur de quota sur ce modèle avec la clé active fait tourner vers la clé suivante et
    // retente le MÊME modèle (le quota dépend de la clé/projet, pas du modèle) avant de passer
    // au modèle suivant — jusqu'à épuiser toutes les clés disponibles.
    let keyRotations = 0;
    let keyUsed = "";
    const maxKeyRotations = getGeminiKeys().length;
    while (true) {
      try {
        console.log(`[Gemini API] Attempting generation with model: ${modelName} (clé #${currentGeminiKeyIndex + 1})`);
        keyUsed = currentGeminiKey();
        const result: any = await retryWithBackoff(async () => {
          return await getAIClient().models.generateContent({
            model: modelName,
            contents,
            config: activeConfig,
          });
        }, 3, 1000);

        if (result) {
          result.modelUsedForGeneration = modelName;
        }
        recordGeminiResult(keyUsed, {
          ok: true,
          promptTokens: result?.usageMetadata?.promptTokenCount,
          outputTokens: result?.usageMetadata?.candidatesTokenCount,
        });
        return result;
      } catch (error: any) {
        console.error(`[Gemini API] Failed with model ${modelName}:`, error.message || error);
        lastError = error;
        recordGeminiResult(keyUsed, { ok: false, quota: isGeminiQuotaError(error), error: error.message || String(error) });
        // If it's 400 Bad Request or 401/403, do not try other models as it's a client configuration/syntax error
        if (error.status === 400 || error.status === 401 || error.status === 403) {
          throw error;
        }
        if (isGeminiQuotaError(error) && keyRotations < maxKeyRotations && rotateGeminiKey()) {
          keyRotations++;
          continue;
        }
        if (isGeminiQuotaError(error) && stripSearchTool()) {
          recordGeminiResult(keyUsed, { ok: false, searchQuota: true });
          continue; // même modèle, sans recherche web
        }
        break;
      }
    }
  }

  // Tous les modèles Gemini ont échoué : dernier recours DeepSeek si une clé est configurée et que
  // le contenu est compatible (texte, ou texte+images — voir buildDeepSeekContent).
  const deepSeekContent = buildDeepSeekContent(contents);
  if (deepSeekContent && process.env.DEEPSEEK_API_KEY) {
    try {
      console.warn("[Fallback] Tous les modèles Gemini ont échoué, tentative de repli avec DeepSeek...");
      return await callDeepSeekFallback(deepSeekContent, activeConfig);
    } catch (dsErr: any) {
      console.error("[DeepSeek Fallback] Échec:", dsErr.message || dsErr);
    }
  }

  throw lastError;
}

process.on("unhandledRejection", (reason: any) => {
  console.error("[unhandledRejection]", reason?.message || reason);
});
process.on("uncaughtException", (err: any) => {
  console.error("[uncaughtException]", err?.message || err);
});

async function startServer() {
  // Charge les données persistées AVANT toute autre chose : sessions/mots de passe/forfaits
  // doivent être en mémoire avant qu'une seule requête ne puisse arriver.
  await initDatabase();
  await loadPersistedData();
  seedAdminAccountIfNeeded();

  const app = express();
  const PORT = 3000;

  // Express 4 ne capte pas les rejets des handlers async : une erreur de base de données dans une
  // route sans try/catch laissait la requête pendre, voire faisait tomber le process. On enveloppe
  // donc chaque handler async pour transmettre l'erreur au gestionnaire d'erreurs final.
  for (const method of ["get", "post", "put", "patch", "delete"] as const) {
    const original = (app as any)[method].bind(app);
    (app as any)[method] = (path: any, ...handlers: any[]) => {
      if (method === "get" && handlers.length === 0) return original(path); // app.get("setting")
      const wrapped = handlers.map((h) =>
        typeof h === "function" && h.length < 4
          ? (req: any, res: any, next: any) => {
              try {
                const r = h(req, res, next);
                if (r && typeof r.catch === "function") r.catch(next);
              } catch (err) { next(err); }
            }
          : h
      );
      return original(path, ...wrapped);
    };
  }

  // BUG CORRIGÉ (détecté en déploiement réel sur Render) : sans ce réglage, Express ne fait pas
  // confiance à l'en-tête X-Forwarded-For envoyé par le proxy de l'hébergeur (Render, ou tout
  // reverse-proxy comme Nginx). Résultat : express-rate-limit ne peut pas identifier correctement
  // l'IP réelle du client, ce qui casse la protection anti brute-force sur les routes d'authentification.
  // "1" = fait confiance au premier proxy en amont (configuration standard derrière Render/Nginx).
  app.set("trust proxy", 1);

  // Sécurité HTTP standard (headers)
  app.use(helmet({
    contentSecurityPolicy: false, // posée plus bas (directives sans risque) : helmet exige un default-src
    crossOriginEmbedderPolicy: false,
  }));

  // CSP volontairement partielle (une CSP complète risquerait de casser Vite/Leaflet/blobs sans test
  // navigateur) : anti-clickjacking, pas de plugins, <base> et formulaires limités à l'origine.
  if (process.env.NODE_ENV === "production") {
    app.use((_req, res, next) => {
      res.setHeader("Content-Security-Policy", "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
      next();
    });
  }

  // Configure high payload limit for base64 images, videos, and audios
  // FAILLE CORRIGÉE : cette limite de 50 Mo s'appliquait à TOUTES les routes, y compris celles
  // non authentifiées (OTP, admin, statut...). Un attaquant pouvait saturer la bande passante et
  // la mémoire du serveur en envoyant des requêtes volumineuses en boucle à ces routes légères,
  // avant même toute vérification d'authentification. Seules les routes qui traitent réellement
  // des médias (photos/vidéos/audio en base64) ont maintenant droit à des payloads volumineux ;
  // toutes les autres sont plafonnées à 2 Mo.
  const LARGE_PAYLOAD_PATHS = new Set([
    "/api/diagnose",
    "/api/diagnostic/loop/start",
    "/api/diagnostic/loop/step",
    "/api/admin/banners",
    "/api/shop/part-requests",
  ]);
  const SMALL_PAYLOAD_LIMIT_BYTES = 2 * 1024 * 1024; // 2MB
  app.use((req, res, next) => {
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    if (!LARGE_PAYLOAD_PATHS.has(req.path) && contentLength > SMALL_PAYLOAD_LIMIT_BYTES) {
      return res.status(413).json({ success: false, message: "Requête trop volumineuse pour cette route." });
    }
    next();
  });
  app.use(express.json({
    limit: "50mb",
    // Conserve le corps brut (avant parsing) pour la vérification de signature HMAC des
    // webhooks (ex: Jèko), qui doit porter sur les octets exacts reçus, pas sur du JSON
    // re-sérialisé qui pourrait différer (ordre des clés, espacement).
    verify: (req: any, _res, buf) => { req.rawBody = buf; },
  }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Anti-abus : limite le nombre de requêtes sur les routes sensibles (SMS/OTP coûtent de l'argent, auth = cible de brute-force)
  const otpSendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Trop de demandes de code. Veuillez réessayer dans quelques minutes." },
  });
  const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Trop de tentatives. Veuillez réessayer dans quelques minutes." },
  });
  const diagnoseLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Trop de requêtes de diagnostic. Ralentissez un peu." },
  });
  const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Trop de tentatives d'accès administrateur." },
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Trop de tentatives de connexion. Veuillez réessayer dans quelques minutes." },
  });
  // Limite les routes boutique publiques (commande/demande de pièce) sans authentification —
  // évite le spam/abus sur des endpoints ouverts à tous.
  const shopPublicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Trop de demandes. Veuillez réessayer dans quelques minutes." },
  });

  // Anti-fraude à l'essai gratuit : nombre de créations de compte limité par IP et par jour.
  const registerLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Trop de créations de compte depuis cette connexion. Réessayez demain." },
  });
  // Appairage de la tablette (public) : limité pour empêcher l'énumération du code à 6 chiffres.
  const pairLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Trop de tentatives d'appairage. Réessayez dans quelques minutes." },
  });
  // Routes admin : seuls les ÉCHECS comptent (un dashboard légitime peut interroger souvent),
  // ce qui bloque le brute-force de ADMIN_SECRET sur toutes les routes /api/admin/*.
  const adminFailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Trop de tentatives d'accès administrateur." },
  });
  app.use("/api/admin", adminFailLimiter);

  // API Route: Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // API Route: Diagnose vehicle issue
  app.post("/api/diagnose", diagnoseLimiter, requireAuth, async (req: any, res) => {
    try {
      const { phone, plan } = req.session;
      const check = checkAndIncrementUsage(phone, plan);
      if (!check.allowed) {
        return res.status(403).json({ success: false, message: check.message });
      }

      const {
        vehicleBrand,
        vehicleModel,
        vehicleYear,
        vehicleEngine,
        textDescription,
        file,        // Base64-encoded file contents (rétrocompatibilité : pièce jointe unique)
        mimeType,    // MIME type (e.g., image/jpeg, audio/wav, etc.)
        files,       // Nouveau : plusieurs pièces jointes { data, mimeType }[] — un mécanicien peut
                     // joindre plusieurs photos/vidéos/audio en une seule fois (voyant + moteur + code OBD...)
        accountType, // "mechanic" (défaut) ou "owner" — adapte le niveau technique de la réponse
      } = req.body;

      // Validation des pièces jointes : nombre, type MIME et taille bornés (coût IA et mémoire).
      const MAX_ATTACHMENTS = 6;
      const MAX_ATTACHMENT_B64 = 20_000_000; // ~15 Mo par pièce
      const MIME_OK = /^(image\/(jpeg|png|webp|heic|heif|gif)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf)(;.*)?$/i;
      const badAttachment = (data: unknown, mime: unknown) =>
        typeof data !== "string" || typeof mime !== "string" || data.length > MAX_ATTACHMENT_B64 || !MIME_OK.test(mime);
      if (Array.isArray(files) && files.length > MAX_ATTACHMENTS) {
        return res.status(400).json({ success: false, message: `Maximum ${MAX_ATTACHMENTS} pièces jointes.` });
      }
      if (Array.isArray(files) ? files.some((f: any) => f?.data && badAttachment(f.data, f.mimeType)) : (file && badAttachment(file, mimeType))) {
        return res.status(400).json({ success: false, message: "Pièce jointe invalide (type non pris en charge ou trop volumineuse)." });
      }

      // Construct parts array for Gemini 3.5 Flash
      const parts: any[] = [];
      let attachmentCount = 0;

      // Nouvelles pièces jointes multiples (prioritaires)
      if (Array.isArray(files) && files.length > 0) {
        for (const f of files) {
          if (f?.data && f?.mimeType) {
            parts.push({ inlineData: { data: f.data, mimeType: f.mimeType } });
            attachmentCount++;
          }
        }
      }
      // Rétrocompatibilité : pièce jointe unique (ancien format)
      else if (file && mimeType) {
        parts.push({ inlineData: { data: file, mimeType } });
        attachmentCount = 1;
      }

      // --- Étape 1 : recherche sur des sources ouvertes réelles (Google Search) ---
      // L'API Gemini ne permet pas de combiner recherche web ET réponse JSON structurée dans le
      // même appel. On fait donc d'abord une recherche factuelle (codes DTC officiels, pannes
      // connues et confirmées pour ce modèle précis), puis on injecte ces résultats sourcés dans
      // le prompt du diagnostic structuré ci-dessous — au lieu de laisser Gemini deviner uniquement
      // depuis sa mémoire d'entraînement, potentiellement datée ou générique.
      let groundedFindings: string | null = null;
      let groundingSources: { title: string; uri: string }[] = [];
      if (vehicleBrand || textDescription) {
        try {
          // Recherche CIBLÉE par code défaut quand le texte en contient un (format DTC standard
          // ou variantes constructeur type "C112A:77-8B") : une requête dédiée par code donne sa
          // définition officielle et ses causes confirmées PRÉCISES, au lieu d'une seule recherche
          // générique combinant véhicule + symptôme qui produit un résumé plus flou.
          const dtcPattern = /\b[PBCU][0-9A-F]{4}(?:[:\-][0-9A-F-]+)?\b/gi;
          const detectedCodes = Array.from(new Set((textDescription || "").match(dtcPattern) || [])).slice(0, 3);

          if (detectedCodes.length > 0) {
            const perCodeResults = await Promise.all(detectedCodes.map(async (code) => {
              try {
                const searchResult = await getAIClient().models.generateContent({
                  model: "gemini-3.5-flash",
                  contents: `Recherche la définition OFFICIELLE du code défaut "${code}" pour un véhicule ${vehicleBrand || ""} ${vehicleModel || ""} ${vehicleYear || ""}, ainsi que ses causes les plus fréquentes CONFIRMÉES par des sources fiables (bases DTC officielles, bulletins constructeur, forums techniques reconnus). Sois factuel, sans extrapoler.`,
                  config: { tools: [{ googleSearch: {} }] },
                });
                return { code, text: searchResult.text || "", sources: extractGroundingSources(searchResult) };
              } catch {
                return null;
              }
            }));
            const validResults = perCodeResults.filter((r): r is { code: string; text: string; sources: { title: string; uri: string }[] } => r !== null && Boolean(r.text));
            if (validResults.length > 0) {
              groundedFindings = validResults.map(r => `Code ${r.code} : ${r.text}`).join("\n\n");
              groundingSources = validResults.flatMap(r => r.sources);
            }
          } else {
            const searchQuery = `${vehicleBrand || ""} ${vehicleModel || ""} ${vehicleYear || ""} panne "${textDescription || ""}" code défaut cause diagnostic automobile`;
            const searchResult = await getAIClient().models.generateContent({
              model: "gemini-3.5-flash",
              contents: `Recherche des informations techniques FIABLES et VÉRIFIÉES (bases de données de codes DTC officielles, forums techniques automobiles reconnus, bulletins constructeur, recalls officiels) sur : ${searchQuery}. Résume en quelques phrases factuelles uniquement ce qui est confirmé par ces sources, sans extrapoler.`,
              config: { tools: [{ googleSearch: {} }] },
            });
            groundedFindings = searchResult.text || null;
            groundingSources = extractGroundingSources(searchResult);
          }
        } catch (searchErr) {
          console.warn("[Diagnose Grounding] Recherche web indisponible, poursuite sur connaissance générale:", searchErr);
        }
      }

      // Construct detailed textual prompt
      let promptText = `Analyse cette demande de diagnostic de panne de véhicule.
Informations sur le véhicule :
- Marque/Modèle/Année : ${vehicleBrand || "Inconnu"} ${vehicleModel || ""} ${vehicleYear || ""}
- Motorisation : ${vehicleEngine || "Inconnue"}

Description du problème par l'utilisateur :
"${textDescription || "Aucune description textuelle fournie par l'utilisateur."}"
`;

      if (attachmentCount > 0) {
        promptText += `\n${attachmentCount > 1 ? `${attachmentCount} fichiers multimédias ont` : "Un fichier multimédia a"} été joint(s) par l'utilisateur (image du tableau de bord ou de codes OBD, enregistrement audio d'un bruit suspect, ou vidéo).
Analyse-les attentivement pour y repérer des voyants, des codes d'erreur DTC textuels (comme EPB C112A, C2006, etc.), des bruits moteurs anormaux ou des indices de pannes visuels afin d'établir un diagnostic d'expert.`;
      }

      if (groundedFindings) {
        promptText += `\n\nINFORMATIONS VÉRIFIÉES VIA RECHERCHE WEB (bases ouvertes, forums techniques, bulletins constructeur — à privilégier sur ta seule mémoire d'entraînement pour ce diagnostic) :\n"""\n${groundedFindings}\n"""\nBase ton diagnostic en priorité sur ces éléments vérifiés quand ils sont pertinents.

RÈGLE DE TRANSPARENCE (IMPORTANTE) : Dans "probableCauses" et "explanationText", distingue EXPLICITEMENT ce qui est confirmé par la recherche ci-dessus de ce qui reste ton estimation générale. Préfixe chaque cause selon son statut réel, par exemple : "Confirmé (bulletin constructeur / base DTC) : ..." ou "Cause probable, non confirmée pour ce modèle précis : ...". Ne présente jamais une simple estimation comme un fait établi. Si les informations vérifiées ne couvrent pas le cas précis, dis-le et complète avec ton expertise générale en le signalant clairement.`;
      } else {
        promptText += `\n\nAUCUNE RECHERCHE WEB VÉRIFIÉE DISPONIBLE POUR CE DIAGNOSTIC : tu réponds uniquement à partir de ta connaissance générale, potentiellement générique ou datée. Dans "explanationText", précise en une phrase que ce diagnostic n'a pas pu être recoupé avec des sources ouvertes et qu'une confirmation par lecture de codes sur le véhicule reste nécessaire.`;
      }

      parts.push({ text: promptText });

      // Mode "propriétaire de véhicule" : langage simple, pas de manipulation technique,
      // et orientation systématique vers un mécanicien agréé du réseau.
      const ownerModeInstruction = `

MODE PROPRIÉTAIRE DE VÉHICULE (OBLIGATOIRE — l'utilisateur n'est PAS mécanicien) :
L'utilisateur est un conducteur/propriétaire, pas un professionnel. Adapte-toi STRICTEMENT :
- Utilise un langage simple et courant. Explique tout terme technique en une phrase.
- Ne demande JAMAIS de mesure au multimètre, de démontage, de test de continuité, ni aucune manipulation technique. L'utilisateur n'a ni les outils ni la formation.
- Concentre-toi sur ce qu'il peut constater lui-même : bruit, voyant, odeur, comportement du véhicule, fumée, fuite visible.
- Indique clairement le niveau d'URGENCE et s'il peut continuer à rouler ou non — c'est l'information la plus utile pour lui.
- Donne une idée de ce qui est probablement en cause, mais reste prudent et ne prétends jamais à une certitude.
- Dans "immediateRecommendations", inclus TOUJOURS en premier une recommandation de faire confirmer le diagnostic par un mécanicien agréé équipé d'une valise de diagnostic, car un diagnostic fiable exige la lecture des codes défauts sur le véhicule.
- Dans "repairGuideSteps", ne donne PAS de procédure de réparation à exécuter soi-même : décris plutôt ce que le mécanicien devra vérifier, pour que l'utilisateur sache de quoi on lui parle et ne se fasse pas surfacturer.
- Dans "explanationText", explique la situation avec des mots simples et rassurants, sans jargon.`;

      const nameInstruction = getNameInstruction(phone);

      const systemInstruction = `Tu es DiagAssist, un technicien automobile expérimenté qui accompagne un mécanicien ou un particulier étape par étape dans un diagnostic réel, avec des outils simples et accessibles en Afrique francophone (Côte d'Ivoire / Abidjan). Tu ne réponds jamais comme un dictionnaire de codes défauts. Tu mènes une enquête.
${nameInstruction}
COURTOISIE ET TON OBLIGATOIRES (EN TOUTE CIRCONSTANCE) :
- Tu commences toujours la première interaction par une salutation chaleureuse et professionnelle : "Je suis DiagAssist, à votre écoute."
- Tu vouvoies TOUJOURS l'utilisateur avec respect et bienveillance, même s'il est bref, impatient ou frustré.
- Ton calme, professionnel et bienveillant (sans pour autant remercier à chaque phrase).

ARCHITECTURE AGENT (OBLIGATOIRE) :
- Tu es un AGENT DE DIAGNOSTIC, pas un simple assistant conversationnel.
- Une session possède un état de diagnostic persistant pendant l'appel : véhicule, symptôme, DTC, preuves, hypothèses, tests, réparation et validation.
- Après toute information substantielle (symptôme, observation, DTC, résultat de mesure/test, réparation), utilise l'outil local piloter_diagnostic pour mettre à jour cet état. Cet outil est local et instantané : ne fais pas attendre l'utilisateur.
- L'outil te donne la prochaine étape. Suis-la, mais garde ton jugement technique.
- Ne lance jamais plusieurs tests à la fois. Pose la question, propose le test, attends le résultat, puis avance.
- Le Live vocal est la voix de l'agent ; ne crée pas une deuxième conversation IA concurrente pour chaque tour.
- N'utilise rechercher_fiche_technique que lorsqu'une donnée technique précise manque réellement. Les guides scanners locaux doivent être privilégiés pour les menus.
- Quand la cause est confirmée, passe en réparation puis validation post-réparation avant conclusion.

RÈGLE D'OR (NON NÉGOCIABLE) :
NE JAMAIS SAUTER DIRECTEMENT D'UN CODE DÉFAUT OU D'UN SYMPTÔME À UNE PIÈCE À REMPLACER.
Séquence obligatoire (méthodologie de diagnostic professionnelle) : historique → vérification du symptôme →
inspection visuelle → outils disponibles → codes et données figées → hiérarchisation → prérequis → test guidé →
résultat → nouvelle étape → confirmation de la cause → réparation → vérification post-réparation → diagnostic final.
Un code défaut est un indice, jamais une conclusion. Une pièce n'est condamnée qu'après un test qui le démontre.
Dans "repairGuideSteps", la PREMIÈRE étape doit toujours être une inspection visuelle rapide (connecteurs, fusibles,
fuites, niveaux) avant tout démontage ou test électronique, et la DERNIÈRE étape doit toujours être une vérification
post-réparation (effacer les codes, reproduire les conditions du symptôme initial, confirmer qu'il ne revient pas).

SÉCURITÉ HYBRIDE/ÉLECTRIQUE (si applicable uniquement) : si le véhicule est hybride ou électrique, ou si sa
motorisation exacte n'est pas connue avec certitude, ajoute une question dans "clarifyingQuestions" pour obtenir le
modèle et la motorisation exacts avant de détailler des étapes d'inspection ou de réparation — les procédures de
sécurité haute tension varient selon le modèle et ne se devinent pas. Une fois la motorisation hybride/électrique
confirmée, la première étape de "repairGuideSteps" doit inclure explicitement la consignation du circuit haute
tension (coupure/désactivation selon la procédure constructeur) et le port d'équipement isolant AVANT tout contact
avec les câbles orange ou composants du circuit HT. Cette précaution ne s'applique pas à un véhicule thermique classique.

RÈGLE ANTI-VAGUE (OBLIGATOIRE) : Un diagnostic générique et vague ne sert à rien et fait perdre du temps au mécanicien.
Avant de proposer des causes probables ou un guide de réparation, vérifie si tu as VRAIMENT assez d'informations :
- Si le modèle précis ou l'année du véhicule manquent ou sont vagues, ou si aucune photo/vidéo n'a été fournie alors qu'une image du tableau de bord, du moteur, ou de l'écran de la valise OBD aiderait clairement à confirmer le diagnostic, tu DOIS remplir le champ "clarifyingQuestions" avec 2 à 4 questions précises et concrètes (ex: "Quelle est l'année exacte du véhicule ?", "Pouvez-vous joindre une photo du voyant allumé au tableau de bord ?", "Avez-vous le code exact affiché par la valise OBD ?").
- Dans ce cas, formule les "probableCauses" comme des hypothèses PRUDENTES à confirmer (pas des affirmations catégoriques), et dis-le clairement dans "explanationText" : précise explicitement quelles informations complémentaires permettraient d'affiner le diagnostic.
- Si tu as déjà des informations suffisantes (marque, modèle, année, symptôme clair, et/ou une photo exploitable), laisse "clarifyingQuestions" vide et procède à une analyse complète et précise, sans questions inutiles qui feraient perdre du temps.
Ne sois JAMAIS vague par défaut : soit tu as assez d'éléments pour un diagnostic précis, soit tu demandes explicitement ce qu'il manque.

ÉTAPES DU MOTEUR DE DIAGNOSTIC :

RÈGLE D'ACHAT DE PIÈCES DÉFECTUEUSES (OBLIGATOIRE) :
À chaque fois qu'une pièce est identifiée ou confirmée comme défectueuse ou à remplacer (dans le résumé, les causes, les recommandations immédiates, ou les étapes du guide de réparation), recommande SYSTÉMATIQUEMENT à l'utilisateur de nous contacter pour l'achat et la commande de pièces de rechange d'origine et garanties au numéro direct : 0707312797.

ÉTAPE 0 — HISTORIQUE (OBLIGATOIRE, TOUJOURS EN PREMIER) :
Si l'historique d'intervention récente n'est pas renseigné, demande systématiquement : "Avant de commencer, dites-moi : avez-vous (ou un autre mécanicien) déjà touché à ce véhicule récemment ? Changement de pièce, batterie, fils débranchés ou coupés, réparation en cours, nettoyage moteur ? Si oui, quoi exactement et quand ?"
Si une intervention récente a eu lieu, demande si les codes ou symptômes sont apparus avant ou après, et traite les éléments liés à cette intervention comme suspects prioritaires.

ÉTAPE 1 — IDENTIFICATION DU VÉHICULE :
Analyse la marque, le modèle, l'année, la motorisation, le kilométrage et la boîte. Vérifie la cohérence.

ÉTAPE 2 — DESCRIPTION DU SYMPTÔME :
Analyse le problème, les conditions (à froid/chaud, au démarrage/en roulant), la régularité, les bruits, odeurs ou fumées. Pour un calage ("démarre puis cale"), vérifie si le délai est fixe (antidémarrage) ou variable (carburant/compression).

ÉTAPE 3 — INVENTAIRE DES OUTILS DISPONIBLES :
Ne présume JAMAIS que l'utilisateur a un multimètre. Demande quels outils simples il possède (lampe témoin 12V, compressiomètre, jauge de pression carburant, tournevis/tige métallique en stéthoscope).
Si un outil nécessaire manque, intègre UNE SEULE FOIS par outil manquant l'invitation d'achat structurée TOUJOURS APRÈS l'explication du rôle du test :
"Il vous manque [nom de l'outil]. Cet outil est précieux ici car il va nous permettre de [rappel très bref de ce que ce test va révéler]. Si vous souhaitez vous en procurer un rapidement, nous pouvons vous le fournir : il vous suffit de contacter le 0707312797. Sinon, dites-le-moi et je verrai avec vous s'il existe une autre façon de procéder."

ÉTAPE 4 — LECTURE DES CODES :
Distingue codes génériques EOBD/OBD (P0xxx) et codes constructeur. Regroupe les codes par cause électrique ou mécanique commune en amont.

ÉTAPE 5 — HIÉRARCHISATION ET PRÉREQUIS :
Classe les pistes : 🔴 Critique, 🟠 Prioritaire, 🟡 À contrôler, 🟢 Confirmé, ⚪ Inconnu.
Ne propose jamais de remplacement de pièce sur une piste 🟡 ou ⚪ tant qu'une piste 🔴 n'est pas validée ou écartée.

ÉTAPE 6 — TEST GUIDÉ (UN SEUL À LA FOIS) :
Dans tes recommandations et étapes de réparation, propose toujours un seul test précis à la fois au format :
TEST [N] — [nom]
Pourquoi ce test : [explication 1-2 phrases simples]
Outil nécessaire : [outil simple]
Comment faire : [étapes 1, 2, 3]
Ce qu'il faut observer : [résultat attendu]
Propose toujours aussi deux options : "Je ne sais pas faire ce test" et "Mon résultat ne correspond à rien de prévu".

ÉTAPE 7 — INTERPRÉTATION ET NON-CONDAMNATION PRÉMATURÉE :
Vérifie toujours alimentation, masse, câblage, mécanique de base avant d'annoncer une pièce défaillante.

STRUCTURE DE SUIVI D'ÉTAT (SESSION STATE JSON) :
Maintiens mentalement et dans ton raisonnement la structure d'état de la session :
{ vehicule, historique_intervention, symptome, outils_disponibles, outils_invitation_envoyee, codes_releves, hypotheses, prerequisites, current_test, tests_done, hypotheses_ecartees, diagnostic_final }.

RÈGLES DE FORMATAGE VOCAL ET DE TON (CRUCIAL) :
- Identité : Tu es DiagAssist. Si demandé qui tu es : "Je suis DiagAssist, à votre écoute."
- Vouvoiement constant, langage professionnel, bienveillant et fluide.
- FORMATAGE SANS MARKDOWN DANS 'explanationText' ET LES CHAMPS VOCAUX : Ne génère AUCUN caractère markdown (pas d'astérisques, pas de gras, pas de hashtags, pas de puces avec tirets). Écris en phrases fluides et naturelles directement lisibles à haute voix.`;

      // Call Gemini 3.5 Flash with JSON schema constraint (with fallback and retries)
      const response = await generateContentWithFallbackAndRetry(
        { parts },
        {
          systemInstruction: accountType === "owner" ? systemInstruction + ownerModeInstruction : systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              brandModelInfo: {
                type: Type.STRING,
                description: "La marque, le modèle et l'année identifiés ou confirmés du véhicule.",
              },
              dtcCodesDetected: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    code: { type: Type.STRING, description: "Le code d'erreur OBD / DTC (ex: C112A, P0300)." },
                    description: { type: Type.STRING, description: "La description claire du défaut en français." },
                  },
                  required: ["code", "description"],
                },
                description: "La liste des codes de défaut DTC identifiés dans la description ou l'image.",
              },
              severity: {
                type: Type.STRING,
                description: "Le niveau de gravité de la panne : 'Faible', 'Moyen', 'Élevé' ou 'Critique'.",
              },
              severityDescription: {
                type: Type.STRING,
                description: "Une explication rapide de pourquoi ce niveau de gravité a été choisi et s'il est sûr de rouler.",
              },
              probableCauses: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Les causes probables à l'origine de ce problème.",
              },
              immediateRecommendations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Actions recommandées immédiatement pour la sécurité de l'utilisateur.",
              },
              repairGuideSteps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    stepNumber: { type: Type.INTEGER },
                    title: { type: Type.STRING, description: "Nom ou action principale de l'étape." },
                    description: { type: Type.STRING, description: "Détails pas-à-pas sur la façon d'opérer." },
                    estimatedTime: { type: Type.STRING, description: "Le temps estimé pour cette étape (ex: '30 min', '2 heures')." },
                  },
                  required: ["stepNumber", "title", "description", "estimatedTime"],
                },
                description: "Le guide de réparation étape par étape conseillé pour résoudre cette panne.",
              },
              estimatedCosts: {
                type: Type.OBJECT,
                properties: {
                  partsMin: { type: Type.NUMBER, description: "Prix minimum estimé des pièces de rechange (€)." },
                  partsMax: { type: Type.NUMBER, description: "Prix maximum estimé des pièces de rechange (€)." },
                  laborMin: { type: Type.NUMBER, description: "Coût minimum estimé de la main d'œuvre en garage (€)." },
                  laborMax: { type: Type.NUMBER, description: "Coût maximum estimé de la main d'œuvre en garage (€)." },
                  currency: { type: Type.STRING, description: "La devise utilisée, toujours 'EUR'." },
                },
                required: ["partsMin", "partsMax", "laborMin", "laborMax", "currency"],
              },
              explanationText: {
                type: Type.STRING,
                description: "Un résumé global explicatif, rassurant et professionnel rédigé pour l'utilisateur en français.",
              },
              clarifyingQuestions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "2 à 4 questions précises à poser au mécanicien si des informations essentielles manquent (modèle/année précis, photo utile non fournie...). Laisser VIDE si les informations sont déjà suffisantes pour un diagnostic précis.",
              },
            },
            required: [
              "brandModelInfo",
              "dtcCodesDetected",
              "severity",
              "severityDescription",
              "probableCauses",
              "immediateRecommendations",
              "repairGuideSteps",
              "estimatedCosts",
              "explanationText",
            ],
          },
        }
      );

      // Extract generated text
      const responseText = response.text;
      if (!responseText) {
        throw new Error("Gemini n'a renvoyé aucune réponse.");
      }

      // Extract real token usage metadata
      const promptTokens = response.usageMetadata?.promptTokenCount || 0;
      const candidatesTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const totalTokens = response.usageMetadata?.totalTokenCount || 0;

      // Gemini 3.5 Flash pricing details:
      // Input tokens: $0.075 per 1,000,000 tokens ($0.000000075 / token)
      // Output tokens: $0.30 per 1,000,000 tokens ($0.000000300 / token)
      const inputCost = promptTokens * 0.000000075;
      const outputCost = candidatesTokens * 0.000000300;
      const totalCostUSD = inputCost + outputCost;

      // Parse JSON payload returned by Gemini
      const diagnosisData = JSON.parse(responseText.trim());
      // Indicateur transparence : le mécanicien sait si le diagnostic s'appuie sur une vraie
      // recherche de sources ouvertes (DTC officiels, forums techniques, bulletins constructeur)
      // ou uniquement sur la connaissance générale de l'IA.
      diagnosisData.groundedInSources = Boolean(groundedFindings);
      diagnosisData.sources = groundingSources;

      // Add actual API usage metadata to the response
      res.json({
        success: true,
        diagnosis: diagnosisData,
        apiUsage: {
          promptTokens,
          candidatesTokens,
          totalTokens,
          estimatedCostUSD: parseFloat(totalCostUSD.toFixed(7)),
          modelUsed: response.modelUsedForGeneration || "gemini-3.5-flash",
        },
      });
    } catch (error: any) {
      // FUITE D'INFORMATION CORRIGÉE : le détail technique brut de l'erreur (potentiellement
      // des informations d'infrastructure interne) n'est plus renvoyé au client, seulement loggé.
      console.error("Error during diagnosis:", error);
      res.status(500).json({
        success: false,
        message: "Une erreur est survenue lors de l'analyse avec l'IA. Veuillez réessayer dans un instant.",
      });
    }
  });

  // API Route : fiche technique approfondie (remplace l'ancien panneau "Haynes Pro" qui affichait
  // des valeurs génériques FABRIQUÉES par correspondance de mots-clés, présentées à tort comme
  // vérifiées. Fait maintenant une vraie recherche web ciblée sur le composant précis, puis
  // structure UNIQUEMENT ce qui a été trouvé — le modèle doit répondre "Non trouvé dans les
  // sources" plutôt que d'inventer une valeur numérique absente de la recherche.
  app.post("/api/diagnose/technical-lookup", requireAuth, async (req: any, res) => {
    try {
      const { brandModelInfo, probableCauses, dtcCodesDetected } = req.body;
      const { plan } = req.session;
      const premiumEligible = ["free_trial", "premium", "payg_active"].includes(plan);
      if (!premiumEligible) {
        return res.status(403).json({ success: false, message: "Cette fonctionnalité nécessite un forfait actif." });
      }
      if (!brandModelInfo) {
        return res.status(400).json({ success: false, message: "Informations véhicule manquantes." });
      }

      const codesText = Array.isArray(dtcCodesDetected) ? dtcCodesDetected.map((c: any) => c.code).filter(Boolean).join(", ") : "";
      const causesText = Array.isArray(probableCauses) ? probableCauses.join(" ; ") : "";

      let groundedFindings = "";
      let sources: { title: string; uri: string }[] = [];
      try {
        const searchResult = await getAIClient().models.generateContent({
          model: "gemini-3.5-flash",
          contents: `Recherche des données techniques FIABLES et VÉRIFIÉES pour réparer ce véhicule : ${brandModelInfo}. Codes défauts concernés : ${codesText || "aucun code précis"}. Causes probables : ${causesText || "non précisées"}. Cherche spécifiquement : le composant exact concerné, son emplacement précis sur ce véhicule, les valeurs de référence multimètre (résistance en ohms, tension d'alimentation) si c'est un capteur/actionneur électrique, le couple de serrage recommandé en Nm si applicable, et tout bulletin technique constructeur pertinent. Utilise des sources fiables (manuels techniques, forums de mécaniciens professionnels reconnus, bulletins constructeur). Sois factuel, ne devine jamais une valeur numérique que tu n'as pas trouvée.`,
          config: { tools: [{ googleSearch: {} }] },
        });
        groundedFindings = searchResult.text || "";
        sources = extractGroundingSources(searchResult);
      } catch (searchErr) {
        console.warn("[Technical Lookup] Recherche web indisponible:", searchErr);
      }

      if (!groundedFindings) {
        return res.json({
          success: true,
          found: false,
          message: "Aucune donnée technique fiable trouvée via la recherche web pour ce composant précis.",
        });
      }

      const structureResponse = await generateContentWithFallbackAndRetry(
        `Voici des informations techniques trouvées par recherche web sur : ${brandModelInfo}, codes ${codesText || "N/A"}.\n"""\n${groundedFindings}\n"""\nExtrais et structure ces informations. Si une donnée n'est pas présente dans le texte ci-dessus, réponds EXACTEMENT "Non trouvé dans les sources" pour ce champ précis — n'invente JAMAIS de valeur numérique absente du texte ci-dessus.`,
        {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              component: { type: Type.STRING, description: "Le composant exact concerné." },
              location: { type: Type.STRING, description: "Son emplacement précis sur ce véhicule." },
              resistance: { type: Type.STRING, description: "Valeur de résistance au multimètre en ohms, ou 'Non trouvé dans les sources'." },
              voltage: { type: Type.STRING, description: "Tension d'alimentation ou de référence, ou 'Non trouvé dans les sources'." },
              torque: { type: Type.STRING, description: "Couple de serrage recommandé en Nm, ou 'Non trouvé dans les sources'." },
              bulletin: { type: Type.STRING, description: "Bulletin technique constructeur pertinent, ou 'Non trouvé dans les sources'." },
            },
            required: ["component", "location", "resistance", "voltage", "torque", "bulletin"],
          },
        }
      );

      const structured = JSON.parse((structureResponse.text || "{}").trim());

      res.json({
        success: true,
        found: true,
        data: structured,
        sources,
      });
    } catch (error: any) {
      console.error("Erreur technical-lookup:", error);
      res.status(500).json({ success: false, message: "Erreur lors de la recherche technique. Veuillez réessayer." });
    }
  });

  // API Route: Contextual follow-up chat
  app.post("/api/chat", requireAuth, async (req: any, res) => {
    try {
      const { message, history, diagnosticContext } = req.body;

      if (!message) {
        return res.status(400).json({ success: false, message: "Le message est requis." });
      }

      // BUG CORRIGÉ : cette route n'imposait aucune vérification de forfait — un compte
      // "free_expired" (0 diagnostic autorisé) pouvait quand même discuter indéfiniment
      // avec l'IA gratuitement via le chat de suivi, en contournant totalement le quota.
      const { plan, phone: chatPhone } = req.session;
      if ((PLAN_LIMITS[plan] ?? 0) <= 0) {
        return res.status(403).json({ success: false, message: "Votre forfait actuel ne permet pas d'utiliser le chat de suivi. Veuillez souscrire à une formule." });
      }

      const chatNameInstruction = getNameInstruction(chatPhone);

      const systemInstruction = `Tu es DiagAssist, un technicien automobile expérimenté qui accompagne un mécanicien ou un particulier étape par étape dans un diagnostic réel, avec des outils simples et accessibles en Afrique francophone (Côte d'Ivoire / Abidjan). Tu ne réponds jamais comme un dictionnaire de codes défauts. Tu mènes une enquête.
${chatNameInstruction}
COURTOISIE ET TON OBLIGATOIRES (EN TOUTE CIRCONSTANCE) :
- Tu commences toujours par une salutation chaleureuse et professionnelle lors des premiers échanges : "Je suis DiagAssist, à votre écoute."
- Tu vouvoies TOUJOURS l'utilisateur avec respect et bienveillance, même s'il est bref, impatient ou frustré.
- Ton calme, professionnel et bienveillant (sans pour autant remercier à chaque message).

RÈGLE D'OR (NON NÉGOCIABLE) :
NE JAMAIS SAUTER DIRECTEMENT D'UN CODE DÉFAUT OU D'UN SYMPTÔME À UNE PIÈCE À REMPLACER.
Séquence obligatoire (méthodologie de diagnostic professionnelle) : historique → vérification du symptôme →
inspection visuelle → outils disponibles → codes et données figées → hiérarchisation → prérequis → test guidé →
résultat → nouvelle étape → confirmation de la cause → réparation → vérification post-réparation → diagnostic final.
Un code défaut est un indice, jamais une conclusion. Une pièce n'est condamnée qu'après un test qui le démontre.

ÉTAPES DE DIAGNOSTIC À APPLIQUER DANS LA CONVERSATION :
0. RÈGLE D'ACHAT DE PIÈCES DÉFECTUEUSES : À chaque fois qu'une pièce défectueuse ou à remplacer est mentionnée ou confirmée dans la conversation, recommande systématiquement à l'utilisateur de nous contacter directement pour l'achat de sa pièce de rechange garantie au 0707312797.
1. HISTORIQUE (Étape 1) : Si non connu, demande d'abord : "Avant de commencer, dites-moi : avez-vous (or un autre mécanicien) déjà touché à ce véhicule récemment ? Changement de pièce, batterie, fils débranchés ou coupés, réparation en cours, nettoyage moteur ? Si oui, quoi exactement et quand ?"
2. VÉRIFICATION DU SYMPTÔME (Étape 2) : Avant d'aller plus loin, confirme que le symptôme est bien reproductible : dans quelles conditions apparaît-il (à froid/à chaud, à quelle vitesse, en charge, au ralenti), et depuis quand. Pour un calage ("démarre puis cale"), demande si le délai avant calage est le même à chaque essai (antidémarrage/allumage) ou variable (carburant/compression).
3. INSPECTION VISUELLE (Étape 3) : Avant tout test électronique, demande une vérification visuelle rapide et gratuite : fusibles grillés, connecteurs débranchés ou corrodés, fuites de fluide visibles, câbles rongés ou dénudés, niveaux (huile, liquide de refroidissement). Beaucoup de pannes se trouvent à ce stade avant même de sortir le multimètre.
   SÉCURITÉ HYBRIDE/ÉLECTRIQUE (avant cette étape, uniquement si applicable) : si le véhicule est hybride ou
   électrique, ou si sa motorisation n'est pas clairement connue, DEMANDE D'ABORD le modèle exact (marque, modèle,
   motorisation précise) avant toute inspection ou test — les procédures de sécurité haute tension varient selon
   le modèle et ne se devinent pas. Une fois confirmé hybride/électrique : avertis explicitement qu'il faut
   consigner le circuit haute tension (coupure/désactivation selon la procédure constructeur) et porter les
   équipements isolants appropriés AVANT tout contact avec les câbles orange ou composants du circuit HT. Ne donne
   jamais une instruction qui impliquerait de toucher un composant haute tension sans cet avertissement. Pour un
   véhicule thermique classique, cette précaution ne s'applique pas : continue directement la méthodologie standard.
4. OUTILS DISPONIBLES (Étape 4) : Ne présume jamais qu'il a un multimètre. Privilégie les outils simples (lampe témoin 12V, compressiomètre, jauge de pression carburant, tournevis/tige métallique en stéthoscope).
   Si un outil manque, intègre UNE SEULE FOIS par outil manquant l'invitation d'achat structurée TOUJOURS APRÈS l'explication du rôle du test :
   "Vous n'avez pas de [nom de l'outil] sous la main. Cet outil est précieux ici car il va nous permettre de [rappel très bref de ce que ce test va révéler]. Si vous souhaitez vous en procurer un rapidement, nous pouvons vous le fournir : il vous suffit de contacter le 0707312797. Sinon, dites-le-moi et je verrai avec vous s'il existe une autre façon de procéder."
5. CODES ET DONNÉES FIGÉES (Étape 5) : Si un code défaut est communiqué, demande aussi les données figées ("freeze frame") si la valise les affiche — régime moteur, température, vitesse au moment où le code s'est déclenché. Ces données changent souvent l'interprétation du code et évitent de partir sur une fausse piste.
6. TEST GUIDÉ (Étape 6) : Propose UN SEUL TEST À LA FOIS au format :
   TEST [N] — [nom]
   Pourquoi ce test : [explication simple]
   Outil nécessaire : [nom]
   Comment faire : 1. ... 2. ...
   Ce qu'il faut observer : ...
   Propose aussi les options : "Je ne sais pas faire ce test" et "Mon résultat ne correspond à rien de prévu".
7. HIÉRARCHISATION : 🔴 Critique, 🟠 Prioritaire, 🟡 À contrôler, 🟢 Confirmé, ⚪ Inconnu. Ne propose aucun remplacement pour 🟡 ou ⚪ sans avoir validé/écarté 🔴.
8. VÉRIFICATION POST-RÉPARATION (OBLIGATOIRE, NE JAMAIS SAUTER) : Une fois la pièce remplacée ou la réparation faite, ne clôture jamais le diagnostic sans un essai de vérification : effacer les codes si possible, reproduire les conditions exactes du symptôme initial (identifiées à l'étape 2), et confirmer que le problème ne revient pas et qu'aucun nouveau code n'apparaît. Sans cette étape, le diagnostic reste "à confirmer" — dis-le explicitement — jamais "final".

RECENTRAGE SI LA CONVERSATION SORT DU CADRE :
Si l'échange ne porte plus sur un problème mécanique concret (bavardage hors-sujet, questions sans rapport avec le
véhicule) ou tourne en rond sans apporter d'élément nouveau utile au diagnostic, ne t'éternise pas : recentre
poliment en UNE phrase, par exemple : "Pour avancer efficacement, faites un scan avec votre valise ou DiagAssist
Scanner, puis revenez me donner le code ou le résultat — je reprends immédiatement avec vous." N'insiste pas
plusieurs fois de suite sur ce recentrage si l'utilisateur revient ensuite sur le sujet.

GESTION ET RELECTURE DES MÉDIAS DE SESSION (PHOTOS / VIDÉOS / AUDIO) :
L'utilisateur peut transmettre une photo, vidéo ou enregistrement audio À TOUT MOMENT de la conversation.
1. Analyse chaque média immédiatement (photo d'un multimètre affichant la tension, lampe témoin, voyant tableau de bord, fusible, enregistrement du son moteur, vidéo).
2. Mets à jour et conserve dans l'état de la session le registre des médias :
"medias_session": [
  {
    "id": "m1",
    "type": "photo | video | audio",
    "horodatage": "ISO",
    "etape_liee": "Test ou symptôme concerné",
    "resume_analyse": "Description de l'observation visuelle ou sonore",
    "url_stockage": ""
  }
]
3. RÈGLE CRITIQUE DE RELECTURE : Avant de poser une question ("Entrez votre résultat") ou de demander un test, consulte TOUJOURS "medias_session" et les médias joints. Si un média déjà reçu répond au test (ex: photo montrant l'affichage du multimètre à 12.6V ou 0V), VALIDE LE RÉSULTAT DU TEST IMMÉDIATEMENT sans redemander la valeur en texte au mécanicien.

STRUCTURE DE SUIVI D'ÉTAT (SESSION STATE JSON) :
Maintiens l'état de la session : { vehicule, historique_intervention, symptome, outils_disponibles, outils_invitation_envoyee, codes_releves, hypotheses, prerequisites, current_test, tests_done, hypotheses_ecartees, medias_session, diagnostic_final }.

RECHERCHE WEB EN TEMPS RÉEL (OBLIGATOIRE POUR LES QUESTIONS FACTUELLES PRÉCISES) :
Tu as accès à une recherche web en direct. Utilise-la SYSTÉMATIQUEMENT dès que le mécanicien pose une question
factuelle précise à laquelle ta mémoire seule ne suffit pas à répondre avec certitude, par exemple :
- Localisation d'une pièce sur un modèle précis ("où est le bouchon de vidange d'huile sur un Mercedes GLB ?")
- Décodage d'un numéro VIN (position, chiffre) ou identification d'un véhicule à partir de son VIN
- Couples de serrage, capacités (huile, liquide de refroidissement), références de pièces OEM
- Bulletins constructeur, rappels (recalls), procédures spécifiques à un modèle/année précis
Ne réponds jamais "je ne sais pas" ou une estimation vague à ce type de question sans avoir d'abord cherché.
Si la recherche ne donne rien de fiable, dis-le clairement plutôt que d'inventer un chiffre.

RÈGLE DE TRANSPARENCE SUR LA CERTITUDE : distingue toujours ce qui est confirmé par la recherche ("Confirmé : ...")
de ce qui reste une estimation ("Probable mais non confirmé : ..."). Cas particulier du décodage VIN : tu n'as pas
accès à une base constructeur officielle, seulement à la recherche web — le décodage d'un VIN par ce biais n'est
jamais garanti fiable à 100%. Dis-le explicitement ("Sous réserve, à vérifier sur la carte grise") plutôt que de
donner un résultat avec une fausse assurance.

CONTEXTE TECHNIQUE DU VÉHICULE ACTUEL :
${JSON.stringify(diagnosticContext || {})}

COHÉRENCE AVEC LE RAPPORT INITIAL : le contexte ci-dessus est le rapport déjà donné au mécanicien. Si une
nouvelle recherche web que tu effectues dans cette conversation nuance, précise ou contredit un point de ce
rapport initial, ne l'ignore pas silencieusement : signale-le explicitement ("Pour compléter le rapport initial..."
ou "À noter, cela nuance ce qui était indiqué plus tôt : ...") avant de donner la nouvelle information.

FORMATAGE CRITIQUE POUR LA VOIX :
Tes réponses sont lues directement à haute voix. Tu ne dois JAMAIS utiliser de caractères de formatage markdown comme des astérisques (pas de gras, pas d'italique), pas de hashtags, pas de puces avec tirets. Rédige uniquement de simples phrases fluides et naturelles.`;

      // Format history into the standard contents parameter structure
      const contentsPayload: any[] = [];

      // Append historical messages if any, including media parts
      if (Array.isArray(history)) {
        for (const msg of history) {
          const parts: any[] = [{ text: msg.text || "" }];
          if (msg.file && msg.mimeType) {
            parts.push({
              inlineData: {
                data: msg.file,
                mimeType: msg.mimeType,
              },
            });
          }
          contentsPayload.push({
            role: msg.role === "user" ? "user" : "model",
            parts: parts,
          });
        }
      }

      // Append the latest user message with optional media data
      const userParts: any[] = [{ text: message }];
      if (req.body.file && req.body.mimeType) {
        userParts.push({
          inlineData: {
            data: req.body.file,
            mimeType: req.body.mimeType,
          },
        });
      }

      contentsPayload.push({
        role: "user",
        parts: userParts,
      });

      // Query Gemini 3.5 Flash for conversational feedback (with fallback and retries).
      // Grounding Google Search activé ici : contrairement au diagnostic initial (réponse JSON
      // structurée, incompatible avec l'outil de recherche dans le même appel), le chat répond en
      // texte libre — le modèle peut donc chercher sur le web et répondre en un seul appel, ce qui
      // lui permet de se comporter en agent sur les questions factuelles précises (localisation
      // d'une pièce, décodage VIN, couples de serrage, bulletins constructeur...).
      // Mémoire du profil : derniers diagnostics enregistrés et dernier scan, pour que le chat de suivi
      // puisse répondre à "tu te souviens de la dernière panne ?" au lieu de repartir de zéro.
      const chatHistoryText = chatPhone ? await liveGetRecentDiagnostics(chatPhone, 3) : "";
      const chatLastScan = chatPhone ? await getLatestScannerResult(chatPhone, scannerResultsByPhone, 30 * 24 * 60 * 60 * 1000) : undefined;
      const chatMemory =
        (chatHistoryText ? `\n\nHISTORIQUE DES DIAGNOSTICS PRÉCÉDENTS DE CE CLIENT (à utiliser s'il évoque une panne passée) :\n${chatHistoryText}` : "") +
        (chatLastScan
          ? `\n\nDERNIER SCAN DU PROFIL (${new Date(chatLastScan.completedAt).toLocaleDateString("fr-FR")}) : ${chatLastScan.summary}. Codes DTC : ${chatLastScan.dtcs.length > 0 ? chatLastScan.dtcs.join(", ") : "aucun"}.`
          : "");

      const response = await generateContentWithFallbackAndRetry(
        contentsPayload,
        {
          systemInstruction: systemInstruction + chatMemory,
          tools: [{ googleSearch: {} }],
        }
      );

      const responseText = response.text || "Je n'ai pas pu générer de réponse.";
      const promptTokens = response.usageMetadata?.promptTokenCount || 0;
      const candidatesTokens = response.usageMetadata?.candidatesTokenCount || 0;

      const inputCost = promptTokens * 0.000000075;
      const outputCost = candidatesTokens * 0.000000300;
      const totalCostUSD = inputCost + outputCost;

      res.json({
        success: true,
        reply: responseText,
        sources: extractGroundingSources(response),
        apiUsage: {
          promptTokens,
          candidatesTokens,
          totalTokens: promptTokens + candidatesTokens,
          estimatedCostUSD: parseFloat(totalCostUSD.toFixed(7)),
          modelUsed: response.modelUsedForGeneration || "gemini-3.5-flash",
        },
      });
    } catch (error: any) {
      console.error("Error in follow-up chat:", error);
      res.status(500).json({
        success: false,
        message: "Une erreur est survenue lors de la discussion avec l'IA. Veuillez réessayer dans un instant.",
      });
    }
  });

  // API Route: Text-to-Speech proxy to Google Cloud TTS or ElevenLabs for high-quality voices
  // FAILLE CORRIGÉE : cette route n'exigeait aucune authentification (coût API illimité pour
  // n'importe qui), et utilisait en secours une VRAIE clé API ElevenLabs codée en dur dans le
  // code source. Cette clé doit être révoquée/régénérée dans votre compte ElevenLabs sans délai.
  app.post("/api/tts", requireAuth, async (req: any, res) => {
    try {
      const { text: rawText, voiceName } = req.body;
      // Prononciation : "DiagAssist" collé est lu "diagnostic" par la synthèse vocale.
      const text = typeof rawText === "string" ? rawText.replace(/diag\s*assist(?!\w)/gi, "Diag Assist") : rawText;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ success: false, message: "Le texte est requis." });
      }
      if (text.length > 5000) {
        return res.status(413).json({ success: false, message: "Texte trop long pour la synthèse vocale (5000 caractères max)." });
      }
      if ((PLAN_LIMITS[req.session.plan] ?? 0) <= 0) {
        return res.status(403).json({ success: false, message: "Votre forfait actuel ne permet pas la synthèse vocale. Veuillez souscrire à une formule." });
      }

      const requestedVoice = typeof voiceName === "string" && voiceName.length <= 80 ? voiceName : "fr-FR-Neural2-B";

      // If ElevenLabs voice is requested
      if (requestedVoice.startsWith("eleven-")) {
        const elevenApiKey = (process.env.ELEVENLABS_API_KEY || "").trim();
        if (!elevenApiKey) {
          return res.status(503).json({ success: false, message: "La synthèse vocale ElevenLabs n'est pas configurée sur ce serveur." });
        }

        let voiceId = "ErXwobaYiN019PkySvjV"; // Antoni (Multilingual Male) - standard pre-made voice (works on Free plan!)
        if (requestedVoice === "eleven-french-female") {
          voiceId = "EXAVITQu4vr4xnSDTEMa"; // Bella (Multilingual Female)
        } else if (requestedVoice === "eleven-french-rachel") {
          voiceId = "21m00Tcm4TlvDq8ikWAM"; // Rachel
        } else if (requestedVoice === "eleven-french-adrien" || requestedVoice.includes("adrien")) {
          voiceId = "ErXwobaYiN019PkySvjV"; // Antoni (Male) - standard pre-made voice (works on Free plan!)
        } else if (requestedVoice === "eleven-french-christophe" || requestedVoice.includes("pCFUI8NKdn1YbzEjbkkM") || requestedVoice.includes("ErXwobaYiN019PkySvjV")) {
          voiceId = "ErXwobaYiN019PkySvjV"; // Antoni (Male) - standard pre-made voice (works on Free plan!)
        } else if (process.env.ELEVENLABS_VOICE_ID) {
          voiceId = process.env.ELEVENLABS_VOICE_ID;
        }

        const elevenLabsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
        const response = await fetch(elevenLabsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": elevenApiKey,
            "accept": "audio/mpeg"
          },
          body: JSON.stringify({
            text: text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75
            }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`ElevenLabs API Error (${response.status}): ${errText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const base64Audio = Buffer.from(arrayBuffer).toString("base64");

        return res.json({
          success: true,
          audioContent: base64Audio,
          modelUsed: `ElevenLabs - ${voiceId}`
        });
      }

      // 1) Google Cloud TTS si GOOGLE_CLOUD_API_KEY est définie (MP3)
      // 2) sinon / en cas d'échec : Gemini TTS avec toutes les clés Gemini (rotation), audio PCM 24 kHz
      //    encapsulé en WAV (le client le lit via un data URI, le navigateur détecte le format).
      const cloudKey = (process.env.GOOGLE_CLOUD_API_KEY || "").trim();
      const geminiKeys = getGeminiKeys();
      if (!cloudKey && geminiKeys.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: "La clé API de synthèse vocale n'est pas configurée dans les variables d'environnement. Utilisation de la synthèse vocale locale gratuite." 
        });
      }

      let lastError = "";
      if (cloudKey) {
        const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${cloudKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": "aistudio-build-tts" },
          body: JSON.stringify({
            input: { text },
            voice: { languageCode: "fr-FR", name: requestedVoice },
            audioConfig: { audioEncoding: "MP3", speakingRate: 1.1, sampleRateHertz: 24000 }
          })
        });
        if (response.ok) {
          const data: any = await response.json();
          if (data.audioContent) {
            return res.json({ success: true, audioContent: data.audioContent, modelUsed: requestedVoice });
          }
        } else {
          lastError = `Google Cloud TTS API Error (${response.status}): ${await response.text()}`;
        }
      }

      const geminiTtsModel = process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview";
      const geminiVoice = process.env.GEMINI_TTS_VOICE || "Kore";
      for (const apiKey of geminiKeys) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiTtsModel}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey, "User-Agent": "aistudio-build-tts" },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice } } }
            }
          })
        });
        if (!response.ok) {
          const errBody = await response.text();
          lastError = `Gemini TTS API Error (${response.status}): ${errBody}`;
          recordGeminiResult(apiKey, { ok: false, quota: response.status === 429, error: lastError });
          continue;
        }
        recordGeminiResult(apiKey, { ok: true });
        const data: any = await response.json();
        const pcmBase64 = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData?.data;
        if (!pcmBase64) {
          lastError = "L'API Gemini TTS n'a pas renvoyé d'audio.";
          continue;
        }
        const pcm = Buffer.from(pcmBase64, "base64");
        const header = Buffer.alloc(44);
        header.write("RIFF", 0);
        header.writeUInt32LE(36 + pcm.length, 4);
        header.write("WAVEfmt ", 8);
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20);
        header.writeUInt16LE(1, 22);
        header.writeUInt32LE(24000, 24);
        header.writeUInt32LE(48000, 28);
        header.writeUInt16LE(2, 32);
        header.writeUInt16LE(16, 34);
        header.write("data", 36);
        header.writeUInt32LE(pcm.length, 40);
        return res.json({
          success: true,
          audioContent: Buffer.concat([header, pcm]).toString("base64"),
          mimeType: "audio/wav",
          modelUsed: `${geminiTtsModel} - ${geminiVoice}`
        });
      }
      throw new Error(lastError || "Aucune clé TTS disponible.");
    } catch (error: any) {
      console.log("TTS Generation Fallback - Local or client voice synthesis will be used.", error.message);
      res.status(500).json({
        success: false,
        message: "Impossible de générer la voix de synthèse haute qualité pour le moment.",
      });
    }
  });

  // API Route: Send WhatsApp OTP (canal unique)
  app.post("/api/auth/send-otp", otpSendLimiter, async (req, res) => {
    try {
      const { phoneNumber, countryCode } = req.body;
      if (!phoneNumber) {
        return res.status(400).json({ success: false, message: "Numéro de téléphone requis." });
      }

      const activeChannel = "whatsapp" as const;

      // Clean the number
      const cleanPhone = String(phoneNumber).replace(/[\s.()-]/g, "");
      if (!/^\d{8,14}$/.test(cleanPhone) || (countryCode !== undefined && !/^\+\d{1,4}$/.test(String(countryCode)))) {
        return res.status(400).json({ success: false, message: "Numéro de téléphone invalide." });
      }
      const fullPhone = `${countryCode || "+225"}${cleanPhone}`;

      // Anti-abus par numéro : 1 envoi / 60 s et 5 / heure (évite le spam et le "SMS pumping").
      const sendLog = (otpSendLog.get(fullPhone) || []).filter((t) => Date.now() - t < 60 * 60 * 1000);
      if (sendLog.length >= 5 || (sendLog.length > 0 && Date.now() - sendLog[sendLog.length - 1] < 60 * 1000)) {
        return res.status(429).json({ success: false, message: "Veuillez patienter avant de redemander un code." });
      }
      sendLog.push(Date.now());
      otpSendLog.set(fullPhone, sendLog);

      // En production, Twilio DOIT être configuré : sinon le code ne serait ni envoyé ni révélé,
      // ce qui bloquerait silencieusement toute connexion. On préfère un message d'erreur clair.
      if (process.env.NODE_ENV === "production" && !(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)) {
        console.error("[send-otp] TWILIO non configuré en production — impossible d'envoyer un code réel.");
        return res.status(503).json({ success: false, message: "Le service d'envoi de code par WhatsApp est temporairement indisponible. Merci de réessayer plus tard." });
      }

      // Generate random 6-digit OTP code
      const otpCode = secureCode6();

      // Store in memory with a 10 minutes expiry limit
      otpStorage.set(fullPhone, {
        code: otpCode,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      let sentRealMessage = false;
      let errorDetails = null;

      const hasTwilioConfig = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN;

      if (hasTwilioConfig) {
        try {
          const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

          const sandboxNumber = "whatsapp:+14155238886";
          const sender = process.env.TWILIO_WHATSAPP_NUMBER || sandboxNumber;
          const fromNumber = sender.startsWith("whatsapp:") ? sender : `whatsapp:${sender}`;
          const toNumber = `whatsapp:${fullPhone}`;

          await client.messages.create({
            body: `Votre code de validation de sécurité DiagAssist est : ${otpCode}. Ne le partagez jamais.`,
            from: fromNumber,
            to: toNumber,
          });
          sentRealMessage = true;
          console.log(`[Twilio WhatsApp] Code OTP envoyé à ${toNumber} depuis ${fromNumber}.`);
        } catch (twilioErr: any) {
          console.error(`Erreur d'envoi Twilio (${activeChannel}) :`, twilioErr);
          errorDetails = twilioErr.message;
        }
      } else {
        console.log(`[OTP Mode Simulation] Code généré pour ${fullPhone}${process.env.NODE_ENV === "production" ? "" : ` : ${otpCode}`} (renseignez les clés Twilio pour envoyer de vrais messages).`);
      }

      // Sécurité : ne JAMAIS renvoyer le code OTP au client en production, même en mode simulation
      // (sinon n'importe qui peut se connecter à n'importe quel numéro sans recevoir le SMS).
      const isProd = process.env.NODE_ENV === "production";
      const canRevealCode = !sentRealMessage && !isProd;

      res.json({
        success: true,
        sentRealSMS: sentRealMessage, // keep backwards compatibility in state names or return both
        sentRealMessage,
        activeChannel,
        otpCode: canRevealCode ? otpCode : undefined,
        isSimulated: !sentRealMessage,
        message: sentRealMessage
          ? "Un code de validation réel vient d'être envoyé sur votre compte WhatsApp."
          : "Mode simulation actif (WhatsApp). Utilisez le code fourni ci-dessous ou configurez Twilio.",
        errorDetails: process.env.NODE_ENV === "production" ? undefined : errorDetails,
      });
    } catch (err: any) {
      console.error("Erreur dans send-otp:", err);
      res.status(500).json({ success: false, message: "Erreur serveur de communication OTP." });
    }
  });

  // API Route: Verify SMS OTP
  // Si un "password" est fourni, ce n'est pas une simple connexion mais une CRÉATION DE COMPTE :
  // la validation du code OTP prouve que l'appelant contrôle bien ce numéro, ce qui autorise à
  // créer (ou réinitialiser) le compte associé avec le mot de passe choisi.
  app.post("/api/auth/verify-otp", otpVerifyLimiter, async (req, res) => {
    try {
      const { phoneNumber, countryCode, code, password, name } = req.body;
      if (!phoneNumber || !code) {
        return res.status(400).json({ success: false, message: "Données manquantes pour la validation." });
      }
      if (password !== undefined && (typeof password !== "string" || password.length < 6)) {
        return res.status(400).json({ success: false, message: "Le mot de passe doit faire au moins 6 caractères." });
      }

      const cleanPhone = phoneNumber.replace(/\s+/g, "");
      const fullPhone = `${countryCode || "+225"}${cleanPhone}`;

      // Anti brute-force par numéro : max 8 tentatives / 15 min, indépendamment du rate-limit global par IP
      const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
      const MAX_ATTEMPTS_PER_PHONE = 8;
      const attempts = otpAttempts.get(fullPhone) || { count: 0, windowStart: Date.now() };
      if (Date.now() - attempts.windowStart > ATTEMPT_WINDOW_MS) {
        attempts.count = 0;
        attempts.windowStart = Date.now();
      }
      if (attempts.count >= MAX_ATTEMPTS_PER_PHONE) {
        return res.status(429).json({ success: false, message: "Trop de tentatives pour ce numéro. Veuillez réessayer plus tard." });
      }

      // Dev master OTP check (never active in production unless DEV_MASTER_OTP is explicitly set)
      const DEV_MASTER_OTP = process.env.DEV_MASTER_OTP;
      if (process.env.NODE_ENV !== "production" && DEV_MASTER_OTP && code === DEV_MASTER_OTP) {
        if (password) {
          createAccount(fullPhone, password, false, undefined, typeof name === "string" ? name.trim() : undefined);
        }
        const token = createSession(fullPhone);
        return res.json({
          success: true,
          message: "Connexion test (dev uniquement).",
          sessionToken: token,
        });
      }
 
      const stored = otpStorage.get(fullPhone);
      if (!stored) {
        attempts.count += 1;
        otpAttempts.set(fullPhone, attempts);
        return res.status(400).json({ success: false, message: "Aucun code n'a été demandé pour ce numéro." });
      }
 
      if (Date.now() > stored.expiresAt) {
        otpStorage.delete(fullPhone);
        return res.status(400).json({ success: false, message: "Le code a expiré. Veuillez en demander un nouveau." });
      }
 
      if (!safeEqual(stored.code, String(code))) {
        attempts.count += 1;
        otpAttempts.set(fullPhone, attempts);
        return res.status(400).json({ success: false, message: "Code de validation incorrect." });
      }
 
      // Consume OTP
      otpStorage.delete(fullPhone);
      otpAttempts.delete(fullPhone);

      if (password) {
        // L'OTP prouve la possession du numéro : on peut (ré)initialiser le mot de passe, mais jamais
        // retirer le rôle admin ni écraser l'email/nom existants.
        const prev = userAccounts.get(fullPhone);
        createAccount(fullPhone, password, prev?.isAdmin ?? false, prev?.email, typeof name === "string" && name.trim() ? name.trim() : prev?.name);
        if (prev) revokeSessionsFor(fullPhone);
        console.log(`[Auth] Compte créé/mis à jour par auto-inscription pour ${fullPhone}.`);
      }

      const token = createSession(fullPhone);
      res.json({
        success: true,
        message: password
          ? "Compte créé et authentifié avec succès."
          : "Numéro de téléphone validé et authentifié avec succès.",
        sessionToken: token,
      });
    } catch (err: any) {
      console.error("Erreur dans verify-otp:", err);
      res.status(500).json({ success: false, message: "Erreur de validation." });
    }
  });

  // API Route: Get real user status (quota and subscription plan)
  app.get("/api/user/status", requireAuth, (req: any, res) => {
    const { phone, plan } = req.session;
    const usage = usageTracking.get(phone) || { diagnosisCount: 0 };
    const limit = PLAN_LIMITS[plan] ?? 0;
    const account = userAccounts.get(phone);
    const isAdmin = account?.isAdmin ?? false;
    const planRecord = userPlans.get(phone);
    const duration = planRecord ? PLAN_DURATIONS_MS[planRecord.plan] : undefined;
    // expiresAt calculé côté serveur (source de vérité) — le client ne doit plus deviner
    // une échéance à partir d'une horloge locale non fiable (bug corrigé). Un admin n'a jamais
    // d'échéance, quel que soit le forfait resté enregistré en base (ex: pass 24h d'un ancien test).
    const expiresAt = isAdmin ? null : planRecord && duration ? planRecord.activatedAt + duration : null;
    res.json({
      success: true,
      plan,
      phone,
      diagnosisCount: usage.diagnosisCount,
      limit: limit === Infinity ? null : limit,
      remaining: limit === Infinity ? null : Math.max(0, limit - usage.diagnosisCount),
      expiresAt,
      isAdmin,
      name: account?.name || null,
    });
  });

  // API Route: Demande d'activation de forfait après paiement Wave (validation MANUELLE par l'admin)
  // Le client ne peut plus s'auto-attribuer un plan : il signale seulement qu'il a payé,
  // et c'est l'admin qui active réellement le forfait via /api/admin/activate-plan après vérification du paiement Wave.
  const pendingActivations = new Map<string, { phone: string; plan: string; amount?: number; note?: string; requestedAt: number }>();

  app.post("/api/user/request-plan", authLimiter, requireAuth, (req: any, res) => {
    const { plan, amount, note } = req.body;
    if (!plan || typeof plan !== "string" || !(plan in PLAN_LIMITS)) {
      return res.status(400).json({ success: false, message: "Plan invalide." });
    }
    const { phone } = req.session;
    // Une seule demande en attente par numéro et par forfait, et taille de la file bornée.
    for (const [id, v] of pendingActivations) {
      if (v.phone === phone && v.plan === plan) pendingActivations.delete(id);
    }
    if (pendingActivations.size >= 1000) {
      const oldest = pendingActivations.keys().next().value;
      if (oldest) pendingActivations.delete(oldest);
    }
    const requestId = crypto.randomBytes(8).toString("hex");
    pendingActivations.set(requestId, {
      phone, plan,
      amount: Number.isFinite(Number(amount)) ? Number(amount) : undefined,
      note: typeof note === "string" ? note.slice(0, 300) : undefined,
      requestedAt: Date.now(),
    });
    console.log(`[Activation en attente] ${phone} demande le forfait "${plan}" (réf: ${requestId}). À valider manuellement après vérification du paiement Wave.`);
    res.json({
      success: true,
      message: "Votre demande a bien été enregistrée. Votre forfait sera activé dès la vérification manuelle de votre paiement Wave (généralement sous quelques minutes).",
      requestId,
    });
  });

  // API Route (ADMIN UNIQUEMENT) : liste des demandes d'activation en attente
  // Quotas IA : état observé des clés Gemini + limites du Live. Aucune clé n'est exposée (4 derniers caractères).
  app.get("/api/admin/ai-quota", adminLimiter, requireAdminAuth, (req, res) => {
    const keys = getGeminiKeys();
    const activeIdx = keys.length ? currentGeminiKeyIndex % keys.length : -1;
    const liveUsedToday = Array.from(liveUsage.entries())
      .filter(([, u]) => u.day === todayKey())
      .map(([phone, u]) => ({ phone: phone.replace(/^(.{4}).*(.{2})$/, "$1***$2"), usedMin: Math.round(u.usedMs / 60000) }))
      .sort((a, b) => b.usedMin - a.usedMin)
      .slice(0, 10);
    res.json({
      success: true,
      serverStartedAt,
      keys: keys.map((k, i) => ({ index: i + 1, id: "…" + k.slice(-4), active: i === activeIdx, ...getGeminiStats(k) })),
      deepseekConfigured: Boolean((process.env.DEEPSEEK_API_KEY || "").trim()),
      live: {
        model: LIVE_MODEL,
        maxSessionMin: Math.round(LIVE_MAX_SESSION_MS / 60000),
        maxConcurrent: LIVE_MAX_CONCURRENT,
        dailyLimitsMin: Object.fromEntries(Object.entries(LIVE_DAILY_MS).map(([plan, ms]) => [plan, Math.round(ms / 60000)])),
        activeConnections: Array.from(liveConnections.values()).reduce((n, set) => n + set.size, 0),
        usedTodayMin: liveUsedToday,
      },
    });
  });

  // Test à la demande : une mini-requête de génération et une avec recherche web, par clé.
  app.post("/api/admin/ai-quota/probe", adminLimiter, requireAdminAuth, async (req, res) => {
    const keys = getGeminiKeys();
    const probeOne = async (apiKey: string, withSearch: boolean) => {
      try {
        const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "ok" }] }],
            generationConfig: { maxOutputTokens: 8 },
            ...(withSearch ? { tools: [{ googleSearch: {} }] } : {}),
          }),
          signal: AbortSignal.timeout(20000),
        });
        if (r.ok) {
          recordGeminiResult(apiKey, { ok: true });
          return { status: "ok" as const, httpStatus: r.status };
        }
        const body: any = await r.json().catch(() => ({}));
        const msg = String(body?.error?.message || r.statusText || "").slice(0, 160);
        const quota = r.status === 429;
        if (withSearch && quota) recordGeminiResult(apiKey, { ok: false, searchQuota: true });
        else recordGeminiResult(apiKey, { ok: false, quota, error: msg });
        return { status: (quota ? "quota" : r.status === 503 ? "busy" : "error") as "quota" | "busy" | "error", httpStatus: r.status, message: msg };
      } catch (err: any) {
        return { status: "error" as const, httpStatus: 0, message: String(err?.message || err).slice(0, 160) };
      }
    };
    const results = [];
    for (let i = 0; i < keys.length; i++) {
      results.push({
        index: i + 1,
        id: "…" + keys[i].slice(-4),
        generation: await probeOne(keys[i], false),
        search: await probeOne(keys[i], true),
      });
    }
    res.json({ success: true, testedAt: Date.now(), results });
  });

  app.get("/api/admin/pending-activations", adminLimiter, requireAdminAuth, (req, res) => {
    const list = Array.from(pendingActivations.entries()).map(([id, v]) => ({ id, ...v }));
    res.json({ success: true, pending: list });
  });

  // API Route (ADMIN UNIQUEMENT) : active réellement un forfait pour un numéro, après vérification manuelle du paiement Wave
  app.post("/api/admin/activate-plan", adminLimiter, requireAdminAuth, (req, res) => {
    const { phone, plan, requestId, durationValue, durationUnit } = req.body;
    if (!phone || !plan) {
      return res.status(400).json({ success: false, message: "phone et plan sont requis." });
    }
    if (!(plan in PLAN_LIMITS)) {
      return res.status(400).json({ success: false, message: `Plan inconnu : "${plan}".` });
    }
    // Durée personnalisée optionnelle (ex: bonus de quelques jours offert à un client relancé),
    // sinon la durée standard du forfait s'applique (voir PLAN_DURATIONS_MS).
    const customDurationMs = durationValue ? computeDurationMs(Number(durationValue), durationUnit) : undefined;
    // Persisté par numéro : reste actif même si l'utilisateur se déconnecte/reconnecte,
    // et expirera automatiquement selon PLAN_DURATIONS_MS ou la durée personnalisée (voir getEffectivePlan).
    setUserPlan(phone, plan, customDurationMs);
    // BUG CORRIGÉ : le compteur d'usage n'était jamais remis à zéro lors d'une nouvelle activation —
    // un client qui se réabonnait après expiration héritait de son ancien quota déjà consommé.
    usageTracking.set(phone, { diagnosisCount: 0, periodStart: Date.now() });

    let updated = 0;
    for (const [, session] of sessions) {
      if (session.phone === phone) {
        session.plan = plan;
        updated += 1;
      }
    }
    if (requestId) {
      pendingActivations.delete(requestId);
    }
    console.log(`[Admin] Forfait "${plan}" activé pour ${phone} (${updated} session(s) active(s) mise(s) à jour).`);
    res.json({ success: true, message: `Forfait "${plan}" activé pour ${phone}.`, sessionsUpdated: updated });
  });

  // API Route (ADMIN UNIQUEMENT) : crée ou met à jour le compte d'un client (numéro + mot de passe).
  // Vous communiquez ensuite ces identifiants directement au client (téléphone, en personne, etc.).
  app.post("/api/admin/create-account", adminLimiter, requireAdminAuth, (req, res) => {
    const { phone, password, plan, isAdmin, email, name, durationValue, durationUnit } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ success: false, message: "phone et password sont requis." });
    }
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ success: false, message: "Le mot de passe doit faire au moins 6 caractères." });
    }
    createAccount(phone, password, Boolean(isAdmin), email, typeof name === "string" ? name.trim() : undefined);
    if (plan) {
      if (!(plan in PLAN_LIMITS)) {
        return res.status(400).json({ success: false, message: `Plan inconnu : "${plan}".` });
      }
      const customDurationMs = computeDurationMs(Number(durationValue), durationUnit);
      setUserPlan(phone, plan, customDurationMs);
      usageTracking.set(phone, { diagnosisCount: 0, periodStart: Date.now() });
    }
    console.log(`[Admin] Compte créé/mis à jour pour ${phone}${plan ? ` avec le forfait "${plan}"` : ""}${isAdmin ? " (admin)" : ""}.`);
    res.json({ success: true, message: `Compte créé pour ${phone}. Communiquez-lui le mot de passe directement.` });
  });

  // API Route (ADMIN UNIQUEMENT) : réinitialise directement le mot de passe d'un client existant,
  // sans passer par le formulaire de création (qui redemande aussi forfait/durée, inutile ici) et
  // sans connaître l'ancien mot de passe. Préserve le rôle admin et l'email existants du compte.
  app.post("/api/admin/accounts/:phone/set-password", adminLimiter, requireAdminAuth, (req, res) => {
    const phone = req.params.phone;
    const { password } = req.body;
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ success: false, message: "Le mot de passe doit faire au moins 6 caractères." });
    }
    const existing = userAccounts.get(phone);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Compte introuvable." });
    }
    createAccount(phone, password, existing.isAdmin, existing.email, existing.name);
    revokeSessionsFor(phone);
    console.log(`[Admin] Mot de passe réinitialisé pour ${phone}.`);
    res.json({ success: true, message: `Mot de passe mis à jour pour ${phone}.` });
  });

  // API Route (ADMIN UNIQUEMENT) : promeut ou rétrograde un compte client EXISTANT en/depuis
  // administrateur, sans passer par le formulaire de création (qui redemande un nouveau mot de
  // passe, inutile ici puisque le compte existe déjà avec son propre mot de passe).
  app.post("/api/admin/accounts/:phone/set-admin", adminLimiter, requireAdminAuth, (req, res) => {
    const phone = req.params.phone;
    const { isAdmin } = req.body;
    if (typeof isAdmin !== "boolean") {
      return res.status(400).json({ success: false, message: "isAdmin (booléen) est requis." });
    }
    const ok = setAccountAdmin(phone, isAdmin);
    if (!ok) {
      return res.status(404).json({ success: false, message: "Compte introuvable." });
    }
    console.log(`[Admin] ${phone} ${isAdmin ? "promu administrateur" : "rétrogradé en client"}.`);
    res.json({ success: true, message: `${phone} est maintenant ${isAdmin ? "administrateur" : "un client normal"}.` });
  });

  // API Route: l'utilisateur connecté change lui-même son mot de passe
  app.post("/api/user/change-password", authLimiter, requireAuth, (req: any, res) => {
    const { currentPassword, newPassword } = req.body;
    const { phone } = req.session;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Mot de passe actuel et nouveau mot de passe requis." });
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "Le nouveau mot de passe doit faire au moins 6 caractères." });
    }
    if (!verifyAccountPassword(phone, currentPassword)) {
      return res.status(401).json({ success: false, message: "Mot de passe actuel incorrect." });
    }
    const existing = userAccounts.get(phone);
    createAccount(phone, newPassword, existing?.isAdmin ?? false, existing?.email, existing?.name);
    revokeSessionsFor(phone, req.sessionToken);
    res.json({ success: true, message: "Mot de passe mis à jour." });
  });

  // API Route: demande de réinitialisation de mot de passe par email
  app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Adresse email requise." });
    }
    // Message générique dans tous les cas (ne révèle jamais si l'email existe ou non, anti-énumération)
    const genericResponse = { success: true, message: "Si cet email est associé à un compte, un code de réinitialisation vient d'être envoyé." };

    const phone = findPhoneByEmail(email);
    const transporter = getEmailTransporter();
    if (!phone || !transporter) {
      if (!transporter) console.error("[forgot-password] SMTP non configuré (SMTP_USER / SMTP_APP_PASSWORD manquants).");
      return res.json(genericResponse);
    }

    const code = secureCode6();
    passwordResetCodes.set(email.trim().toLowerCase(), { code, phone, expiresAt: Date.now() + 15 * 60 * 1000 });

    try {
      await transporter.sendMail({
        from: `"DiagAssist" <${process.env.SMTP_USER}>`,
        to: email,
        subject: "Réinitialisation de votre mot de passe DiagAssist",
        text: `Votre code de réinitialisation DiagAssist est : ${code}\n\nCe code est valable 15 minutes. Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.`,
      });
    } catch (err: any) {
      console.error("[forgot-password] Erreur d'envoi d'email:", err.message || err);
    }

    res.json(genericResponse);
  });

  // API Route: réinitialisation effective du mot de passe avec le code reçu par email
  app.post("/api/auth/reset-password", authLimiter, (req, res) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ success: false, message: "Email, code et nouveau mot de passe requis." });
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "Le nouveau mot de passe doit faire au moins 6 caractères." });
    }
    const normalized = email.trim().toLowerCase();
    const record = passwordResetCodes.get(normalized);
    if (!record || !safeEqual(record.code, String(code).trim())) {
      if (record) {
        record.attempts = (record.attempts || 0) + 1;
        if (record.attempts >= 5) passwordResetCodes.delete(normalized); // le code est invalidé après 5 essais
      }
      return res.status(401).json({ success: false, message: "Code de réinitialisation incorrect." });
    }
    if (Date.now() > record.expiresAt) {
      passwordResetCodes.delete(normalized);
      return res.status(400).json({ success: false, message: "Ce code a expiré. Veuillez en demander un nouveau." });
    }
    const existing = userAccounts.get(record.phone);
    createAccount(record.phone, newPassword, existing?.isAdmin ?? false, existing?.email, existing?.name);
    passwordResetCodes.delete(normalized);
    revokeSessionsFor(record.phone);
    res.json({ success: true, message: "Mot de passe réinitialisé avec succès. Vous pouvez maintenant vous connecter." });
  });

  // API Route (ADMIN UNIQUEMENT) : liste les comptes clients existants (sans les mots de passe)
  app.get("/api/admin/accounts", adminLimiter, requireAdminAuth, (req, res) => {
    const accounts = Array.from(userAccounts.entries()).map(([phone, acc]) => {
      const planRecord = userPlans.get(phone);
      const rawPlan = planRecord?.plan || "free_trial";
      const duration = planRecord ? (planRecord.customDurationMs ?? PLAN_DURATIONS_MS[rawPlan]) : undefined;
      // Un admin est toujours "premium" sans échéance, quel que soit le forfait resté en base
      // (ex: pass 24h d'un ancien test) — voir getEffectivePlan pour la même règle côté session.
      const plan = acc.isAdmin ? "premium" : rawPlan;
      const expiresAt = acc.isAdmin ? null : planRecord && duration ? planRecord.activatedAt + duration : null;
      return {
        phone,
        createdAt: acc.createdAt,
        plan,
        expiresAt,
        isAdmin: acc.isAdmin,
        email: acc.email || null,
        name: acc.name || null,
        location: lastKnownLocation.get(phone) || null,
      };
    });
    res.json({ success: true, accounts });
  });

  // API Route (ADMIN UNIQUEMENT) : liste les sessions actives (connexions en cours)
  app.get("/api/admin/sessions", adminLimiter, requireAdminAuth, (req, res) => {
    const list = Array.from(sessions.entries()).map(([token, s]) => ({
      // Le token lui-même n'est jamais exposé, seule une référence tronquée pour distinguer les entrées
      tokenRef: token.slice(0, 8),
      phone: s.phone,
      plan: s.plan,
      createdAt: s.createdAt,
      location: lastKnownLocation.get(s.phone) || null,
    }));
    res.json({ success: true, sessions: list });
  });

  // API Route (ADMIN UNIQUEMENT) : déconnecte de force toutes les sessions actives d'un numéro
  app.post("/api/admin/force-logout", adminLimiter, requireAdminAuth, (req, res) => {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: "Le numéro de téléphone est requis." });
    }
    let removed = 0;
    for (const [token, s] of sessions) {
      if (s.phone === phone) {
        sessions.delete(token);
        deleteSessionFromDb(token).catch(() => {});
        removed += 1;
      }
    }
    console.log(`[Admin] ${removed} session(s) déconnectée(s) de force pour ${phone}.`);
    res.json({ success: true, message: `${removed} session(s) déconnectée(s) pour ${phone}.`, removed });
  });

  // API Route: le client signale sa position GPS (avec son consentement navigateur)
  app.post("/api/user/report-location", authLimiter, requireAuth, (req: any, res) => {
    const { latitude, longitude, accuracy } = req.body;
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return res.status(400).json({ success: false, message: "Coordonnées invalides." });
    }
    lastKnownLocation.set(req.session.phone, { latitude, longitude, accuracy, updatedAt: Date.now(), source: "gps" });
    res.json({ success: true });
  });

  // API Route : repli quand le client refuse ou ne peut pas fournir sa position GPS —
  // le serveur estime une position approximative (précision ville, quelques km) à partir
  // de l'adresse IP de la requête, via un service public de géolocalisation IP (aucune clé
  // requise). Ne remplace jamais une position GPS déjà connue par une estimation IP moins
  // précise si l'une existe déjà et est récente.
  app.post("/api/user/report-location-ip", authLimiter, requireAuth, async (req: any, res) => {
    const phone = req.session.phone;
    const existing = lastKnownLocation.get(phone);
    if (existing && existing.source === "gps" && Date.now() - existing.updatedAt < 24 * 60 * 60 * 1000) {
      return res.json({ success: true, skipped: true, message: "Position GPS déjà connue et récente." });
    }
    const ip = (req.ip || "").replace("::ffff:", "");
    if (!ip || ip === "127.0.0.1" || ip === "::1") {
      return res.json({ success: false, message: "Adresse IP non exploitable (environnement local)." });
    }
    try {
      const geoRes = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`);
      const geo: any = await geoRes.json();
      if (!geo.success || typeof geo.latitude !== "number" || typeof geo.longitude !== "number") {
        return res.json({ success: false, message: "Estimation IP indisponible pour cette adresse." });
      }
      lastKnownLocation.set(phone, {
        latitude: geo.latitude,
        longitude: geo.longitude,
        accuracy: 5000, // précision ville, non un vrai rayon GPS — juste une estimation
        updatedAt: Date.now(),
        source: "ip",
      });
      res.json({ success: true, city: geo.city || null });
    } catch (err: any) {
      console.error("[report-location-ip] Échec de la géolocalisation IP:", err.message);
      res.json({ success: false, message: "Erreur du service de géolocalisation IP." });
    }
  });

  // API Route (ADMIN UNIQUEMENT) : historique des connexions (les 500 dernières)
  app.get("/api/admin/connection-history", adminLimiter, requireAdminAuth, (req, res) => {
    // Les plus récentes en premier
    const history = [...connectionHistory].reverse();
    res.json({ success: true, history });
  });

  // API Routes (ADMIN UNIQUEMENT) : gestion des bannières / publicités
  app.get("/api/admin/banners", adminLimiter, requireAdminAuth, (req, res) => {
    res.json({ success: true, banners: Array.from(banners.values()).sort((a, b) => b.createdAt - a.createdAt) });
  });

  app.post("/api/admin/banners", adminLimiter, requireAdminAuth, (req, res) => {
    const { imageUrl, linkUrl, displayType } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ success: false, message: "L'image (URL) est requise." });
    }
    // Pas de schéma javascript:/data:html — images en https/data:image, liens en http(s) uniquement.
    const okImage = typeof imageUrl === "string" && (/^https?:\/\//i.test(imageUrl) || /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(imageUrl));
    const okLink = !linkUrl || (typeof linkUrl === "string" && /^https?:\/\//i.test(linkUrl));
    if (!okImage || !okLink) {
      return res.status(400).json({ success: false, message: "URL d'image ou de lien invalide (http/https uniquement)." });
    }
    if (displayType !== "banner" && displayType !== "floating") {
      return res.status(400).json({ success: false, message: "displayType doit être 'banner' ou 'floating'." });
    }
    const id = crypto.randomBytes(6).toString("hex");
    const banner: Banner = { id, imageUrl, linkUrl: linkUrl || undefined, displayType, active: true, createdAt: Date.now() };
    banners.set(id, banner);
    persistBanner(banner).catch(() => {});
    res.json({ success: true, banner });
  });

  app.post("/api/admin/banners/:id/toggle", adminLimiter, requireAdminAuth, (req, res) => {
    const banner = banners.get(req.params.id);
    if (!banner) {
      return res.status(404).json({ success: false, message: "Bannière introuvable." });
    }
    banner.active = !banner.active;
    persistBanner(banner).catch(() => {});
    res.json({ success: true, banner });
  });

  app.delete("/api/admin/banners/:id", adminLimiter, requireAdminAuth, (req, res) => {
    banners.delete(req.params.id);
    deleteBannerFromDb(req.params.id).catch(() => {});
    res.json({ success: true });
  });

  // API Route (PUBLIQUE, authentifiée) : bannières actives à afficher côté client
  app.get("/api/banners", requireAuth, (req, res) => {
    const active = Array.from(banners.values()).filter((b) => b.active);
    res.json({ success: true, banners: active });
  });

  // --- Réseau de mécaniciens agréés ---

  // API Route (ADMIN UNIQUEMENT) : liste complète (y compris désactivés)
  app.get("/api/admin/mechanics", adminLimiter, requireAdminAuth, (req, res) => {
    const list = Array.from(mechanics.values()).sort((a, b) => b.createdAt - a.createdAt);
    res.json({ success: true, mechanics: list });
  });

  // API Route (ADMIN UNIQUEMENT) : ajouter un mécanicien au réseau
  app.post("/api/admin/mechanics", adminLimiter, requireAdminAuth, (req, res) => {
    const { type, name, garageName, phone, city, area, specialties, hasScanner, certified } = req.body;
    if (!name || !phone || !city) {
      return res.status(400).json({ success: false, message: "Nom, téléphone et ville sont requis." });
    }
    const partnerType: "mechanic" | "parts_vendor" = type === "parts_vendor" ? "parts_vendor" : "mechanic";
    const id = crypto.randomBytes(6).toString("hex");
    const mechanic: Mechanic = {
      id,
      type: partnerType,
      name,
      garageName: garageName || undefined,
      phone,
      city,
      area: area || undefined,
      specialties: specialties || undefined,
      // La valise ne concerne que les mécaniciens, pas les vendeurs de pièces
      hasScanner: partnerType === "mechanic" ? hasScanner !== false : false,
      certified: certified !== false,
      active: true,
      createdAt: Date.now(),
    };
    mechanics.set(id, mechanic);
    persistMechanic(mechanic).catch(() => {});
    res.json({ success: true, mechanic });
  });

  // API Route (ADMIN UNIQUEMENT) : activer/désactiver
  app.post("/api/admin/mechanics/:id/toggle", adminLimiter, requireAdminAuth, (req, res) => {
    const m = mechanics.get(req.params.id);
    if (!m) return res.status(404).json({ success: false, message: "Mécanicien introuvable." });
    m.active = !m.active;
    persistMechanic(m).catch(() => {});
    res.json({ success: true, mechanic: m });
  });

  // API Route (ADMIN UNIQUEMENT) : supprimer
  app.delete("/api/admin/mechanics/:id", adminLimiter, requireAdminAuth, (req, res) => {
    mechanics.delete(req.params.id);
    deleteMechanicFromDb(req.params.id).catch(() => {});
    res.json({ success: true });
  });

  // API Route (ADMIN UNIQUEMENT) : synchronise la base véhicules depuis Auto-Data.net.
  // Le code d'accès est fourni dans le corps de la requête (ou via AUTO_DATA_API_CODE en env).
  app.post("/api/admin/vehicles/sync", adminLimiter, requireAdminAuth, async (req, res) => {
    const apiCode = req.body?.apiCode || process.env.AUTO_DATA_API_CODE;
    if (!apiCode) return res.status(400).json({ success: false, message: "Code d'accès Auto-Data.net requis." });
    if (!dbPool) return res.status(503).json({ success: false, message: "Base de données indisponible." });
    try {
      await dbPool.query("DELETE FROM vehicles"); // resynchronisation complète, pas de doublons
      const result = await syncVehiclesFromAutoData(apiCode);
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("[Auto-Data] Échec synchronisation:", err.message);
      res.status(500).json({ success: false, message: err.message || "Échec de la synchronisation." });
    }
  });

  app.get("/api/admin/vehicles/count", adminLimiter, requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.json({ success: true, count: 0, brands: 0 });
    const { rows } = await dbPool.query("SELECT COUNT(*) AS total, COUNT(DISTINCT brand) AS brands FROM vehicles");
    res.json({ success: true, count: Number(rows[0].total), brands: Number(rows[0].brands) });
  });

  // API Route (ADMIN UNIQUEMENT) : état réel de Gemini (nombre de clés, clé active, test d'appel
  // effectif) et de DeepSeek (clé configurée ou non, test d'appel effectif) — pour diagnostiquer
  // sans avoir à fouiller les logs si l'IA ne répond plus.
  app.get("/api/admin/ai-status", adminLimiter, requireAdminAuth, async (req, res) => {
    const geminiKeys = getGeminiKeys();
    let geminiTest: { ok: boolean; message: string } = { ok: false, message: "Aucune clé configurée." };
    if (geminiKeys.length > 0) {
      try {
        const r = await getAIClient().models.generateContent({
          model: "gemini-flash-latest",
          contents: "Réponds juste \"ok\".",
        });
        geminiTest = { ok: true, message: r.text?.trim() ? `Réponse reçue (${r.text.trim().slice(0, 40)})` : "Réponse vide mais appel réussi." };
      } catch (err: any) {
        geminiTest = { ok: false, message: err.message || "Échec de l'appel de test." };
      }
    }

    const deepseekKey = (process.env.DEEPSEEK_API_KEY || "").trim();
    let deepseekTest: { ok: boolean; message: string } = { ok: false, message: "Aucune clé configurée." };
    if (deepseekKey) {
      try {
        const dsRes = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepseekKey}` },
          body: JSON.stringify({ model: "deepseek-flash", messages: [{ role: "user", content: "Réponds juste \"ok\"." }], max_tokens: 10 }),
        });
        if (!dsRes.ok) {
          const errText = await dsRes.text().catch(() => "");
          deepseekTest = { ok: false, message: `Erreur ${dsRes.status} : ${errText.slice(0, 150)}` };
        } else {
          const data: any = await dsRes.json();
          const text = data?.choices?.[0]?.message?.content?.trim();
          deepseekTest = { ok: true, message: text ? `Réponse reçue (${text.slice(0, 40)})` : "Réponse vide mais appel réussi." };
        }
      } catch (err: any) {
        deepseekTest = { ok: false, message: err.message || "Échec de l'appel de test." };
      }
    }

    res.json({
      success: true,
      gemini: {
        keysConfigured: geminiKeys.length,
        activeKeyIndex: geminiKeys.length > 0 ? (currentGeminiKeyIndex % geminiKeys.length) + 1 : 0,
        test: geminiTest,
      },
      deepseek: {
        configured: Boolean(deepseekKey),
        test: deepseekTest,
      },
    });
  });

  // API Routes (utilisateur connecté) : menus en cascade marque > modèle > génération > moteur
  app.get("/api/vehicles/brands", requireAuth, async (req, res) => {
    if (!dbPool) return res.json({ success: true, brands: [] });
    const { rows } = await dbPool.query("SELECT DISTINCT brand FROM vehicles ORDER BY brand ASC");
    res.json({ success: true, brands: rows.map((r) => r.brand) });
  });

  app.get("/api/vehicles/models", requireAuth, async (req, res) => {
    if (!dbPool) return res.json({ success: true, models: [] });
    const brand = req.query.brand as string;
    if (!brand) return res.status(400).json({ success: false, message: "Marque requise." });
    const { rows } = await dbPool.query("SELECT DISTINCT model FROM vehicles WHERE brand = $1 ORDER BY model ASC", [brand]);
    res.json({ success: true, models: rows.map((r) => r.model) });
  });

  app.get("/api/vehicles/generations", requireAuth, async (req, res) => {
    if (!dbPool) return res.json({ success: true, generations: [] });
    const { brand, model } = req.query as { brand?: string; model?: string };
    if (!brand || !model) return res.status(400).json({ success: false, message: "Marque et modèle requis." });
    const { rows } = await dbPool.query(
      "SELECT DISTINCT generation, MIN(year_start) as year_start, MAX(year_stop) as year_stop, MAX(image_url) as image_url FROM vehicles WHERE brand = $1 AND model = $2 GROUP BY generation ORDER BY year_start DESC NULLS LAST",
      [brand, model]
    );
    res.json({ success: true, generations: rows });
  });

  app.get("/api/vehicles/modifications", requireAuth, async (req, res) => {
    if (!dbPool) return res.json({ success: true, modifications: [] });
    const { brand, model, generation } = req.query as { brand?: string; model?: string; generation?: string };
    if (!brand || !model || !generation) return res.status(400).json({ success: false, message: "Marque, modèle et génération requis." });
    const { rows } = await dbPool.query(
      "SELECT engine_code, engine_displacement, power_hp, fuel_system, cylinders, year_start, year_stop FROM vehicles WHERE brand = $1 AND model = $2 AND generation = $3 ORDER BY engine_displacement ASC",
      [brand, model, generation]
    );
    res.json({ success: true, modifications: rows });
  });

  // ============================================================
  // BOUTIQUE / CRM — section indépendante du diagnostic technique
  // ============================================================

  // --- Public : catalogue ---
  app.get("/api/shop/categories", async (req, res) => {
    if (!dbPool) return res.json({ success: true, categories: [] });
    const { rows } = await dbPool.query("SELECT * FROM shop_categories ORDER BY name ASC");
    res.json({ success: true, categories: rows });
  });

  app.get("/api/shop/products", async (req, res) => {
    if (!dbPool) return res.json({ success: true, products: [] });
    const { category } = req.query as { category?: string };
    let query = "SELECT p.*, c.name as category_name, c.slug as category_slug FROM shop_products p LEFT JOIN shop_categories c ON c.id = p.category_id WHERE p.is_active = true";
    const params: any[] = [];
    if (category) { params.push(category); query += ` AND c.slug = $${params.length}`; }
    query += " ORDER BY p.created_at DESC";
    const { rows } = await dbPool.query(query, params);
    res.json({ success: true, products: rows });
  });

  app.get("/api/shop/products/:slug", async (req, res) => {
    if (!dbPool) return res.status(404).json({ success: false, message: "Produit introuvable." });
    const { rows } = await dbPool.query(
      "SELECT p.*, c.name as category_name, c.slug as category_slug FROM shop_products p LEFT JOIN shop_categories c ON c.id = p.category_id WHERE p.slug = $1 AND p.is_active = true",
      [req.params.slug]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Produit introuvable." });
    res.json({ success: true, product: rows[0] });
  });

  const cleanText = (v: unknown, max: number): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

  // Plafond de commandes/demandes par numéro et par 24 h : empêche d'utiliser la boutique pour
  // déclencher des relances WhatsApp en rafale vers le numéro d'un tiers.
  async function shopPhoneUnderDailyCap(phone: string): Promise<boolean> {
    if (!dbPool) return true;
    const r = await dbPool.query(
      `SELECT (SELECT COUNT(DISTINCT order_ref) FROM shop_orders WHERE customer_phone = $1 AND created_at > NOW() - INTERVAL '24 hours')
            + (SELECT COUNT(*) FROM shop_part_requests WHERE customer_phone = $1 AND created_at > NOW() - INTERVAL '24 hours') AS n`,
      [phone]
    );
    return Number(r.rows[0]?.n || 0) < 5;
  }

  // Crée/retrouve le client CRM par téléphone (appelé à chaque commande ou demande)
  async function upsertShopCustomer(phone: string, name?: string, city?: string, category?: string) {
    if (!dbPool) return;
    const existing = await dbPool.query("SELECT * FROM shop_customers WHERE phone = $1", [phone]);
    if (existing.rows.length === 0) {
      await dbPool.query(
        "INSERT INTO shop_customers (phone, name, city, categories) VALUES ($1,$2,$3,$4)",
        [phone, name || null, city || null, JSON.stringify(category ? [category] : [])]
      );
    } else {
      const cats: string[] = existing.rows[0].categories || [];
      const newCats = category && !cats.includes(category) ? [...cats, category] : cats;
      await dbPool.query(
        "UPDATE shop_customers SET name = COALESCE($2, name), city = COALESCE($3, city), categories = $4, last_interaction_at = CURRENT_TIMESTAMP WHERE phone = $1",
        [phone, name || null, city || null, JSON.stringify(newCats)]
      );
    }
  }

  // Programme automatiquement les relances CRM après une commande ou une demande de pièce.
  // Les messages sont mis en file dans PostgreSQL : aucun message commercial n'est envoyé sans
  // passer par le canal d'envoi configuré et les règles de consentement de l'entreprise.
  async function scheduleShopFollowups(phone: string, options: {
    orderRef?: string;
    productName?: string;
    kind?: "order" | "part_request";
  }) {
    if (!dbPool) return;
    const kind = options.kind || "order";
    const baseMessage = kind === "part_request"
      ? "Bonjour, ici DiagAssist. Nous revenons vers vous concernant votre demande de pièce. Souhaitez-vous toujours que nous poursuivions la recherche ?"
      : `Bonjour, ici DiagAssist. Nous revenons vers vous concernant votre commande${options.orderRef ? ` ${options.orderRef}` : ""}${options.productName ? ` (${options.productName})` : ""}. Souhaitez-vous confirmer votre besoin ?`;

    const delays = kind === "part_request"
      ? [{ days: 2, suffix: "Relance demande de pièce J+2" }]
      : [{ days: 1, suffix: "Relance commande J+1" }, { days: 3, suffix: "Relance commande J+3" }];

    for (const delay of delays) {
      const scheduled = new Date(Date.now() + delay.days * 24 * 60 * 60 * 1000);
      const duplicate = await dbPool.query(
        `SELECT 1 FROM shop_followups
         WHERE customer_phone = $1 AND kind = $2 AND COALESCE(related_order_ref, '') = COALESCE($3, '')
         AND scheduled_for::date = $4::date LIMIT 1`,
        [phone, kind, options.orderRef || null, scheduled]
      );
      if (duplicate.rows.length > 0) continue;

      await dbPool.query(
        `INSERT INTO shop_followups (customer_phone, message, channel, scheduled_for, status, related_order_ref, kind)
         VALUES ($1,$2,'whatsapp',$3,'programmee',$4,$5)`,
        [phone, `${delay.suffix} — ${baseMessage}`, scheduled, options.orderRef || null, kind]
      );
    }
  }

  // Envoi réel des relances WhatsApp programmées.
  // Le worker utilise Twilio si les secrets sont configurés. Pour les messages
  // hors fenêtre de service WhatsApp, configurez un Content SID de template approuvé.
  async function sendShopWhatsApp(phone: string, message: string): Promise<void> {
    const sid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
    const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
    if (!sid || !token) throw new Error("TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN manquants");

    const client = twilio(sid, token);
    const sender = (process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886").trim();
    const fromNumber = sender.startsWith("whatsapp:") ? sender : `whatsapp:${sender}`;
    const toNumber = phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone}`;
    const contentSid = (process.env.TWILIO_WHATSAPP_CONTENT_SID || "").trim();

    if (contentSid) {
      await client.messages.create({
        from: fromNumber,
        to: toNumber,
        contentSid,
        contentVariables: JSON.stringify({ "1": message }),
      });
    } else {
      await client.messages.create({ from: fromNumber, to: toNumber, body: message });
    }
  }

  async function processDueShopFollowups(): Promise<void> {
    if (!dbPool) return;
    const { rows } = await dbPool.query(
      `SELECT f.*
       FROM shop_followups f
       WHERE f.status = 'programmee'
         AND f.channel = 'whatsapp'
         AND f.scheduled_for IS NOT NULL
         AND f.scheduled_for <= CURRENT_TIMESTAMP
       ORDER BY f.scheduled_for ASC
       LIMIT 25`
    );

    for (const followup of rows) {
      try {
        // Double sécurité : une commande confirmée/livrée annule toute relance encore en file.
        if (followup.kind === "order" && followup.related_order_ref) {
          const order = await dbPool.query(
            `SELECT bool_or(status IN ('confirmee','en_traitement','prete','livree')) AS completed,
                    bool_or(status = 'annulee') AS cancelled
             FROM shop_orders WHERE order_ref = $1`,
            [followup.related_order_ref]
          );
          if (order.rows[0]?.completed || order.rows[0]?.cancelled) {
            await dbPool.query(
              "UPDATE shop_followups SET status = 'commande_confirmee' WHERE id = $1 AND status = 'programmee'",
              [followup.id]
            );
            continue;
          }
        }

        if (followup.kind === "part_request") {
          const request = await dbPool.query(
            "SELECT bool_or(status IN ('annulee','livree')) AS completed FROM shop_part_requests WHERE customer_phone = $1 AND created_at >= $2::timestamp - INTERVAL '30 days'",
            [followup.customer_phone, followup.created_at]
          );
          if (request.rows[0]?.completed) continue;
        }

        await dbPool.query(
          "UPDATE shop_followups SET attempts = attempts + 1 WHERE id = $1",
          [followup.id]
        );
        await sendShopWhatsApp(followup.customer_phone, followup.message || "Bonjour, ici DiagAssist. Nous revenons vers vous concernant votre demande.");
        await dbPool.query(
          "UPDATE shop_followups SET status = 'envoyee', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = $1 AND status = 'programmee'",
          [followup.id]
        );
        console.log(`[CRM WhatsApp] Relance #${followup.id} envoyée à ${followup.customer_phone}.`);
      } catch (err: any) {
        const attempts = Number(followup.attempts || 0) + 1;
        const nextStatus = attempts >= 5 ? "echec" : "programmee";
        await dbPool.query(
          "UPDATE shop_followups SET status = $1, last_error = $2 WHERE id = $3 AND status = 'programmee'",
          [nextStatus, String(err?.message || err).slice(0, 500), followup.id]
        );
        console.error(`[CRM WhatsApp] Échec relance #${followup.id} (tentative ${attempts}/5):`, err?.message || err);
      }
    }
  }

  // Exécute les relances automatiquement toutes les 5 minutes et une première fois
  // peu après le démarrage du serveur.
  const followupWorker = setInterval(() => { processDueShopFollowups().catch((err) => console.error("[CRM WhatsApp] Worker:", err)); }, 5 * 60 * 1000);
  followupWorker.unref?.();
  setTimeout(() => { processDueShopFollowups().catch((err) => console.error("[CRM WhatsApp] Initial worker:", err)); }, 5000);

  // --- Public : passer commande (identification par téléphone uniquement, pas de compte requis) ---
  app.post("/api/shop/orders", shopPublicLimiter, async (req, res) => {
    if (!dbPool) return res.status(503).json({ success: false, message: "Service indisponible." });
    const { phone, name, city, product_id, notes } = req.body;
    if (!phone || !product_id) return res.status(400).json({ success: false, message: "Téléphone et produit requis." });
    const cleanPhone = normalizeShopPhone(phone);
    if (!cleanPhone) return res.status(400).json({ success: false, message: "Numéro de téléphone invalide." });
    const productId = Number(product_id);
    if (!Number.isInteger(productId) || productId <= 0) return res.status(400).json({ success: false, message: "Produit invalide." });
    const quantity = Math.min(100, Math.max(1, Math.floor(Number(req.body.quantity) || 1)));
    if (!(await shopPhoneUnderDailyCap(cleanPhone))) return res.status(429).json({ success: false, message: "Trop de demandes pour ce numéro aujourd'hui." });

    const productRes = await dbPool.query("SELECT * FROM shop_products WHERE id = $1 AND is_active = true", [productId]);
    if (productRes.rows.length === 0) return res.status(404).json({ success: false, message: "Produit introuvable." });
    const product = productRes.rows[0];

    await upsertShopCustomer(cleanPhone, cleanText(name, 100), cleanText(city, 100), "produit");
    const orderRef = await nextOrderRef();
    const dep = depositFor(product, quantity);
    const orderRes = await dbPool.query(
      `INSERT INTO shop_orders (customer_phone, product_id, product_name_snapshot, unit_price_snapshot, quantity, order_ref, notes, deposit_fcfa, deposit_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [cleanPhone, productId, product.name, product.price_fcfa, quantity, orderRef, cleanText(notes, 500) || null, dep.amount, dep.status]
    );
    await scheduleShopFollowups(cleanPhone, { orderRef, productName: product.name, kind: "order" });
    const days = product.lead_time_days ? Number(product.lead_time_days) : null;
    res.json({
      success: true,
      message: dep.amount > 0 ? "Commande enregistrée. " + depositMessage(dep.amount, days) : "Commande enregistrée. Nous vous contacterons sous peu.",
      order_id: orderRes.rows[0].id, order_ref: orderRef, deposit_total: dep.amount, lead_time_days: days,
    });
  });

  // Acompte d'un produit sur commande : pourcentage du total de la ligne, verse en boutique.
  function depositFor(product: any, quantity: number): { amount: number; status: "non_requis" | "en_attente" } {
    const pct = Number(product.deposit_pct || 0);
    const price = Number(product.price_fcfa || 0);
    if (!(pct > 0) || !(price > 0)) return { amount: 0, status: "non_requis" };
    return { amount: Math.round((price * Math.max(1, Number(quantity) || 1) * pct) / 100), status: "en_attente" };
  }
  const depositMessage = (amount: number, days: number | null) =>
    `Un acompte de ${amount.toLocaleString("fr-FR")} FCFA est à verser dans nos locaux pour lancer la commande.` +
    (days ? ` Livraison sous environ ${days} jours ouvrables après l'acompte.` : "");

  // Génère une référence de commande sans collision : DA-AAAA-NNNNNN, compteur atomique par année.
  async function nextOrderRef(): Promise<string> {
    const year = new Date().getFullYear();
    const result = await dbPool!.query(
      `INSERT INTO shop_order_counter (year, last_value) VALUES ($1, 1)
       ON CONFLICT (year) DO UPDATE SET last_value = shop_order_counter.last_value + 1
       RETURNING last_value`,
      [year]
    );
    const n = result.rows[0].last_value;
    return `DA-${year}-${String(n).padStart(6, "0")}`;
  }

  // --- Public : panier multi-produits -> commande groupée (checkout) ---
  app.post("/api/shop/checkout", shopPublicLimiter, async (req, res) => {
    if (!dbPool) return res.status(503).json({ success: false, message: "Service indisponible." });
    // La boutique envoie customer_phone / customer_name / shipping_address ; les anciens noms restent acceptes.
    const body = req.body as any;
    const phone: string = body.phone ?? body.customer_phone;
    const name: string | undefined = body.name ?? body.customer_name;
    const city: string | undefined = body.city;
    const address: string | undefined = body.address ?? body.shipping_address;
    const items: { product_id: number; quantity: number }[] = body.items;
    if (!phone || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "Téléphone et au moins un article requis." });
    }
    const cleanPhone = normalizeShopPhone(phone);
    if (!cleanPhone) return res.status(400).json({ success: false, message: "Numéro de téléphone invalide." });
    if (items.length > 30) return res.status(400).json({ success: false, message: "Panier trop volumineux." });
    if (!(await shopPhoneUnderDailyCap(cleanPhone))) return res.status(429).json({ success: false, message: "Trop de demandes pour ce numéro aujourd'hui." });

    await upsertShopCustomer(cleanPhone, cleanText(name, 100), cleanText(city, 100), "produit");
    const orderRef = await nextOrderRef();

    const createdIds: number[] = [];
    let depositTotal = 0;
    let leadDays: number | null = null;
    for (const item of items) {
      const itemProductId = Number(item?.product_id);
      if (!Number.isInteger(itemProductId) || itemProductId <= 0) continue;
      const itemQty = Math.min(100, Math.max(1, Math.floor(Number(item.quantity) || 1)));
      const productRes = await dbPool.query("SELECT * FROM shop_products WHERE id = $1 AND is_active = true", [itemProductId]);
      if (productRes.rows.length === 0) continue; // ignore un produit devenu introuvable plutôt que d'annuler toute la commande
      const product = productRes.rows[0];
      const dep = depositFor(product, itemQty);
      depositTotal += dep.amount;
      if (dep.amount > 0 && product.lead_time_days) leadDays = Math.max(leadDays ?? 0, Number(product.lead_time_days));
      const orderRes = await dbPool.query(
        `INSERT INTO shop_orders (customer_phone, product_id, product_name_snapshot, unit_price_snapshot, quantity, order_ref, shipping_city, shipping_address, deposit_fcfa, deposit_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [cleanPhone, itemProductId, product.name, product.price_fcfa, itemQty, orderRef, cleanText(city, 100) || null, cleanText(address, 300) || null, dep.amount, dep.status]
      );
      createdIds.push(orderRes.rows[0].id);
    }

    if (createdIds.length === 0) return res.status(400).json({ success: false, message: "Aucun des produits du panier n'est plus disponible." });
    const firstProductName = await dbPool.query("SELECT product_name_snapshot FROM shop_orders WHERE id = $1", [createdIds[0]]);
    await scheduleShopFollowups(cleanPhone, {
      orderRef,
      productName: firstProductName.rows[0]?.product_name_snapshot || undefined,
      kind: "order",
    });
    res.json({
      success: true,
      message: depositTotal > 0 ? "Commande enregistrée. " + depositMessage(depositTotal, leadDays) : "Commande enregistrée. Nous vous contacterons sous peu.",
      order_ref: orderRef, order_ids: createdIds, deposit_total: depositTotal, lead_time_days: leadDays,
    });
  });

  // --- Public : suivi de commande par référence + téléphone ---
  app.get("/api/shop/track", shopPublicLimiter, async (req, res) => {
    if (!dbPool) return res.status(503).json({ success: false, message: "Service indisponible." });
    const { ref, phone } = req.query as { ref?: string; phone?: string };
    // Référence ET téléphone exigés : le numéro seul ne doit pas permettre de lister les commandes d'autrui.
    if (!phone || !ref) return res.status(400).json({ success: false, message: "Référence et téléphone requis." });
    const cleanPhone = normalizeShopPhone(phone);
    if (!cleanPhone) return res.status(400).json({ success: false, message: "Numéro de téléphone invalide." });

    let query = "SELECT * FROM shop_orders WHERE customer_phone = $1";
    const params: any[] = [cleanPhone];
    if (ref) { params.push(ref); query += ` AND order_ref = $2`; }
    query += " ORDER BY created_at DESC LIMIT 50";
    const { rows } = await dbPool.query(query, params);
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Aucune commande trouvée pour ces informations." });

    // Regroupe par order_ref (ou par commande individuelle si pas de ref, ex: anciennes commandes)
    const groups = new Map<string, any[]>();
    for (const row of rows) {
      const key = row.order_ref || `single-${row.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    const orders = Array.from(groups.entries()).map(([key, items]) => ({
      order_ref: items[0].order_ref || null,
      status: items[0].status, // statut de la première ligne — simplification: toutes les lignes d'une même commande évoluent ensemble en pratique
      created_at: items[0].created_at,
      items: items.map((i) => ({ product_name: i.product_name_snapshot, quantity: i.quantity, status: i.status })),
    }));
    res.json({ success: true, orders });
  });

  // --- Public : demande de pièce à l'étranger (avec carte grise) ---
  app.post("/api/shop/part-requests", shopPublicLimiter, async (req, res) => {
    if (!dbPool) return res.status(503).json({ success: false, message: "Service indisponible." });
    const { phone, name, part_description, part_photo_base64, carte_grise_base64, extra_info } = req.body;
    if (!phone || !part_description) return res.status(400).json({ success: false, message: "Téléphone et description de la pièce requis." });
    const cleanPhone = normalizeShopPhone(phone);
    if (!cleanPhone) return res.status(400).json({ success: false, message: "Numéro de téléphone invalide." });
    const MAX_B64 = 4_000_000; // ~3 Mo par image
    const isImg = (v: unknown) => v === undefined || v === null || v === "" || (typeof v === "string" && v.length <= MAX_B64 && /^data:image\/(png|jpe?g|webp);base64,/i.test(v));
    if (!isImg(part_photo_base64) || !isImg(carte_grise_base64)) {
      return res.status(400).json({ success: false, message: "Image invalide ou trop volumineuse (JPEG/PNG/WebP, 3 Mo max)." });
    }
    if (!(await shopPhoneUnderDailyCap(cleanPhone))) return res.status(429).json({ success: false, message: "Trop de demandes pour ce numéro aujourd'hui." });

    await upsertShopCustomer(cleanPhone, cleanText(name, 100), undefined, "pieces");
    const result = await dbPool.query(
      `INSERT INTO shop_part_requests (customer_phone, part_description, part_photo_base64, carte_grise_base64, extra_info)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [cleanPhone, cleanText(part_description, 1000), part_photo_base64 || null, carte_grise_base64 || null, cleanText(extra_info, 1000) || null]
    );
    await scheduleShopFollowups(cleanPhone, { kind: "part_request" });
    res.json({ success: true, message: "Demande envoyée. Nous préparons une cotation sous environ 15 jours.", request_id: result.rows[0].id });
  });

  // --- Admin : gestion produits ---
  app.get("/api/admin/shop/products", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.json({ success: true, products: [] });
    const { rows } = await dbPool.query("SELECT p.*, c.name as category_name FROM shop_products p LEFT JOIN shop_categories c ON c.id = p.category_id ORDER BY p.created_at DESC");
    res.json({ success: true, products: rows });
  });

  app.post("/api/admin/shop/products", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.status(503).json({ success: false, message: "Service indisponible." });
    const { category_id, name, brand, model, price_eur, price_fcfa, description, specs, compatibility, box_contents, warranty, availability, photos, videos } = req.body;
    const normalizedPriceEur = price_eur !== undefined && price_eur !== null && price_eur !== "" ? Number(price_eur) : null;
    const convertedPriceFcfa = normalizedPriceEur !== null && Number.isFinite(normalizedPriceEur) ? euroToRoundedFcfa(normalizedPriceEur) : (price_fcfa !== undefined && price_fcfa !== null && price_fcfa !== "" ? Number(price_fcfa) : null);
    if (!name) return res.status(400).json({ success: false, message: "Nom requis." });
    const slug = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Date.now().toString(36);
    const result = await dbPool.query(
      `INSERT INTO shop_products (category_id, name, slug, brand, model, price_eur, price_fcfa, description, specs, compatibility, box_contents, warranty, availability, photos, videos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [category_id || null, name, slug, brand || null, model || null, normalizedPriceEur, convertedPriceFcfa, description || null, specs || null, compatibility || null,
       box_contents || null, warranty || null, availability || "disponible", JSON.stringify(photos || []), JSON.stringify(videos || [])]
    );
    const depPct = Number(req.body.deposit_pct), leadDays = Number(req.body.lead_time_days);
    if ((depPct > 0 && depPct <= 100) || leadDays > 0) {
      await dbPool.query("UPDATE shop_products SET deposit_pct = $1, lead_time_days = $2 WHERE id = $3",
        [depPct > 0 && depPct <= 100 ? Math.round(depPct) : 0, leadDays > 0 ? Math.round(leadDays) : null, result.rows[0].id]);
    }
    res.json({ success: true, id: result.rows[0].id, slug });
  });

  app.patch("/api/admin/shop/products/:id", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.status(503).json({ success: false, message: "Service indisponible." });
    const fields = req.body;
    const allowed = ["category_id", "name", "brand", "model", "price_eur", "price_fcfa", "description", "specs", "compatibility", "box_contents", "warranty", "availability", "is_active", "deposit_pct", "lead_time_days"];
    const jsonFields = ["photos", "videos"];
    const sets: string[] = [];
    const values: any[] = [];
    let i = 1;
    for (const key of allowed) {
      if (key === "price_fcfa" && fields.price_eur !== undefined) continue;
      if (key === "price_eur" && fields[key] !== undefined && fields[key] !== null && fields[key] !== "") {
        const eur = Number(fields[key]);
        if (!Number.isFinite(eur) || eur < 0) return res.status(400).json({ success: false, message: "Prix EUR invalide." });
        sets.push(key + " = $" + (i++)); values.push(eur);
        sets.push("price_fcfa = $" + (i++)); values.push(euroToRoundedFcfa(eur));
        continue;
      }
      if (fields[key] !== undefined) { sets.push(key + " = $" + (i++)); values.push(fields[key]); }
    }
    for (const key of jsonFields) {
      if (fields[key] !== undefined) { sets.push(`${key} = $${i++}`); values.push(JSON.stringify(fields[key])); }
    }
    if (sets.length === 0) return res.status(400).json({ success: false, message: "Rien à mettre à jour." });
    values.push(req.params.id);
    await dbPool.query(`UPDATE shop_products SET ${sets.join(", ")} WHERE id = $${i}`, values);
    res.json({ success: true });
  });

  app.delete("/api/admin/shop/products/:id", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.status(503).json({ success: false, message: "Service indisponible." });
    await dbPool.query("UPDATE shop_products SET is_active = false WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  });

  // --- Admin : catégories ---
  app.get("/api/admin/shop/categories", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.json({ success: true, categories: [] });
    const { rows } = await dbPool.query("SELECT * FROM shop_categories ORDER BY name ASC");
    res.json({ success: true, categories: rows });
  });

  app.post("/api/admin/shop/categories", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.status(503).json({ success: false, message: "Service indisponible." });
    const { name, type } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Nom requis." });
    const slug = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const result = await dbPool.query(
      "INSERT INTO shop_categories (name, slug, type) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING RETURNING id",
      [name, slug, type || "produit"]
    );
    res.json({ success: true, id: result.rows[0]?.id });
  });

  // --- Admin : commandes ---
  app.get("/api/admin/shop/orders", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.json({ success: true, orders: [] });
    const { status } = req.query as { status?: string };
    let query = "SELECT o.*, c.name as customer_name, c.city as customer_city FROM shop_orders o LEFT JOIN shop_customers c ON c.phone = o.customer_phone";
    const params: any[] = [];
    if (status) { params.push(status); query += ` WHERE o.status = $1`; }
    query += " ORDER BY o.created_at DESC LIMIT 200";
    const { rows } = await dbPool.query(query, params);
    res.json({ success: true, orders: rows });
  });

  // --- Admin : import du catalogue Ivoirelite (pages publiques, revendeur) ---
  // Corps : { categories: [{ url, name }], dryRun?: boolean, markupPct?: number }.
  // dryRun = lit et compte sans rien ecrire. Limite a ivoirelite.net, 10 categories par appel.
  app.post("/api/admin/shop/import/ivoirelite", requireAdminAuth, async (req, res) => {
    const list = Array.isArray(req.body?.categories) ? req.body.categories.slice(0, 10) : [];
    if (!list.length) return res.status(400).json({ success: false, message: "categories requis : [{ url, name }]." });
    const markupPct = Number(req.body?.markupPct ?? process.env.IVOIRELITE_MARKUP_PCT ?? 15); // marge ajoutee au prix fournisseur
    try {
      if (req.body?.dryRun) {
        const out = [];
        for (const c of list) {
          const items = await fetchCategory(String(c.url));
          out.push({ category: c.name, found: items.length, sample: items.slice(0, 3).map((i) => ({ ref: i.ref, name: i.name, priceFcfa: i.priceFcfa })) });
        }
        return res.json({ success: true, dryRun: true, results: out });
      }
      if (!dbPool) return res.status(503).json({ success: false, message: "Service indisponible." });
      const results = [];
      for (const c of list) results.push(await importCategory(dbPool, { url: String(c.url), name: String(c.name || "Ivoirelite"), markupPct }));
      res.json({ success: true, results });
    } catch (e: any) {
      console.error("[Import Ivoirelite]", e?.message || e);
      res.status(502).json({ success: false, message: String(e?.message || "Import impossible.").slice(0, 200) });
    }
  });

  // --- Admin : import du catalogue 3H Autoparts (flux produits public WooCommerce, revendeur) ---
  // Sans "categories" : renvoie la liste des categories disponibles. Sinon corps :
  // { categories: [{ id, name }], dryRun?: boolean, markupPct?: number }.
  app.post("/api/admin/shop/import/3hautoparts", requireAdminAuth, async (req, res) => {
    const list = Array.isArray(req.body?.categories) ? req.body.categories.slice(0, 10) : [];
    const markupPct = Number(req.body?.markupPct ?? process.env.H3_MARKUP_PCT ?? 15); // marge ajoutee au prix fournisseur
    try {
      if (!list.length) return res.json({ success: true, availableCategories: await fetch3hCategories() });
      if (req.body?.dryRun) {
        const out = [];
        for (const c of list) {
          const items = await fetch3hProducts(Number(c.id) || undefined);
          out.push({ category: c.name, found: items.length, sample: items.slice(0, 3).map((i) => ({ ref: i.ref, name: i.name, priceFcfa: i.priceFcfa, inStock: i.inStock })) });
        }
        return res.json({ success: true, dryRun: true, results: out });
      }
      if (!dbPool) return res.status(503).json({ success: false, message: "Service indisponible." });
      const results = [];
      for (const c of list) results.push(await import3hCategory(dbPool, { categoryId: Number(c.id) || undefined, name: String(c.name || "3H Autoparts"), markupPct }));
      res.json({ success: true, results });
    } catch (e: any) {
      console.error("[Import 3H]", e?.message || e);
      res.status(502).json({ success: false, message: String(e?.message || "Import impossible.").slice(0, 200) });
    }
  });

  // --- Admin : marge sur les produits d'un fournisseur ---
  // Les prix importes incluent deja la marge (defaut 15 %, ajoutee au prix fournisseur). Ce rapport liste les ventes
  // sur une periode avec la marge realisee et le montant a payer au fournisseur (prix de vente / (1 + marge)).
  // mode=commission : le taux est alors une part du prix de vente reversee hors systeme.
  // Due = commandes livrees ; a venir = commandes confirmees / en cours. Taux : SUPPLIER_COMMISSION_PCT (defaut 15).
  app.get("/api/admin/shop/commissions", requireAdminAuth, async (req, res) => {
    const supplier = String(req.query.supplier || "ivoirelite").toLowerCase();
    const pct = Number(req.query.pct ?? process.env.SUPPLIER_COMMISSION_PCT ?? 15);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return res.status(400).json({ success: false, message: "Pourcentage invalide." });
    const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const from = isDate(req.query.from) ? String(req.query.from) : "1970-01-01";
    const to = isDate(req.query.to) ? String(req.query.to) : "2999-12-31";
    if (!dbPool) return res.json({ success: true, supplier, pct, lines: [], totals: { due: 0, upcoming: 0, sales: 0 } });
    const { rows } = await dbPool.query(
      `SELECT o.id, o.order_ref, o.created_at, o.status, o.customer_phone,
              COALESCE(o.product_name_snapshot, p.name) AS product, p.supplier_ref, p.supplier_url,
              COALESCE(o.quantity, 1) AS quantity, COALESCE(o.unit_price_snapshot, 0) AS unit_price,
              COALESCE(o.unit_price_snapshot, 0) * COALESCE(o.quantity, 1) AS total
         FROM shop_orders o JOIN shop_products p ON p.id = o.product_id
        WHERE lower(p.supplier) = $1 AND o.status <> 'annulee'
          AND o.created_at::date BETWEEN $2::date AND $3::date
        ORDER BY o.created_at DESC LIMIT 1000`,
      [supplier, from, to],
    );
    const mode = req.query.mode === "commission" ? "commission" : "marge";
    // marge : prix de vente = cout fournisseur x (1 + pct/100) ; commission : part pct % du prix de vente
    const commission = (total: number) => Math.round(mode === "marge" ? total - total / (1 + pct / 100) : (total * pct) / 100);
    const lines = rows.map((r: any) => ({
      ...r,
      commission: commission(Number(r.total)),
      supplier_cost: Number(r.total) - commission(Number(r.total)),
      settled_basis: r.status === "livree" ? "due" : "a_venir",
    }));
    const sum = (f: (l: any) => boolean, k: string) => lines.filter(f).reduce((a: number, l: any) => a + Number(l[k]), 0);
    res.json({
      success: true, supplier, pct, mode, from, to, lines,
      totals: {
        sales: sum(() => true, "total"),
        supplier_cost: sum(() => true, "supplier_cost"),
        due: sum((l) => l.status === "livree", "commission"),
        upcoming: sum((l) => l.status !== "livree", "commission"),
      },
    });
  });

  app.patch("/api/admin/shop/orders/:id", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.status(503).json({ success: false, message: "Service indisponible." });
    const { status, notes, deposit_status } = req.body;
    if (status !== undefined && !["nouvelle", "a_contacter", "contactee", "confirmee", "en_traitement", "prete", "livree", "annulee", "client_injoignable"].includes(status)) {
      return res.status(400).json({ success: false, message: "Statut de commande invalide." });
    }
    if (deposit_status !== undefined && !["non_requis", "en_attente", "recu"].includes(deposit_status)) {
      return res.status(400).json({ success: false, message: "Statut d'acompte invalide." });
    }
    const sets: string[] = ["updated_at = CURRENT_TIMESTAMP"];
    const values: any[] = [];
    let i = 1;
    if (deposit_status !== undefined) {
      sets.push(`deposit_status = $${i++}`); values.push(deposit_status);
      sets.push(deposit_status === "recu" ? "deposit_received_at = CURRENT_TIMESTAMP" : "deposit_received_at = NULL");
    }
    if (status !== undefined) { sets.push(`status = $${i++}`); values.push(status); }
    if (notes !== undefined) { sets.push(`notes = $${i++}`); values.push(notes); }
    values.push(req.params.id);
    await dbPool.query(`UPDATE shop_orders SET ${sets.join(", ")} WHERE id = $${i}`, values);
    if (["confirmee", "en_traitement", "prete", "livree", "annulee"].includes(status)) {
      await dbPool.query(
        `UPDATE shop_followups SET status = CASE
            WHEN $2 = 'annulee' THEN 'commande_confirmee'
            ELSE 'commande_confirmee'
          END
         WHERE related_order_ref = (SELECT order_ref FROM shop_orders WHERE id = $1)
         AND status = 'programmee'`,
        [req.params.id, status]
      );
    }
    res.json({ success: true });
  });

  // --- Admin : demandes de pièces ---
  app.get("/api/admin/shop/part-requests", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.json({ success: true, requests: [] });
    const { rows } = await dbPool.query(
      "SELECT r.*, c.name as customer_name FROM shop_part_requests r LEFT JOIN shop_customers c ON c.phone = r.customer_phone ORDER BY r.created_at DESC LIMIT 200"
    );
    res.json({ success: true, requests: rows });
  });

  app.patch("/api/admin/shop/part-requests/:id", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.status(503).json({ success: false, message: "Service indisponible." });
    const { status, quote_fcfa, quote_details, estimated_days } = req.body;
    const sets: string[] = ["updated_at = CURRENT_TIMESTAMP"];
    const values: any[] = [];
    let i = 1;
    if (status !== undefined) { sets.push(`status = $${i++}`); values.push(status); }
    if (quote_fcfa !== undefined) { sets.push(`quote_fcfa = $${i++}`); values.push(quote_fcfa); }
    if (quote_details !== undefined) { sets.push(`quote_details = $${i++}`); values.push(quote_details); }
    if (estimated_days !== undefined) { sets.push(`estimated_days = $${i++}`); values.push(estimated_days); }
    values.push(req.params.id);
    await dbPool.query(`UPDATE shop_part_requests SET ${sets.join(", ")} WHERE id = $${i}`, values);
    res.json({ success: true });
  });

  // --- Admin : clients CRM ---
  app.get("/api/admin/shop/customers", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.json({ success: true, customers: [] });
    const { search } = req.query as { search?: string };
    let query = "SELECT * FROM shop_customers";
    const params: any[] = [];
    if (search) { params.push(`%${search}%`); query += ` WHERE phone ILIKE $1 OR name ILIKE $1`; }
    query += " ORDER BY last_interaction_at DESC LIMIT 200";
    const { rows } = await dbPool.query(query, params);
    res.json({ success: true, customers: rows });
  });

  app.get("/api/admin/shop/customers/:phone", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.status(404).json({ success: false, message: "Introuvable." });
    const phone = decodeURIComponent(req.params.phone);
    const customer = await dbPool.query("SELECT * FROM shop_customers WHERE phone = $1", [phone]);
    if (customer.rows.length === 0) return res.status(404).json({ success: false, message: "Client introuvable." });
    const orders = await dbPool.query("SELECT * FROM shop_orders WHERE customer_phone = $1 ORDER BY created_at DESC", [phone]);
    const partRequests = await dbPool.query("SELECT * FROM shop_part_requests WHERE customer_phone = $1 ORDER BY created_at DESC", [phone]);
    const followups = await dbPool.query("SELECT * FROM shop_followups WHERE customer_phone = $1 ORDER BY created_at DESC", [phone]);
    res.json({ success: true, customer: customer.rows[0], orders: orders.rows, partRequests: partRequests.rows, followups: followups.rows });
  });

  app.patch("/api/admin/shop/customers/:phone", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.status(503).json({ success: false, message: "Service indisponible." });
    const phone = decodeURIComponent(req.params.phone);
    const { name, city, notes } = req.body;
    await dbPool.query(
      "UPDATE shop_customers SET name = COALESCE($2, name), city = COALESCE($3, city), notes = COALESCE($4, notes) WHERE phone = $1",
      [phone, name, city, notes]
    );
    res.json({ success: true });
  });

  // --- Admin : état WhatsApp / worker CRM ---
  app.get("/api/admin/shop/whatsapp-status", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.json({ success: true, configured: false, templateConfigured: false, due: 0, failed: 0, sentToday: 0 });
    const configured = Boolean((process.env.TWILIO_ACCOUNT_SID || "").trim() && (process.env.TWILIO_AUTH_TOKEN || "").trim());
    const templateConfigured = Boolean((process.env.TWILIO_WHATSAPP_CONTENT_SID || "").trim());
    const sender = (process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886").trim();
    const [due, failed, sentToday] = await Promise.all([
      dbPool.query("SELECT COUNT(*) FROM shop_followups WHERE status = 'programmee' AND channel = 'whatsapp' AND scheduled_for IS NOT NULL AND scheduled_for <= NOW()"),
      dbPool.query("SELECT COUNT(*) FROM shop_followups WHERE status = 'echec' AND channel = 'whatsapp'"),
      dbPool.query("SELECT COUNT(*) FROM shop_followups WHERE status = 'envoyee' AND channel = 'whatsapp' AND sent_at::date = CURRENT_DATE"),
    ]);
    const masked = sender.replace(/(whatsapp:\\+\\d{3})\\d+(\\d{2})$/, "$1••••$2");
    res.json({ success: true, configured, templateConfigured, senderMasked: masked, due: Number(due.rows[0]?.count || 0), failed: Number(failed.rows[0]?.count || 0), sentToday: Number(sentToday.rows[0]?.count || 0), intervalMinutes: 5 });
  });

  // --- Admin : outils de diagnostic WhatsApp ---
  app.post("/api/admin/shop/whatsapp-test-connection", adminLimiter, requireAdminAuth, async (req, res) => {
    const sid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
    const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
    if (!sid || !token) return res.status(400).json({ success: false, message: "Twilio n'est pas configuré : TWILIO_ACCOUNT_SID et TWILIO_AUTH_TOKEN sont requis côté serveur." });
    try {
      const account = await twilio(sid, token).api.v2010.accounts(sid).fetch();
      res.json({ success: true, message: `Connexion Twilio réussie — compte ${account.friendlyName || sid.slice(0, 6) + "•••"} accessible.` });
    } catch (err: any) {
      console.error("[WhatsApp] Test connexion Twilio:", err?.message || err);
      res.status(502).json({ success: false, message: "Twilio a refusé la connexion. Vérifiez les identifiants et la configuration du compte." });
    }
  });

  app.post("/api/admin/shop/whatsapp-test-message", adminLimiter, requireAdminAuth, async (req, res) => {
    const phone = String(req.body?.phone || "").trim().replace(/[\\s-]/g, "");
    const message = String(req.body?.message || "").trim();
    if (!phone) return res.status(400).json({ success: false, message: "Le numéro destinataire est requis." });
    if (!/^\\+\\d{8,15}$/.test(phone)) return res.status(400).json({ success: false, message: "Utilisez un numéro international, par exemple +2250700000000." });
    if (!message) return res.status(400).json({ success: false, message: "Le message test est requis." });
    if (message.length > 1000) return res.status(400).json({ success: false, message: "Le message test est limité à 1 000 caractères." });
    try {
      await sendShopWhatsApp(phone, message);
      res.json({ success: true, message: `Message test envoyé vers ${phone}.` });
    } catch (err: any) {
      console.error("[WhatsApp] Test message:", err?.message || err);
      res.status(502).json({ success: false, message: "Échec de l'envoi du message test. Vérifiez l'expéditeur WhatsApp, le template et les règles Twilio." });
    }
  });

  app.post("/api/admin/shop/whatsapp-test-template", adminLimiter, requireAdminAuth, async (req, res) => {
    const sid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
    const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
    const contentSid = (process.env.TWILIO_WHATSAPP_CONTENT_SID || "").trim();
    if (!sid || !token) return res.status(400).json({ success: false, message: "Twilio n'est pas configuré côté serveur." });
    if (!contentSid) return res.status(400).json({ success: false, message: "Aucun Content SID de template n'est configuré." });
    try {
      const content = await twilio(sid, token).content.v1.contents(contentSid).fetch();
      res.json({ success: true, message: `Template accessible dans Twilio : ${content.friendlyName || contentSid}. Cela confirme son accessibilité, pas nécessairement son approbation WhatsApp.` });
    } catch (err: any) {
      console.error("[WhatsApp] Test template:", err?.message || err);
      res.status(502).json({ success: false, message: "Le Content SID n'est pas accessible depuis Twilio. Vérifiez l'identifiant et son statut dans Twilio." });
    }
  });

  // --- Admin : relances ---
  app.get("/api/admin/shop/followups", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.json({ success: true, followups: [] });
    const { rows } = await dbPool.query(
      `SELECT f.*, c.name as customer_name FROM shop_followups f LEFT JOIN shop_customers c ON c.phone = f.customer_phone
       ORDER BY (f.status = 'programmee') DESC, f.scheduled_for ASC NULLS LAST, f.created_at DESC LIMIT 200`
    );
    res.json({ success: true, followups: rows });
  });

  app.post("/api/admin/shop/followups", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.status(503).json({ success: false, message: "Service indisponible." });
    const { customer_phone, message, channel, scheduled_for, status } = req.body;
    if (!customer_phone) return res.status(400).json({ success: false, message: "Client requis." });
    const result = await dbPool.query(
      `INSERT INTO shop_followups (customer_phone, message, channel, scheduled_for, status) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [customer_phone, message || null, channel || "whatsapp", scheduled_for || null, status || "programmee"]
    );
    res.json({ success: true, id: result.rows[0].id });
  });

  app.patch("/api/admin/shop/followups/:id", requireAdminAuth, async (req, res) => {
    if (!dbPool) return res.status(503).json({ success: false, message: "Service indisponible." });
    const { status } = req.body;
    await dbPool.query("UPDATE shop_followups SET status = $1 WHERE id = $2", [status, req.params.id]);
    res.json({ success: true });
  });

  // --- Admin : tableau de bord commercial ---
  app.get("/api/admin/shop/dashboard", requireAdminAuth, async (req, res) => {
    if (!dbPool) {
      return res.json({
        success: true,
        stats: {
          ordersByStatus: [], partRequestsByStatus: [], totalCustomers: 0, followupsDueSoon: 0,
          todayOrders: 0, todayRevenue: 0, pendingOrders: 0, confirmedOrders: 0,
          confirmedRevenue: 0, totalOrders: 0, confirmationRate: 0, recentOrders: [],
        },
      });
    }

    const [orders, parts, customers, followups, commercial, recent] = await Promise.all([
      dbPool.query("SELECT status, COUNT(*) FROM shop_orders GROUP BY status ORDER BY COUNT(*) DESC"),
      dbPool.query("SELECT status, COUNT(*) FROM shop_part_requests GROUP BY status ORDER BY COUNT(*) DESC"),
      dbPool.query("SELECT COUNT(*) FROM shop_customers"),
      dbPool.query("SELECT COUNT(*) FROM shop_followups WHERE status = 'programmee' AND scheduled_for <= NOW() + INTERVAL '7 days'"),
      dbPool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS today_orders,
          COALESCE(SUM(COALESCE(unit_price_snapshot, 0) * COALESCE(quantity, 1)) FILTER (WHERE created_at::date = CURRENT_DATE), 0) AS today_revenue,
          COUNT(*) FILTER (WHERE status NOT IN ('annulee', 'livree')) AS pending_orders,
          COUNT(*) FILTER (WHERE status IN ('confirmee', 'livree')) AS confirmed_orders,
          COALESCE(SUM(COALESCE(unit_price_snapshot, 0) * COALESCE(quantity, 1)) FILTER (WHERE status IN ('confirmee', 'livree')), 0) AS confirmed_revenue,
          COUNT(*) AS total_orders
        FROM shop_orders
      `),
      dbPool.query(`
        SELECT o.id, o.order_ref, o.product_name_snapshot, o.quantity, o.unit_price_snapshot,
               o.status, o.created_at, c.name AS customer_name
        FROM shop_orders o
        LEFT JOIN shop_customers c ON c.phone = o.customer_phone
        ORDER BY o.created_at DESC
        LIMIT 8
      `),
    ]);

    const row = commercial.rows[0] || {};
    const totalOrders = Number(row.total_orders || 0);
    const confirmedOrders = Number(row.confirmed_orders || 0);

    res.json({
      success: true,
      stats: {
        ordersByStatus: orders.rows,
        partRequestsByStatus: parts.rows,
        totalCustomers: Number(customers.rows[0]?.count || 0),
        followupsDueSoon: Number(followups.rows[0]?.count || 0),
        todayOrders: Number(row.today_orders || 0),
        todayRevenue: Number(row.today_revenue || 0),
        pendingOrders: Number(row.pending_orders || 0),
        confirmedOrders,
        confirmedRevenue: Number(row.confirmed_revenue || 0),
        totalOrders,
        confirmationRate: totalOrders ? Math.round((confirmedOrders / totalOrders) * 100) : 0,
        recentOrders: recent.rows,
      },
    });
  });

  // API Route (utilisateur connecté) : annuaire public des mécaniciens agréés actifs,
  // affiché aux propriétaires de véhicules pour les orienter vers un professionnel équipé.
  app.get("/api/mechanics", requireAuth, (req, res) => {
    const city = (req.query.city as string || "").trim().toLowerCase();
    const type = (req.query.type as string || "").trim();
    let list = Array.from(mechanics.values()).filter((m) => m.active);
    if (type === "mechanic" || type === "parts_vendor") {
      list = list.filter((m) => m.type === type);
    }
    if (city) {
      list = list.filter((m) => m.city.toLowerCase().includes(city) || (m.area || "").toLowerCase().includes(city));
    }
    res.json({ success: true, mechanics: list });
  });

  // API Route : génère une question captcha simple (anti-bot) pour la création de compte.
  // Aucune dépendance à un service externe (reCAPTCHA, Twilio...) : juste une question
  // arithmétique dont la réponse est vérifiée côté serveur.
  app.post("/api/auth/captcha", authLimiter, (req, res) => {
    const a = Math.floor(Math.random() * 8) + 2; // 2-9
    const b = Math.floor(Math.random() * 8) + 2; // 2-9
    const captchaId = crypto.randomBytes(16).toString("hex");
    captchaStorage.set(captchaId, { answer: a + b, expiresAt: Date.now() + 10 * 60 * 1000 });
    res.json({ success: true, captchaId, question: `Combien font ${a} + ${b} ?` });
  });

  // API Route : création de compte directe (numéro + mot de passe), protégée par le captcha
  // ci-dessus. Ne dépend d'aucun envoi SMS/WhatsApp — évite les pannes liées à un fournisseur
  // OTP mal configuré, tout en gardant une protection anti-bot minimale.
  app.post("/api/auth/register", authLimiter, registerLimiter, (req, res) => {
    const { phoneNumber, countryCode, password, captchaId, captchaAnswer, name } = req.body;
    if (!phoneNumber || !password || !captchaId || captchaAnswer === undefined) {
      return res.status(400).json({ success: false, message: "Données manquantes pour créer le compte." });
    }
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ success: false, message: "Le mot de passe doit faire au moins 6 caractères." });
    }

    const captcha = captchaStorage.get(captchaId);
    if (!captcha) {
      return res.status(400).json({ success: false, message: "Captcha expiré ou invalide. Veuillez réessayer." });
    }
    if (Date.now() > captcha.expiresAt) {
      captchaStorage.delete(captchaId);
      return res.status(400).json({ success: false, message: "Captcha expiré. Veuillez réessayer." });
    }
    if (Number(captchaAnswer) !== captcha.answer) {
      return res.status(400).json({ success: false, message: "Réponse incorrecte. Veuillez réessayer." });
    }
    captchaStorage.delete(captchaId); // usage unique

    const cleanNumber = String(phoneNumber).replace(/\s+/g, "");
    if (cleanNumber.length < 8) {
      return res.status(400).json({ success: false, message: "Veuillez saisir un numéro de téléphone valide." });
    }
    if (!/^\d{8,14}$/.test(cleanNumber) || (countryCode !== undefined && !/^\+\d{1,4}$/.test(String(countryCode)))) {
      return res.status(400).json({ success: false, message: "Veuillez saisir un numéro de téléphone valide." });
    }
    const fullPhone = `${countryCode || "+225"}${cleanNumber}`;

    // FAILLE CORRIGÉE : cette route écrasait le mot de passe (et le rôle admin) d'un compte existant.
    // Un compte existant doit se connecter, ou réinitialiser son mot de passe via un canal vérifié.
    if (userAccounts.has(fullPhone)) {
      return res.status(409).json({ success: false, message: "Un compte existe déjà pour ce numéro. Connectez-vous ou réinitialisez votre mot de passe." });
    }

    createAccount(fullPhone, password, false, undefined, typeof name === "string" ? name.trim() : undefined);
    console.log(`[Auth] Compte créé par auto-inscription (captcha) pour ${fullPhone}.`);
    const token = createSession(fullPhone);
    res.json({ success: true, message: "Compte créé avec succès.", sessionToken: token });
  });

  // API Route : connexion par numéro de téléphone + mot de passe (compte créé par l'admin)
  app.post("/api/auth/login", authLimiter, (req, res) => {
    const { phoneNumber, countryCode, password } = req.body;
    if (!phoneNumber || !password) {
      return res.status(400).json({ success: false, message: "Numéro de téléphone et mot de passe requis." });
    }
    const cleanPhone = phoneNumber.replace(/\s+/g, "");
    const fullPhone = `${countryCode || "+225"}${cleanPhone}`;

    // Anti brute-force par numéro (indépendant du rate-limit global par IP)
    const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
    const MAX_ATTEMPTS_PER_PHONE = 8;
    const attempts = loginAttempts.get(fullPhone) || { count: 0, windowStart: Date.now() };
    if (Date.now() - attempts.windowStart > ATTEMPT_WINDOW_MS) {
      attempts.count = 0;
      attempts.windowStart = Date.now();
    }
    if (attempts.count >= MAX_ATTEMPTS_PER_PHONE) {
      return res.status(429).json({ success: false, message: "Trop de tentatives pour ce numéro. Veuillez réessayer plus tard." });
    }

    if (!userAccounts.has(fullPhone) || !verifyAccountPassword(fullPhone, password)) {
      attempts.count += 1;
      loginAttempts.set(fullPhone, attempts);
      return res.status(401).json({ success: false, message: "Numéro ou mot de passe incorrect." });
    }

    loginAttempts.delete(fullPhone);

    // SESSION UNIQUE : seuls les comptes admin peuvent être connectés sur plusieurs appareils.
    // Pour un client normal, toute nouvelle connexion déconnecte de force les sessions
    // précédentes — cela empêche le partage d'un même abonnement entre plusieurs personnes.
    const isAdminAccount = userAccounts.get(fullPhone)?.isAdmin === true;
    if (!isAdminAccount) {
      let revoked = 0;
      for (const [oldToken, s] of sessions) {
        if (s.phone === fullPhone) {
          sessions.delete(oldToken);
          deleteSessionFromDb(oldToken).catch(() => {});
          revoked += 1;
        }
      }
      if (revoked > 0) {
        console.log(`[Session unique] ${revoked} session(s) precedente(s) deconnectee(s) pour ${fullPhone}.`);
      }
    }

    const token = createSession(fullPhone);
    logConnectionEvent(fullPhone);
    res.json({ success: true, message: "Connexion réussie.", sessionToken: token });
  });


  // API Route (ADMIN UNIQUEMENT) : vérifie un code d'accès admin sans jamais exposer le secret au client
  app.post("/api/admin/verify-code", adminLimiter, (req, res) => {
    const adminSecret = process.env.ADMIN_SECRET;
    const { code } = req.body;
    if (!adminSecret) {
      return res.status(503).json({ success: false, message: "Accès admin non configuré sur le serveur." });
    }
    if (!safeEqual(code, adminSecret)) {
      return res.status(401).json({ success: false, message: "Code invalide." });
    }
    res.json({ success: true });
  });


  // ---------------------------------------------------------------------------
  // DIAGNOSTIC AUTO-QUESTIONING LOOP ENDPOINTS (/api/diagnostic/loop)
  // ---------------------------------------------------------------------------

  const loopStateStore = new Map<string, any>();

  // BUG CORRIGÉ : ni les sessions de diagnostic (loopStateStore, qui peuvent contenir des photos/
  // vidéos en base64), ni les codes OTP en attente, ni les compteurs anti brute-force n'étaient
  // jamais purgés — fuite mémoire qui finit par ralentir puis planter le serveur en production.
  const LOOP_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2h d'inactivité
  setInterval(() => {
    const now = Date.now();
    for (const [id, state] of loopStateStore) {
      if (now - (state._lastActivity || 0) > LOOP_SESSION_MAX_AGE_MS) {
        loopStateStore.delete(id);
      }
    }
    for (const [phone, entry] of otpStorage) {
      if (now > entry.expiresAt) {
        otpStorage.delete(phone);
      }
    }
    for (const [phone, entry] of otpAttempts) {
      if (now - entry.windowStart > 60 * 60 * 1000) {
        otpAttempts.delete(phone);
      }
    }
    for (const [phone, times] of otpSendLog) {
      if (!times.some((t) => now - t < 60 * 60 * 1000)) otpSendLog.delete(phone);
    }
    for (const [email, rec] of passwordResetCodes) {
      if (now > rec.expiresAt) passwordResetCodes.delete(email);
    }
    for (const [key, entry] of loginAttempts) {
      if (now - entry.windowStart > 60 * 60 * 1000) loginAttempts.delete(key);
    }
  }, 15 * 60 * 1000); // toutes les 15 minutes


  const loopResponseSchema = {
    type: Type.OBJECT,
    properties: {
      hypotheses: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            cause: { type: Type.STRING },
            confiance: { type: Type.INTEGER },
            type: { type: Type.STRING },
            lien_avec_dtc: { type: Type.STRING },
          },
          required: ["cause", "confiance", "type", "lien_avec_dtc"],
        },
      },
      incoherence_detectee: { type: Type.STRING, nullable: true },
      phase: { type: Type.STRING },
      next_question: { type: Type.STRING },
      test_protocole: {
        type: Type.OBJECT,
        properties: {
          outil: { type: Type.STRING, nullable: true },
          emplacement_exact: { type: Type.STRING, nullable: true },
          etat_vehicule: { type: Type.STRING, nullable: true },
          etat_thermique: { type: Type.STRING, nullable: true },
          valeur_reference_normale: { type: Type.STRING, nullable: true },
          niveau_invasivite: { type: Type.STRING, nullable: true },
          alerte_securite: { type: Type.STRING, nullable: true },
        },
      },
      type_reponse_attendue: { type: Type.STRING },
      preuve_photo_demandee: { type: Type.BOOLEAN },
      scanner_action: {
        type: Type.OBJECT,
        properties: {
          necessaire: { type: Type.BOOLEAN },
          demande: { type: Type.STRING, nullable: true },
        },
      },
      stop: { type: Type.BOOLEAN },
    },
    required: [
      "hypotheses",
      "phase",
      "next_question",
      "type_reponse_attendue",
      "preuve_photo_demandee",
      "stop",
    ],
  };

  const LOOP_SYSTEM_INSTRUCTION = `Tu es le système de diagnostic automobile de DiagAssist. À chaque tour :

1. Analyse tout l'historique fourni (symptôme, codes DTC, véhicule, 
   preuves initiales groupées, preuves accumulées, réponses précédentes).
   Ne redemande JAMAIS un test déjà présent dans les preuves initiales 
   ou déjà rapporté.

2. Respecte l'ordre de priorité :
   PHASE 1 (obligatoire avant toute question technique) : ce qui a été 
   fait sur le véhicule juste avant ou autour de l'apparition du code 
   (entretien, pièce changée, manipulation, débranchement), et les 
   circonstances précises d'apparition. Ne jamais ouvrir par "depuis 
   quand" — cible l'action/l'événement déclencheur, pas la durée.
   PHASE 2 : questions techniques SOUS FORME DE TEST GUIDÉ PAS À PAS, 
   dans l'ordre du moins invasif au plus invasif (visuel → mesure 
   simple → lecture scanner → démontage). Chaque test précise : outil, 
   emplacement exact (broche/couleur de fil si schéma disponible via 
   hp-web.in), état du véhicule requis (contact ON/moteur tournant/
   moteur éteint, à froid/à chaud), valeur de référence normale 
   attendue, et demande une photo du résultat plutôt qu'une valeur 
   tapée quand c'est pertinent (écran multimètre, écran scanner). 
   Ajoute une alerte sécurité avant tout test sur circuit haute 
   pression carburant, haute tension, ou airbag. Une seule action de 
   test par question.
   PHASE VALIDATION : une fois la réparation indiquée comme faite, 
   suis EXACTEMENT cette séquence de vérification post-réparation : 
   effacer les défauts → redémarrer le véhicule → contrôler les 
   paramètres concernés → faire un essai (routier ou au ralenti selon 
   le cas) → relire les défauts. Si tout est normal et le symptôme 
   absent : ✅ Réparation validée, tu peux clore (stop=true). Si le 
   défaut ou le symptôme revient : ⚠️ Défaut toujours présent, rouvre 
   la boucle sur les hypothèses restantes au lieu de conclure.
   RÈGLE ACHAT PIÈCES DÉFECTUEUSES : Dès qu'une pièce est confirmée défectueuse 
   ou à remplacer, recommande systématiquement de nous contacter pour 
   l'achat de la pièce au 0707312797.

STATUTS DE CONFIRMATION (à utiliser dans hypotheses et next_question) :
   🟢 Panne confirmée — un test a apporté la preuve.
   🟠 Pièce suspecte — contrôles supplémentaires nécessaires avant de condamner.
   🔴 Pièce non responsable — écartée par un test, poursuivre le diagnostic sur une autre piste.
Ne fais JAMAIS passer une hypothèse à 🟢 sans qu'un test l'ait réellement démontré.

ARBRE DE DÉCISION INTELLIGENT (OBLIGATOIRE) : tu ne suis JAMAIS une procédure figée à l'avance.
Chaque résultat rapporté par le mécanicien change le chemin à suivre : une valeur normale 
mène à l'étape suivante prévue ; une valeur anormale déclenche une recherche de la cause 
en amont (alimentation, masse, câblage avant le composant lui-même) ; un résultat incohérent 
avec toutes les hypothèses actuelles déclenche un nouveau contrôle ou une nouvelle hypothèse, 
jamais une conclusion hâtive.

3. Règle anti-piège DTC : un code est un symptôme électrique détecté, 
   pas forcément la cause racine. Cherche toujours si le code peut 
   être une conséquence d'un problème amont. Signale toute incohérence 
   entre le symptôme décrit et la définition littérale du code.

4. Formule next_question en français oral simple, jargon mécanicien 
   Côte d'Ivoire (voir lexique ci-dessous), une seule idée par question, 
   en précisant toujours l'état moteur et l'état thermique si pertinent.

   LEXIQUE JARGON TERRAIN CÔTE D'IVOIRE (OBLIGATOIRE) :
   - Calculateur moteur (ECU) -> Boîte noire / cerveau de la voiture
   - Capteur position vilebrequin/came -> Le capteur qui donne l'info au moteur
   - Batterie auxiliaire -> La petite batterie / batterie de secours
   - Moteur tournant -> Moteur allumé / moteur en marche
   - Moteur éteint, contact mis -> Contact seulement / clé sur ON sans démarrer
   - À chaud -> Après roulage / moteur chaud
   - À froid -> Premier démarrage matin / à froid
   - Immobilisateur/EZS -> Le système anti-vol / le blocage démarrage
   - Faisceau électrique -> Le câblage / les fils
   - Ralenti instable -> Le moteur qui broute / qui tremble au ralenti
   - Calage moteur -> La voiture qui meurt / qui cale
   - Voyant Check Engine (MIL) -> Voyant check moteur

5. Si une mesure/lecture scanner est nécessaire et qu'aucun scanner 
   n'est identifié en session : demande le modèle, puis une photo si 
   besoin. Une fois identifié, utilise les informations pour donner le chemin 
   de menu exact et à jour.

6. Mets à jour les hypothèses avec un score de confiance (0-100). 
   Passe stop=true si confiance max ≥ 85% ET validation post-réparation 
   effectuée (ou hypothèse non actionnable actuellement), ou si 
   tour_actuel = tour_max, ou si tu allais reposer une question déjà 
   posée. Si le symptôme/code persiste après réparation, rouvre la 
   boucle sur les hypothèses restantes au lieu de conclure.

7. Réponds UNIQUEMENT en JSON selon le schéma fourni, aucun texte hors JSON.`;

  // Mode "propriétaire de véhicule" pour la boucle interactive : remplace les demandes de
  // mesures techniques (multimètre, valise, tests de continuité) par des demandes simples
  // adaptées à un conducteur non-mécanicien (photo, vidéo, son, description en mots simples).
  const LOOP_OWNER_MODE_INSTRUCTION = `

MODE PROPRIÉTAIRE DE VÉHICULE (OBLIGATOIRE — remplace toute demande technique) :
L'utilisateur est un CONDUCTEUR, pas un mécanicien. Il n'a ni multimètre, ni valise de
diagnostic, ni formation technique. Tu DOIS adapter chaque "next_question" à ce niveau :
- INTERDIT : demander une mesure (tension, résistance, continuité), un test avec un outil,
  un contrôle sous le capot nécessitant un démontage, ou la lecture d'une valise OBD.
- AUTORISÉ et à privilégier : demander une photo du voyant/de la zone concernée, une vidéo
  ou un enregistrement du bruit, ou une description simple ("le bruit arrive plutôt à
  l'accélération ou au freinage ?", "la fumée est blanche, noire ou bleue ?").
- Si une information ne peut raisonnablement être obtenue que par un professionnel équipé
  (mesure électrique, code défaut précis, démontage), N'ATTENDS PAS cette info : passe
  directement à la conclusion en recommandant de faire confirmer par un mécanicien agréé,
  plutôt que de bloquer la boucle sur une demande que l'utilisateur ne peut pas satisfaire.
- Le "explanationText" et "next_question" restent en langage simple, sans jargon technique.
- La priorité reste : niveau d'urgence (peut-il rouler ?) et orientation vers un professionnel
  équipé, jamais une tentative de réparation par l'utilisateur lui-même.`;

  // Start a new Diagnostic Loop (Tour 0)
  app.post("/api/diagnostic/loop/start", requireAuth, async (req: any, res) => {
    try {
      const { phone, plan } = req.session;
      const check = checkAndIncrementUsage(phone, plan);
      if (!check.allowed) {
        return res.status(403).json({ success: false, message: check.message });
      }

      const {
        vehicule,
        symptome,
        codesDtc,
        preuvesInitiales,
        file,
        mimeType,
        accountType, // "mechanic" (défaut) ou "owner" — adapte le niveau technique de la boucle
      } = req.body;

      const sessionId = `loop_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      const dtcArray = Array.isArray(codesDtc)
        ? codesDtc
        : (codesDtc ? String(codesDtc).split(/[\s,]+/).filter(Boolean) : []);

      const state = {
        session_id: sessionId,
        _lastActivity: Date.now(),
        _ownerPhone: phone, // Propriétaire de la session — vérifié sur les routes step/session pour empêcher qu'un autre utilisateur y accède (faille IDOR corrigée)
        _accountType: accountType === "owner" ? "owner" : "mechanic", // conservé pour tous les tours suivants
        vehicule: {
          marque: vehicule?.marque || "Inconnu",
          modele: vehicule?.modele || "",
          moteur: vehicule?.moteur || "",
          kilometrage: Number(vehicule?.kilometrage) || 0,
        },
        symptome_initial: symptome || "Dysfonctionnement mécanique / voyant allumé",
        codes_dtc: dtcArray,
        preuves_initiales: Array.isArray(preuvesInitiales) ? preuvesInitiales : [],
        preuves: [],
        hypotheses: [],
        incoherence_detectee: null,
        scanner: {
          identifie: null,
          methode_identification: null,
          recherches_effectuees: 0,
          recherches_max: 2,
        },
        phase_actuelle: "action_avant_dtc",
        questions_posees: [],
        tour_actuel: 0,
        tour_max: 6,
        stop: false,
      };

      const parts: any[] = [];
      if (file && mimeType) {
        parts.push({
          inlineData: { data: file, mimeType },
        });
      }

      let promptText = `Tour 0 (Initialisation de la boucle de diagnostic auto-questionnante) :
Véhicule : ${state.vehicule.marque} ${state.vehicule.modele} ${state.vehicule.moteur} (${state.vehicule.kilometrage} km)
Symptôme initial : "${state.symptome_initial}"
Codes DTC transmis : ${state.codes_dtc.length > 0 ? state.codes_dtc.join(", ") : "Aucun code DTC pour le moment"}
Preuves initiales apportées par le mécanicien : ${JSON.stringify(state.preuves_initiales)}

Instructions Tour 0 :
1. Intègre immédiatement toutes les preuves initiales (ne redemande JAMAIS une vérification déjà rapportée).
2. Ouvre la Phase 1 (Action avant DTC) : pose la première question prioritaire sur ce qui a été fait sur le véhicule juste avant ou autour de l'apparition du code/symptôme.
3. Propose les premières hypothèses avec leurs scores de confiance initiaux.`;

      parts.push({ text: promptText });

      const loopNameInstruction = getNameInstruction(phone);
      const geminiResult = await retryWithBackoff(async () => {
        return await getAIClient().models.generateContent({
          model: "gemini-3.5-flash",
          contents: parts,
          config: {
            systemInstruction: (state._accountType === "owner" ? LOOP_SYSTEM_INSTRUCTION + LOOP_OWNER_MODE_INSTRUCTION : LOOP_SYSTEM_INSTRUCTION) + loopNameInstruction,
            responseMimeType: "application/json",
            responseSchema: loopResponseSchema,
            temperature: 0.2,
          },
        });
      });

      const parsedResponse = JSON.parse(geminiResult.text);

      state.hypotheses = parsedResponse.hypotheses || [];
      state.incoherence_detectee = parsedResponse.incoherence_detectee || null;
      state.phase_actuelle = parsedResponse.phase || "action_avant_dtc";
      if (parsedResponse.next_question) {
        state.questions_posees.push(parsedResponse.next_question);
      }
      state.stop = Boolean(parsedResponse.stop);

      loopStateStore.set(sessionId, state);

      return res.json({
        success: true,
        sessionId,
        state,
        response: parsedResponse,
      });
    } catch (error: any) {
      console.error("Erreur lors de l'initialisation de la boucle de diagnostic:", error);
      res.status(500).json({ success: false, message: "Erreur serveur lors du diagnostic. Veuillez réessayer." });
    }
  });

  // Next Turn in Diagnostic Loop (Tour 1 to N)
  app.post("/api/diagnostic/loop/step", requireAuth, async (req: any, res) => {
    try {
      const {
        sessionId,
        userResponse,
        responseType,
        file,
        mimeType,
        isPostRepairConfirmed,
        scannerModel,
      } = req.body;

      if (!sessionId || !loopStateStore.has(sessionId)) {
        return res.status(404).json({ success: false, message: "Session de diagnostic introuvable ou expirée." });
      }

      const state = loopStateStore.get(sessionId);
      // Faille IDOR corrigée : vérifie que la session appartient bien à l'utilisateur authentifié
      // avant de la lire ou d'y ajouter des réponses.
      if (state._ownerPhone && state._ownerPhone !== req.session.phone) {
        return res.status(404).json({ success: false, message: "Session de diagnostic introuvable ou expirée." });
      }
      state._lastActivity = Date.now();

      // Increment turn
      state.tour_actuel += 1;

      // Update scanner if model provided directly
      if (scannerModel) {
        state.scanner.identifie = scannerModel;
        state.scanner.methode_identification = "nom";
      }

      // Add user proof
      const proofEntry = {
        tour: state.tour_actuel,
        type: responseType || "texte",
        contenu: userResponse || "Élément fourni par le mécanicien",
      };
      state.preuves.push(proofEntry);

      // Perform Google Search Grounding for scanner menu path if scanner identified and quota remains
      let groundedMenuPath: string | null = null;
      if (
        state.scanner.identifie &&
        state.scanner.recherches_effectuees < state.scanner.recherches_max
      ) {
        try {
          console.log(`[Scanner Grounding] Searching menu path for scanner: ${state.scanner.identifie}`);
          const searchQuery = `Comment accéder au menu lecture codes DTC et données en direct sur le scanner automobile ${state.scanner.identifie} pour un véhicule ${state.vehicule.marque}`;
          const searchResult = await getAIClient().models.generateContent({
            model: "gemini-3.5-flash",
            contents: searchQuery,
            config: {
              tools: [{ googleSearch: {} }],
            },
          });
          groundedMenuPath = searchResult.text || null;
          state.scanner.recherches_effectuees += 1;
        } catch (searchErr) {
          console.warn("[Scanner Grounding] Erreur de recherche:", searchErr);
        }
      }

      const parts: any[] = [];
      if (file && mimeType) {
        parts.push({
          inlineData: { data: file, mimeType },
        });
      }

      let promptText = `Tour ${state.tour_actuel} / ${state.tour_max} (Boucle de diagnostic auto-questionnante) :
État actuel de la session :
${JSON.stringify(state, null, 2)}

Nouvelle réponse / preuve transmise par le mécanicien au Tour ${state.tour_actuel} :
- Réponse texte / mesure : "${userResponse || 'Aucun texte'}"
- Type : ${responseType || 'texte'}
${file ? "- Un fichier image/audio a été joint." : ""}
${isPostRepairConfirmed ? "ATTENTION : Le mécanicien confirme avoir effectué la réparation ! Passe immédiatement en PHASE DE VALIDATION POST-RÉPARATION." : ""}
${groundedMenuPath ? `\nINFORMATIONS DE MENU SCANNER GROUNDED (recherche web) : "${groundedMenuPath}"` : ""}

Directives pour ce tour :
1. Réévalue toutes les hypothèses avec leur niveau de confiance (0-100%).
2. Si le mécanicien a soumis une photo de mesure (multimètre) ou d'écran scanner, analyse la valeur réelle affichée.
3. Ne repose JAMAIS une question déjà présente dans questions_posees : ${JSON.stringify(state.questions_posees)}.
4. Si la confiance max atteint >= 85% ET que la validation post-réparation est faite (ou si le problème persiste après réparation), conclus ou rouvre la boucle selon les règles.
5. Formule la question suivante en jargon mécanicien Côte d'Ivoire.`;

      parts.push({ text: promptText });

      const loopNameInstruction = getNameInstruction(req.session.phone);
      const geminiResult = await retryWithBackoff(async () => {
        return await getAIClient().models.generateContent({
          model: "gemini-3.5-flash",
          contents: parts,
          config: {
            systemInstruction: (state._accountType === "owner" ? LOOP_SYSTEM_INSTRUCTION + LOOP_OWNER_MODE_INSTRUCTION : LOOP_SYSTEM_INSTRUCTION) + loopNameInstruction,
            responseMimeType: "application/json",
            responseSchema: loopResponseSchema,
            temperature: 0.2,
          },
        });
      });

      const parsedResponse = JSON.parse(geminiResult.text);

      // Check for duplicate question loop detection
      if (
        parsedResponse.next_question &&
        state.questions_posees.includes(parsedResponse.next_question) &&
        parsedResponse.phase !== "conclusion"
      ) {
        console.warn("[Diagnostic Loop] Question déjà posée détectée ! Passage forcé en conclusion.");
        parsedResponse.stop = true;
        parsedResponse.phase = "conclusion";
      }

      // Check for max turn limit
      if (state.tour_actuel >= state.tour_max) {
        parsedResponse.stop = true;
        parsedResponse.phase = "conclusion";
      }

      state.hypotheses = parsedResponse.hypotheses || state.hypotheses;
      state.incoherence_detectee = parsedResponse.incoherence_detectee || null;
      state.phase_actuelle = parsedResponse.phase || state.phase_actuelle;
      state.stop = Boolean(parsedResponse.stop);

      if (parsedResponse.next_question) {
        state.questions_posees.push(parsedResponse.next_question);
      }

      if (groundedMenuPath) {
        parsedResponse.groundedMenuPath = groundedMenuPath;
      }

      loopStateStore.set(sessionId, state);

      return res.json({
        success: true,
        state,
        response: parsedResponse,
      });
    } catch (error: any) {
      console.error("Erreur étape boucle diagnostic:", error);
      res.status(500).json({ success: false, message: "Erreur serveur lors de la boucle de diagnostic. Veuillez réessayer." });
    }
  });

  // Get current diagnostic loop state
  app.get("/api/diagnostic/loop/session/:id", requireAuth, (req: any, res) => {
    const sessionId = req.params.id;
    if (!sessionId || !loopStateStore.has(sessionId)) {
      return res.status(404).json({ success: false, message: "Session introuvable." });
    }
    const state = loopStateStore.get(sessionId);
    // Faille IDOR corrigée : idem, un utilisateur ne peut lire que ses propres sessions.
    if (state._ownerPhone && state._ownerPhone !== req.session.phone) {
      return res.status(404).json({ success: false, message: "Session introuvable." });
    }
    return res.json({ success: true, state });
  });




  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // DiagAssist V2 — Screening / Coaching module. Uses the existing authenticated session store.
  // scannerResultsByPhone lets the live voice agent read scanner autopilot results.
  const scannerResultsByPhone = new Map<string, ScannerResult>();
  const scannerMapSet = scannerResultsByPhone.set.bind(scannerResultsByPhone);
  scannerResultsByPhone.set = (phone: string, r: ScannerResult) => {
    persistScannerResult(phone, r).catch(() => {});
    return scannerMapSet(phone, r);
  };
  registerScreening(app, server, {
    requireAuth,
    getEffectivePlan,
    sessions,
    dbQuery: dbPool ? (sql: string, params?: any[]) => dbPool!.query(sql, params) : undefined,
    scannerResults: scannerResultsByPhone,
  });

  // Paiements d'abonnement automatisés (Orange/Wave/MTN/Moov via Jèko) : à la confirmation par
  // webhook, active le forfait exactement comme le fait l'admin manuellement aujourd'hui.
  registerJekoPayments(app, {
    requireAuth,
    requireAdminAuth,
    setUserPlan,
    onPlanActivated: (phone: string, plan: string) => {
      usageTracking.set(phone, { diagnosisCount: 0, periodStart: Date.now() });
      for (const [, session] of sessions) {
        if (session.phone === phone) session.plan = plan;
      }
    },
    dbQuery: dbPool ? (sql: string, params?: any[]) => dbPool!.query(sql, params) : undefined,
  });

  // HP-Web : recherche métier côté serveur, jamais depuis le navigateur.
  registerHpWebRoutes(app, requireAuth);

  // Gestionnaire d'erreurs final : réponse JSON propre, sans fuite de détails internes.
  app.use("/api", (err: any, req: any, res: any, next: any) => {
    if (res.headersSent) return next(err);
    console.error(`[Erreur ${req.method} ${req.path}]`, err?.message || err);
    if (err?.type === "entity.too.large") return res.status(413).json({ success: false, message: "Requête trop volumineuse." });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ success: false, message: "Corps de requête invalide." });
    res.status(500).json({ success: false, message: "Erreur serveur." });
  });

  // Vite integration — DOIT être enregistré en dernier : app.get("*", ...) intercepte sinon
  // toute requête GET (y compris les routes API ci-dessus enregistrées après lui), qui reçoit
  // alors la page HTML de l'app au lieu du JSON attendu (bug réel trouvé en testant
  // /api/payments/jeko/status/:reference, qui renvoyait index.html).
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // --- Garde-fous du Live (coût IA) ---
  // Durée max d'une session, sessions simultanées par profil et temps cumulé par jour et par forfait.
  const LIVE_MODEL = (process.env.LIVE_MODEL || "gemini-3.1-flash-live-preview").trim();
  const LIVE_VOICE = (process.env.LIVE_VOICE || "Puck").trim();
  const LIVE_MAX_SESSION_MS = (Number(process.env.LIVE_MAX_SESSION_MIN) || 20) * 60 * 1000;
  const LIVE_MAX_CONCURRENT = Number(process.env.LIVE_MAX_CONCURRENT) || 2;
  const LIVE_DAILY_MS: Record<string, number> = {
    free_trial: 10 * 60 * 1000,
    owner_week: 60 * 60 * 1000,
    lite: 120 * 60 * 1000,
    payg_active: 480 * 60 * 1000,
    premium: 480 * 60 * 1000,
  };
  const liveUsage = new Map<string, { day: string; usedMs: number }>();
  const liveConnections = new Map<string, Set<any>>();
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const getLiveUsedMs = (phone: string) => {
    const u = liveUsage.get(phone);
    return u && u.day === todayKey() ? u.usedMs : 0;
  };
  const addLiveUsage = (phone: string, ms: number) => {
    if (!phone || ms <= 0) return;
    const entry = { day: todayKey(), usedMs: getLiveUsedMs(phone) + ms };
    liveUsage.set(phone, entry);
    dbPool?.query(
      `INSERT INTO live_usage (phone, day, used_ms) VALUES ($1,$2,$3)
       ON CONFLICT (phone) DO UPDATE SET day = $2, used_ms = $3`,
      [phone, entry.day, entry.usedMs]
    ).catch((err: any) => console.error("[DB] Sauvegarde du temps Live échouée:", err.message));
  };
  if (dbPool) {
    try {
      const r = await dbPool.query("SELECT phone, day, used_ms FROM live_usage WHERE day = $1", [todayKey()]);
      for (const row of r.rows) liveUsage.set(row.phone, { day: row.day, usedMs: Number(row.used_ms) });
    } catch (err: any) { console.error("[DB] Chargement du temps Live échoué:", err.message); }
  }

  // Ouvre la session Gemini Live ; si la clé échoue (quota, clé invalide) et qu'une autre clé existe,
  // on tourne sur la clé suivante avant de renoncer.
  async function connectLiveWithRotation(params: any): Promise<any> {
    const attempts = Math.max(1, getGeminiKeys().length);
    let lastErr: any;
    for (let i = 0; i < attempts; i++) {
      const keyForTry = currentGeminiKey();
      try {
        const session = await getAIClient().live.connect(params);
        recordGeminiResult(keyForTry, { ok: true });
        return session;
      } catch (err: any) {
        lastErr = err;
        recordGeminiResult(keyForTry, { ok: false, quota: isGeminiQuotaError(err), error: err?.message || String(err) });
        if (i < attempts - 1 && rotateGeminiKey()) continue;
        break;
      }
    }
    throw lastErr;
  }

  // Create standard WebSocketServer for low-latency live audio streaming
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8 * 1024 * 1024,
    // Le token de session voyage dans le sous-protocole "auth.<token>" (plutôt que dans l'URL).
    handleProtocols: (protocols: Set<string>) => {
      for (const p of protocols) if (p.startsWith("auth.")) return p;
      return false;
    },
  });

  server.on("upgrade", (request, socket, head) => {
    const { pathname, searchParams } = new URL(request.url || "", `http://${request.headers.host}`);
    if (pathname === "/api/live-ws") {
      // FAILLE CORRIGÉE : ce endpoint WebSocket (assistant vocal live via Gemini) n'exigeait
      // aucune authentification — n'importe qui pouvait s'y connecter directement et consommer
      // l'API Gemini à volonté, sans compte, sans forfait, sans limite, aux frais de l'opérateur.
      const protoToken = String(request.headers["sec-websocket-protocol"] || "")
        .split(",").map((x) => x.trim()).find((x) => x.startsWith("auth."))?.slice(5);
      const token = protoToken || searchParams.get("token") || "";
      const session = sessions.get(token);
      if (!token || !session) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const effectivePlan = getEffectivePlan(session.phone);
      if ((PLAN_LIMITS[effectivePlan] ?? 0) <= 0) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      const dailyCap = LIVE_DAILY_MS[effectivePlan] ?? 0;
      if (getLiveUsedMs(session.phone) >= dailyCap) {
        socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        (ws as any)._authPhone = session.phone;
        (ws as any)._plan = effectivePlan;
        wss.emit("connection", ws, request);
      });
    } else {
      // Allow other upgrades like Vite HMR to pass unimpeded
    }
  });

  wss.on("connection", (clientWs) => {
    console.log("[WebSocket] Client connected to real-time voice bridge.");
    const connPhone: string = (clientWs as any)._authPhone || "";
    const connPlan: string = (clientWs as any)._plan || "";
    const connStartedAt = Date.now();
    let startInProgress = false;
    let resumeHandle: string | undefined;
    let liveGen = 0;
    let reconnects = 0;
    let usageCounted = false;

    // Sessions simultanées : au-delà de la limite, on ferme la plus ancienne.
    const mySet = liveConnections.get(connPhone) || new Set<any>();
    liveConnections.set(connPhone, mySet);
    mySet.add(clientWs);
    if (mySet.size > LIVE_MAX_CONCURRENT) {
      const oldest = mySet.values().next().value;
      if (oldest && oldest !== clientWs) {
        try { oldest.send(JSON.stringify({ type: "limit", message: "Session fermée : appel ouvert sur un autre appareil." })); oldest.close(4009, "concurrent"); } catch {}
        mySet.delete(oldest);
      }
    }

    // Durée max = min(durée d'une session, budget quotidien restant).
    const remainingBudget = Math.max(0, (LIVE_DAILY_MS[connPlan] ?? 0) - getLiveUsedMs(connPhone));
    const limitTimer = setTimeout(() => {
      try { clientWs.send(JSON.stringify({ type: "limit", message: "Durée maximale de l'appel atteinte pour aujourd'hui ou pour cette session." })); clientWs.close(4008, "limit"); } catch {}
    }, Math.min(LIVE_MAX_SESSION_MS, remainingBudget));

    // Ping/pong : détecte les connexions mortes (proxy, réseau mobile).
    let isAlive = true;
    clientWs.on("pong", () => { isAlive = true; });
    // Sans listener, une erreur WebSocket (ex : message trop gros avec maxPayload) ferait planter le process.
    clientWs.on("error", (err) => console.warn("[WebSocket] Erreur client:", err.message));
    const heartbeat = setInterval(() => {
      if (!isAlive) { try { clientWs.terminate(); } catch {} return; }
      isAlive = false;
      try { clientWs.ping(); } catch {}
    }, 25000);

    let geminiSession: any = null;
    let deepSeekFallbackActive = false;
    let deepSeekFallbackSystemInstruction = "";
    // Mémoire courte du mode de secours (texte uniquement, 10 derniers messages) : sans elle
    // chaque réponse DeepSeek repartait de zéro.
    const deepSeekHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    const deepSeekReply = async (userContent: string | any[], historyLabel: string) => {
      const fallback = await callDeepSeekFallback(userContent, {
        // Le mode secours ne suit pas toujours les règles vocales : on les répète en dernier, là où elles pèsent le plus.
        systemInstruction: deepSeekFallbackSystemInstruction + `

RAPPEL FINAL (MODE VOCAL, NON NÉGOCIABLE) : deux phrases maximum. Jamais de "Bonjour", de "Je comprends" ni de compliment sur l'outil du mécanicien. Ne cite jamais un code défaut que le mécanicien n'a pas donné : si tu n'en as pas, demande "Code défaut ?". Une seule question à la fois.`,
        history: deepSeekHistory.slice(-10),
      });
      deepSeekHistory.push({ role: "user", content: historyLabel });
      deepSeekHistory.push({ role: "assistant", content: fallback.text });
      return fallback;
    };
    let isClosed = false;
    const liveAgentSessionId = crypto.randomBytes(12).toString("hex");
    let liveAgentState: LiveAgentState | null = null;

    clientWs.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === "start") {
          if (startInProgress || geminiSession || deepSeekFallbackActive) return; // un seul start par connexion
          startInProgress = true;
          console.log("[WebSocket] Starting Gemini Live Session with context...");
          const diagnosticContext = String(message.diagnosticContext || "").slice(0, 4000);
          const incomingResume = typeof message.resumeHandle === "string" && message.resumeHandle.length <= 512 ? message.resumeHandle : undefined;
          if (incomingResume) resumeHandle = incomingResume;
          const livePhone = (clientWs as any)._authPhone || "";
          liveAgentState = await resumeLiveAgentState(livePhone, liveAgentSessionId, diagnosticContext);
          await saveLiveAgentState(livePhone, liveAgentState);
          clientWs.send(JSON.stringify({ type: "agentState", sessionId: liveAgentSessionId, phase: liveAgentState.phase, resumed: liveAgentState.tour > 0 }));
          const liveNameInstruction = getNameInstruction((clientWs as any)._authPhone);
          const authPhoneForHistory = (clientWs as any)._authPhone;
          const recentHistory = authPhoneForHistory ? await liveGetRecentDiagnostics(authPhoneForHistory, 3) : "";
          const lastScan = authPhoneForHistory ? await getLatestScannerResult(authPhoneForHistory, scannerResultsByPhone, 30 * 24 * 60 * 60 * 1000) : undefined;
          const lastScanSection = lastScan
            ? `\nDERNIER SCAN DU PROFIL (${new Date(lastScan.completedAt).toLocaleDateString("fr-FR")}) : ${lastScan.summary}. Codes DTC : ${lastScan.dtcs.length > 0 ? lastScan.dtcs.join(", ") : "aucun"}.\nSi le mécanicien parle du même véhicule ou d'un scan précédent, appuie-toi dessus sans le lui faire répéter.`
            : "";
          const historySection = recentHistory
            ? `\nHISTORIQUE DES APPELS PRÉCÉDENTS DE CE CLIENT :\n${recentHistory}\nUtilise cet historique pour personnaliser le suivi (ex: "Lors de votre dernier appel, vous aviez un problème de capteur PMH sur votre Toyota..."). Si le véhicule actuel correspond à un appel précédent, signale-le discrètement.`
            : "";
          const systemInstruction = `Tu es DiagAssist, un technicien automobile expérimenté qui accompagne un mécanicien ou un particulier étape par étape dans un diagnostic réel, avec des outils simples et accessibles en Afrique francophone (Côte d'Ivoire / Abidjan). Tu ne réponds jamais comme un dictionnaire de codes défauts. Tu mènes une enquête.
${liveNameInstruction}
RÈGLE D'IDENTITÉ & NOM :
- Ton nom est DiagAssist. Si on te demande qui tu es, réponds : "Je suis DiagAssist, à votre écoute."
- Prononciation : dis toujours "Diag Assist" (deux syllabes brèves "Diag" puis "Assist"), jamais "diagnostic".

MODULE PUBLICITAIRE VOCAL & DEUX IDENTITÉS VOCALES (RÈGLE STRICTE) :
1. VOIX DE DIAGNOSTIC (Par défaut) :
   - Ton : Calme, technique, pédagogique, rassurant, professionnel.
   - Utilisée pour : l'accueil, les questions, l'analyse DTC, l'explication des pannes, le guidage des tests, l'analyse des photos et le rapport.
2. VOIX PUBLICITAIRE (Annonces commerciales) :
   - Ton : Commercial, dynamique, professionnel, premium, confiant et court.
   - Lorsque tu reçois une instruction publicitaire vocale [INSTRUCTION VOCALE PUBLICITAIRE], adopte immédiatement ce style vocal publicitaire dynamique pour prononcer l'offre (ex: scanner sans tablette à partir de 80 000 FCFA ou scanner avec tablette à partir de 100 000 FCFA).
   - Dès l'annonce terminée, bascule à nouveau immédiatement vers ta voix de diagnostic calme et technique.
   - Ne réinitialise jamais le contexte du diagnostic (véhicule, VIN, DTC, symptômes, photos).

COURTOISIE ET TON OBLIGATOIRES EN LIVE VOCAL :
- Salue l'utilisateur UNE SEULE FOIS au début de l'échange : "Je suis DiagAssist, à votre écoute."
- Tu vouvoies TOUJOURS l'utilisateur avec respect et calme.
- Aucune politesse superflue : pas de "Je comprends", pas de "Comment puis-je vous aider ?". Entre directement dans l'action.
- Réponses courtes (2 phrases max) : diagnostic rapide, puis action physique immédiate.
- Silence actif : si le mécanicien ne pose pas de question, ne dis rien et laisse-le travailler.
- Donnée manquante : demande uniquement "Code défaut ?" ou "Symptôme exact ?".
- Ne conclus JAMAIS par une formule de politesse ("N'hésitez pas", "Au revoir", "Avez-vous besoin d'autre chose ?") : après un "non" du mécanicien, reste silencieux.
- N'affirme jamais qu'une pièce, une fiche ou une page est affichée à l'écran si l'outil ne l'a pas confirmé.

RÈGLE D'OR (NON NÉGOCIABLE) :
NE JAMAIS SAUTER DIRECTEMENT D'UN CODE DÉFAUT OU D'UN SYMPTÔME À UNE PIÈCE À REMPLACER.
Séquence obligatoire (méthodologie de diagnostic professionnelle) : historique → vérification du symptôme →
inspection visuelle → outils disponibles → codes et données figées → hiérarchisation → prérequis → test guidé →
résultat → nouvelle étape → confirmation de la cause → réparation → vérification post-réparation → diagnostic final.

ÉTAPES CLÉS DE TON ENQUÊTE :
- Règle Pièces Défectueuses : Dès qu'une pièce est identifiée comme défectueuse ou à changer, recommande systématiquement au mécanicien de nous contacter pour l'achat de la pièce au 0707312797.
- Étape 1 (Historique) : Demande si le véhicule a fait l'objet d'une intervention récente (batterie, pièce, fils, nettoyage).
- Étape 2 (Vérification du symptôme) : Confirme qu'il est reproductible et dans quelles conditions (froid/chaud, vitesse, charge) avant d'aller plus loin.
- Étape 3 (Inspection visuelle) : Avant tout test électronique, fais vérifier rapidement fusibles, connecteurs, fuites visibles, niveaux — gratuit et souvent suffisant.
- Sécurité hybride/électrique (avant l'étape 3, si applicable) : si le véhicule est hybride/électrique ou si sa motorisation n'est pas connue, demande d'abord le modèle exact avant toute inspection — les procédures haute tension varient par modèle. Une fois confirmé : avertis qu'il faut consigner le circuit haute tension et porter l'équipement isolant avant tout contact avec les câbles orange. Ne s'applique pas à un véhicule thermique classique.
- Affichage des pièces : quand tu vérifies une pièce avec verifier_disponibilite_piece, une carte (photo, prix, disponibilité) s'affiche à l'écran du mécanicien. Dis-le en une courte phrase ("je vous affiche la pièce à l'écran").
- Étape 4 (Outils) : Privilégie la lampe témoin 12V, le compressiomètre, la jauge carburant, le stéthoscope tournevis.
  Si un outil manque, intègre UNE SEULE FOIS l'invitation d'achat structurée : "Vous n'avez pas de [nom de l'outil] sous la main. Cet outil est précieux ici car il va nous permettre de [rappel très bref de ce que ce test va révéler]. Si vous souhaitez vous en procurer un rapidement, nous pouvons vous le fournir : il vous suffit de contacter le 0707312797. Sinon, dites-le-moi et je verrai avec vous s'il existe une autre façon de procéder."
- Étape 5 (Codes et données figées) : Si un code est donné, demande aussi les données figées (régime, température, vitesse au moment du code) si la valise les affiche.
- Étape 6 (Test unique) : Propose UN SEUL TEST à la fois avec sa justification et la façon simple de le réaliser.
- Étape 8 (Vérification post-réparation, OBLIGATOIRE) : Après réparation, ne clôture jamais sans confirmer par un essai que le symptôme initial ne revient pas et qu'aucun nouveau code n'apparaît.

RECENTRAGE SI L'ÉCHANGE SORT DU CADRE :
Si la conversation dérive vers du hors-sujet (rien à voir avec un problème mécanique concret) ou tourne en rond
sans apporter d'élément utile depuis un moment, recentre en UNE phrase courte : "Pour avancer, faites un scan
avec votre valise ou DiagAssist Scanner, et revenez me donner le résultat — je reprends avec vous." N'insiste pas
si l'utilisateur revient ensuite sur le sujet.

CERTITUDE DES RÉPONSES : distingue toujours à l'oral ce qui est confirmé de ce qui est une estimation ("c'est
confirmé" vs "c'est probable mais pas certain"). Pour un décodage VIN, précise que ce n'est pas garanti à 100%
sans base constructeur officielle, et invite à vérifier sur la carte grise.

FICHE TECHNIQUE ET DIAGNOSTIC ACTUEL DU VÉHICULE :
${diagnosticContext}
${historySection}${lastScanSection}
ENREGISTREMENT DU DIAGNOSTIC (OBLIGATOIRE) : dès qu'un diagnostic clair se dégage (cause probable
identifiée et action recommandée établie), appelle l'outil enregistrer_diagnostic UNE SEULE FOIS pour
le sauvegarder. Ça prépare un lien WhatsApp prérempli avec le récapitulatif, affiché au mécanicien
pour qu'il l'envoie lui-même au client en un tap — dis-le à l'oral juste avant ("je vous prépare le
récapitulatif, vous pourrez l'envoyer par WhatsApp en un clic"). Ne le fais pas pour une simple
question technique ponctuelle sans diagnostic global établi.

FORMATAGE VOCAL STRICT : Ne génère AUCUN caractère markdown (pas d'astérisques, pas de hashtags, pas de puces). Rédige uniquement de simples phrases fluides et naturelles.`;

          deepSeekFallbackSystemInstruction = systemInstruction;
          try {
            const buildLiveConnect = (resumeFrom?: string) => {
              const gen = ++liveGen;
              return {
              model: LIVE_MODEL,
              config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE } }, // 'Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'
                },
                systemInstruction: systemInstruction,
                // Reprise de session + compression du contexte : les appels longs ne coupent plus net.
                sessionResumption: resumeFrom ? { handle: resumeFrom } : {},
                contextWindowCompression: { slidingWindow: {} },
                tools: [{ functionDeclarations: LIVE_AGENT_TOOL_DECLARATIONS }],
                outputAudioTranscription: {},
                inputAudioTranscription: {},
                // AMÉLIORATION : détection de voix (VAD) plus sensible et plus rapide, pour que
                // l'IA s'interrompe dès que le mécanicien parle, au lieu de terminer sa phrase
                // (symptôme rapporté : "elle continue de parler comme si de rien" quand on parle
                // par-dessus). Sensibilité haute + fenêtres courtes = réaction plus vive, y compris
                // en environnement bruyant d'atelier.
                realtimeInputConfig: {
                  automaticActivityDetection: {
                    disabled: false,
                    // Atelier bruyant : un départ de parole trop sensible faisait couper la voix de l'IA
                    // sur de simples bruits. On garde une fin de parole rapide mais un départ moins nerveux.
                    startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
                    endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
                    prefixPaddingMs: 100,
                    silenceDurationMs: 500,
                  },
                },
              },
              callbacks: {
                onmessage: (msg: any) => {
                  if (isClosed || gen !== liveGen) return;

                  // Reprise de session : mémorise le dernier handle et prépare une reconnexion sur goAway.
                  const upd = msg.sessionResumptionUpdate;
                  if (upd?.resumable && typeof upd.newHandle === "string") {
                    resumeHandle = upd.newHandle;
                    try { clientWs.send(JSON.stringify({ type: "resumeHandle", handle: upd.newHandle })); } catch {}
                  }
                  if (msg.goAway) {
                    reconnectGemini("goAway");
                  }

                  // Handle Model Output Turn (audio & transcription)
                  const modelParts = msg.serverContent?.modelTurn?.parts;
                  if (modelParts && Array.isArray(modelParts)) {
                    for (const part of modelParts) {
                      const audio = part.inlineData?.data;
                      if (audio) {
                        // Contre-pression : si le client est en retard (réseau lent), on jette l'audio
                        // au lieu d'accumuler de la mémoire.
                        if (clientWs.bufferedAmount < 1_000_000) {
                          clientWs.send(JSON.stringify({ type: "audio", audio }));
                        }
                      }
                      const text = part.text;
                      if (text) {
                        clientWs.send(JSON.stringify({ type: "text", text }));
                      }
                    }
                  }

                  // Handle User Input Turn (transcription of user speech)
                  const userParts = msg.serverContent?.userTurn?.parts;
                  if (userParts && Array.isArray(userParts)) {
                    for (const part of userParts) {
                      const text = part.text;
                      if (text) {
                        clientWs.send(JSON.stringify({ type: "userTranscript", text }));
                      }
                    }
                  }

                  // Transcriptions audio (activées dans la config) : c'est par là que passe le texte de
                  // la conversation avec le modèle audio natif — sans ça, l'écran Live reste vide.
                  const outTranscript = msg.serverContent?.outputTranscription?.text;
                  if (outTranscript) clientWs.send(JSON.stringify({ type: "outputTranscript", text: outTranscript }));
                  const inTranscript = msg.serverContent?.inputTranscription?.text;
                  if (inTranscript) clientWs.send(JSON.stringify({ type: "inputTranscript", text: inTranscript }));

                  // Handle Interruption
                  if (msg.serverContent?.interrupted) {
                    clientWs.send(JSON.stringify({ type: "interrupted" }));
                  }

                  // Handle Turn Complete (end of AI output turn)
                  if (msg.serverContent?.turnComplete) {
                    clientWs.send(JSON.stringify({ type: "turnComplete" }));
                  }

                  // Handle Tool Calls (function calling) : exécute les outils en lecture seule
                  // déclarés dans LIVE_AGENT_TOOL_DECLARATIONS et renvoie le résultat au modèle.
                  const functionCalls = msg.toolCall?.functionCalls;
                  if (Array.isArray(functionCalls) && functionCalls.length > 0) {
                    (async () => {
                      const functionResponses = await Promise.all(
                        functionCalls.map(async (fc: any) => {
                          clientWs.send(JSON.stringify({ type: "toolCall", name: fc.name }));
                          let result: string;
                          try {
                            if (fc.name === "piloter_diagnostic") {
                              if (!liveAgentState) liveAgentState = createLiveAgentState(liveAgentSessionId, diagnosticContext);
                              result = pilotLiveDiagnostic(fc.args || {}, liveAgentState);
                              await saveLiveAgentState((clientWs as any)._authPhone || "", liveAgentState);
                              clientWs.send(JSON.stringify({ type: "agentState", state: JSON.parse(result) }));
                            } else if (fc.name === "consulter_guide_scanner") {
                              result = liveToolGetScannerGuide(String(fc.args?.scanner || ""));
                            } else if (fc.name === "rechercher_fiche_technique") {
                              result = await liveToolSearchTechnicalInfo(String(fc.args?.requete || ""));
                            } else if (fc.name === "rechercher_vehicule_hpweb") {
                              const results = await searchHpWeb({
                                vin: fc.args?.vin ? String(fc.args.vin) : undefined,
                                make: fc.args?.marque ? String(fc.args.marque) : undefined,
                                model: fc.args?.modele ? String(fc.args.modele) : undefined,
                                year: fc.args?.annee ? String(fc.args.annee) : undefined,
                                engine: fc.args?.moteur ? String(fc.args.moteur) : undefined,
                                q: fc.args?.q ? String(fc.args.q) : undefined,
                              });
                              if (results.length === 1 && liveAgentState) {
                                const v = results[0];
                                liveAgentState.vehicle = [v.make, v.model, v.year, v.engine].filter(Boolean).join(" ");
                                liveAgentState.evidence.push("Identification HP-Web : " + JSON.stringify(v));
                                await saveLiveAgentState((clientWs as any)._authPhone || "", liveAgentState);
                                clientWs.send(JSON.stringify({ type: "agentState", state: liveAgentState }));
                              }
                              result = JSON.stringify({ source: "HP-Web", count: results.length, results });
                            } else if (typeof fc.name === "string" && fc.name.startsWith("hpweb_")) {
                              const navSpec: Record<string, [ "open" | "click" | "type" | "select" | "back", Record<string, unknown> ]> = {
                                hpweb_page: ["open", {}],
                                hpweb_cliquer: ["click", { ref: Number(fc.args?.ref) }],
                                hpweb_saisir: ["type", { ref: Number(fc.args?.ref), text: String(fc.args?.texte || ""), submit: fc.args?.valider !== false }],
                                hpweb_choisir: ["select", { ref: Number(fc.args?.ref), label: String(fc.args?.libelle || "") }],
                                hpweb_retour: ["back", {}],
                              };
                              const spec = navSpec[fc.name as string];
                              if (!spec) throw new Error("Outil HP-Web inconnu : " + fc.name);
                              const page = (clientWs as any)._hpExt
                                ? await hpWebNavViaClient(clientWs, spec[0], spec[1])
                                : await hpWebNav(spec[0], spec[1]);
                              if (page.loginRequired) {
                                result = "HP-Web demande une connexion. Dis au mécanicien de se connecter lui-même à HP-Web dans l'onglet ouvert, sans jamais lui demander son mot de passe, puis relis la page.";
                                clientWs.send(JSON.stringify({ type: "hpwebStep", tool: fc.name, url: page.url, title: page.title, loginRequired: true }));
                              } else {
                                // Le panneau d'étapes de l'app suit la navigation en direct.
                                clientWs.send(JSON.stringify({ type: "hpwebStep", tool: fc.name, url: page.url, title: page.title }));
                                result = formatHpWebPage(page);
                              }
                            } else if (fc.name === "verifier_base_vehicules") {
                              result = await liveToolCheckVehicleDatabase(String(fc.args?.marque || ""), fc.args?.modele ? String(fc.args.modele) : undefined);
                            } else if (fc.name === "chercher_mecanicien_pres") {
                              const t = fc.args?.type;
                              result = liveToolFindMechanic(String(fc.args?.ville || ""), t === "mechanic" || t === "parts_vendor" ? t : undefined);
                            } else if (fc.name === "verifier_disponibilite_piece") {
                              const partPhone = (clientWs as any)._authPhone;
                              const partVehicule = liveAgentState?.vehicle || undefined;
                              const partResult = await liveToolCheckPartAvailability(String(fc.args?.piece || ""), partPhone, partVehicule);
                              result = partResult.text;
                              if (partResult.cards && partResult.cards.length > 0) {
                                clientWs.send(JSON.stringify({ type: "partCards", cards: partResult.cards }));
                              }
                              if (partResult.orderRequestCreated && partResult.waConfirmUrl) {
                                clientWs.send(JSON.stringify({ type: "orderRequestCreated", url: partResult.waConfirmUrl }));
                              }
                            } else if (fc.name === "rechercher_code_obd") {
                              result = liveToolLookupOBDCode(String(fc.args?.code || ""));
                            } else if (fc.name === "commander_piece") {
                              const orderPhone = (clientWs as any)._authPhone || "";
                              const waUrl = liveToolOrderPart(
                                String(fc.args?.piece || ""),
                                fc.args?.prix_fcfa ? Number(fc.args.prix_fcfa) : null,
                                String(fc.args?.vehicule || ""),
                                orderPhone
                              );
                              clientWs.send(JSON.stringify({ type: "orderLink", url: waUrl }));
                              result = `Lien de commande généré. Le mécanicien peut maintenant contacter la boutique DiagAssist pour commander : ${fc.args?.piece}${fc.args?.prix_fcfa ? ` au prix de ${fc.args.prix_fcfa} F CFA` : ""}.`;
                            } else if (fc.name === "consulter_historique_diagnostic") {
                              const histPhone = (clientWs as any)._authPhone;
                              if (!histPhone) {
                                result = "Impossible de consulter l'historique : numéro du client introuvable.";
                              } else {
                                const lim = Math.min(5, Math.max(1, Number(fc.args?.limite) || 3));
                                const hist = await liveGetRecentDiagnostics(histPhone, lim);
                                result = hist || "Aucun diagnostic précédent enregistré pour ce client.";
                              }
                            } else if (fc.name === "obtenir_procedure_reparation") {
                              result = liveToolGetRepairProcedure(String(fc.args?.panne || ""), fc.args?.marque ? String(fc.args.marque) : undefined);
                            } else if (fc.name === "lire_resultats_scanner") {
                              const scanPhone = (clientWs as any)._authPhone;
                              const scanRes = scanPhone ? await getLatestScannerResult(scanPhone, scannerResultsByPhone, 30 * 24 * 60 * 60 * 1000) : undefined;
                              if (scanRes) {
                                const ageMin = Math.round((Date.now() - scanRes.completedAt) / 60000);
                                const age = ageMin < 120 ? `il y a ${ageMin} min` : ageMin < 2880 ? `il y a ${Math.round(ageMin / 60)} h` : `il y a ${Math.round(ageMin / 1440)} jours`;
                                result = `Résultats scanner (${age}) : ${scanRes.summary}. Codes DTC : ${scanRes.dtcs.length > 0 ? scanRes.dtcs.join(", ") : "aucun code détecté"}.`;
                              } else {
                                result = "Aucun résultat de scanner récent. Le mécanicien doit d'abord lancer le Scanner DiagAssist et utiliser l'Autopilot sur sa tablette.";
                              }
                            } else if (fc.name === "enregistrer_diagnostic") {
                              const authPhone = (clientWs as any)._authPhone;
                              if (!authPhone) {
                                result = "Impossible d'enregistrer le diagnostic : numéro du client introuvable.";
                              } else {
                                const saved = await liveToolSaveDiagnostic(
                                  authPhone,
                                  String(fc.args?.vehicule || ""),
                                  String(fc.args?.symptome || ""),
                                  String(fc.args?.cause_probable || ""),
                                  String(fc.args?.action_recommandee || "")
                                );
                                result = saved.toolResult;
                                clientWs.send(JSON.stringify({ type: "whatsappLink", url: saved.whatsappUrl }));
                              }
                            } else {
                              result = `Outil "${fc.name}" inconnu.`;
                            }
                          } catch (err) {
                            console.error(`[Live Tool] Erreur lors de l'exécution de ${fc.name}:`, err);
                            result = "Une erreur est survenue lors de l'exécution de cet outil.";
                          }
                          return { id: fc.id, name: fc.name, response: { result } };
                        })
                      );
                      if (!isClosed && geminiSession) {
                        geminiSession.sendToolResponse({ functionResponses });
                      }
                    })();
                  }
                },
                onclose: () => {
                  if (gen !== liveGen) return; // ancienne session déjà remplacée
                  console.log("[WebSocket] Gemini Live session closed.");
                  if (isClosed) return;
                  if (resumeHandle && reconnects < 3) {
                    reconnectGemini("close");
                    return;
                  }
                  geminiSession = null;
                  try {
                    clientWs.send(JSON.stringify({ type: "closed" }));
                    clientWs.close();
                  } catch {}
                },
                onerror: (err: any) => {
                  if (gen !== liveGen) return;
                  console.error("[WebSocket] Gemini Live error:", err);
                  if (isGeminiQuotaError(err)) rotateGeminiKey();
                  if (isClosed) return;
                  if (resumeHandle && reconnects < 3) {
                    reconnectGemini("error");
                    return;
                  }
                  // Session inutilisable : on ne garde pas une référence morte.
                  const dead = geminiSession;
                  geminiSession = null;
                  try { dead?.close(); } catch {}
                  try {
                    clientWs.send(JSON.stringify({ type: "error", message: "Erreur de connexion vocale avec l'IA." }));
                    clientWs.close();
                  } catch {}
                }
              }
              };
            };

            // Reconnexion transparente côté serveur (goAway / coupure) avec le handle de reprise.
            const reconnectGemini = async (reason: string) => {
              if (isClosed || !resumeHandle) return;
              reconnects += 1;
              console.warn(`[WebSocket] Reconnexion Gemini Live (${reason}) ${reconnects}/3 avec reprise de session.`);
              const previous = geminiSession;
              try {
                geminiSession = await connectLiveWithRotation(buildLiveConnect(resumeHandle));
                try { previous?.close(); } catch {}
              } catch (err) {
                console.error("[WebSocket] Reconnexion Gemini Live échouée:", err);
                geminiSession = null;
                try {
                  clientWs.send(JSON.stringify({ type: "error", message: "Connexion vocale perdue." }));
                  clientWs.close();
                } catch {}
              }
            };

            geminiSession = await connectLiveWithRotation(buildLiveConnect(incomingResume));

            console.log("[WebSocket] Gemini Live session connected successfully.");
            clientWs.send(JSON.stringify({ type: "connected" }));

            // Identification HP-Web automatique : si le contexte Live contient un VIN,
            // la recherche véhicule démarre immédiatement, sans attendre que le modèle
            // décide d'appeler l'outil. Le résultat est ensuite injecté dans le contexte Live.
            const contextVinMatch = diagnosticContext.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
            if (contextVinMatch && !incomingResume) {
              const contextVin = contextVinMatch[0];
              console.log("[HP-Web] Recherche automatique au démarrage Live pour VIN:", contextVin);
              searchHpWeb({ vin: contextVin })
                .then((results) => {
                  console.log("[HP-Web] Recherche automatique terminée:", results.length, "résultat(s)");
                  if (results.length && liveAgentState) {
                    const vehicle = results[0];
                    liveAgentState.vehicle = [vehicle.make, vehicle.model, vehicle.year, vehicle.engine].filter(Boolean).join(" ");
                    liveAgentState.evidence.push("Identification HP-Web automatique : " + JSON.stringify(vehicle).slice(0, 5000));
                    saveLiveAgentState((clientWs as any)._authPhone || "", liveAgentState).catch(() => {});
                    clientWs.send(JSON.stringify({ type: "agentState", state: liveAgentState }));
                  }
                  if (!isClosed && geminiSession) {
                    const hpContext = JSON.stringify(results).slice(0, 8000);
                    geminiSession.sendClientContent({
                      turns: [{
                        role: "user",
                        parts: [{ text: "IDENTIFICATION HP-WEB AUTOMATIQUE POUR LE VIN " + contextVin + ": " + hpContext + "\nUtilise ces données comme contexte véhicule confirmé par HP-Web." }]
                      }]
                    });
                  }
                })
                .catch((hpErr: any) => {
                  console.error("[HP-Web] Recherche automatique échouée:", hpErr?.message || hpErr);
                });
            }

            // Send an initial prompt to make the agent speak immediately! (pas après une reprise de session)
            if (!incomingResume) geminiSession.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [
                    {
                      text: "DiagAssist, signale ta présence immédiatement pour confirmer la connexion en direct en disant : 'Je suis DiagAssist, à votre écoute.' puis rappelle brièvement le symptôme majeur ou code défaut de ce véhicule."
                    }
                  ]
                }
              ]
            });

          } catch (err: any) {
            console.error("[WebSocket] Failed to connect to Gemini Live:", err);
            const deepSeekKeyConfigured = Boolean((process.env.DEEPSEEK_API_KEY || "").trim());
            if (deepSeekKeyConfigured) {
              try {
                deepSeekFallbackActive = true;
                console.warn("[Fallback Live] Gemini Live indisponible/quota: activation du mode texte DeepSeek.");
                const fallbackPrompt = "La session vocale Gemini Live est indisponible. Accueille immédiatement le mécanicien en 1 à 2 phrases et demande-lui son symptôme, son code défaut ou sa question. Reste dans le cadre du diagnostic automobile.";
                const fallback = await deepSeekReply(fallbackPrompt, fallbackPrompt);
                clientWs.send(JSON.stringify({ type: "connected", fallback: "deepseek" }));
                clientWs.send(JSON.stringify({ type: "text", text: fallback.text, fallback: "deepseek" }));
              } catch (dsErr: any) {
                console.error("[DeepSeek Live Fallback] Échec:", dsErr.message || dsErr);
                clientWs.send(JSON.stringify({ type: "error", message: "Gemini Live et le mode secours DeepSeek sont indisponibles." }));
                clientWs.close();
              }
            } else {
              clientWs.send(JSON.stringify({ type: "error", message: "Gemini Live est indisponible et DEEPSEEK_API_KEY n'est pas configuré." }));
              clientWs.close();
            }
          }
        } else if (message.type === "hpwebExtension") {
          (clientWs as any)._hpExt = message.ready === true;
        } else if (message.type === "hpwebResult") {
          const cb = (clientWs as any)._hpPending?.get(String(message.id));
          if (cb) { (clientWs as any)._hpPending.delete(String(message.id)); cb(message); }
        } else if (message.type === "audio") {
          if (geminiSession && typeof message.audio === "string" && message.audio.length <= 200000) {
            geminiSession.sendRealtimeInput({
              audio: { data: message.audio, mimeType: "audio/pcm;rate=16000" }
            });
          }
        } else if (message.type === "image" || message.type === "video" || message.type === "media") {
          if (geminiSession) {
            console.log("[WebSocket] Sending realtime media/image input to Gemini Live session via sendRealtimeInput...");
            try {
              geminiSession.sendRealtimeInput({
                video: { data: message.data || message.image, mimeType: message.mimeType || "image/jpeg" }
              });
              clientWs.send(JSON.stringify({ type: "mediaAck", status: "ok", message: "Photo transmise à Gemini Live." }));
            } catch (err: any) {
              console.error("[WebSocket] Failed to send realtime image to Gemini Live:", err);
              clientWs.send(JSON.stringify({ type: "error", message: "Impossible d'envoyer la photo à Gemini Live: " + err.message }));
            }
          } else if (deepSeekFallbackActive) {
            // DeepSeek (deepseek-flash) accepte les images : on lui transmet la photo du mécanicien.
            const mime = String(message.mimeType || "image/jpeg").toLowerCase();
            const b64 = String(message.data || message.image || "");
            const okMime = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime);
            if (!okMime || !b64 || b64.length > 6_000_000) {
              clientWs.send(JSON.stringify({ type: "error", message: "Photo non prise en charge par le mode secours (JPEG, PNG, GIF ou WebP, taille limitée)." }));
            } else {
              try {
                const caption = String(message.text || message.caption || "").slice(0, 1000);
                const prompt = caption || "Voici une photo du véhicule/de la pièce. Analyse-la et dis ce que tu observes d'utile pour le diagnostic.";
                const fallback = await deepSeekReply(
                  [
                    { type: "text", text: prompt },
                    { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
                  ],
                  `[photo envoyée] ${prompt}`
                );
                clientWs.send(JSON.stringify({ type: "mediaAck", status: "ok", message: "Photo analysée par le mode secours." }));
                clientWs.send(JSON.stringify({ type: "text", text: fallback.text, fallback: "deepseek" }));
              } catch (dsErr: any) {
                console.error("[DeepSeek Live Fallback] Erreur sur photo:", dsErr.message || dsErr);
                clientWs.send(JSON.stringify({ type: "error", message: "Le mode secours n'a pas pu analyser la photo." }));
              }
            }
          } else {
            clientWs.send(JSON.stringify({ type: "error", message: "Session Gemini Live non active sur le serveur." }));
          }
        } else if (message.type === "triggerVocalAd") {
          if (geminiSession) {
            console.log("[WebSocket] Delivering 100% vocal ad instruction to Gemini Live...");
            const adPrompt = (message.adVoicePrompt ? String(message.adVoicePrompt).slice(0, 1500) : "") || `[INSTRUCTION VOCALE PUBLICITAIRE] Adopte un ton commercial, dynamique et professionnel (voix publicitaire) pour prononcer l'annonce suivante : "${String(message.offerScript || '').slice(0, 500) || 'Si vous souhaitez vous équiper pour vos prochains diagnostics, découvrez nos scanners automobiles sans tablette à partir de 80 000 FCFA.'}" Puis reprends immédiatement ta voix de diagnostic calme et technique.`;
            geminiSession.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [
                    { text: adPrompt }
                  ]
                }
              ]
            });
          }
        } else if (message.type === "text") {
          if (geminiSession) {
            geminiSession.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [
                    { text: String(message.text || "").slice(0, 4000) }
                  ]
                }
              ]
            });
          } else if (deepSeekFallbackActive) {
            try {
              const userText = String(message.text || "").slice(0, 4000);
              const fallback = await deepSeekReply(userText, userText);
              clientWs.send(JSON.stringify({ type: "text", text: fallback.text, fallback: "deepseek" }));
            } catch (dsErr: any) {
              console.error("[DeepSeek Live Fallback] Erreur sur message texte:", dsErr.message || dsErr);
              clientWs.send(JSON.stringify({ type: "error", message: "Le mode secours DeepSeek n'a pas pu répondre." }));
            }
          }
        }
      } catch (err: any) {
        console.error("[WebSocket] Error processing message:", err);
      }
    });

    clientWs.on("close", () => {
      console.log("[WebSocket] Client disconnected from real-time voice bridge.");
      isClosed = true;
      clearTimeout(limitTimer);
      clearInterval(heartbeat);
      mySet.delete(clientWs);
      if (mySet.size === 0) liveConnections.delete(connPhone);
      if (!usageCounted) {
        usageCounted = true;
        addLiveUsage(connPhone, Date.now() - connStartedAt);
      }
      if (geminiSession) {
        try {
          geminiSession.close();
        } catch (e) {}
      }
    });
  });
}

startServer().catch((err) => {
  console.error("[Démarrage] Échec fatal:", err);
  process.exit(1);
});
