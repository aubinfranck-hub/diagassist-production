import crypto from "crypto";
import type { Pool, PoolClient } from "pg";
import {
  ACTIVE_MISSION_STATUSES, CLIENT_CANCELLABLE, SERVICE_SEED, STATUS_LABELS, approxPosition, canTransition,
  clean, estimateEtaMinutes, haversineKm, normalizePhone, parseQuoteLines, validCoords,
  type RequestStatus,
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
  jeko?: {
    isConfigured: () => boolean;
    create: (p: { reference: string; amountXof: number; paymentMethod: string; payerPhone?: string; successUrl: string; errorUrl: string }) => Promise<{ id?: string; redirectUrl?: string }>;
    fetchStatus: (jekoId: string) => Promise<string>;
  };
  appOrigin?: (req?: any) => string;
};

const DEFAULT_SETTINGS = {
  offer_timeout_s: 60,
  search_radius_km: 25,
  max_candidates: 5,
  location_max_age_min: 15,
  avg_speed_kmh: 25,
  commission_pct: null as number | null,
  tariffs: {} as Record<string, { deplacement?: number; diagnostic?: number }>,
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
    if ("search_radius_km" in patch) out.search_radius_km = num("search_radius_km", 1, 200);
    if ("max_candidates" in patch) out.max_candidates = Math.round(num("max_candidates", 1, 50));
    if ("location_max_age_min" in patch) out.location_max_age_min = num("location_max_age_min", 1, 240);
    if ("avg_speed_kmh" in patch) out.avg_speed_kmh = num("avg_speed_kmh", 5, 120);
    if ("commission_pct" in patch) out.commission_pct = patch.commission_pct === null || patch.commission_pct === "" ? null : num("commission_pct", 0, 100);
    if ("whatsapp_notifications" in patch) out.whatsapp_notifications = patch.whatsapp_notifications === true;
    if ("tariffs" in patch) {
      const t: Record<string, { deplacement?: number; diagnostic?: number }> = {};
      const src: any = patch.tariffs || {};
      for (const code of Object.keys(src)) {
        const dep = src[code]?.deplacement, diag = src[code]?.diagnostic;
        const entry: { deplacement?: number; diagnostic?: number } = {};
        if (dep !== undefined && dep !== null && dep !== "") { if (!Number.isInteger(Number(dep)) || Number(dep) < 0) throw new AssistanceError(400, "Tarif de déplacement invalide."); entry.deplacement = Number(dep); }
        if (diag !== undefined && diag !== null && diag !== "") { if (!Number.isInteger(Number(diag)) || Number(diag) < 0) throw new AssistanceError(400, "Tarif de diagnostic invalide."); entry.diagnostic = Number(diag); }
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

  async function notify(phone: string, requestId: string | null, type: string, title: string, body: string, whatsapp = false) {
    try {
      await pool.query(
        `INSERT INTO assistance_notifications (phone, request_id, type, title, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [phone, requestId, type, title, body, Date.now()]
      );
      if (whatsapp && deps.sendWhatsApp) {
        const s = await getSettings();
        if (s.whatsapp_notifications) deps.sendWhatsApp(phone, `DiagAssist - ${title}. ${body}`).catch((e) => console.warn("[ASSISTANCE] WhatsApp non envoyé:", e?.message || e));
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
      `SELECT specialties, zone_ids, available, mobility FROM assistance_pros WHERE validation_status='valide' AND mobility IN ('mobile','both')`
    );
    const zones = await pool.query(`SELECT id FROM assistance_zones WHERE active`);
    const activeZoneIds = new Set(zones.rows.map((z) => z.id));
    return s.rows.filter((x) => x.enabled).map((x) => {
      const comp = pros.rows.filter((p) => p.specialties.includes(x.code) && p.zone_ids.some((z: number) => activeZoneIds.has(z)));
      return { code: x.code, label: x.label, description: x.description, available: comp.length > 0, proCount: comp.length, availableNow: comp.filter((p) => p.available).length };
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
    if (!p.specialties?.length) b.push("Choisissez au moins une spécialité.");
    if (!p.zone_ids?.length) b.push("Choisissez au moins une zone d'intervention.");
    if (p.mobility === "garage") b.push("Votre profil est réservé au garage fixe : les interventions mobiles ne vous sont pas proposées.");
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
      mobility: p.mobility, validationStatus: p.validation_status, validationNote: p.validation_note, available: p.available,
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
    await pool.query(`UPDATE assistance_pros SET available=false WHERE phone=$1 AND (cardinality(specialties)=0 OR cardinality(zone_ids)=0 OR mobility='garage')`, [phone]);
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
    await pool.query("UPDATE assistance_offers SET status=$2, responded_at=$3 WHERE pro_phone=$1 AND status='envoyee'", [phone, status, Date.now()]);
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
    const share = input.shareDiagnostic === true;
    const diagnostic = share && input.diagnostic ? { summary: clean(input.diagnostic.summary, 4000), faultCodes: clean(input.diagnostic.faultCodes, 300), vehicle: input.diagnostic.vehicle ? clean(JSON.stringify(input.diagnostic.vehicle), 500) : null } : null;
    const id = rid();
    const now = Date.now();
    await tx(async (c) => {
      await c.query(
        `INSERT INTO assistance_requests (id, client_phone, status, service, vehicle, symptoms, fault_codes, description, contact_phone, lat, lng, accuracy, position_source, address, landmark, position_confirmed, share_diagnostic, diagnostic, created_at, updated_at)
         VALUES ($1,$2,'brouillon',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)`,
        [id, clientPhone, service, JSON.stringify(vehicle), symptoms, clean(input.faultCodes, 300) || null, clean(input.description, 1000) || null, contact, pos.lat, pos.lng, pos.accuracy, pos.source, pos.address, pos.landmark, pos.confirmed, share && !!diagnostic, diagnostic ? JSON.stringify(diagnostic) : null, now]
      );
      await logEvent(c, id, clientPhone, "client", "creation", { to: "brouillon", meta: { share_diagnostic: share && !!diagnostic } });
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
    if (input.service !== undefined) { await assertServiceEnabled(String(input.service)); add("service", String(input.service)); }
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
      await c.query(`UPDATE assistance_requests SET status='recherche', zone_id=$2, search_started_at=$3, updated_at=$3 WHERE id=$1`, [id, zone.id, now]);
      await logEvent(c, id, clientPhone, "client", "envoi", { from: "brouillon", to: "recherche", meta: { zone: zone.name } });
    });
    await notify(clientPhone, id, "demande_recue", "Demande reçue", "Nous cherchons un mécanicien près de vous.");
    await dispatch(id);
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
      await c.query(`UPDATE assistance_offers SET status='annulee', responded_at=$2 WHERE request_id=$1 AND status='envoyee'`, [id, now]);
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
  async function dispatch(requestId: string): Promise<void> {
    const settings = await getSettings();
    let offered: { pro: string; svc: string } | null = null;
    let noneFor: string | null = null;
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [requestId])).rows[0];
      if (!r || r.status !== "recherche") return;
      const now = Date.now();
      await c.query(`UPDATE assistance_offers SET status='expiree', responded_at=$2 WHERE request_id=$1 AND status='envoyee' AND expires_at<=$2`, [requestId, now]);
      const open = await c.query(`SELECT 1 FROM assistance_offers WHERE request_id=$1 AND status='envoyee'`, [requestId]);
      if (open.rowCount) return;
      const round = Number(r.search_started_at || r.created_at);
      const tried = (await c.query(`SELECT COUNT(*)::int n FROM assistance_offers WHERE request_id=$1 AND sent_at>=$2`, [requestId, round])).rows[0].n;
      let chosen: { phone: string; km: number } | null = null;
      if (tried < settings.max_candidates && r.zone_id) {
        const minLoc = now - settings.location_max_age_min * 60000;
        const cands = (await c.query(
          `SELECT p.phone, p.last_lat, p.last_lng FROM assistance_pros p
           WHERE p.validation_status='valide' AND p.available AND p.mobility IN ('mobile','both')
             AND $1 = ANY(p.specialties) AND $2 = ANY(p.zone_ids) AND p.last_loc_at >= $3 AND p.phone <> $4
             AND NOT EXISTS (SELECT 1 FROM assistance_requests m WHERE m.assigned_phone=p.phone AND m.status = ANY($7))
             AND NOT EXISTS (SELECT 1 FROM assistance_offers o WHERE o.request_id=$5 AND o.pro_phone=p.phone AND o.sent_at>=$6)
             AND NOT EXISTS (SELECT 1 FROM assistance_assignments a WHERE a.request_id=$5 AND a.pro_phone=p.phone)
             AND NOT EXISTS (SELECT 1 FROM assistance_offers o2 WHERE o2.pro_phone=p.phone AND o2.status='envoyee')`,
          [r.service, r.zone_id, minLoc, r.client_phone, requestId, round, ACTIVE_MISSION_STATUSES]
        )).rows;
        const ranked = cands
          .map((p) => ({ phone: p.phone as string, km: haversineKm(r.lat, r.lng, p.last_lat, p.last_lng) }))
          .filter((p) => p.km <= settings.search_radius_km)
          .sort((a, b) => a.km - b.km);
        chosen = ranked[0] || null;
      }
      if (chosen) {
        await c.query(
          `INSERT INTO assistance_offers (request_id, pro_phone, distance_km, sent_at, expires_at) VALUES ($1,$2,$3,$4,$5)`,
          [requestId, chosen.phone, chosen.km, now, now + settings.offer_timeout_s * 1000]
        );
        await logEvent(c, requestId, "systeme", "systeme", "proposition", { meta: { pro: chosen.phone, km: Math.round(chosen.km * 10) / 10 } });
        offered = { pro: chosen.phone, svc: r.service };
      } else {
        await c.query(`UPDATE assistance_requests SET status='sans_disponibilite', updated_at=$2 WHERE id=$1`, [requestId, now]);
        await logEvent(c, requestId, "systeme", "systeme", "sans_disponibilite", { from: "recherche", to: "sans_disponibilite", reason: tried >= settings.max_candidates ? "candidats épuisés" : "aucun professionnel éligible" });
        noneFor = r.client_phone;
      }
    }).catch(async (e) => {
      // Deux envois simultanés vers la même demande : l'index unique d'offre ouverte protège ; on ignore.
      if (e?.code === "23505") return;
      throw e;
    });
    if (offered) await notify((offered as any).pro, requestId, "mission_proposee", "Nouvelle mission proche de vous", "Ouvrez DiagAssist pour accepter ou refuser.", true);
    if (noneFor) await notify(noneFor, requestId, "sans_disponibilite", "Aucun mécanicien disponible", "Aucun professionnel n'est disponible pour le moment. Vous pouvez réessayer ou demander une prise en charge manuelle.");
  }

  async function dispatchTick(): Promise<void> {
    const now = Date.now();
    const expired = await pool.query(`UPDATE assistance_offers SET status='expiree', responded_at=$1 WHERE status='envoyee' AND expires_at<=$1 RETURNING request_id, pro_phone`, [now]);
    for (const e of expired.rows) await logEvent(pool, e.request_id, "systeme", "systeme", "proposition_expiree", { meta: { pro: e.pro_phone } });
    const pending = await pool.query(
      `SELECT r.id FROM assistance_requests r WHERE r.status='recherche' AND NOT EXISTS (SELECT 1 FROM assistance_offers o WHERE o.request_id=r.id AND o.status='envoyee')`
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

  // Acceptation ATOMIQUE : verrou de ligne sur la demande + proposition ouverte unique + index unique
  // d'affectation active. Deux acceptations simultanées ne produisent jamais deux affectations.
  async function acceptOffer(offerId: number, proPhone: string) {
    let clientPhone = "", requestId = "";
    await tx(async (c) => {
      const o = (await c.query("SELECT * FROM assistance_offers WHERE id=$1", [offerId])).rows[0];
      if (!o || o.pro_phone !== proPhone) throw new AssistanceError(404, "Proposition introuvable.");
      requestId = o.request_id;
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [o.request_id])).rows[0];
      const cur = (await c.query("SELECT * FROM assistance_offers WHERE id=$1 FOR UPDATE", [offerId])).rows[0];
      const now = Date.now();
      if (!r || r.status !== "recherche" || cur.status !== "envoyee" || Number(cur.expires_at) <= now) {
        throw new AssistanceError(409, r && r.status !== "recherche" ? "Cette mission a déjà été prise ou annulée." : "Cette proposition a expiré.", "ALREADY_TAKEN");
      }
      const pro = (await c.query("SELECT * FROM assistance_pros WHERE phone=$1 FOR UPDATE", [proPhone])).rows[0];
      if (!pro || pro.validation_status !== "valide") throw new AssistanceError(403, "Votre profil n'est pas validé.");
      const busy = await c.query(`SELECT 1 FROM assistance_requests WHERE assigned_phone=$1 AND status = ANY($2)`, [proPhone, ACTIVE_MISSION_STATUSES]);
      if (busy.rowCount) throw new AssistanceError(409, "Terminez votre mission en cours avant d'en accepter une autre.");
      await c.query(`UPDATE assistance_offers SET status='acceptee', responded_at=$2 WHERE id=$1`, [offerId, now]);
      await c.query(`UPDATE assistance_offers SET status='annulee', responded_at=$2 WHERE request_id=$1 AND id<>$3 AND status='envoyee'`, [r.id, now, offerId]);
      await c.query(`INSERT INTO assistance_assignments (request_id, pro_phone, assigned_at, assigned_by) VALUES ($1,$2,$3,$2)`, [r.id, proPhone, now]);
      await c.query(`UPDATE assistance_requests SET status='affectee', assigned_phone=$2, assigned_at=$3, updated_at=$3 WHERE id=$1`, [r.id, proPhone, now]);
      await logEvent(c, r.id, proPhone, "pro", "acceptation", { from: "recherche", to: "affectee" });
      clientPhone = r.client_phone;
    });
    const p = await pool.query("SELECT display_name FROM assistance_pros WHERE phone=$1", [proPhone]);
    await notify(clientPhone, requestId, "mission_acceptee", "Mécanicien trouvé", `${p.rows[0]?.display_name || "Un mécanicien"} a accepté votre demande.`, true);
    return requestId;
  }

  async function declineOffer(offerId: number, proPhone: string) {
    const r = await pool.query(`UPDATE assistance_offers SET status='refusee', responded_at=$3 WHERE id=$1 AND pro_phone=$2 AND status='envoyee' RETURNING request_id`, [offerId, proPhone, Date.now()]);
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
      const busy = await c.query(`SELECT 1 FROM assistance_requests WHERE assigned_phone=$1 AND status = ANY($2) AND id<>$3`, [proPhone, ACTIVE_MISSION_STATUSES, requestId]);
      if (busy.rowCount) throw new AssistanceError(409, "Ce professionnel a déjà une mission en cours.");
      const now = Date.now();
      await c.query(`UPDATE assistance_offers SET status='annulee', responded_at=$2 WHERE request_id=$1 AND status='envoyee'`, [requestId, now]);
      await c.query(`UPDATE assistance_assignments SET ended_at=$2, ended_reason='reaffectation' WHERE request_id=$1 AND ended_at IS NULL`, [requestId, now]);
      await c.query(`INSERT INTO assistance_assignments (request_id, pro_phone, assigned_at, assigned_by) VALUES ($1,$2,$3,$4)`, [requestId, proPhone, now, admin]);
      await c.query(`UPDATE assistance_requests SET status='affectee', assigned_phone=$2, assigned_at=$3, updated_at=$3 WHERE id=$1`, [requestId, proPhone, now]);
      await logEvent(c, requestId, admin, "admin", "affectation_manuelle", { from: r.status, to: "affectee", meta: { pro: proPhone, previous: r.assigned_phone } });
      clientPhone = r.client_phone;
      if (r.assigned_phone && r.assigned_phone !== proPhone) await notify(r.assigned_phone, requestId, "mission_retiree", "Mission réaffectée", "Cette mission a été confiée à un autre professionnel.");
    });
    await notify(proPhone, requestId, "mission_assignee", "Mission assignée", "DiagAssist vous a confié une mission. Ouvrez-la pour voir les détails.", true);
    await notify(clientPhone, requestId, "mission_acceptee", "Mécanicien trouvé", "Un mécanicien a été affecté à votre demande.", true);
  }

  async function redispatch(requestId: string, actor: string, role: "admin" | "pro", reason: string, expectedPro?: string) {
    let prevPro: string | null = null, clientPhone = "";
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [requestId])).rows[0];
      if (!r) throw new AssistanceError(404, "Demande introuvable.");
      if (expectedPro && r.assigned_phone !== expectedPro) throw new AssistanceError(404, "Mission introuvable.");
      if (!["sans_disponibilite", "recherche", "affectee", "en_route", "sur_place"].includes(r.status)) throw new AssistanceError(409, "Cette demande ne peut plus être relancée.");
      const now = Date.now();
      await c.query(`UPDATE assistance_offers SET status='annulee', responded_at=$2 WHERE request_id=$1 AND status='envoyee'`, [requestId, now]);
      await c.query(`UPDATE assistance_assignments SET ended_at=$2, ended_reason=$3 WHERE request_id=$1 AND ended_at IS NULL`, [requestId, now, role === "pro" ? "desistement" : "reaffectation"]);
      await c.query(`UPDATE assistance_requests SET status='recherche', assigned_phone=NULL, assigned_at=NULL, search_started_at=$2, updated_at=$2 WHERE id=$1`, [requestId, now]);
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
      if (!canTransition(r.status, to)) throw new AssistanceError(409, `Impossible de passer de « ${STATUS_LABELS[r.status as RequestStatus]} » à « ${STATUS_LABELS[to]} ».`);
      if (to === "en_intervention" && r.quote_status !== "accepte") throw new AssistanceError(409, "Le client doit d'abord accepter le devis avant de commencer.", "QUOTE_NOT_ACCEPTED");
      const now = Date.now();
      let amountDue = r.amount_due;
      if (to === "terminee") {
        if (r.quote_status === "propose") throw new AssistanceError(409, "Un devis attend l'accord du client : l'intervention ne peut pas être terminée.", "QUOTE_PENDING");
        const sum = (await c.query(`SELECT COALESCE(SUM(total),0)::int s FROM assistance_quotes WHERE request_id=$1 AND status='accepte'`, [requestId])).rows[0].s;
        if (sum <= 0) throw new AssistanceError(409, "Aucun devis accepté : établissez un devis avant de terminer.", "NO_QUOTE");
        amountDue = sum;
      }
      await c.query(
        `UPDATE assistance_requests SET status=$2, amount_due=$3, updated_at=$4, completed_at=$5 WHERE id=$1`,
        [requestId, to, amountDue, now, to === "terminee" ? now : r.completed_at]
      );
      await logEvent(c, requestId, admin || proPhone, admin ? "admin" : "pro", "etape", { from: r.status, to });
      clientPhone = r.client_phone; prev = r.status;
    });
    if (to === "terminee") await clearLocationIfIdle(proPhone);
    const msgs: Partial<Record<RequestStatus, [string, string, string]>> = {
      en_route: ["mecanicien_en_route", "Votre mécanicien est en route", "Il se dirige vers vous."],
      sur_place: ["mecanicien_arrive", "Votre mécanicien est arrivé", "Il est sur place."],
      en_intervention: ["intervention_commencee", "Intervention en cours", "Le mécanicien a commencé les travaux."],
      terminee: ["intervention_terminee", "Intervention terminée", "Consultez le récapitulatif et procédez au paiement."],
    };
    const m = msgs[to];
    if (m) await notify(clientPhone, requestId, m[0], m[1], m[2], to === "sur_place" || to === "terminee");
    return prev;
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
    const kind = input.kind === "supplementaire" ? "supplementaire" : "initial";
    let clientPhone = "";
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [requestId])).rows[0];
      if (!r || r.assigned_phone !== proPhone) throw new AssistanceError(404, "Mission introuvable.");
      if (!["sur_place", "en_intervention"].includes(r.status)) throw new AssistanceError(409, "Le devis s'établit une fois sur place.");
      if (r.quote_status === "propose") throw new AssistanceError(409, "Un devis attend déjà l'accord du client.");
      const hasAccepted = (await c.query(`SELECT 1 FROM assistance_quotes WHERE request_id=$1 AND status='accepte' AND kind='initial'`, [requestId])).rowCount;
      if (kind === "initial" && hasAccepted) throw new AssistanceError(409, "Le devis initial est déjà accepté : proposez un devis supplémentaire.");
      if (kind === "supplementaire" && !hasAccepted) throw new AssistanceError(409, "Un devis supplémentaire suppose un devis initial accepté.");
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
      await c.query(`UPDATE assistance_requests SET quote_status=$2, updated_at=$3 WHERE id=$1`, [requestId, accepted ? "accepte" : accept ? "accepte" : "refuse", now]);
      await logEvent(c, requestId, clientPhone, actorRole, accept ? "devis_accepte" : "devis_refuse", { meta: { version: q.version, kind: q.kind, total: q.total } });
      proPhone = r.assigned_phone;
    });
    if (proPhone) await notify(proPhone, requestId, accept ? "devis_accepte" : "devis_refuse", accept ? "Devis accepté" : "Devis refusé", accept ? "Le client a donné son accord." : "Le client a refusé le devis.", true);
  }

  // ---------- Paiement ----------
  async function startPayment(requestId: string, clientPhone: string, method: string, payerPhone: string | undefined, origin: string) {
    const r = (await pool.query("SELECT * FROM assistance_requests WHERE id=$1", [requestId])).rows[0];
    if (!r || r.client_phone !== clientPhone) throw new AssistanceError(404, "Demande introuvable.");
    if (r.status !== "terminee") throw new AssistanceError(409, "Le paiement s'ouvre une fois l'intervention terminée.");
    if (r.payment_status === "paye") throw new AssistanceError(409, "Cette intervention est déjà payée.");
    if (!(r.amount_due > 0)) throw new AssistanceError(409, "Aucun montant à payer.");
    if (method === "especes") throw new AssistanceError(400, "Pour un paiement en espèces, le mécanicien déclare la réception et vous la confirmez.");
    if (!["wave", "orange", "mtn", "moov"].includes(method)) throw new AssistanceError(400, "Moyen de paiement invalide.");
    if (!deps.jeko?.isConfigured()) throw new AssistanceError(503, "Le paiement en ligne n'est pas encore activé. Réglez en espèces auprès du mécanicien.", "PAYMENT_NOT_CONFIGURED");
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
        `INSERT INTO assistance_payments (reference, request_id, payer_phone, method, provider, amount, status, provider_ref, redirect_url, created_at, updated_at) VALUES ($1,$2,$3,$4,'jeko',$5,'en_attente',$6,$7,$8,$8)`,
        [reference, requestId, clientPhone, method, r.amount_due, created.id || null, created.redirectUrl || null, now]
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
      if (!["en_attente", "annule"].includes(p.status)) return; // déjà traité : pas de double traitement
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [p.request_id])).rows[0];
      const now = Date.now();
      if (outcome === "paye") {
        const settings = await getSettings();
        const commission = settings.commission_pct != null ? Math.round((p.amount * settings.commission_pct) / 100) : null;
        await c.query(`UPDATE assistance_payments SET status='paye', commission_amount=$2, confirmed_by=$3, updated_at=$4 WHERE reference=$1`, [reference, commission, by, now]);
        const dup = r.payment_status === "paye";
        await c.query(`UPDATE assistance_requests SET payment_status='paye', updated_at=$2 WHERE id=$1`, [p.request_id, now]);
        await logEvent(c, p.request_id, by, by === "jeko" ? "systeme" : "admin", dup ? "double_paiement_detecte" : "paiement_confirme", { meta: { reference, amount: p.amount } });
      } else {
        await c.query(`UPDATE assistance_payments SET status='echoue', updated_at=$2 WHERE reference=$1`, [reference, now]);
        if (r.payment_status !== "paye") {
          const other = (await c.query(`SELECT 1 FROM assistance_payments WHERE request_id=$1 AND reference<>$2 AND status IN ('en_attente','especes_a_confirmer')`, [p.request_id, reference])).rowCount;
          if (!other) await c.query(`UPDATE assistance_requests SET payment_status='echoue', updated_at=$2 WHERE id=$1`, [p.request_id, now]);
        }
        await logEvent(c, p.request_id, by, "systeme", "paiement_echoue", { meta: { reference } });
      }
    });
    const pay = (await pool.query("SELECT request_id, payer_phone FROM assistance_payments WHERE reference=$1", [reference])).rows[0];
    if (pay && outcome === "paye") {
      const r = (await pool.query("SELECT assigned_phone FROM assistance_requests WHERE id=$1", [pay.request_id])).rows[0];
      if (r?.assigned_phone) await notify(r.assigned_phone, pay.request_id, "paiement_recu", "Paiement reçu", "Le client a réglé l'intervention.");
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

  async function declareCash(requestId: string, proPhone: string) {
    await tx(async (c) => {
      const r = (await c.query("SELECT * FROM assistance_requests WHERE id=$1 FOR UPDATE", [requestId])).rows[0];
      if (!r || r.assigned_phone !== proPhone) throw new AssistanceError(404, "Mission introuvable.");
      if (r.status !== "terminee") throw new AssistanceError(409, "Terminez l'intervention avant de déclarer un règlement.");
      if (r.payment_status === "paye") throw new AssistanceError(409, "Cette intervention est déjà payée.");
      const now = Date.now();
      await c.query(`UPDATE assistance_payments SET status='annule', updated_at=$2 WHERE request_id=$1 AND status IN ('en_attente','especes_a_confirmer')`, [requestId, now]);
      const ref = `dgas-${requestId}-cash-${crypto.randomBytes(3).toString("hex")}`;
      await c.query(`INSERT INTO assistance_payments (reference, request_id, payer_phone, method, provider, amount, status, created_at, updated_at) VALUES ($1,$2,$3,'especes','especes',$4,'especes_a_confirmer',$5,$5)`, [ref, requestId, r.client_phone, r.amount_due, now]);
      await c.query(`UPDATE assistance_requests SET payment_status='especes_a_confirmer', updated_at=$2 WHERE id=$1`, [requestId, now]);
      await logEvent(c, requestId, proPhone, "pro", "especes_declarees", { meta: { amount: r.amount_due } });
    });
    const r = (await pool.query("SELECT client_phone FROM assistance_requests WHERE id=$1", [requestId])).rows[0];
    await notify(r.client_phone, requestId, "especes_a_confirmer", "Confirmez votre paiement en espèces", "Le mécanicien indique avoir reçu des espèces. Confirmez dans l'application.", true);
  }

  async function confirmCash(requestId: string, reference: string, actor: string, role: "client" | "admin") {
    const p = (await pool.query("SELECT * FROM assistance_payments WHERE reference=$1 AND request_id=$2", [reference, requestId])).rows[0];
    if (!p || p.method !== "especes") throw new AssistanceError(404, "Paiement introuvable.");
    if (role === "client" && p.payer_phone !== actor) throw new AssistanceError(404, "Paiement introuvable.");
    if (p.status !== "especes_a_confirmer") throw new AssistanceError(409, "Ce règlement n'est plus à confirmer.");
    await tx(async (c) => {
      const settings = await getSettings();
      const commission = settings.commission_pct != null ? Math.round((p.amount * settings.commission_pct) / 100) : null;
      const locked = (await c.query("SELECT status FROM assistance_payments WHERE reference=$1 FOR UPDATE", [reference])).rows[0];
      if (locked.status !== "especes_a_confirmer") throw new AssistanceError(409, "Ce règlement n'est plus à confirmer.");
      const now = Date.now();
      await c.query(`UPDATE assistance_payments SET status='paye', commission_amount=$2, confirmed_by=$3, updated_at=$4 WHERE reference=$1`, [reference, commission, actor, now]);
      await c.query(`UPDATE assistance_requests SET payment_status='paye', updated_at=$2 WHERE id=$1`, [requestId, now]);
      await logEvent(c, requestId, actor, role, "paiement_especes_confirme", { meta: { reference, amount: p.amount } });
    });
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
  const summary = (r: any, serviceLabel?: string) => ({
    id: r.id, status: r.status, statusLabel: STATUS_LABELS[r.status as RequestStatus], service: r.service, serviceLabel: serviceLabel || r.service,
    vehicle: r.vehicle, symptoms: r.symptoms, quoteStatus: r.quote_status, paymentStatus: r.payment_status, amountDue: r.amount_due,
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), manualRequested: r.manual_requested,
  });

  async function serviceLabels(): Promise<Record<string, string>> {
    const s = await pool.query("SELECT code, label FROM assistance_services");
    return Object.fromEntries(s.rows.map((x) => [x.code, x.label]));
  }

  async function listForClient(phone: string) {
    const [r, labels] = await Promise.all([
      pool.query("SELECT * FROM assistance_requests WHERE client_phone=$1 ORDER BY created_at DESC LIMIT 100", [phone]),
      serviceLabels(),
    ]);
    return r.rows.map((x) => summary(x, labels[x.service]));
  }

  const CLIENT_TIMELINE: Record<string, string> = {
    envoi: "Demande envoyée", acceptation: "Mécanicien trouvé", affectation_manuelle: "Mécanicien affecté par DiagAssist",
    sans_disponibilite: "Aucun mécanicien disponible", nouvel_essai: "Nouvelle recherche", relance_recherche: "Recherche relancée",
    desistement: "Le mécanicien n'est plus disponible, nouvelle recherche", annulation: "Demande annulée",
    devis_propose: "Devis proposé", devis_supplementaire_propose: "Travaux supplémentaires proposés", devis_accepte: "Devis accepté", devis_refuse: "Devis refusé",
    paiement_confirme: "Paiement confirmé", paiement_echoue: "Paiement échoué", paiement_especes_confirme: "Paiement en espèces confirmé", especes_declarees: "Règlement en espèces déclaré",
    avis: "Avis envoyé", reclamation: "Réclamation envoyée",
  };
  const STEP_LABELS: Record<string, string> = { en_route: "Mécanicien en route", sur_place: "Mécanicien arrivé", en_intervention: "Intervention commencée", terminee: "Intervention terminée" };

  async function clientDetail(id: string, phone: string) {
    const r = (await pool.query("SELECT * FROM assistance_requests WHERE id=$1 AND client_phone=$2", [id, phone])).rows[0];
    if (!r) throw new AssistanceError(404, "Demande introuvable.");
    const settings = await getSettings();
    const [labels, quotes, pay, ev, media, review] = await Promise.all([
      serviceLabels(),
      pool.query(`SELECT id, version, kind, lines, total, currency, status, note, created_at, decided_at FROM assistance_quotes WHERE request_id=$1 ORDER BY version`, [id]),
      pool.query(`SELECT reference, method, amount, status, created_at, updated_at, redirect_url FROM assistance_payments WHERE request_id=$1 ORDER BY created_at DESC LIMIT 1`, [id]),
      pool.query(`SELECT at, type, to_status FROM assistance_events WHERE request_id=$1 ORDER BY at, id`, [id]),
      pool.query(`SELECT id, kind, mime, size FROM assistance_media WHERE request_id=$1 ORDER BY created_at`, [id]),
      pool.query(`SELECT rating, comment, created_at FROM assistance_reviews WHERE request_id=$1`, [id]),
    ]);
    let pro: any = null;
    if (r.assigned_phone && r.status !== "annulee") {
      const p = (await pool.query("SELECT * FROM assistance_pros WHERE phone=$1", [r.assigned_phone])).rows[0];
      if (p) {
        const [rt, tr] = await Promise.all([
          pool.query("SELECT COUNT(*)::int n, AVG(rating)::float avg FROM assistance_reviews WHERE pro_phone=$1", [p.phone]),
          pool.query("SELECT title, issuer FROM assistance_trainings WHERE pro_phone=$1 AND status='verifiee' ORDER BY id", [p.phone]),
        ]);
        const sharing = ["affectee", "en_route"].includes(r.status);
        const fresh = p.last_loc_at && Date.now() - Number(p.last_loc_at) <= settings.location_max_age_min * 60000;
        const loc = sharing && fresh && p.last_lat != null ? { lat: p.last_lat, lng: p.last_lng, updatedAt: Number(p.last_loc_at) } : null;
        let eta = null;
        if (loc && r.lat != null) {
          const km = haversineKm(loc.lat, loc.lng, r.lat, r.lng);
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
      .map((e) => ({ at: Number(e.at), label: e.type === "creation" ? "Demande créée" : e.type === "etape" ? STEP_LABELS[e.to_status] : CLIENT_TIMELINE[e.type], status: e.to_status || null }))
      .filter((e) => e.label);
    const hasReview = review.rowCount! > 0;
    return {
      request: {
        ...summary(r, labels[r.service]), faultCodes: r.fault_codes, description: r.description, contactPhone: r.contact_phone,
        position: { lat: r.lat, lng: r.lng, address: r.address, landmark: r.landmark, source: r.position_source, confirmed: r.position_confirmed },
        shareDiagnostic: r.share_diagnostic, diagnostic: r.diagnostic, proDiagnosis: r.pro_diagnosis, cancelReason: r.cancel_reason,
      },
      pro,
      quotes: quotes.rows.map((q) => ({ id: q.id, version: q.version, kind: q.kind, lines: q.lines, total: q.total, currency: q.currency, status: q.status, note: q.note, createdAt: Number(q.created_at), decidedAt: q.decided_at ? Number(q.decided_at) : null })),
      payment: pay.rows[0] ? { reference: pay.rows[0].reference, method: pay.rows[0].method, amount: pay.rows[0].amount, status: pay.rows[0].status, redirectUrl: pay.rows[0].status === "en_attente" ? pay.rows[0].redirect_url : null, updatedAt: Number(pay.rows[0].updated_at) } : null,
      timeline,
      media: media.rows,
      review: hasReview ? { rating: review.rows[0].rating, comment: review.rows[0].comment } : null,
      allowed: {
        cancel: CLIENT_CANCELLABLE.includes(r.status),
        retry: r.status === "sans_disponibilite",
        manual: ["recherche", "sans_disponibilite"].includes(r.status) && !r.manual_requested,
        pay: r.status === "terminee" && r.amount_due > 0 && r.payment_status !== "paye",
        review: r.status === "terminee" && !hasReview,
        claim: !!r.assigned_phone,
        decideQuote: r.quote_status === "propose" && ACTIVE_MISSION_STATUSES.includes(r.status),
      },
    };
  }

  async function proOffers(phone: string) {
    const labels = await serviceLabels();
    const o = await pool.query(
      `SELECT o.id, o.request_id, o.distance_km, o.expires_at, r.service, r.vehicle, r.symptoms, r.lat, r.lng
       FROM assistance_offers o JOIN assistance_requests r ON r.id=o.request_id
       WHERE o.pro_phone=$1 AND o.status='envoyee' AND o.expires_at>$2 AND r.status='recherche'`,
      [phone, Date.now()]
    );
    return o.rows.map((x) => ({
      id: x.id, requestId: x.request_id, service: x.service, serviceLabel: labels[x.service] || x.service, vehicle: x.vehicle, symptoms: x.symptoms,
      approxPosition: approxPosition(x.lat, x.lng), distanceKm: Math.round(x.distance_km * 10) / 10, expiresAt: Number(x.expires_at),
    }));
  }

  async function proMissionList(phone: string) {
    const [labels, r] = await Promise.all([
      serviceLabels(),
      pool.query(`SELECT * FROM assistance_requests WHERE assigned_phone=$1 ORDER BY created_at DESC LIMIT 100`, [phone]),
    ]);
    return r.rows.map((x) => ({ ...summary(x, labels[x.service]), isActive: ACTIVE_MISSION_STATUSES.includes(x.status) }));
  }

  async function proMissionDetail(id: string, phone: string) {
    const r = (await pool.query("SELECT * FROM assistance_requests WHERE id=$1 AND assigned_phone=$2", [id, phone])).rows[0];
    if (!r) throw new AssistanceError(404, "Mission introuvable.");
    const [labels, quotes, pay, media, msgs] = await Promise.all([
      serviceLabels(),
      pool.query(`SELECT id, version, kind, lines, total, currency, status, note, created_at, decided_at FROM assistance_quotes WHERE request_id=$1 ORDER BY version`, [id]),
      pool.query(`SELECT reference, method, amount, status, updated_at FROM assistance_payments WHERE request_id=$1 ORDER BY created_at DESC LIMIT 1`, [id]),
      pool.query(`SELECT id, kind, mime, size FROM assistance_media WHERE request_id=$1 ORDER BY created_at`, [id]),
      listMessages(id),
    ]);
    const open = ACTIVE_MISSION_STATUSES.includes(r.status) || (r.status === "terminee" && Date.now() - Number(r.completed_at || 0) < 48 * 3600000);
    const s = await getSettings();
    return {
      mission: {
        ...summary(r, labels[r.service]), faultCodes: r.fault_codes, description: r.description,
        // Position exacte, repère et téléphone : uniquement pour le professionnel affecté, tant que la mission est ouverte.
        position: open ? { lat: r.lat, lng: r.lng, address: r.address, landmark: r.landmark, source: r.position_source } : null,
        clientPhone: open ? r.contact_phone : null,
        // Dossier IA transmis seulement avec le consentement du client.
        diagnostic: r.share_diagnostic ? r.diagnostic : null, shareDiagnostic: r.share_diagnostic, proDiagnosis: r.pro_diagnosis,
      },
      quotes: quotes.rows.map((q) => ({ id: q.id, version: q.version, kind: q.kind, lines: q.lines, total: q.total, status: q.status, note: q.note, createdAt: Number(q.created_at), decidedAt: q.decided_at ? Number(q.decided_at) : null })),
      payment: pay.rows[0] ? { reference: pay.rows[0].reference, method: pay.rows[0].method, amount: pay.rows[0].amount, status: pay.rows[0].status } : null,
      media: open ? media.rows : [],
      messages: msgs,
      tariffs: s.tariffs[r.service] || {},
      allowed: {
        enRoute: r.status === "affectee", surPlace: r.status === "en_route", enIntervention: r.status === "sur_place" && r.quote_status === "accepte",
        terminer: r.status === "en_intervention" && r.quote_status !== "propose",
        quote: ["sur_place", "en_intervention"].includes(r.status) && r.quote_status !== "propose",
        cashReceived: r.status === "terminee" && r.payment_status !== "paye", release: ["affectee", "en_route", "sur_place"].includes(r.status),
      },
    };
  }

  async function accessMedia(mediaId: string, viewer: { phone?: string; admin?: boolean }) {
    const m = (await pool.query("SELECT * FROM assistance_media WHERE id=$1", [mediaId])).rows[0];
    if (!m) return null;
    if (viewer.admin || m.owner_phone === viewer.phone) return m;
    if (m.request_id && viewer.phone) {
      const r = (await pool.query("SELECT assigned_phone, status FROM assistance_requests WHERE id=$1", [m.request_id])).rows[0];
      if (r && r.assigned_phone === viewer.phone && ACTIVE_MISSION_STATUSES.includes(r.status)) return m;
    }
    return null;
  }

  async function adminDashboard() {
    const [req, st, times, money, pros, claims] = await Promise.all([
      pool.query(`SELECT COUNT(*) FILTER (WHERE status<>'brouillon')::int received, COUNT(*) FILTER (WHERE assigned_at IS NOT NULL)::int accepted, COUNT(*) FILTER (WHERE status='terminee')::int completed, COUNT(*) FILTER (WHERE status='annulee')::int cancelled, COUNT(*) FILTER (WHERE status='sans_disponibilite')::int unavailable, COUNT(*) FILTER (WHERE manual_requested AND status IN ('recherche','sans_disponibilite'))::int manual FROM assistance_requests`),
      pool.query(`SELECT status, COUNT(*)::int n FROM assistance_requests GROUP BY status`),
      pool.query(`SELECT AVG(r.assigned_at - e.at)::float accept_ms FROM assistance_requests r JOIN LATERAL (SELECT at FROM assistance_events WHERE request_id=r.id AND type='envoi' ORDER BY at LIMIT 1) e ON true WHERE r.assigned_at IS NOT NULL`),
      pool.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE status='paye'),0)::bigint paid, COALESCE(SUM(amount) FILTER (WHERE status IN ('en_attente','especes_a_confirmer')),0)::bigint pending, COALESCE(SUM(commission_amount) FILTER (WHERE status='paye'),0)::bigint commission, COUNT(*) FILTER (WHERE status='paye')::int paid_count FROM assistance_payments`),
      pool.query(`SELECT validation_status, COUNT(*)::int n, COUNT(*) FILTER (WHERE available)::int available FROM assistance_pros GROUP BY validation_status`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE status='ouverte')::int open FROM assistance_claims`),
    ]);
    const arrival = await pool.query(`SELECT AVG(a.at - b.at)::float ms FROM assistance_events a JOIN assistance_events b ON b.request_id=a.request_id AND b.type='acceptation' WHERE a.type='etape' AND a.to_status='sur_place'`);
    return {
      requests: req.rows[0], byStatus: st.rows, avgAcceptMs: times.rows[0].accept_ms ? Math.round(times.rows[0].accept_ms) : null,
      avgArrivalMs: arrival.rows[0].ms ? Math.round(arrival.rows[0].ms) : null,
      payments: { paid: Number(money.rows[0].paid), pending: Number(money.rows[0].pending), commission: Number(money.rows[0].commission), paidCount: money.rows[0].paid_count },
      pros: pros.rows, openClaims: claims.rows[0].open,
    };
  }

  return {
    pool, tx, init, getSettings, saveSettings, logEvent, notify, resolveZone, servicesStatus, syncDirectory, proProfile, upsertProProfile,
    setPresence, updateLocation, clearLocationIfIdle, createRequest, updateDraft, getRequestRow, submitRequest, cancelRequest, retryRequest,
    requestManual, dispatch, dispatchTick, startWorker, stopWorker, acceptOffer, declineOffer, adminAssign, redispatch, proProgress,
    setProDiagnosis, proposeQuote, decideQuote, startPayment, handleJekoWebhook, reconcilePayment, declareCash, confirmCash, applyPaymentResult,
    addReview, addClaim, addMessage, listMessages, storeMedia, listForClient, clientDetail, proOffers, proMissionList, proMissionDetail,
    accessMedia, adminDashboard, serviceLabels, summary,
  };
}
export type AssistanceCore = ReturnType<typeof createAssistanceCore>;
