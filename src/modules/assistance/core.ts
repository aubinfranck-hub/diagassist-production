import crypto from "crypto";
import type { Pool, PoolClient } from "pg";
import {
  ACTIVE_MISSION_STATUSES, CLIENT_CANCELLABLE, bidRange, PAYMENT_METHODS, SERVICE_SEED, STATUS_LABELS, approxPosition, canTransition,
  clean, estimateEtaMinutes, haversineKm, normalizePhone, parseQuoteLines, statusLabelFor, validCoords,
  type RequestMode, type RequestStatus,
} from "./domain";
import { ASSISTANCE_SCHEMA_SQL } from "./schema";

export class AssistanceError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export type DirectoryMechanic = {
  id: string; type: string; name: string; garageName?: string; phone: string; city: string;
  area?: string; specialties?: string; hasScanner: boolean; certified: boolean; active: boolean;
};

export type CoreDeps = {
  pool: Pool;
  sendWhatsApp?: (phone: string, message: string) => Promise<void>;
  // Droit d'accès : seuls les mécaniciens à jour de leur abonnement DiagAssist reçoivent des assistances.
  isProSubscribed: (phone: string) => boolean;
  // Analyse automatique par l'IA DiagAssist (texte + médias). Peut échouer : la demande part quand même.
  appUrl?: string;
  analyze?: (input: { service: string; vehicle: any; symptoms: string; faultCodes: string | null; media: { mime: string; data: Buffer }[] }) => Promise<string | null>;
  // Paiement via le système (Jèko). Absent ou non configuré : le paiement renvoie 503 explicite.
  jeko?: {
    isConfigured: () => boolean;
    create: (p: { reference: string; amountXof: number; paymentMethod: string; payerPhone?: string; successUrl: string; errorUrl: string }) => Promise<{ id?: string; redirectUrl?: string }>;
    fetchStatus: (jekoId: string) => Promise<string>;
  };
};

const DEFAULT_SETTINGS = {
  offer_timeout_s: 120, // fenêtre accordée au mécanicien pour faire son offre de prix
  bid_valid_s: 300, // durée de validité d'une offre de prix après son envoi
  search_radius_km: 25,
  max_candidates: 10,
  broadcast_size: 5,
  location_max_age_min: 15,
  avg_speed_kmh: 25,
  commission_pct: 10 as number, // % prélevé par DiagAssist sur le paiement reçu par le mécanicien (0..100)
  // `indicatif` = tarif affiché au client pour le service (clé conservée pour compatibilité).
  tariffs: {} as Record<string, { deplacement?: number; diagnostic?: number; indicatif?: number; min?: number; max?: number }>,
  whatsapp_notifications: false,
};
export type Settings = typeof DEFAULT_SETTINGS;

export const canonicalPhone = (p: string): string => {
  let d = normalizePhone(p);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10) d = "225" + d; // numéro ivoirien à 10 chiffres sans indicatif
  return "+" + d;
};

const rid = () => "AS-" + crypto.randomBytes(5).toString("hex").slice(0, 7).toUpperCase();

export function createAssistanceCore(deps: CoreDeps) {
  const { pool } = deps;
  let settingsCache: { at: number; value: Settings } | null = null;

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  // ---------- Initialisation ----------
  async function init(): Promise<void> {
    await pool.query(ASSISTANCE_SCHEMA_SQL);
    for (const s of SERVICE_SEED) {
      await pool.query(
        `INSERT INTO assistance_services (code, label, description, sort) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING`,
        [s.code, s.label, s.description, s.sort]
      );
    }
    // Zone de lancement (Abidjan) : point de départ modifiable par l'admin, créé une seule fois.
    const z = await pool.query("SELECT 1 FROM assistance_zones LIMIT 1");
    if (!z.rowCount) {
      await pool.query(
        `INSERT INTO assistance_zones (name, center_lat, center_lng, radius_km, created_at) VALUES ('Abidjan', 5.3600, -4.0083, 30, $1) ON CONFLICT DO NOTHING`,
        [Date.now()]
      );
    }
  }

  // ---------- Réglages ----------
  async function getSettings(force = false): Promise<Settings> {
    if (!force && settingsCache && Date.now() - settingsCache.at < 5000) return settingsCache.value;
    const r = await pool.query("SELECT key, value FROM assistance_settings");
    const v: any = { ...DEFAULT_SETTINGS };
    for (const row of r.rows) if (row.key in DEFAULT_SETTINGS) v[row.key] = row.value;
    settingsCache = { at: Date.now(), value: v };
    return v;
  }
  async function saveSettings(patch: Record<string, unknown>): Promise<Settings> {
    const num = (k: string, min: number, max: number) => {
      const n = Number(patch[k]);
      if (!Number.isFinite(n) || n < min || n > max) throw new AssistanceError(400, `Réglage invalide : ${k} doit être entre ${min} et ${max}.`);
      return n;
    };
    const out: Record<string, unknown> = {};
    if ("offer_timeout_s" in patch) out.offer_timeout_s = Math.round(num("offer_timeout_s", 10, 600));
    if ("bid_valid_s" in patch) out.bid_valid_s = Math.round(num("bid_valid_s", 30, 3600));
    if ("search_radius_km" in patch) out.search_radius_km = num("search_radius_km", 1, 200);
    if ("broadcast_size" in patch) out.broadcast_size = Math.round(num("broadcast_size", 1, 20));
    if ("max_candidates" in patch) out.max_candidates = Math.round(num("max_candidates", 1, 50));
    if ("location_max_age_min" in patch) out.location_max_age_min = num("location_max_age_min", 1, 240);
    if ("avg_speed_kmh" in patch) out.avg_speed_kmh = num("avg_speed_kmh", 5, 120);
    if ("commission_pct" in patch) out.commission_pct = patch.commission_pct === null || patch.commission_pct === "" ? DEFAULT_SETTINGS.commission_pct : num("commission_pct", 0, 100);
    if ("whatsapp_notifications" in patch) out.whatsapp_notifications = patch.whatsapp_notifications === true;
    if ("tariffs" in patch) {
      const t: Record<string, { deplacement?: number; diagnostic?: number; indicatif?: number; min?: number; max?: number }> = {};
      const src: any = patch.tariffs || {};
      const given = (v: any) => v !== undefined && v !== null && v !== "";
      const amount = (v: any, label: string) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new AssistanceError(400, `${label} invalide (entier en F CFA, 1 000 000 maximum).`);
        return n;
      };
      for (const code of Object.keys(src)) {
        const entry: { deplacement?: number; diagnostic?: number; indicatif?: number; min?: number; max?: number } = {};
        if (given(src[code]?.indicatif)) entry.indicatif = amount(src[code].indicatif, "Tarif affiché");
        if (given(src[code]?.deplacement)) entry.deplacement = amount(src[code].deplacement, "Tarif de déplacement");
        if (given(src[code]?.diagnostic)) entry.diagnostic = amount(src[code].diagnostic, "Tarif de diagnostic");
        if (given(src[code]?.min)) entry.min = amount(src[code].min, "Prix minimum");
        if (given(src[code]?.max)) entry.max = amount(src[code].max, "Prix maximum");
        const range = bidRange(entry);
        if (range.min > range.max) throw new AssistanceError(400, `Fourchette de prix incohérente pour « ${code} » : le minimum (${range.min}) dépasse le maximum (${range.max}).`);
        t[String(code)] = entry;
      }
      out.tariffs = t;
    }
    for (const [k, v] of Object.entries(out)) {
      await pool.query(
        `INSERT INTO assistance_settings (key, value, updated_at) VALUES ($1,$2::jsonb,$3) ON CONFLICT (key) DO UPDATE SET value=$2::jsonb, updated_at=$3`,
        [k, JSON.stringify(v), Date.now()]
      );
    }
    return getSettings(true);
  }

  // ---------- Journal, notifications ----------
  async function logEvent(c: Pool | PoolClient, requestId: string, actor: string, actorRole: string, type: string, o: { from?: string; to?: string; reason?: string; meta?: any } = {}) {
    await c.query(
      `INSERT INTO assistance_events (request_id, at, actor, actor_role, type, from_status, to_status, reason, meta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [requestId, Date.now(), actor, actorRole, type, o.from || null, o.to || null, o.reason || null, o.meta ? JSON.stringify(o.meta) : null]
    );
    console.log(`[ASSISTANCE] ${requestId} ${type}${o.from || o.to ? ` ${o.from || "-"}→${o.to || "-"}` : ""} par ${actorRole}:${actor}${o.reason ? ` (${o.reason})` : ""}`);
  }

  async function notify(phone: string, requestId: string | null, type: string, title: string, body: string, whatsapp: boolean | "force" = false) {
    try {
      await pool.query(
        `INSERT INTO assistance_notifications (phone, request_id, type, title, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [phone, requestId, type, title, body, Date.now()]
      );
      if (whatsapp && deps.sendWhatsApp) {
        const s = await getSettings();
        if (whatsapp === "force" || s.whatsapp_notifications) deps.sendWhatsApp(phone, `DiagAssist - ${title}. ${body}`).catch((e) => console.warn("[ASSISTANCE] WhatsApp non envoyé:", e?.message || e));
      }
    } catch (e: any) {
      console.error("[ASSISTANCE] Notification impossible:", e.message);
    }
  }

  // ---------- Zones et services ----------
  async function resolveZone(lat: number, lng: number): Promise<{ id: number; name: string } | null> {
    const r = await pool.query("SELECT id, name, center_lat, center_lng, radius_km FROM assistance_zones WHERE active");
    let best: { id: number; name: string; d: number } | null = null;
    for (const z of r.rows) {
      const d = haversineKm(lat, lng, z.center_lat, z.center_lng);
      if (d <= z.radius_km && (!best || d < best.d)) best = { id: z.id, name: z.name, d };
    }
    return best ? { id: best.id, name: best.name } : null;
  }

  async function servicesStatus() {
    const s = await pool.query(`SELECT code, label, description, enabled FROM assistance_services ORDER BY sort, code`);
    const pros = await pool.query(
      `SELECT phone, specialties, zone_ids, available, mobility, last_lat FROM assistance_pros WHERE validation_status='valide'`
    );
    const settings = await getSettings();
    const zones = await pool.query(`SELECT id FROM assistance_zones WHERE active`);
    const activeZoneIds = new Set(zones.rows.map((z) => z.id));
    return s.rows.filter((x) => x.enabled).map((x) => {
      const ok = pros.rows.filter((p) => deps.isProSubscribed(p.phone) && p.specialties.includes(x.code) && p.zone_ids.some((z: number) => activeZoneIds.has(z)));
      const comp = ok.filter((p) => ["mobile", "both"].includes(p.mobility));
      const atelier = ok.filter((p) => ["garage", "both"].includes(p.mobility) && p.last_lat != null);
      const tariff = settings.tariffs[x.code]?.indicatif ?? null;
      return {
        code: x.code, label: x.label, description: x.description, available: comp.length > 0, proCount: comp.length, availableNow: comp.filter((p) => p.available).length,
        atelierAvailable: atelier.length > 0, atelierProCount: atelier.length, atelierAvailableNow: atelier.filter((p) => p.available).length,
        tariff, indicativeAmount: tariff,
      };
    });
  }

  // ---------- Profils professionnels ----------
  function guessSpecialties(m: DirectoryMechanic): string[] {
    const t = `${m.specialties || ""}`.toLowerCase();
    const out = new Set<string>();
    if (/électr|electr|câbl|cabl/.test(t)) out.add("electricite");
    if (/pneu/.test(t)) out.add("pneumatiques");
    if (/batter|démarr|demarr/.test(t)) out.add("batterie");
    if (/diag|valise|scann/.test(t) || m.hasScanner) out.add("diagnostic");
    if (/remorq|dépann|depann/.test(t)) out.add("remorquage");
    if (/vidange|entretien/.test(t)) out.add("vidange");
    if (!out.size || /méca|meca|moteur|frein|général|general/.test(t)) out.add("mecanique");
    return [...out];
  }

  // Rattache chaque mécanicien de l'annuaire au dépannage : profil créé « en attente de validation »
  // (l'inscription seule ne vaut pas vérification). Idempotent ; ne touche jamais au statut d'un
  // profil déjà existant, sauf pour suspendre celui dont l'entrée d'annuaire a été désactivée.
  async function syncDirectory(list: DirectoryMechanic[]): Promise<{ created: number; linked: number; suspended: number }> {
    let created = 0, linked = 0, suspended = 0;
    const zones = (await pool.query("SELECT id, name FROM assistance_zones WHERE active")).rows;
    for (const m of list) {
      if (m.type !== "mechanic") continue;
      const phone = canonicalPhone(m.phone);
      if (phone.length < 9) continue;
      const existing = await pool.query("SELECT phone, source, validation_status, directory_id FROM assistance_pros WHERE phone=$1 OR directory_id=$2 LIMIT 1", [phone, m.id]);
      if (!m.active) {
        if (existing.rowCount && existing.rows[0].source === "annuaire" && ["en_attente", "valide"].includes(existing.rows[0].validation_status)) {
          await pool.query(`UPDATE assistance_pros SET validation_status='suspendu', validation_note='Retiré de l''annuaire', available=false, updated_at=$2 WHERE phone=$1`, [existing.rows[0].phone, Date.now()]);
          suspended++;
        }
        continue;
      }
      if (existing.rowCount) {
        if (!existing.rows[0].directory_id) {
          await pool.query("UPDATE assistance_pros SET directory_id=$2, updated_at=$3 WHERE phone=$1", [existing.rows[0].phone, m.id, Date.now()]);
          linked++;
        }
        continue;
      }
      const zoneIds = zones.filter((z) => `${m.city} ${m.area || ""}`.toLowerCase().includes(String(z.name).toLowerCase())).map((z) => z.id);
      await pool.query(
        `INSERT INTO assistance_pros (phone, display_name, garage_name, specialties, zone_ids, mobility, source, directory_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'mobile','annuaire',$6,$7,$7) ON CONFLICT DO NOTHING`,
        [phone, clean(m.name, 80), m.garageName ? clean(m.garageName, 80) : null, guessSpecialties(m), zoneIds, m.id, Date.now()]
      );
      created++;
    }
    return { created, linked, suspended };
  }

  async function proBlockers(p: any): Promise<string[]> {
    const b: string[] = [];
    if (p.validation_status === "en_attente") b.push("Votre profil est en attente de validation par DiagAssist.");
    if (p.validation_status === "suspendu") b.push("Votre profil est suspendu. Contactez DiagAssist.");
    if (p.validation_status === "refuse") b.push("Votre profil n'a pas été retenu.");
    if (!deps.isProSubscribed(p.phone)) b.push("Votre abonnement DiagAssist n'est plus à jour : renouvelez-le pour recevoir des assistances.");
    if (!p.specialties?.length) b.push("Choisissez au moins une spécialité.");
    if (!p.zone_ids?.length) b.push("Choisissez au moins une zone d'intervention.");
    return b;
  }

  async function proProfile(phone: string) {
    const r = await pool.query("SELECT * FROM assistance_pros WHERE phone=$1", [phone]);
    if (!r.rowCount) return null;
    const p = r.rows[0];
    const [tr, docs, rating, done, active] = await Promise.all([
      pool.query("SELECT id, title, issuer, completed_on, status FROM assistance_trainings WHERE pro_phone=$1 ORDER BY id", [phone]),
      pool.query("SELECT id, kind, label, mime, status, created_at FROM assistance_pro_documents WHERE pro_phone=$1 ORDER BY id", [phone]),
      pool.query("SELECT COUNT(*)::int n, AVG(rating)::float avg FROM assistance_reviews WHERE pro_phone=$1", [phone]),
      pool.query("SELECT COUNT(*)::int n FROM assistance_requests WHERE assigned_phone=$1 AND status='terminee'", [phone]),
      pool.query("SELECT id FROM assistance_requests WHERE assigned_phone=$1 AND status = ANY($2)", [phone, ACTIVE_MISSION_STATUSES]),
    ]);
    const blockers = await proBlockers(p);
    const s = await getSettings();
    const fresh = p.last_loc_at && Date.now() - Number(p.last_loc_at) <= s.location_max_age_min * 60000;
    if (p.validation_status === "valide" && p.available && !fresh) blockers.push("Partagez votre position pour recevoir des missions.");
    return {
      phone: p.phone, displayName: p.display_name, garageName: p.garage_name, specialties: p.specialties, zoneIds: p.zone_ids,
      mobility: p.mobility, subscribed: deps.isProSubscribed(p.phone), validationStatus: p.validation_status, validationNote: p.validation_note, available: p.available,
      shareLocation: p.available || active.rowCount! > 0,
      location: p.last_lat != null ? { lat: p.last_lat, lng: p.last_lng, updatedAt: Number(p.last_loc_at) } : null,
      trainings: tr.rows.map((t) => ({ id: t.id, title: t.title, issuer: t.issuer, completedOn: t.completed_on, status: t.status })),
      documents: docs.rows.map((d) => ({ id: d.id, kind: d.kind, label: d.label, mime: d.mime, status: d.status, createdAt: Number(d.created_at) })),
      rating: rating.rows[0].n ? { avg: Math.round(rating.rows[0].avg * 10) / 10, count: rating.rows[0].n } : null,
      missionsDone: done.rows[0].n, activeMissionId: active.rows[0]?.id || null,
      canReceiveMissions: p.validation_status === "valide" && blockers.length === 0, blockers, source: p.source,
    };
  }

  async function upsertProProfile(phone: string, input: any) {
    const name = clean(input.displayName, 80);
    if (name.length < 2) throw new AssistanceError(400, "Indiquez votre nom.");
    const svc = await pool.query("SELECT code FROM assistance_services");
    const known = new Set(svc.rows.map((s) => s.code));
    const specialties = [...new Set((Array.isArray(input.specialties) ? input.specialties : []).map(String))].filter((s: any) => known.has(s));
    const zr = await pool.query("SELECT id FROM assistance_zones WHERE active");
    const knownZ = new Set(zr.rows.map((z) => z.id));
    const zoneIds = [...new Set((Array.isArray(input.zoneIds) ? input.zoneIds : []).map(Number))].filter((z: any) => knownZ.has(z));
    const mobility = ["mobile", "garage", "both"].includes(input.mobility) ? input.mobility : "mobile";
    const now = Date.now();
    await pool.query(
      `INSERT INTO assistance_pros (phone, display_name, garage_name, specialties, zone_ids, mobility, source, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'inscription',$7,$7)
       ON CONFLICT (phone) DO UPDATE SET display_name=$2, garage_name=$3, specialties=$4, zone_ids=$5, mobility=$6, updated_at=$7`,
      [phone, name, input.garageName ? clean(input.garageName, 80) : null, specialties, zoneIds, mobility, now]
    );
    // Retirer un service/une zone ne doit pas laisser une offre ouverte devenue incompatible.
    await pool.query(`UPDATE assistance_pros SET available=false WHERE phone=$1 AND (cardinality(specialties)=0 OR cardinality(zone_ids)=0)`, [phone]);
    return proProfile(phone);
  }

  async function setPresence(phone: string, available: boolean, lat?: number, lng?: number) {
    const p = (await pool.query("SELECT * FROM assistance_pros WHERE phone=$1", [phone])).rows[0];
    if (!p) throw new AssistanceError(404, "Créez d'abord votre profil dépannage.");
    if (available) {
      if (p.validation_status !== "valide") throw new AssistanceError(403, "Votre profil doit être validé par DiagAssist avant de passer disponible.", "NOT_VALIDATED");
      const bl = await proBlockers(p);
      if (bl.length) throw new AssistanceError(409, bl[0]);
      if (!validCoords(lat, lng)) throw new AssistanceError(400, "Activez votre position pour passer disponible.", "LOCATION_REQUIRED");
      await pool.query("UPDATE assistance_pros SET available=true, last_lat=$2, last_lng=$3, last_loc_at=$4, updated_at=$4 WHERE phone=$1", [phone, lat, lng, Date.now()]);
    } else {
      await closeOpenOffersFor(phone, "annulee");
      await pool.query("UPDATE assistance_pros SET available=false, updated_at=$2 WHERE phone=$1", [phone, Date.now()]);
      await clearLocationIfIdle(phone);
    }
    return proProfile(phone);
  }

  async function clearLocationIfIdle(phone: string) {
    // Arrête le partage de position devenu inutile : ni disponible, ni mission active.
    await pool.query(
      `UPDATE assistance_pros SET last_lat=NULL, last_lng=NULL, last_loc_at=NULL
       WHERE phone=$1 AND available=false AND NOT EXISTS (SELECT 1 FROM assistance_requests WHERE assigned_phone=$1 AND status = ANY($2))`,
      [phone, ACTIVE_MISSION_STATUSES]
    );
  }

  async function updateLocation(phone: string, lat: number, lng: number) {
    if (!validCoords(lat, lng)) throw new AssistanceError(400, "Position invalide.");
    const r = await pool.query(
      `UPDATE assistance_pros SET last_lat=$2, last_lng=$3, last_loc_at=$4
       WHERE phone=$1 AND validation_status='valide' AND (available OR EXISTS (SELECT 1 FROM assistance_requests WHERE assigned_phone=$1 AND status = ANY($5)))
       RETURNING phone`,
      [phone, lat, lng, Date.now(), ACTIVE_MISSION_STATUSES]
    );
    if (!r.rowCount) throw new AssistanceError(409, "Le partage de position n'est plus nécessaire.", "SHARING_NOT_NEEDED");
  }

  async function closeOpenOffersFor(phone: string, status: "annulee" | "refusee" | "expiree") {
    await pool.query("UPDATE assistance_offers SET status=$2, responded_at=$3 WHERE pro_phone=$1 AND status IN ('envoyee','offre_faite')", [phone, status, Date.now()]);
  }

  // ---------- Demandes ----------
  function parsePosition(p: any) {
    if (!p) throw new AssistanceError(400, "Indiquez votre position.");
    if (!validCoords(p.lat, p.lng)) throw new AssistanceError(400, "Position invalide.");
    const source = ["gps", "carte", "adresse"].includes(p.source) ? p.source : "carte";
    return {
      lat: p.lat as number, lng: p.lng as number, accuracy: Number.isFinite(p.accuracy) ? Number(p.accuracy) : null,
      source, address: p.address ? clean(p.address, 200) : null, landmark: p.landmark ? clean(p.landmark, 200) : null, confirmed: p.confirmed === true,
    };
  }

  async function assertServiceEnabled(service: string) {
    const r = await pool.query("SELECT enabled FROM assistance_services WHERE code=$1", [service]);
    if (!r.rowCount || !r.rows[0].enabled) throw new AssistanceError(400, "Ce service n'est pas proposé.");
  }

  async function createRequest(clientPhone: string, input: any) {
    const service = String(input.service || "");
    await assertServiceEnabled(service);
    const pos = parsePosition(input.position);
    const contact = clean(input.contactPhone, 30);
    if (normalizePhone(contact).length < 8) throw new AssistanceError(400, "Indiquez un numéro de téléphone pour être joint.");
    const symptoms = clean(input.symptoms, 1000);
    if (!symptoms && !clean(input.description, 1000)) throw new AssistanceError(400, "Décrivez la panne en quelques mots.");
    const v = input.vehicle || {};
    const vehicle = { brand: clean(v.brand, 60), model: clean(v.model, 80), year: clean(v.year, 8), engine: clean(v.engine, 80), source: v.source === "catalogue" ? "catalogue" : "saisie" };
    const immobilised = input.immobilised !== false; // défaut : véhicule immobilisé (le mécanicien vient)
    const mode: RequestMode = immobilised ? "depannage" : "atelier";
    const tariff = (await getSettings()).tariffs[service]?.indicatif ?? 0;
    const share = input.shareDiagnostic === true;
    const diagnostic = share && input.diagnostic ? { summary: clean(input.diagnostic.summary, 4000), faultCodes: clean(input.diagnostic.faultCodes, 300), vehicle: input.diagnostic.vehicle ? clean(JSON.stringify(input.diagnostic.vehicle), 500) : null } : null;
    const id = rid();
    const now = Date.now();
    await tx(async (c) => {
      await c.query(
        `INSERT INTO assistance_requests (id, client_phone, status, service, vehicle, symptoms, fault_codes, description, contact_phone, lat, lng, accuracy, position_source, address, landmark, position_confirmed, share_diagnostic, diagnostic, immobilised, mode, amount_due, created_at, updated_at)
         VALUES ($1,$2,'brouillon',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21)`,
        [id, clientPhone, service, JSON.stringify(vehicle), symptoms, clean(input.faultCodes, 300) || null, clean(input.description, 1000) || null, contact, pos.lat, pos.lng, pos.accuracy, pos.source, pos.address, pos.landmark, pos.confirmed, share && !!diagnostic, diagnostic ? JSON.stringify(diagnostic) : null, immobilised, mode, tariff, now]
      );
      await logEvent(c, id, clientPhone, "client", "creation", { to: "brouillon", meta: { share_diagnostic: share && !!diagnostic, mode } });
      const ids: string[] = Array.isArray(input.mediaIds) ? input.mediaIds.map(String).slice(0, 8) : [];
      if (ids.length) {
        await c.query(`UPDATE assistance_media SET request_id=$1 WHERE id = ANY($2) AND owner_phone=$3 AND request_id IS NULL`, [id, ids, clientPhone]);
      }
    });
    if (input.submit === true) await submitRequest(id, clientPhone);
    return getRequestRow(id);
  }

  async function updateDraft(id: string, clientPhone: string, input: any) {
    const r = await getRequestRow(id);
    if (!r || r.client_phone !== clientPhone) throw new AssistanceError(404, "Demande introuvable.");
    if (r.status !== "brouillon") throw new AssistanceError(409, "Cette demande est déjà envoyée et ne peut plus être modifiée.");
    const sets: string[] = []; const vals: any[] = [];
    const add = (col: string, v: any) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
    if (input.service !== undefined) {
      await assertServiceEnabled(String(input.service));
      add("service", String(input.service));
      add("amount_due", (await getSettings()).tariffs[String(input.service)]?.indicatif ?? 0);
    }
    if (input.immobilised !== undefined) { add("immobilised", input.immobilised !== false); add("mode", input.immobilised !== false ? "depannage" : "atelier"); }
    if (input.symptoms !== undefined) add("symptoms", clean(input.symptoms, 1000));
    if (input.faultCodes !== undefined) add("fault_codes", clean(input.faultCodes, 300) || null);
    if (input.description !== undefined) add("description", clean(input.description, 1000) || null);
    if (input.contactPhone !== undefined) add("contact_phone", clean(input.contactPhone, 30));
    if (input.vehicle) { const v = input.vehicle; add("vehicle", JSON.stringify({ brand: clean(v.brand, 60), model: clean(v.model, 80), year: clean(v.year, 8), engine: clean(v.engine, 80), source: v.source === "catalogue" ? "catalogue" : "saisie" })); }
    if (input.position) {
      const p = parsePosition(input.position);
      add("lat", p.lat); add("lng", p.lng); add("accuracy", p.accuracy); add("position_source", p.source); add("address", p.address); add("landmark", p.landmark); add("position_confirmed", p.confirmed);
    }
    if (input.shareDiagnostic !== undefined) add("share_diagnostic", input.shareDiagnostic === true && !!r.diagnostic);
    if (sets.length) {
      add("updated_at", Date.now());
      vals.push(id);
      await pool.query(`UPDATE assistance_requests SET ${sets.join(",")} WHERE id=$${vals.length}`, vals);
    }
    if (input.submit === true) await submitRequest(id, clientPhone);
    return getRequestRow(id);
  }

  async function getRequestRow(id: string) {
    const r = await pool.query("SELECT * FROM assistance_requests WHERE id=$1", [id]);
    return r.rows[0] || null;
  }

  async function submitRequest(id: string, clientPhone: string) {
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!r || r.client_phone !== clientPhone) throw new AssistanceError(404, "Demande introuvable.");
      if (r.status !== "brouillon") throw new AssistanceError(409, "Cette demande est déjà envoyée.");
      if (!r.position_confirmed) throw new AssistanceError(400, "Confirmez votre position avant d'envoyer la demande.", "POSITION_NOT_CONFIRMED");
      const open = await c.query(`SELECT 1 FROM assistance_requests WHERE client_phone=$1 AND id<>$2 AND status IN ('recherche','affectee','en_route','sur_place','en_intervention')`, [clientPhone, id]);
      if (open.rowCount) throw new AssistanceError(409, "Vous avez déjà une demande en cours. Terminez-la ou annulez-la avant d'en créer une autre.", "ALREADY_OPEN");
      await assertServiceEnabled(r.service);
      const zone = await resolveZone(r.lat, r.lng);
      if (!zone) throw new AssistanceError(422, "Votre position est hors des zones couvertes pour le moment.", "OUT_OF_ZONE");
      const now = Date.now();
      const tariff = (await getSettings()).tariffs[r.service]?.indicatif ?? 0;
      await c.query(`UPDATE assistance_requests SET status='recherche', zone_id=$2, search_started_at=$3, updated_at=$3, amount_due=$4, visit_status='aucune' WHERE id=$1`, [id, zone.id, now, tariff]);
      await logEvent(c, id, clientPhone, "client", "envoi", { from: "brouillon", to: "recherche", meta: { zone: zone.name, mode: r.mode } });
    });
    await notify(clientPhone, id, "demande_recue", "Demande reçue", (await getRequestRow(id))?.mode === "atelier" ? "Nous cherchons un garage proche de vous." : "Nous cherchons un mécanicien près de vous.");
    await analyzeRequest(id);
    nudgeUnsubscribed(id).catch((e) => console.warn("[ASSISTANCE] Invitation abonnement:", e?.message || e));
    await dispatch(id);
  }

  // Les mécaniciens de la zone compétents mais PAS à jour de leur abonnement sont prévenus automatiquement
  // (WhatsApp + notification) qu'une assistance existe près d'eux et invités à s'abonner pour la prendre.
  // Aucun détail privé du client, ni sa position exacte. Une invitation par mécanicien et par 24 h.
  async function nudgeUnsubscribed(requestId: string): Promise<void> {
    const r = (await pool.query(`SELECT r.service, r.zone_id, r.client_phone, r.mode, z.name AS zone_name, s.label FROM assistance_requests r LEFT JOIN assistance_zones z ON z.id=r.zone_id LEFT JOIN assistance_services s ON s.code=r.service WHERE r.id=$1 AND r.status='recherche'`, [requestId])).rows[0];
    if (!r || !r.zone_id) return;
    const cands = (await pool.query(
      `SELECT p.phone FROM assistance_pros p
       WHERE p.validation_status IN ('valide','en_attente') AND p.mobility = ANY($5)
         AND $1 = ANY(p.specialties) AND $2 = ANY(p.zone_ids) AND p.phone <> $3
         AND NOT EXISTS (SELECT 1 FROM assistance_notifications n WHERE n.phone=p.phone AND n.type='abonnement_invite' AND n.created_at > $4)`,
      [r.service, r.zone_id, r.client_phone, Date.now() - 24 * 3600000, r.mode === "atelier" ? ["garage", "both"] : ["mobile", "both"]]
    )).rows.filter((p) => !deps.isProSubscribed(p.phone)).slice(0, 20);
    const link = deps.appUrl ? ` ${deps.appUrl}` : "";
    for (const p of cands) {
      await notify(
        p.phone, null, "abonnement_invite", r.mode === "atelier" ? "Un client cherche un garage près de vous" : "Une demande de dépannage près de vous",
        `Il y a une demande ${r.mode === "atelier" ? "de passage au garage" : "de dépannage"} près de vous (${r.label || r.service}, ${r.zone_name || "votre zone"}). Abonnez-vous à DiagAssist pour faire une offre de prix.${link}`,
        "force"
      );
    }
    if (cands.length) await logEvent(pool, requestId, "systeme", "systeme", "invitation_abonnement", { meta: { count: cands.length } });
  }

  // Analyse automatique DiagAssist : synthèse des symptômes et médias, transmise aux mécaniciens comme
  // piste à vérifier. Limitée à 20 s ; en cas d'échec, la demande part quand même sans analyse.
  async function analyzeRequest(id: string): Promise<void> {
    if (!deps.analyze) return;
    try {
      const r = (await pool.query("SELECT * FROM assistance_requests WHERE id=$1", [id])).rows[0];
      if (!r) return;
      const m = (await pool.query("SELECT mime, data, kind FROM assistance_media WHERE request_id=$1 ORDER BY created_at LIMIT 4", [id])).rows;
      const text = await Promise.race([
        deps.analyze({ service: r.service, vehicle: r.vehicle, symptoms: r.symptoms || r.description || "", faultCodes: r.fault_codes, media: m.map((x) => ({ mime: x.mime, data: x.data })) }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 20000)),
      ]);
      if (text) {
        await pool.query("UPDATE assistance_requests SET ai_analysis=$2, updated_at=$3 WHERE id=$1", [id, clean(text, 3000), Date.now()]);
        await logEvent(pool, id, "systeme", "systeme", "analyse_ia");
      }
    } catch (e: any) {
      console.warn("[ASSISTANCE] Analyse IA indisponible:", e?.message || e);
    }
  }

  async function cancelRequest(id: string, actor: string, role: "client" | "pro" | "admin" | "systeme", reason: string) {
    let clientPhone = "", proPhone: string | null = null;
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!r || (role === "client" && r.client_phone !== actor)) throw new AssistanceError(404, "Demande introuvable.");
      if (!canTransition(r.status, "annulee")) throw new AssistanceError(409, "Cette demande ne peut plus être annulée.");
      if (role === "client" && !CLIENT_CANCELLABLE.includes(r.status)) throw new AssistanceError(409, "L'intervention a commencé : contactez l'assistance DiagAssist pour l'annuler.");
      const now = Date.now();
      await c.query(`UPDATE assistance_requests SET status='annulee', cancel_reason=$2, updated_at=$3, completed_at=$3 WHERE id=$1`, [id, clean(reason, 300) || null, now]);
      // Clôture les anciennes propositions et l'affectation en cours.
      await c.query(`UPDATE assistance_offers SET status='annulee', responded_at=$2 WHERE request_id=$1 AND status IN ('envoyee','offre_faite')`, [id, now]);
      await c.query(`UPDATE assistance_assignments SET ended_at=$2, ended_reason='annulation' WHERE request_id=$1 AND ended_at IS NULL`, [id, now]);
      await logEvent(c, id, actor, role, "annulation", { from: r.status, to: "annulee", reason });
      clientPhone = r.client_phone; proPhone = r.assigned_phone;
    });
    if (proPhone) {
      await clearLocationIfIdle(proPhone);
      await notify(proPhone, id, "mission_annulee", "Mission annulée", "Le client a annulé la demande. Le partage de position est arrêté.", true);
    }
    if (role !== "client") await notify(clientPhone, id, "demande_annulee", "Demande annulée", "Votre demande d'assistance a été annulée.");
  }

  async function retryRequest(id: string, clientPhone: string) {
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!r || r.client_phone !== clientPhone) throw new AssistanceError(404, "Demande introuvable.");
      if (r.status !== "sans_disponibilite") throw new AssistanceError(409, "Cette demande n'est pas en attente de nouvel essai.");
      const now = Date.now();
      await c.query(`UPDATE assistance_requests SET status='recherche', search_started_at=$2, updated_at=$2 WHERE id=$1`, [id, now]);
      await logEvent(c, id, clientPhone, "client", "nouvel_essai", { from: "sans_disponibilite", to: "recherche" });
    });
    await dispatch(id);
  }

  async function requestManual(id: string, clientPhone: string) {
    const r = await pool.query(
      `UPDATE assistance_requests SET manual_requested=true, updated_at=$3 WHERE id=$1 AND client_phone=$2 AND status IN ('recherche','sans_disponibilite') RETURNING id`,
      [id, clientPhone, Date.now()]
    );
    if (!r.rowCount) throw new AssistanceError(409, "Prise en charge manuelle impossible pour cette demande.");
    await logEvent(pool, id, clientPhone, "client", "prise_en_charge_manuelle");
  }

  // ---------- Affectation ----------
  // Envoi simultané à plusieurs mécaniciens de la zone (les plus proches d'abord). Chacun peut faire une
  // OFFRE DE PRIX (bidOffer) ; le client compare et choisit (selectBid). Tant qu'il reste une proposition
  // ouverte ou une offre valide, la demande reste en `recherche`. Quand plus rien n'est ouvert (tout a
  // expiré ou été refusé), la vague suivante part, jusqu'à `max_candidates` professionnels au total,
  // puis `sans_disponibilite` : jamais de blocage indéfini.
  async function dispatch(requestId: string): Promise<void> {
    const settings = await getSettings();
    let offered: string[] = [];
    let offeredAtelier = false;
    let noneFor: string | null = null;
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [requestId])).rows[0];
      if (!r || r.status !== "recherche") return;
      const now = Date.now();
      await c.query(`UPDATE assistance_offers SET status='expiree', responded_at=$2 WHERE request_id=$1 AND ((status='envoyee' AND expires_at<=$2) OR (status='offre_faite' AND bid_expires_at<=$2))`, [requestId, now]);
      const open = await c.query(`SELECT 1 FROM assistance_offers WHERE request_id=$1 AND status IN ('envoyee','offre_faite')`, [requestId]);
      if (open.rowCount) return;
      const round = Number(r.search_started_at || r.created_at);
      const tried = (await c.query(`SELECT COUNT(*)::int n FROM assistance_offers WHERE request_id=$1 AND sent_at>=$2`, [requestId, round])).rows[0].n;
      let chosen: { phone: string; km: number }[] = [];
      const room = Math.min(settings.broadcast_size, settings.max_candidates - tried);
      const atelier = r.mode === "atelier";
      if (room > 0 && r.zone_id) {
        // Dépannage : position fraîche exigée (le mécanicien se déplace). Atelier : la dernière position
        // partagée sert de position du garage (fixe), seule sa présence est requise.
        const minLoc = atelier ? 0 : now - settings.location_max_age_min * 60000;
        const cands = (await c.query(
          `SELECT p.phone, p.last_lat, p.last_lng FROM assistance_pros p
           WHERE p.validation_status='valide' AND p.available AND p.mobility = ANY($8) AND p.last_lat IS NOT NULL AND p.last_lng IS NOT NULL
             AND $1 = ANY(p.specialties) AND $2 = ANY(p.zone_ids) AND COALESCE(p.last_loc_at,0) >= $3 AND p.phone <> $4
             AND NOT EXISTS (SELECT 1 FROM assistance_requests m WHERE m.assigned_phone=p.phone AND m.status = ANY($7))
             AND NOT EXISTS (SELECT 1 FROM assistance_offers o WHERE o.request_id=$5 AND o.pro_phone=p.phone AND o.sent_at>=$6)
             AND NOT EXISTS (SELECT 1 FROM assistance_assignments a WHERE a.request_id=$5 AND a.pro_phone=p.phone)`,
          [r.service, r.zone_id, minLoc, r.client_phone, requestId, round, ACTIVE_MISSION_STATUSES, atelier ? ["garage", "both"] : ["mobile", "both"]]
        )).rows;
        chosen = cands
          .filter((p) => deps.isProSubscribed(p.phone))
          .map((p) => ({ phone: p.phone as string, km: haversineKm(r.lat, r.lng, p.last_lat, p.last_lng) }))
          .filter((p) => p.km <= settings.search_radius_km)
          .sort((a, b) => a.km - b.km)
          .slice(0, room);
      }
      if (chosen.length) {
        for (const ch of chosen) {
          await c.query(
            `INSERT INTO assistance_offers (request_id, pro_phone, distance_km, sent_at, expires_at) VALUES ($1,$2,$3,$4,$5)`,
            [requestId, ch.phone, ch.km, now, now + settings.offer_timeout_s * 1000]
          );
        }
        await logEvent(c, requestId, "systeme", "systeme", "proposition", { meta: { mode: r.mode, pros: chosen.map((x) => x.phone), km: chosen.map((x) => Math.round(x.km * 10) / 10) } });
        offered = chosen.map((x) => x.phone);
        offeredAtelier = atelier;
      } else {
        await c.query(`UPDATE assistance_requests SET status='sans_disponibilite', updated_at=$2 WHERE id=$1`, [requestId, now]);
        await logEvent(c, requestId, "systeme", "systeme", "sans_disponibilite", { from: "recherche", to: "sans_disponibilite", reason: tried >= settings.max_candidates ? "candidats épuisés" : "aucun professionnel éligible" });
        noneFor = r.client_phone;
      }
    });
    for (const pro of offered) {
      await notify(pro, requestId, "mission_proposee", offeredAtelier ? "Un client cherche un garage près de vous" : "Nouvelle demande de dépannage près de vous", offeredAtelier ? "Faites votre offre de prix : le client compare les offres et choisit. Ouvrez DiagAssist." : "Faites votre offre de prix : le client compare les offres et choisit. Ouvrez DiagAssist.", true);
    }
    if (noneFor) await notify(noneFor, requestId, "sans_disponibilite", "Aucun mécanicien disponible", "Aucun professionnel n'est disponible pour le moment. Vous pouvez réessayer ou demander une prise en charge manuelle.");
  }

  async function dispatchTick(): Promise<void> {
    const now = Date.now();
    const expired = await pool.query(`UPDATE assistance_offers SET status='expiree', responded_at=$1 WHERE (status='envoyee' AND expires_at<=$1) OR (status='offre_faite' AND bid_expires_at<=$1) RETURNING request_id, pro_phone, bid_amount`, [now]);
    for (const e of expired.rows) await logEvent(pool, e.request_id, "systeme", "systeme", e.bid_amount != null ? "offre_expiree" : "proposition_expiree", { meta: { pro: e.pro_phone } });
    const pending = await pool.query(
      `SELECT r.id FROM assistance_requests r WHERE r.status='recherche' AND NOT EXISTS (SELECT 1 FROM assistance_offers o WHERE o.request_id=r.id AND o.status IN ('envoyee','offre_faite'))`
    );
    for (const r of pending.rows) await dispatch(r.id).catch((e) => console.error("[ASSISTANCE] dispatch", r.id, e.message));
  }

  let timer: NodeJS.Timeout | null = null;
  function startWorker() {
    if (timer) return;
    timer = setInterval(() => { dispatchTick().catch((e) => console.error("[ASSISTANCE] worker:", e.message)); }, 5000);
    timer.unref();
  }
  function stopWorker() { if (timer) { clearInterval(timer); timer = null; } }

  // ---------- Offres de prix (modèle « enchères inversées ») ----------
  const SELECT_PRO_CHECKS = async (c: PoolClient, proPhone: string, mode: "bid" | "select") => {
    const pro = (await c.query("SELECT * FROM assistance_pros WHERE phone=$1 FOR UPDATE", [proPhone])).rows[0];
    if (!pro || pro.validation_status !== "valide") return { code: "PRO_NOT_VALIDATED", status: mode === "bid" ? 403 : 409, message: mode === "bid" ? "Votre profil n'est pas validé." : "Ce mécanicien n'est plus disponible. Choisissez une autre offre." };
    if (!deps.isProSubscribed(proPhone)) return { code: "SUBSCRIPTION_REQUIRED", status: mode === "bid" ? 403 : 409, message: mode === "bid" ? "Votre abonnement DiagAssist n'est plus à jour." : "Ce mécanicien n'est plus disponible (abonnement non à jour). Choisissez une autre offre." };
    if (!pro.available) return { code: "PRO_UNAVAILABLE", status: 409, message: mode === "bid" ? "Passez disponible pour faire une offre." : "Ce mécanicien n'est plus disponible. Choisissez une autre offre." };
    const busy = await c.query(`SELECT 1 FROM assistance_requests WHERE assigned_phone=$1 AND status = ANY($2)`, [proPhone, ACTIVE_MISSION_STATUSES]);
    if (busy.rowCount) return { code: "PRO_BUSY", status: 409, message: mode === "bid" ? "Terminez votre mission en cours avant de faire une autre offre." : "Ce mécanicien a déjà une mission en cours. Choisissez une autre offre." };
    return { pro } as { pro: any };
  };

  // Offre (ou révision) d'un mécanicien : montant dans la fourchette du service, ETA facultatif. Une seule offre par
  // proposition, modifiable tant qu'elle n'est ni retenue ni expirée. La demande reste en `recherche`.
  async function bidOffer(offerId: number, proPhone: string, input: { amount?: unknown; etaMinutes?: unknown }) {
    const amount = Number(input?.amount);
    if (input?.amount === undefined || input?.amount === null || input?.amount === "" || !Number.isInteger(amount)) throw new AssistanceError(400, "Indiquez votre prix en F CFA (nombre entier).", "BID_INVALID");
    let eta: number | null = null;
    if (input?.etaMinutes !== undefined && input?.etaMinutes !== null && input?.etaMinutes !== "") {
      eta = Number(input.etaMinutes);
      if (!Number.isInteger(eta) || eta < 1 || eta > 240) throw new AssistanceError(400, "Le délai d'arrivée doit être entre 1 et 240 minutes.", "BID_INVALID");
    }
    const settings = await getSettings();
    let clientPhone = "", requestId = "", revised = false, atelier = false, finalEta = 0, validUntil = 0;
    await tx(async (c) => {
      const o0 = (await c.query("SELECT request_id, pro_phone FROM assistance_offers WHERE id=$1", [offerId])).rows[0];
      if (!o0 || o0.pro_phone !== proPhone) throw new AssistanceError(404, "Proposition introuvable.");
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [o0.request_id])).rows[0];
      const o = (await c.query("SELECT * FROM assistance_offers WHERE id=$1 FOR UPDATE", [offerId])).rows[0];
      const now = Date.now();
      requestId = o0.request_id;
      if (!r) throw new AssistanceError(404, "Proposition introuvable.");
      if (r.status !== "recherche") {
        if (r.assigned_phone) throw new AssistanceError(409, "Le client a déjà choisi un autre mécanicien.", "ALREADY_TAKEN");
        throw new AssistanceError(409, r.status === "annulee" ? "Cette demande a été annulée." : "Cette demande n'est plus ouverte.", "REQUEST_CLOSED");
      }
      const live = (o.status === "envoyee" && Number(o.expires_at) > now) || (o.status === "offre_faite" && Number(o.bid_expires_at) > now);
      if (!live) {
        if (o.status === "refusee") throw new AssistanceError(409, "Vous avez décliné cette demande.", "OFFER_CLOSED");
        if (o.status === "annulee" || o.status === "acceptee") throw new AssistanceError(409, "Cette proposition n'est plus ouverte.", "OFFER_CLOSED");
        throw new AssistanceError(409, "Cette proposition a expiré.", "OFFER_EXPIRED");
      }
      const chk: any = await SELECT_PRO_CHECKS(c, proPhone, "bid");
      if (chk.code) throw new AssistanceError(chk.status, chk.message, chk.code);
      const pro = chk.pro;
      const range = bidRange(settings.tariffs[r.service]);
      if (amount < range.min || amount > range.max) throw new AssistanceError(400, `Votre offre doit être comprise entre ${range.min} et ${range.max} F CFA.`, "BID_OUT_OF_RANGE");
      // ETA approximatif par défaut : dépannage = du mécanicien au client ; atelier = du client au garage.
      let km = Number(o.distance_km) || 0;
      if (pro.last_lat != null && pro.last_lng != null) km = haversineKm(r.lat, r.lng, pro.last_lat, pro.last_lng);
      finalEta = eta ?? estimateEtaMinutes(km, settings.avg_speed_kmh);
      revised = o.status === "offre_faite";
      validUntil = now + settings.bid_valid_s * 1000;
      await c.query(
        `UPDATE assistance_offers SET status='offre_faite', bid_amount=$2, bid_eta_min=$3, bid_at=$4, bid_expires_at=$5, bid_revised=bid_revised OR $6, responded_at=$4 WHERE id=$1`,
        [offerId, amount, finalEta, now, validUntil, revised]
      );
      await logEvent(c, r.id, proPhone, "pro", revised ? "offre_revisee" : "offre_prix", { meta: { amount, etaMinutes: finalEta } });
      clientPhone = r.client_phone; atelier = r.mode === "atelier";
    });
    await notify(clientPhone, requestId, "nouvelle_offre", revised ? "Offre mise à jour" : "Nouvelle offre",
      `${revised ? "Offre mise à jour" : "Nouvelle offre"} : ${amount} F CFA, ${atelier ? "vous arrivez au garage en" : "arrive dans"} ~${finalEta} min. Comparez et choisissez dans l'application.`, true);
    return offerId;
  }

  // Choix du client — ATOMIQUE : verrou de la demande, offre encore valide, mécanicien toujours éligible. L'index unique
  // d'affectation active reste la garantie ultime. Le prix de l'offre retenue devient le montant convenu.
  async function selectBid(requestId: string, offerId: number, clientPhone: string) {
    let proPhone = "", amount = 0, atelier = false, others: string[] = [], failure: AssistanceError | null = null;
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [requestId])).rows[0];
      if (!r || r.client_phone !== clientPhone) throw new AssistanceError(404, "Demande introuvable.");
      if (r.status !== "recherche") throw new AssistanceError(409, r.assigned_phone ? "Vous avez déjà choisi un mécanicien pour cette demande." : "Cette demande n'est plus en cours de recherche.", "NOT_SEARCHING");
      const o = (await c.query("SELECT * FROM assistance_offers WHERE id=$1 AND request_id=$2 FOR UPDATE", [offerId, requestId])).rows[0];
      if (!o) throw new AssistanceError(404, "Offre introuvable.");
      const now = Date.now();
      if (o.status !== "offre_faite" || Number(o.bid_expires_at) <= now) throw new AssistanceError(409, "Cette offre n'est plus valable. Choisissez une autre offre.", "BID_EXPIRED");
      const chk: any = await SELECT_PRO_CHECKS(c, o.pro_phone, "select");
      if (chk.code) {
        // Le mécanicien n'est plus éligible : son offre est retirée (validée en base) et le client est informé clairement.
        await c.query(`UPDATE assistance_offers SET status='annulee', responded_at=$2 WHERE id=$1`, [offerId, now]);
        await logEvent(c, requestId, "systeme", "systeme", "offre_retiree", { meta: { pro: o.pro_phone, code: chk.code } });
        failure = new AssistanceError(409, chk.message, chk.code);
        return;
      }
      proPhone = o.pro_phone; amount = Number(o.bid_amount); atelier = r.mode === "atelier";
      const rest = await c.query(`SELECT pro_phone FROM assistance_offers WHERE request_id=$1 AND id<>$2 AND status IN ('envoyee','offre_faite')`, [requestId, offerId]);
      others = rest.rows.map((x) => x.pro_phone);
      await c.query(`UPDATE assistance_offers SET status='acceptee', responded_at=$2 WHERE id=$1`, [offerId, now]);
      await c.query(`UPDATE assistance_offers SET status='annulee', responded_at=$2 WHERE request_id=$1 AND id<>$3 AND status IN ('envoyee','offre_faite')`, [requestId, now, offerId]);
      await c.query(`INSERT INTO assistance_assignments (request_id, pro_phone, assigned_at, assigned_by) VALUES ($1,$2,$3,$4)`, [requestId, proPhone, now, clientPhone]);
      // Atelier : double accord atteint (le pro s'est engagé en faisant son offre, le client valide) → visite confirmée d'emblée.
      await c.query(
        `UPDATE assistance_requests SET status='affectee', assigned_phone=$2, assigned_at=$3, updated_at=$3, amount_due=$4, visit_status=$5 WHERE id=$1`,
        [requestId, proPhone, now, amount, atelier ? "confirmee" : "aucune"]
      );
      await logEvent(c, requestId, clientPhone, "client", "selection_offre", { from: "recherche", to: "affectee", meta: { pro: proPhone, amount, mode: r.mode, offer: offerId } });
      if (atelier) await logEvent(c, requestId, clientPhone, "client", "visite_confirmee", { meta: { pro: proPhone, via: "selection_offre" } });
    });
    if (failure) throw failure;
    await notify(proPhone, requestId, "offre_retenue", "Le client vous a choisi",
      atelier ? `Le client vous a choisi, ${amount} F CFA. Il se rendra à votre garage : vous pouvez le joindre depuis la mission.` : `Le client vous a choisi, ${amount} F CFA. Ouvrez la mission pour voir les détails.`, true);
    for (const p of others) await notify(p, requestId, "offre_non_retenue", "Demande attribuée", "Le client a choisi un autre mécanicien.");
    return requestId;
  }

  async function declineOffer(offerId: number, proPhone: string) {
    const r = await pool.query(`UPDATE assistance_offers SET status='refusee', responded_at=$3 WHERE id=$1 AND pro_phone=$2 AND status IN ('envoyee','offre_faite') RETURNING request_id`, [offerId, proPhone, Date.now()]);
    if (!r.rowCount) throw new AssistanceError(409, "Cette proposition n'est plus ouverte.");
    await logEvent(pool, r.rows[0].request_id, proPhone, "pro", "proposition_refusee");
    await dispatch(r.rows[0].request_id);
  }

  async function adminAssign(requestId: string, proPhone: string, admin: string) {
    let clientPhone = "";
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [requestId])).rows[0];
      if (!r) throw new AssistanceError(404, "Demande introuvable.");
      if (!["recherche", "sans_disponibilite", "affectee", "en_route", "sur_place"].includes(r.status)) throw new AssistanceError(409, "Cette demande ne peut plus être réaffectée.");
      const pro = (await c.query("SELECT * FROM assistance_pros WHERE phone=$1 FOR UPDATE", [proPhone])).rows[0];
      if (!pro || pro.validation_status !== "valide") throw new AssistanceError(400, "Ce professionnel n'est pas validé.");
      if (!pro.specialties.includes(r.service)) throw new AssistanceError(400, "Ce professionnel n'est pas compétent pour ce service.");
      if (pro.phone === r.client_phone) throw new AssistanceError(400, "Un professionnel ne peut pas traiter sa propre demande.");
      if (!deps.isProSubscribed(pro.phone)) throw new AssistanceError(400, "Ce professionnel n'est pas à jour de son abonnement.");
      const busy = await c.query(`SELECT 1 FROM assistance_requests WHERE assigned_phone=$1 AND status = ANY($2) AND id<>$3`, [proPhone, ACTIVE_MISSION_STATUSES, requestId]);
      if (busy.rowCount) throw new AssistanceError(409, "Ce professionnel a déjà une mission en cours.");
      const now = Date.now();
      // Annule les offres en cours (y compris une offre déjà retenue) : le prix convenu redevient le tarif affiché.
      await c.query(`UPDATE assistance_offers SET status='annulee', responded_at=$2 WHERE request_id=$1 AND status IN ('envoyee','offre_faite','acceptee')`, [requestId, now]);
      await c.query(`UPDATE assistance_assignments SET ended_at=$2, ended_reason='reaffectation' WHERE request_id=$1 AND ended_at IS NULL`, [requestId, now]);
      await c.query(`INSERT INTO assistance_assignments (request_id, pro_phone, assigned_at, assigned_by) VALUES ($1,$2,$3,$4)`, [requestId, proPhone, now, admin]);
      const tariff = (await getSettings()).tariffs[r.service]?.indicatif ?? 0;
      await c.query(`UPDATE assistance_quotes SET status='remplace' WHERE request_id=$1 AND status IN ('propose','accepte')`, [requestId]);
      await c.query(`UPDATE assistance_requests SET status='affectee', quote_status='aucun', assigned_phone=$2, assigned_at=$3, updated_at=$3, amount_due=$5, visit_status=$4 WHERE id=$1`, [requestId, proPhone, now, r.mode === "atelier" ? "proposee" : "aucune", tariff]);
      await logEvent(c, requestId, admin, "admin", "affectation_manuelle", { from: r.status, to: "affectee", meta: { pro: proPhone, previous: r.assigned_phone } });
      clientPhone = r.client_phone;
      if (r.assigned_phone && r.assigned_phone !== proPhone) await notify(r.assigned_phone, requestId, "mission_retiree", "Mission réaffectée", "Cette mission a été confiée à un autre professionnel.");
    });
    await notify(proPhone, requestId, "mission_assignee", "Mission assignée", "DiagAssist vous a confié une mission. Ouvrez-la pour voir les détails.", true);
    await notify(clientPhone, requestId, "mission_acceptee", "Mécanicien trouvé", "Un mécanicien a été affecté à votre demande. S'il s'agit d'un garage, confirmez votre venue dans l'application.", true);
  }

  async function redispatch(requestId: string, actor: string, role: "admin" | "pro", reason: string, expectedPro?: string) {
    let prevPro: string | null = null, clientPhone = "";
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [requestId])).rows[0];
      if (!r) throw new AssistanceError(404, "Demande introuvable.");
      if (expectedPro && r.assigned_phone !== expectedPro) throw new AssistanceError(404, "Mission introuvable.");
      if (!["sans_disponibilite", "recherche", "affectee", "en_route", "sur_place"].includes(r.status)) throw new AssistanceError(409, "Cette demande ne peut plus être relancée.");
      const now = Date.now();
      await c.query(`UPDATE assistance_offers SET status='annulee', responded_at=$2 WHERE request_id=$1 AND status IN ('envoyee','offre_faite','acceptee')`, [requestId, now]);
      await c.query(`UPDATE assistance_assignments SET ended_at=$2, ended_reason=$3 WHERE request_id=$1 AND ended_at IS NULL`, [requestId, now, role === "pro" ? "desistement" : "reaffectation"]);
      // Le prix convenu était propre à ce mécanicien : retour au tarif affiché pour la nouvelle recherche.
      const tariff = (await getSettings()).tariffs[r.service]?.indicatif ?? 0;
      await c.query(`UPDATE assistance_quotes SET status='remplace' WHERE request_id=$1 AND status IN ('propose','accepte')`, [requestId]);
      await c.query(`UPDATE assistance_requests SET status='recherche', assigned_phone=NULL, assigned_at=NULL, search_started_at=$2, updated_at=$2, visit_status='aucune', amount_due=$3, quote_status='aucun' WHERE id=$1`, [requestId, now, tariff]);
      await logEvent(c, requestId, actor, role, role === "pro" ? "desistement" : "relance_recherche", { from: r.status, to: "recherche", reason });
      prevPro = r.assigned_phone; clientPhone = r.client_phone;
    });
    if (prevPro) await clearLocationIfIdle(prevPro);
    await notify(clientPhone, requestId, "recherche_relancee", "Nous cherchons un autre mécanicien", "Votre mécanicien n'est plus disponible : nous en cherchons un autre.");
    await dispatch(requestId);
  }

  // ---------- Déroulé de la mission ----------
  async function proProgress(requestId: string, proPhone: string, to: RequestStatus, admin?: string) {
    let clientPhone = "", prev = "";
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [requestId])).rows[0];
      if (!r || (!admin && r.assigned_phone !== proPhone)) throw new AssistanceError(404, "Mission introuvable.");
      if (!["en_route", "sur_place", "en_intervention", "terminee"].includes(to)) throw new AssistanceError(400, "Étape invalide.");
      const atelier = r.mode === "atelier";
      if (atelier && r.visit_status !== "confirmee") throw new AssistanceError(409, "Le client n'a pas encore confirmé sa venue : la mission ne peut pas avancer.", "VISIT_NOT_CONFIRMED");
      if (atelier && to === "en_route") throw new AssistanceError(409, "En mode atelier, c'est le client qui indique son départ.", "CLIENT_TRAVELS");
      // Atelier : si le client arrive sans avoir appuyé sur « Je pars », le pro peut marquer son arrivée directement.
      const direct = atelier && r.status === "affectee" && to === "sur_place";
      if (!direct && !canTransition(r.status, to)) throw new AssistanceError(409, `Impossible de passer de « ${statusLabelFor(r)} » à « ${STATUS_LABELS[to]} ».`);
      if (to === "en_intervention" && !canStartWork(r)) throw new AssistanceError(409, "Le client doit d'abord accepter le devis avant de commencer.", "QUOTE_NOT_ACCEPTED");
      const now = Date.now();
      let amountDue = r.amount_due;
      if (to === "terminee") {
        if (r.quote_status === "propose") throw new AssistanceError(409, "Un devis attend l'accord du client : l'intervention ne peut pas être terminée.", "QUOTE_PENDING");
        // Prix de l'offre retenue + travaux supplémentaires acceptés ; sans offre : somme des devis acceptés, sinon le tarif affiché.
        const sum = (await c.query(`SELECT COALESCE(SUM(total),0)::int s FROM assistance_quotes WHERE request_id=$1 AND status='accepte'`, [requestId])).rows[0].s;
        const tariff = (await getSettings()).tariffs[r.service]?.indicatif ?? 0;
        const base = await agreedBid(c, r);
        amountDue = base != null ? base + sum : sum > 0 ? sum : r.quote_status === "refuse" ? 0 : tariff;
        if (amountDue <= 0) throw new AssistanceError(409, "Aucun devis accepté : établissez un devis avant de terminer.", "NO_QUOTE");
      }
      await c.query(
        `UPDATE assistance_requests SET status=$2, amount_due=$3, updated_at=$4, completed_at=$5 WHERE id=$1`,
        [requestId, to, amountDue, now, to === "terminee" ? now : r.completed_at]
      );
      await logEvent(c, requestId, admin || proPhone, admin ? "admin" : "pro", "etape", { from: r.status, to });
      clientPhone = r.client_phone; prev = r.status;
    });
    if (to === "terminee") await clearLocationIfIdle(proPhone);
    const atelierNow = (await getRequestRow(requestId))?.mode === "atelier";
    const msgs: Partial<Record<RequestStatus, [string, string, string]>> = {
      en_route: ["mecanicien_en_route", "Votre mécanicien est en route", "Il se dirige vers vous."],
      sur_place: atelierNow ? ["arrivee_enregistree", "Arrivée enregistrée", "Le garage a enregistré votre arrivée."] : ["mecanicien_arrive", "Votre mécanicien est arrivé", "Il est sur place."],
      en_intervention: ["intervention_commencee", "Intervention en cours", "Le mécanicien a commencé les travaux."],
      terminee: ["intervention_terminee", "Intervention terminée", "Consultez le récapitulatif et réglez en ligne depuis l'application."],
    };
    const m = msgs[to];
    if (m) await notify(clientPhone, requestId, m[0], m[1], m[2], to === "sur_place" || to === "terminee");
    return prev;
  }

  // Prix convenu à la sélection d'une offre (offre retenue du mécanicien actuellement affecté), sinon null.
  async function agreedBid(c: Pool | PoolClient, r: any): Promise<number | null> {
    if (!r.assigned_phone) return null;
    const o = (await c.query(`SELECT bid_amount FROM assistance_offers WHERE request_id=$1 AND pro_phone=$2 AND status='acceptee' AND bid_amount IS NOT NULL ORDER BY id DESC LIMIT 1`, [r.id, r.assigned_phone])).rows[0];
    return o ? Number(o.bid_amount) : null;
  }

  // Le travail peut commencer si le devis est accepté, ou si le tarif du service est connu et qu'aucun devis n'est en discussion.
  const canStartWork = (r: any) => r.quote_status === "accepte" || (r.quote_status === "aucun" && Number(r.amount_due) > 0);

  // ---------- Mode atelier : confirmation de visite ----------
  // Avec le modèle d'offres de prix, le choix du client (selectBid) vaut confirmation (`visit_status='confirmee'`).
  // Cette étape ne subsiste que pour une affectation manuelle par l'admin (`proposee`) : le client confirme ou refuse ici.
  async function decideVisit(requestId: string, clientPhone: string, accept: boolean) {
    let proPhone = "";
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [requestId])).rows[0];
      if (!r || r.client_phone !== clientPhone) throw new AssistanceError(404, "Demande introuvable.");
      if (r.mode !== "atelier") throw new AssistanceError(409, "Cette demande n'est pas une visite en garage.");
      if (r.status !== "affectee" || r.visit_status !== "proposee" || !r.assigned_phone) throw new AssistanceError(409, "Aucun garage n'attend votre confirmation.", "NO_VISIT_PROPOSED");
      const now = Date.now();
      proPhone = r.assigned_phone;
      if (accept) {
        await c.query(`UPDATE assistance_requests SET visit_status='confirmee', updated_at=$2 WHERE id=$1`, [requestId, now]);
        await logEvent(c, requestId, clientPhone, "client", "visite_confirmee", { meta: { pro: proPhone } });
      } else {
        // Refus : le pro est libéré et exclu pour cette demande (l'affectation terminée l'écarte du redispatch).
        await c.query(`UPDATE assistance_offers SET status='annulee', responded_at=$2 WHERE request_id=$1 AND status IN ('envoyee','offre_faite','acceptee')`, [requestId, now]);
        await c.query(`UPDATE assistance_assignments SET ended_at=$2, ended_reason='refus_client' WHERE request_id=$1 AND ended_at IS NULL`, [requestId, now]);
        const tariff = (await getSettings()).tariffs[r.service]?.indicatif ?? 0;
        await c.query(`UPDATE assistance_requests SET status='recherche', assigned_phone=NULL, assigned_at=NULL, visit_status='aucune', search_started_at=$2, updated_at=$2, amount_due=$3 WHERE id=$1`, [requestId, now, tariff]);
        await logEvent(c, requestId, clientPhone, "client", "visite_refusee", { from: "affectee", to: "recherche", meta: { pro: proPhone } });
      }
    });
    if (accept) {
      await notify(proPhone, requestId, "visite_confirmee", "Le client confirme sa venue", "Le client a confirmé : il se rendra à votre garage. Vous pouvez désormais le joindre depuis la mission.", true);
    } else {
      await clearLocationIfIdle(proPhone);
      await notify(proPhone, requestId, "visite_refusee", "Le client ne vient pas", "Le client a choisi un autre garage. Vous êtes de nouveau disponible.");
      await notify(clientPhone, requestId, "recherche_relancee", "Nous cherchons un autre garage", "Nous recherchons un autre mécanicien proche de vous.");
      await dispatch(requestId);
    }
  }

  // Atelier : le client appuie sur « Je pars » une fois sa venue confirmée.
  async function clientLeaving(requestId: string, clientPhone: string) {
    let proPhone = "";
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [requestId])).rows[0];
      if (!r || r.client_phone !== clientPhone) throw new AssistanceError(404, "Demande introuvable.");
      if (r.mode !== "atelier") throw new AssistanceError(409, "Cette action concerne uniquement une visite en garage.");
      if (r.status !== "affectee" || r.visit_status !== "confirmee") throw new AssistanceError(409, "Confirmez d'abord votre venue au garage proposé.", "VISIT_NOT_CONFIRMED");
      const now = Date.now();
      await c.query(`UPDATE assistance_requests SET status='en_route', updated_at=$2 WHERE id=$1`, [requestId, now]);
      await logEvent(c, requestId, clientPhone, "client", "depart_client", { from: "affectee", to: "en_route" });
      proPhone = r.assigned_phone;
    });
    await notify(proPhone, requestId, "client_en_route", "Le client est en route", "Le client est parti vers votre garage.", true);
  }

  async function setProDiagnosis(requestId: string, proPhone: string, text: string) {
    const r = await pool.query(`UPDATE assistance_requests SET pro_diagnosis=$3, updated_at=$4 WHERE id=$1 AND assigned_phone=$2 AND status IN ('sur_place','en_intervention','terminee') RETURNING id`, [requestId, proPhone, clean(text, 4000), Date.now()]);
    if (!r.rowCount) throw new AssistanceError(409, "Le diagnostic se renseigne une fois sur place.");
    await logEvent(pool, requestId, proPhone, "pro", "diagnostic_pro");
  }

  // ---------- Devis ----------
  async function proposeQuote(requestId: string, proPhone: string, input: any) {
    const parsed = parseQuoteLines(input.lines);
    if (parsed.ok === false) throw new AssistanceError(400, parsed.message);
    let kind = input.kind === "supplementaire" ? "supplementaire" : "initial";
    let clientPhone = "";
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [requestId])).rows[0];
      if (!r || r.assigned_phone !== proPhone) throw new AssistanceError(404, "Mission introuvable.");
      // Prix déjà convenu à la sélection de l'offre : tout devis est un supplément soumis à l'accord du client.
      const bid = await agreedBid(c, r);
      if (bid != null) kind = "supplementaire";
      if (!["sur_place", "en_intervention"].includes(r.status)) throw new AssistanceError(409, "Le devis s'établit une fois sur place.");
      if (r.quote_status === "propose") throw new AssistanceError(409, "Un devis attend déjà l'accord du client.");
      const hasAccepted = (await c.query(`SELECT 1 FROM assistance_quotes WHERE request_id=$1 AND status='accepte' AND kind='initial'`, [requestId])).rowCount;
      if (kind === "initial" && hasAccepted) throw new AssistanceError(409, "Le devis initial est déjà accepté : proposez un devis supplémentaire.");
      if (kind === "supplementaire" && !hasAccepted && bid == null) throw new AssistanceError(409, "Un devis supplémentaire suppose un devis initial accepté.");
      const version = (await c.query(`SELECT COALESCE(MAX(version),0)+1 v FROM assistance_quotes WHERE request_id=$1`, [requestId])).rows[0].v;
      const now = Date.now();
      await c.query(
        `INSERT INTO assistance_quotes (request_id, version, kind, lines, total, status, note, created_by, created_at) VALUES ($1,$2,$3,$4,$5,'propose',$6,$7,$8)`,
        [requestId, version, kind, JSON.stringify(parsed.lines), parsed.total, input.note ? clean(input.note, 500) : null, proPhone, now]
      );
      await c.query(`UPDATE assistance_requests SET quote_status='propose', updated_at=$2 WHERE id=$1`, [requestId, now]);
      await logEvent(c, requestId, proPhone, "pro", kind === "initial" ? "devis_propose" : "devis_supplementaire_propose", { meta: { version, total: parsed.total } });
      clientPhone = r.client_phone;
    });
    await notify(clientPhone, requestId, "devis_disponible", kind === "initial" ? "Devis disponible" : "Travaux supplémentaires à valider", "Consultez le devis et donnez votre accord.", true);
  }

  async function decideQuote(requestId: string, quoteId: number, clientPhone: string, accept: boolean, actorRole: "client" | "admin" = "client") {
    let proPhone = "";
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [requestId])).rows[0];
      if (!r || (actorRole === "client" && r.client_phone !== clientPhone)) throw new AssistanceError(404, "Demande introuvable.");
      const q = (await c.query("SELECT * FROM assistance_quotes WHERE id=$1 AND request_id=$2 FOR UPDATE", [quoteId, requestId])).rows[0];
      if (!q || q.status !== "propose") throw new AssistanceError(409, "Ce devis n'attend plus de réponse.");
      if (!ACTIVE_MISSION_STATUSES.includes(r.status)) throw new AssistanceError(409, "Cette demande n'est plus en cours.");
      const now = Date.now();
      await c.query(`UPDATE assistance_quotes SET status=$2, decided_at=$3, decided_by=$4 WHERE id=$1`, [quoteId, accept ? "accepte" : "refuse", now, clientPhone]);
      // Statut global du devis : accepté dès qu'un devis est accepté ; un refus d'un supplément laisse le devis initial accepté.
      const accepted = (await c.query(`SELECT 1 FROM assistance_quotes WHERE request_id=$1 AND status='accepte'`, [requestId])).rowCount;
      // Montant convenu = prix de l'offre retenue + suppléments acceptés ; sans offre : somme des devis acceptés, sinon tarif affiché.
      const sum = (await c.query(`SELECT COALESCE(SUM(total),0)::int s FROM assistance_quotes WHERE request_id=$1 AND status='accepte'`, [requestId])).rows[0].s;
      const tariff = (await getSettings()).tariffs[r.service]?.indicatif ?? 0;
      const base = await agreedBid(c, r);
      // Avec un prix convenu, le refus d'un supplément ne bloque pas la mission (retour à « aucun devis »).
      const qs = accepted ? "accepte" : base != null ? "aucun" : "refuse";
      await c.query(`UPDATE assistance_requests SET quote_status=$2, amount_due=$4, updated_at=$3 WHERE id=$1`, [requestId, qs, now, base != null ? base + sum : sum > 0 ? sum : tariff]);
      await logEvent(c, requestId, clientPhone, actorRole, accept ? "devis_accepte" : "devis_refuse", { meta: { version: q.version, kind: q.kind, total: q.total } });
      proPhone = r.assigned_phone;
    });
    if (proPhone) await notify(proPhone, requestId, accept ? "devis_accepte" : "devis_refuse", accept ? "Devis accepté" : "Devis refusé", accept ? "Le client a donné son accord." : "Le client a refusé le devis.", true);
  }

  // ---------- Paiement via le système (Jèko) ----------
  // Le client règle la plateforme en mobile money ; DiagAssist ne lui facture rien en plus. À la confirmation
  // (webhook signé ou réconciliation auprès de Jèko, jamais par le client), la commission est calculée côté
  // serveur et le net est « à reverser » au mécanicien. Le montant vient toujours de la base (amount_due).
  async function startPayment(requestId: string, clientPhone: string, method: string, payerPhone: string | undefined, origin: string) {
    const r = (await pool.query("SELECT * FROM assistance_requests WHERE id=$1", [requestId])).rows[0];
    if (!r || r.client_phone !== clientPhone) throw new AssistanceError(404, "Demande introuvable.");
    if (r.status !== "terminee") throw new AssistanceError(409, "Le paiement s'ouvre une fois l'intervention terminée.");
    if (r.payment_status === "paye") throw new AssistanceError(409, "Cette intervention est déjà payée.");
    if (!(r.amount_due > 0)) throw new AssistanceError(409, "Aucun montant à payer.");
    if (!(PAYMENT_METHODS as readonly string[]).includes(method)) throw new AssistanceError(400, "Moyen de paiement invalide (Wave, Orange Money, MTN MoMo ou Moov Money).");
    if (!deps.jeko?.isConfigured()) throw new AssistanceError(503, "Le paiement en ligne n'est pas encore activé. Réessayez plus tard.", "PAYMENT_NOT_CONFIGURED");
    const recent = (await pool.query(`SELECT * FROM assistance_payments WHERE request_id=$1 AND status='en_attente' AND provider='jeko' AND created_at > $2 ORDER BY created_at DESC LIMIT 1`, [requestId, Date.now() - 10 * 60000])).rows[0];
    if (recent && recent.method === method && recent.redirect_url) return { reference: recent.reference, redirectUrl: recent.redirect_url, paymentStatus: "en_attente" };
    if (recent) throw new AssistanceError(409, "Un paiement est déjà en cours. Patientez quelques minutes avant de changer de moyen.");
    const reference = `dgas-${requestId}-${crypto.randomBytes(4).toString("hex")}`;
    const created = await deps.jeko.create({
      reference, amountXof: r.amount_due, paymentMethod: method,
      payerPhone: payerPhone ? normalizePhone(payerPhone) : undefined,
      successUrl: `${origin}/?assistance=${encodeURIComponent(requestId)}&payment=return`,
      errorUrl: `${origin}/?assistance=${encodeURIComponent(requestId)}&payment=return`,
    });
    const now = Date.now();
    await tx(async (c) => {
      await c.query(`UPDATE assistance_payments SET status='annule', updated_at=$2 WHERE request_id=$1 AND status='en_attente'`, [requestId, now]);
      await c.query(
        `INSERT INTO assistance_payments (reference, request_id, payer_phone, pro_phone, method, provider, amount, status, provider_ref, redirect_url, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'jeko',$6,'en_attente',$7,$8,$9,$9)`,
        [reference, requestId, clientPhone, r.assigned_phone, method, r.amount_due, created.id || null, created.redirectUrl || null, now]
      );
      await c.query(`UPDATE assistance_requests SET payment_status='en_attente', updated_at=$2 WHERE id=$1 AND payment_status<>'paye'`, [requestId, now]);
      await logEvent(c, requestId, clientPhone, "client", "paiement_initie", { meta: { reference, method, amount: r.amount_due } });
    });
    return { reference, redirectUrl: created.redirectUrl, paymentStatus: "en_attente" };
  }

  async function applyPaymentResult(reference: string, outcome: "paye" | "echoue", by: string) {
    await tx(async (c) => {
      const p = (await c.query("SELECT * FROM assistance_payments WHERE reference=$1 FOR UPDATE", [reference])).rows[0];
      if (!p) return;
      if (!["en_attente", "annule"].includes(p.status)) return; // déjà traité : idempotent, pas de double traitement
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [p.request_id])).rows[0];
      const now = Date.now();
      if (outcome === "paye") {
        const dup = r.payment_status === "paye";
        if (dup) {
          // Second règlement pour une intervention déjà payée : enregistré mais sans commission ni reversement (à rembourser).
          await c.query(`UPDATE assistance_payments SET status='paye', commission_pct=NULL, commission_amount=0, pro_amount=0, payout_status=NULL, confirmed_by=$2, updated_at=$3 WHERE reference=$1`, [reference, by, now]);
        } else {
          const settings = await getSettings();
          const pct = Math.min(100, Math.max(0, Number(settings.commission_pct)));
          const commission = Math.round((p.amount * pct) / 100);
          await c.query(
            `UPDATE assistance_payments SET status='paye', commission_pct=$2, commission_amount=$3, pro_amount=$4, payout_status='a_reverser', pro_phone=COALESCE(pro_phone,$5), confirmed_by=$6, updated_at=$7 WHERE reference=$1`,
            [reference, pct, commission, p.amount - commission, r.assigned_phone, by, now]
          );
          await c.query(`UPDATE assistance_requests SET payment_status='paye', updated_at=$2 WHERE id=$1`, [p.request_id, now]);
        }
        await logEvent(c, p.request_id, by, by === "jeko" ? "systeme" : "admin", dup ? "double_paiement_detecte" : "paiement_confirme", { meta: { reference, amount: p.amount } });
      } else {
        await c.query(`UPDATE assistance_payments SET status='echoue', updated_at=$2 WHERE reference=$1`, [reference, now]);
        if (r.payment_status !== "paye") {
          const other = (await c.query(`SELECT 1 FROM assistance_payments WHERE request_id=$1 AND reference<>$2 AND status='en_attente'`, [p.request_id, reference])).rowCount;
          if (!other) await c.query(`UPDATE assistance_requests SET payment_status='echoue', updated_at=$2 WHERE id=$1`, [p.request_id, now]);
        }
        await logEvent(c, p.request_id, by, "systeme", "paiement_echoue", { meta: { reference } });
      }
    });
    const pay = (await pool.query("SELECT request_id, payer_phone, pro_phone, pro_amount, payout_status FROM assistance_payments WHERE reference=$1", [reference])).rows[0];
    if (pay && outcome === "paye" && pay.payout_status === "a_reverser") {
      if (pay.pro_phone) await notify(pay.pro_phone, pay.request_id, "paiement_recu", "Paiement reçu", `Le client a réglé l'intervention : ${pay.pro_amount} F CFA vous seront reversés par DiagAssist.`, true);
      await notify(pay.payer_phone, pay.request_id, "paiement_confirme", "Paiement confirmé", "Merci, votre paiement est bien enregistré.");
    }
  }

  // Appelé par le webhook Jèko (signature déjà vérifiée par jeko.routes). Contrôle montant et identifiants.
  async function handleJekoWebhook(reference: string, status: string, body: any): Promise<boolean> {
    const p = (await pool.query("SELECT * FROM assistance_payments WHERE reference=$1", [reference])).rows[0];
    if (!p) return false;
    if (p.provider !== "jeko") return true;
    if (!["en_attente", "annule"].includes(p.status)) return true;
    const webhookAmount = Number(body?.amount?.amount);
    if (Number.isFinite(webhookAmount) && webhookAmount !== p.amount * 100) {
      console.warn(`[ASSISTANCE][Webhook] Montant différent pour ${reference} : reçu=${webhookAmount}, attendu=${p.amount * 100}.`);
      return true;
    }
    const jid = body?.transactionDetails?.id;
    if (p.provider_ref && jid && String(jid) !== String(p.provider_ref)) {
      console.warn(`[ASSISTANCE][Webhook] Identifiant Jèko différent pour ${reference}.`);
      return true;
    }
    const s = status.toLowerCase();
    if (s === "success" || s === "completed") await applyPaymentResult(reference, "paye", "jeko");
    else await applyPaymentResult(reference, "echoue", "jeko");
    return true;
  }

  async function reconcilePayment(reference: string) {
    const p = (await pool.query("SELECT * FROM assistance_payments WHERE reference=$1", [reference])).rows[0];
    if (!p || p.status !== "en_attente" || p.provider !== "jeko" || !p.provider_ref || !deps.jeko?.isConfigured()) return;
    try {
      const s = (await deps.jeko.fetchStatus(p.provider_ref)).toLowerCase();
      if (s === "success" || s === "completed") await applyPaymentResult(reference, "paye", "jeko");
      else if (s === "error" || s === "failed") await applyPaymentResult(reference, "echoue", "jeko");
    } catch (e: any) {
      console.error("[ASSISTANCE] Réconciliation Jèko impossible:", e.message);
    }
  }

  // Reversement au mécanicien (admin) : le net d'un paiement confirmé est marqué comme reversé, une seule fois.
  async function markPayout(reference: string, admin: string) {
    let proPhone: string | null = null, requestId = "", amount = 0;
    await tx(async (c) => {
      const p = (await c.query("SELECT * FROM assistance_payments WHERE reference=$1 FOR UPDATE", [reference])).rows[0];
      if (!p) throw new AssistanceError(404, "Paiement introuvable.");
      if (p.status !== "paye" || p.payout_status !== "a_reverser") throw new AssistanceError(409, p.payout_status === "reverse" ? "Ce paiement a déjà été reversé au mécanicien." : "Ce paiement n'est pas à reverser.");
      const now = Date.now();
      await c.query(`UPDATE assistance_payments SET payout_status='reverse', payout_at=$2, payout_by=$3, updated_at=$2 WHERE reference=$1`, [reference, now, admin]);
      await logEvent(c, p.request_id, admin, "admin", "reversement_effectue", { meta: { reference, amount: p.pro_amount, pro: p.pro_phone } });
      proPhone = p.pro_phone; requestId = p.request_id; amount = p.pro_amount;
    });
    if (proPhone) await notify(proPhone, requestId, "reversement_effectue", "Reversement effectué", `DiagAssist vous a reversé ${amount} F CFA pour cette intervention.`, true);
  }

  const paymentView = (x: any, forPro = false) => x ? {
    reference: x.reference, method: x.method, amount: x.amount, status: x.status,
    ...(forPro ? { commissionAmount: x.commission_amount, proAmount: x.pro_amount, payoutStatus: x.payout_status, payoutAt: x.payout_at ? Number(x.payout_at) : null } : {}),
    redirectUrl: !forPro && x.status === "en_attente" ? x.redirect_url : null, updatedAt: Number(x.updated_at),
  } : null;

  async function proEarnings(phone: string) {
    const [agg, list, s] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(pro_amount) FILTER (WHERE payout_status IN ('a_reverser','reverse')),0)::bigint paid,
                         COALESCE(SUM(pro_amount) FILTER (WHERE payout_status='a_reverser'),0)::bigint to_receive,
                         COALESCE(SUM(pro_amount) FILTER (WHERE payout_status='reverse'),0)::bigint received
                  FROM assistance_payments WHERE pro_phone=$1 AND status='paye'`, [phone]),
      pool.query(`SELECT p.*, r.service FROM assistance_payments p JOIN assistance_requests r ON r.id=p.request_id WHERE p.pro_phone=$1 AND p.status IN ('paye','en_attente') ORDER BY p.created_at DESC LIMIT 100`, [phone]),
      getSettings(),
    ]);
    const labels = await serviceLabels();
    return {
      paid: Number(agg.rows[0].paid), toReceive: Number(agg.rows[0].to_receive), received: Number(agg.rows[0].received), commissionPct: s.commission_pct,
      payments: list.rows.map((x) => ({ ...paymentView(x, true), requestId: x.request_id, service: x.service, serviceLabel: labels[x.service] || x.service, grossAmount: x.amount, createdAt: Number(x.created_at) })),
    };
  }

  // ---------- Avis, réclamations ----------
  async function addReview(requestId: string, clientPhone: string, rating: number, comment: string) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new AssistanceError(400, "La note doit être entre 1 et 5.");
    const r = (await pool.query("SELECT * FROM assistance_requests WHERE id=$1", [requestId])).rows[0];
    if (!r || r.client_phone !== clientPhone) throw new AssistanceError(404, "Demande introuvable.");
    if (r.status !== "terminee" || !r.assigned_phone) throw new AssistanceError(409, "Vous pourrez noter l'intervention une fois terminée.");
    const ins = await pool.query(`INSERT INTO assistance_reviews (request_id, author_phone, pro_phone, rating, comment, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING request_id`, [requestId, clientPhone, r.assigned_phone, rating, clean(comment, 500) || null, Date.now()]);
    if (!ins.rowCount) throw new AssistanceError(409, "Vous avez déjà noté cette intervention.");
    await logEvent(pool, requestId, clientPhone, "client", "avis", { meta: { rating } });
  }

  async function addClaim(requestId: string, clientPhone: string, kind: string, message: string) {
    const r = (await pool.query("SELECT * FROM assistance_requests WHERE id=$1", [requestId])).rows[0];
    if (!r || r.client_phone !== clientPhone) throw new AssistanceError(404, "Demande introuvable.");
    const m = clean(message, 1000);
    if (m.length < 5) throw new AssistanceError(400, "Décrivez le problème en quelques mots.");
    await pool.query(`INSERT INTO assistance_claims (request_id, author_phone, kind, message, created_at) VALUES ($1,$2,$3,$4,$5)`, [requestId, clientPhone, clean(kind, 40) || "autre", m, Date.now()]);
    await logEvent(pool, requestId, clientPhone, "client", "reclamation", { meta: { kind } });
  }

  // ---------- Messages ----------
  async function addMessage(requestId: string, phone: string, role: "client" | "pro", body: string) {
    const b = clean(body, 1000);
    if (!b) throw new AssistanceError(400, "Message vide.");
    const r = (await pool.query("SELECT client_phone, assigned_phone, status FROM assistance_requests WHERE id=$1", [requestId])).rows[0];
    const ok = r && ((role === "client" && r.client_phone === phone) || (role === "pro" && r.assigned_phone === phone));
    if (!ok) throw new AssistanceError(404, "Conversation introuvable.");
    if (!r.assigned_phone) throw new AssistanceError(409, "La messagerie s'ouvre quand un mécanicien est affecté.");
    if (["annulee"].includes(r.status)) throw new AssistanceError(409, "Cette demande est annulée.");
    const ins = await pool.query(`INSERT INTO assistance_messages (request_id, from_phone, from_role, body, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [requestId, phone, role, b, Date.now()]);
    const to = role === "client" ? r.assigned_phone : r.client_phone;
    await notify(to, requestId, "message", "Nouveau message", b.slice(0, 80));
    return ins.rows[0].id;
  }

  async function listMessages(requestId: string, since = 0) {
    const m = await pool.query(`SELECT id, from_role, body, created_at FROM assistance_messages WHERE request_id=$1 AND id>$2 ORDER BY id LIMIT 200`, [requestId, since]);
    return m.rows.map((x) => ({ id: Number(x.id), fromRole: x.from_role, body: x.body, at: Number(x.created_at) }));
  }

  // ---------- Médias ----------
  async function storeMedia(owner: string, requestId: string | null, kind: string, mime: string, buf: Buffer): Promise<string> {
    if (requestId) {
      const n = await pool.query(`SELECT COUNT(*)::int n FROM assistance_media WHERE request_id=$1`, [requestId]);
      if (n.rows[0].n >= 8) throw new AssistanceError(400, "8 fichiers maximum par demande.");
    } else {
      const n = await pool.query(`SELECT COUNT(*)::int n FROM assistance_media WHERE owner_phone=$1 AND request_id IS NULL`, [owner]);
      if (n.rows[0].n >= 8) throw new AssistanceError(400, "8 fichiers maximum par demande.");
    }
    const id = crypto.randomBytes(12).toString("hex");
    await pool.query(`INSERT INTO assistance_media (id, request_id, owner_phone, kind, mime, size, data, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, requestId, owner, kind, mime, buf.length, buf, Date.now()]);
    return id;
  }

  // ---------- Vues ----------
  // `tariffs` (réglages) permet d'exposer le tarif affiché du service (`tariff`, null si non configuré).
  const summary = (r: any, serviceLabel?: string, tariffs?: Settings["tariffs"]) => ({
    id: r.id, status: r.status, statusLabel: statusLabelFor(r), mode: r.mode as RequestMode, immobilised: r.immobilised !== false, visitStatus: r.visit_status as string,
    service: r.service, serviceLabel: serviceLabel || r.service, tariff: tariffs?.[r.service]?.indicatif ?? null,
    vehicle: r.vehicle, symptoms: r.symptoms, quoteStatus: r.quote_status, paymentStatus: r.payment_status as string, amountAgreed: r.amount_due,
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), manualRequested: r.manual_requested,
  });

  async function serviceLabels(): Promise<Record<string, string>> {
    const s = await pool.query("SELECT code, label FROM assistance_services");
    return Object.fromEntries(s.rows.map((x) => [x.code, x.label]));
  }

  async function listForClient(phone: string) {
    const [r, labels, st] = await Promise.all([
      pool.query("SELECT * FROM assistance_requests WHERE client_phone=$1 ORDER BY created_at DESC LIMIT 100", [phone]),
      serviceLabels(), getSettings(),
    ]);
    return r.rows.map((x) => summary(x, labels[x.service], st.tariffs));
  }

  const CLIENT_TIMELINE: Record<string, string> = {
    envoi: "Demande envoyée", acceptation: "Mécanicien trouvé", selection_offre: "Mécanicien choisi", affectation_manuelle: "Mécanicien affecté par DiagAssist",
    sans_disponibilite: "Aucun mécanicien disponible", nouvel_essai: "Nouvelle recherche", relance_recherche: "Recherche relancée",
    desistement: "Le mécanicien n'est plus disponible, nouvelle recherche", annulation: "Demande annulée",
    devis_propose: "Devis proposé", devis_supplementaire_propose: "Travaux supplémentaires proposés", devis_accepte: "Devis accepté", devis_refuse: "Devis refusé",
    paiement_confirme: "Paiement confirmé", paiement_echoue: "Paiement échoué", paiement_initie: "Paiement lancé",
    visite_confirmee: "Venue au garage confirmée", visite_refusee: "Garage refusé, nouvelle recherche", depart_client: "Vous êtes en route vers le garage",
    avis: "Avis envoyé", reclamation: "Réclamation envoyée",
  };
  const STEP_LABELS: Record<string, string> = { en_route: "Mécanicien en route", sur_place: "Mécanicien arrivé", en_intervention: "Intervention commencée", terminee: "Intervention terminée" };

  // Offres de prix valides (non expirées, non annulées) reçues pour une demande en recherche, triées par prix puis délai.
  // Atelier : la position du garage est exacte et réservée au client propriétaire (appelé uniquement par clientDetail).
  async function clientBids(r: any, settings: Settings) {
    const rows = (await pool.query(
      `SELECT o.id, o.pro_phone, o.distance_km, o.bid_amount, o.bid_eta_min, o.bid_at, o.bid_expires_at, o.bid_revised,
              p.display_name, p.garage_name, p.specialties, p.last_lat, p.last_lng, p.last_loc_at, p.available
       FROM assistance_offers o JOIN assistance_pros p ON p.phone=o.pro_phone
       WHERE o.request_id=$1 AND o.status='offre_faite' AND o.bid_expires_at>$2 AND p.validation_status='valide'`,
      [r.id, Date.now()]
    )).rows.filter((x) => deps.isProSubscribed(x.pro_phone) && x.available);
    if (!rows.length) return [];
    const phones = rows.map((x) => x.pro_phone);
    const [rt, tr] = await Promise.all([
      pool.query("SELECT pro_phone, COUNT(*)::int n, AVG(rating)::float avg FROM assistance_reviews WHERE pro_phone = ANY($1) GROUP BY pro_phone", [phones]),
      pool.query("SELECT pro_phone, title, issuer FROM assistance_trainings WHERE pro_phone = ANY($1) AND status='verifiee' ORDER BY id", [phones]),
    ]);
    const atelier = r.mode === "atelier";
    return rows
      .map((x) => {
        const rating = rt.rows.find((y) => y.pro_phone === x.pro_phone);
        let km = Number(x.distance_km) || 0;
        if (x.last_lat != null && x.last_lng != null && r.lat != null) km = haversineKm(r.lat, r.lng, x.last_lat, x.last_lng);
        return {
          id: Number(x.id),
          pro: {
            displayName: x.display_name, garageName: x.garage_name, specialties: x.specialties,
            rating: rating ? { avg: Math.round(rating.avg * 10) / 10, count: rating.n } : null,
            photoUrl: null as string | null,
            trainings: tr.rows.filter((y) => y.pro_phone === x.pro_phone).map((y) => ({ title: y.title, issuer: y.issuer })),
            ...(atelier && x.last_lat != null ? { location: { lat: x.last_lat, lng: x.last_lng, updatedAt: Number(x.last_loc_at) } } : {}),
          },
          amount: Number(x.bid_amount), etaMinutes: Number(x.bid_eta_min), distanceKm: Math.round(km * 10) / 10, approximate: true as const,
          validUntil: Number(x.bid_expires_at), isRevised: !!x.bid_revised, sentAt: Number(x.bid_at),
        };
      })
      .sort((a, b) => a.amount - b.amount || a.etaMinutes - b.etaMinutes || a.sentAt - b.sentAt);
  }

  async function clientDetail(id: string, phone: string) {
    const r = (await pool.query("SELECT * FROM assistance_requests WHERE id=$1 AND client_phone=$2", [id, phone])).rows[0];
    if (!r) throw new AssistanceError(404, "Demande introuvable.");
    const settings = await getSettings();
    const [labels, quotes, ev, media, review, pay] = await Promise.all([
      serviceLabels(),
      pool.query(`SELECT id, version, kind, lines, total, currency, status, note, created_at, decided_at FROM assistance_quotes WHERE request_id=$1 ORDER BY version`, [id]),
      pool.query(`SELECT at, type, to_status FROM assistance_events WHERE request_id=$1 ORDER BY at, id`, [id]),
      pool.query(`SELECT id, kind, mime, size FROM assistance_media WHERE request_id=$1 ORDER BY created_at`, [id]),
      pool.query(`SELECT rating, comment, created_at FROM assistance_reviews WHERE request_id=$1`, [id]),
      pool.query(`SELECT reference, method, amount, status, created_at, updated_at, redirect_url FROM assistance_payments WHERE request_id=$1 ORDER BY created_at DESC LIMIT 1`, [id]),
    ]);
    const atelier = r.mode === "atelier";
    let pro: any = null;
    if (r.assigned_phone && r.status !== "annulee") {
      const p = (await pool.query("SELECT * FROM assistance_pros WHERE phone=$1", [r.assigned_phone])).rows[0];
      if (p) {
        const [rt, tr] = await Promise.all([
          pool.query("SELECT COUNT(*)::int n, AVG(rating)::float avg FROM assistance_reviews WHERE pro_phone=$1", [p.phone]),
          pool.query("SELECT title, issuer FROM assistance_trainings WHERE pro_phone=$1 AND status='verifiee' ORDER BY id", [p.phone]),
        ]);
        // Dépannage : position du mécanicien en route (fraîche). Atelier : position du garage (fixe), visible tout le trajet.
        const sharing = atelier ? ["affectee", "en_route", "sur_place"].includes(r.status) : ["affectee", "en_route"].includes(r.status);
        const fresh = atelier || (p.last_loc_at && Date.now() - Number(p.last_loc_at) <= settings.location_max_age_min * 60000);
        const loc = sharing && fresh && p.last_lat != null ? { lat: p.last_lat, lng: p.last_lng, updatedAt: Number(p.last_loc_at) } : null;
        let eta = null;
        if (loc && r.lat != null) {
          const km = haversineKm(loc.lat, loc.lng, r.lat, r.lng);
          // Atelier : trajet estimé du client jusqu'au garage ; dépannage : arrivée du mécanicien. Toujours approximatif.
        eta = { minutes: estimateEtaMinutes(km, settings.avg_speed_kmh), distanceKm: Math.round(km * 10) / 10, approximate: true };
        }
        const contactOpen = ACTIVE_MISSION_STATUSES.includes(r.status) || (r.status === "terminee" && Date.now() - Number(r.completed_at || 0) < 48 * 3600000);
        pro = {
          displayName: p.display_name, garageName: p.garage_name, specialties: p.specialties,
          rating: rt.rows[0].n ? { avg: Math.round(rt.rows[0].avg * 10) / 10, count: rt.rows[0].n } : null,
          phone: contactOpen ? p.phone : null, trainings: tr.rows, location: loc, eta,
        };
      }
    }
    const timeline = ev.rows
      .map((e) => ({ at: Number(e.at), label: e.type === "creation" ? "Demande créée" : e.type === "etape" ? (atelier && e.to_status === "sur_place" ? "Arrivée au garage" : STEP_LABELS[e.to_status]) : (atelier && e.type === "acceptation" ? "Garage proposé" : atelier && e.type === "selection_offre" ? "Garage choisi" : CLIENT_TIMELINE[e.type]), status: e.to_status || null }))
      .filter((e) => e.label);
    const hasReview = review.rowCount! > 0;
    const bids = r.status === "recherche" ? await clientBids(r, settings) : [];
    return {
      request: {
        ...summary(r, labels[r.service], settings.tariffs), faultCodes: r.fault_codes, description: r.description, contactPhone: r.contact_phone,
        position: { lat: r.lat, lng: r.lng, address: r.address, landmark: r.landmark, source: r.position_source, confirmed: r.position_confirmed },
        shareDiagnostic: r.share_diagnostic, diagnostic: r.diagnostic, aiAnalysis: r.ai_analysis, proDiagnosis: r.pro_diagnosis, cancelReason: r.cancel_reason,
      },
      pro,
      bids,
      quotes: quotes.rows.map((q) => ({ id: q.id, version: q.version, kind: q.kind, lines: q.lines, total: q.total, currency: q.currency, status: q.status, note: q.note, createdAt: Number(q.created_at), decidedAt: q.decided_at ? Number(q.decided_at) : null })),
      timeline,
      payment: paymentView(pay.rows[0]),
      media: media.rows,
      review: hasReview ? { rating: review.rows[0].rating, comment: review.rows[0].comment } : null,
      allowed: {
        cancel: CLIENT_CANCELLABLE.includes(r.status),
        retry: r.status === "sans_disponibilite",
        manual: ["recherche", "sans_disponibilite"].includes(r.status) && !r.manual_requested,
        review: r.status === "terminee" && !hasReview,
        claim: !!r.assigned_phone,
        decideQuote: r.quote_status === "propose" && ACTIVE_MISSION_STATUSES.includes(r.status),
        pay: r.status === "terminee" && r.amount_due > 0 && r.payment_status !== "paye",
        selectBid: r.status === "recherche" && bids.length > 0,
        confirmVisit: atelier && r.status === "affectee" && r.visit_status === "proposee",
        leaving: atelier && r.status === "affectee" && r.visit_status === "confirmee",
      },
    };
  }

  // Propositions du mécanicien : à traiter (`ouverte`), offre envoyée en attente du choix (`offre_envoyee`) et, pendant
  // 30 minutes, le résultat (`retenue` / `non_retenue`). Statut dérivé de l'offre et de la demande.
  async function proOffers(phone: string) {
    const labels = await serviceLabels();
    const now = Date.now();
    const o = await pool.query(
      `SELECT o.id, o.request_id, o.status AS ostatus, o.distance_km, o.expires_at, o.bid_amount, o.bid_eta_min, o.bid_expires_at, o.responded_at,
              r.service, r.mode, r.vehicle, r.symptoms, r.ai_analysis, r.lat, r.lng, r.status AS rstatus, r.assigned_phone
       FROM assistance_offers o JOIN assistance_requests r ON r.id=o.request_id
       WHERE o.pro_phone=$1 AND (
         (r.status='recherche' AND ((o.status='envoyee' AND o.expires_at>$2) OR (o.status='offre_faite' AND o.bid_expires_at>$2)))
         OR (o.bid_amount IS NOT NULL AND o.status IN ('acceptee','annulee') AND r.assigned_phone IS NOT NULL AND o.responded_at>$3))
       ORDER BY o.sent_at DESC, o.id DESC`,
      [phone, now, now - 30 * 60000]
    );
    const settings = await getSettings();
    return o.rows.map((x) => {
      const status = x.ostatus === "envoyee" ? "ouverte" : x.ostatus === "offre_faite" ? "offre_envoyee" : x.ostatus === "acceptee" && x.assigned_phone === phone ? "retenue" : "non_retenue";
      const tariff = settings.tariffs[x.service]?.indicatif ?? null;
      return {
        id: x.id, requestId: x.request_id, service: x.service, serviceLabel: labels[x.service] || x.service, vehicle: x.vehicle, symptoms: x.symptoms,
        aiAnalysis: x.ai_analysis, mode: x.mode as RequestMode, status, canBid: status === "ouverte" || status === "offre_envoyee",
        tariff, indicativeAmount: tariff, range: bidRange(settings.tariffs[x.service]),
        myBid: x.bid_amount != null ? { amount: Number(x.bid_amount), etaMinutes: Number(x.bid_eta_min), validUntil: Number(x.bid_expires_at) } : null,
        // Atelier : le client se déplace, sa position n'est d'aucune utilité au garage → rien n'est exposé, seulement la distance.
        approxPosition: x.mode === "atelier" ? null : approxPosition(x.lat, x.lng), distanceKm: Math.round(x.distance_km * 10) / 10,
        expiresAt: Number(status === "ouverte" ? x.expires_at : x.bid_expires_at ?? x.expires_at),
      };
    });
  }

  async function proMissionList(phone: string) {
    const [labels, r, st] = await Promise.all([
      serviceLabels(),
      pool.query(`SELECT * FROM assistance_requests WHERE assigned_phone=$1 ORDER BY created_at DESC LIMIT 100`, [phone]),
      getSettings(),
    ]);
    return r.rows.map((x) => ({ ...summary(x, labels[x.service], st.tariffs), isActive: ACTIVE_MISSION_STATUSES.includes(x.status) }));
  }

  async function proMissionDetail(id: string, phone: string) {
    const r = (await pool.query("SELECT * FROM assistance_requests WHERE id=$1 AND assigned_phone=$2", [id, phone])).rows[0];
    if (!r) throw new AssistanceError(404, "Mission introuvable.");
    const [labels, quotes, media, msgs, pay, offer] = await Promise.all([
      serviceLabels(),
      pool.query(`SELECT id, version, kind, lines, total, currency, status, note, created_at, decided_at FROM assistance_quotes WHERE request_id=$1 ORDER BY version`, [id]),
      pool.query(`SELECT id, kind, mime, size FROM assistance_media WHERE request_id=$1 ORDER BY created_at`, [id]),
      listMessages(id),
      pool.query(`SELECT * FROM assistance_payments WHERE request_id=$1 AND pro_phone=$2 ORDER BY created_at DESC LIMIT 1`, [id, phone]),
      pool.query(`SELECT distance_km FROM assistance_offers WHERE request_id=$1 AND pro_phone=$2 AND status='acceptee' ORDER BY id DESC LIMIT 1`, [id, phone]),
    ]);
    const atelier = r.mode === "atelier";
    const open = ACTIVE_MISSION_STATUSES.includes(r.status) || (r.status === "terminee" && Date.now() - Number(r.completed_at || 0) < 48 * 3600000);
    // Atelier : téléphone et médias du client seulement après SA confirmation ; sa position n'est jamais transmise.
    const detailsOpen = open && (!atelier || r.visit_status === "confirmee");
    const s = await getSettings();
    return {
      mission: {
        ...summary(r, labels[r.service], s.tariffs), faultCodes: r.fault_codes, description: r.description,
        // Dépannage : position exacte, repère et téléphone, uniquement pour le professionnel affecté, tant que la mission est ouverte.
        position: !atelier && open ? { lat: r.lat, lng: r.lng, address: r.address, landmark: r.landmark, source: r.position_source } : null,
        clientPhone: detailsOpen ? r.contact_phone : null,
        distanceKm: atelier && offer.rows[0] ? Math.round(offer.rows[0].distance_km * 10) / 10 : null,
        // Dossier IA transmis seulement avec le consentement du client.
        diagnostic: r.share_diagnostic ? r.diagnostic : null, shareDiagnostic: r.share_diagnostic, aiAnalysis: r.ai_analysis, proDiagnosis: r.pro_diagnosis,
      },
      quotes: quotes.rows.map((q) => ({ id: q.id, version: q.version, kind: q.kind, lines: q.lines, total: q.total, status: q.status, note: q.note, createdAt: Number(q.created_at), decidedAt: q.decided_at ? Number(q.decided_at) : null })),
      media: detailsOpen ? media.rows : [],
      messages: msgs,
      payment: paymentView(pay.rows[0], true),
      tariffs: s.tariffs[r.service] || {},
      allowed: {
        // Atelier : tant que le client n'a pas confirmé, rien n'avance ; ensuite c'est le client qui « part ».
        enRoute: !atelier && r.status === "affectee",
        surPlace: r.status === "en_route" ? (!atelier || r.visit_status === "confirmee") : atelier && r.status === "affectee" && r.visit_status === "confirmee",
        enIntervention: r.status === "sur_place" && (!atelier || r.visit_status === "confirmee") && canStartWork(r),
        terminer: r.status === "en_intervention" && r.quote_status !== "propose",
        quote: ["sur_place", "en_intervention"].includes(r.status) && r.quote_status !== "propose",
        release: ["affectee", "en_route", "sur_place"].includes(r.status),
      },
    };
  }

  async function accessMedia(mediaId: string, viewer: { phone?: string; admin?: boolean }) {
    const m = (await pool.query("SELECT * FROM assistance_media WHERE id=$1", [mediaId])).rows[0];
    if (!m) return null;
    if (viewer.admin || m.owner_phone === viewer.phone) return m;
    if (m.request_id && viewer.phone) {
      const r = (await pool.query("SELECT assigned_phone, status, mode, visit_status FROM assistance_requests WHERE id=$1", [m.request_id])).rows[0];
      if (r && r.assigned_phone === viewer.phone && ACTIVE_MISSION_STATUSES.includes(r.status) && (r.mode !== "atelier" || r.visit_status === "confirmee")) return m;
    }
    return null;
  }

  async function adminDashboard() {
    const [req, st, times, money, pros, claims] = await Promise.all([
      pool.query(`SELECT COUNT(*) FILTER (WHERE status<>'brouillon')::int received, COUNT(*) FILTER (WHERE assigned_at IS NOT NULL)::int accepted, COUNT(*) FILTER (WHERE status='terminee')::int completed, COUNT(*) FILTER (WHERE status='annulee')::int cancelled, COUNT(*) FILTER (WHERE status='sans_disponibilite')::int unavailable, COUNT(*) FILTER (WHERE manual_requested AND status IN ('recherche','sans_disponibilite'))::int manual FROM assistance_requests`),
      pool.query(`SELECT status, COUNT(*)::int n FROM assistance_requests GROUP BY status`),
      pool.query(`SELECT AVG(r.assigned_at - e.at)::float accept_ms FROM assistance_requests r JOIN LATERAL (SELECT at FROM assistance_events WHERE request_id=r.id AND type='envoi' ORDER BY at LIMIT 1) e ON true WHERE r.assigned_at IS NOT NULL`),
      pool.query(`SELECT COALESCE(SUM(amount_due) FILTER (WHERE status='terminee'),0)::bigint agreed, COUNT(*) FILTER (WHERE status='terminee' AND amount_due>0)::int done_with_amount, COUNT(*) FILTER (WHERE status<>'brouillon' AND mode='atelier')::int atelier_requests FROM assistance_requests`),
      pool.query(`SELECT validation_status, COUNT(*)::int n, COUNT(*) FILTER (WHERE available)::int available FROM assistance_pros GROUP BY validation_status`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE status='ouverte')::int open FROM assistance_claims`),
    ]);
    const pay = (await pool.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE status='paye'),0)::bigint collected,
        COALESCE(SUM(amount) FILTER (WHERE status='en_attente'),0)::bigint pending,
        COALESCE(SUM(commission_amount) FILTER (WHERE status='paye'),0)::bigint commission,
        COALESCE(SUM(pro_amount) FILTER (WHERE status='paye' AND payout_status='a_reverser'),0)::bigint to_reverse,
        COALESCE(SUM(pro_amount) FILTER (WHERE status='paye' AND payout_status='reverse'),0)::bigint reversed,
        COUNT(*) FILTER (WHERE status='paye')::int paid_count,
        COUNT(*) FILTER (WHERE status='paye' AND payout_status='a_reverser')::int to_reverse_count
      FROM assistance_payments`)).rows[0];
    const arrival = await pool.query(`SELECT AVG(a.at - b.at)::float ms FROM assistance_events a JOIN assistance_events b ON b.request_id=a.request_id AND b.type IN ('acceptation','selection_offre') WHERE a.type='etape' AND a.to_status='sur_place'`);
    return {
      requests: req.rows[0], byStatus: st.rows, avgAcceptMs: times.rows[0].accept_ms ? Math.round(times.rows[0].accept_ms) : null,
      avgArrivalMs: arrival.rows[0].ms ? Math.round(arrival.rows[0].ms) : null,
      amounts: { agreedTotal: Number(money.rows[0].agreed), missionsWithAmount: money.rows[0].done_with_amount },
      atelierRequests: money.rows[0].atelier_requests,
      // Montants encaissés via Jèko, commissions DiagAssist, net à reverser aux mécaniciens / déjà reversé.
      payments: { collected: Number(pay.collected), pending: Number(pay.pending), commission: Number(pay.commission), toReverse: Number(pay.to_reverse), reversed: Number(pay.reversed), paidCount: pay.paid_count, toReverseCount: pay.to_reverse_count, commissionPct: (await getSettings()).commission_pct },
      pros: pros.rows, openClaims: claims.rows[0].open,
    };
  }

  return {
    pool, tx, init, getSettings, saveSettings, logEvent, notify, resolveZone, servicesStatus, syncDirectory, proProfile, upsertProProfile,
    setPresence, updateLocation, clearLocationIfIdle, createRequest, updateDraft, getRequestRow, submitRequest, cancelRequest, retryRequest,
    requestManual, dispatch, dispatchTick, analyzeRequest, startWorker, stopWorker, bidOffer, selectBid, declineOffer, adminAssign, redispatch, proProgress,
    setProDiagnosis, proposeQuote, decideQuote, decideVisit, clientLeaving, startPayment, handleJekoWebhook, reconcilePayment, applyPaymentResult, markPayout, proEarnings,
    addReview, addClaim, addMessage, listMessages, storeMedia, listForClient, clientDetail, proOffers, proMissionList, proMissionDetail,
    accessMedia, adminDashboard, serviceLabels, summary,
  };
}
export type AssistanceCore = ReturnType<typeof createAssistanceCore>;
