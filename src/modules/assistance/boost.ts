// Mise en avant payante des mécaniciens (annuaire + offres de dépannage).
// Module volontairement autonome : sa propre table `assistance_boosts`, son propre réglage (clé `boost`
// dans assistance_settings) et ses propres routes. Un mécanicien « mis en avant » apparaît en premier dans
// l'annuaire et reçoit un badge ; ses prix d'offre restent soumis à la même fourchette admin et le client
// garde les tris « Moins cher » / « Plus rapide ».
import crypto from "crypto";
import type { Pool } from "pg";
import { PAYMENT_METHODS, clean, normalizePhone } from "./domain";
import { AssistanceError, canonicalPhone, type CoreDeps } from "./core";

export const BOOST_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS assistance_boosts (
  reference TEXT PRIMARY KEY,
  pro_phone TEXT NOT NULL,
  plan_code TEXT NOT NULL,
  plan_label TEXT NOT NULL,
  days INTEGER NOT NULL CHECK (days > 0),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  method TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('jeko','admin')),
  status TEXT NOT NULL CHECK (status IN ('en_attente','actif','echoue','annule')),
  provider_ref TEXT,
  redirect_url TEXT,
  starts_at BIGINT,
  ends_at BIGINT,
  granted_by TEXT,
  note TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assistance_boosts_pro ON assistance_boosts (pro_phone, status, ends_at);
`;

export type BoostPlan = { code: string; label: string; days: number; price: number };
export type BoostConfig = { enabled: boolean; offersFirst: boolean; plans: BoostPlan[] };

// Désactivée par défaut : rien n'est vendu tant que l'admin n'a pas vérifié les prix et activé l'option.
export const DEFAULT_BOOST_CONFIG: BoostConfig = {
  enabled: false,
  offersFirst: true,
  plans: [
    { code: "semaine", label: "1 semaine", days: 7, price: 3000 },
    { code: "mois", label: "1 mois", days: 30, price: 10000 },
  ],
};

const DAY = 86_400_000;
const SETTINGS_KEY = "boost";

export function parseBoostConfig(raw: any): BoostConfig {
  const c: BoostConfig = { enabled: DEFAULT_BOOST_CONFIG.enabled, offersFirst: DEFAULT_BOOST_CONFIG.offersFirst, plans: DEFAULT_BOOST_CONFIG.plans };
  if (!raw || typeof raw !== "object") return c;
  if (typeof raw.enabled === "boolean") c.enabled = raw.enabled;
  if (typeof raw.offersFirst === "boolean") c.offersFirst = raw.offersFirst;
  if (Array.isArray(raw.plans)) c.plans = raw.plans;
  return c;
}

// Contrôle strict d'une configuration envoyée par l'admin.
export function validateBoostConfig(raw: any): BoostConfig {
  if (!raw || typeof raw !== "object") throw new AssistanceError(400, "Réglage de mise en avant invalide.");
  const plans: BoostPlan[] = [];
  const list = Array.isArray(raw.plans) ? raw.plans : [];
  if (list.length > 6) throw new AssistanceError(400, "Six formules de mise en avant au maximum.");
  const seen = new Set<string>();
  for (const p of list) {
    const label = clean(p?.label, 40);
    const days = Number(p?.days);
    const price = Number(p?.price);
    if (!label) throw new AssistanceError(400, "Chaque formule doit avoir un nom.");
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new AssistanceError(400, `« ${label} » : la durée doit être de 1 à 365 jours.`);
    if (!Number.isInteger(price) || price < 100 || price > 1_000_000) throw new AssistanceError(400, `« ${label} » : le prix doit être un entier de 100 à 1 000 000 F CFA.`);
    let code = clean(p?.code, 30).toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!code) code = `f${days}j`;
    while (seen.has(code)) code += "x";
    seen.add(code);
    plans.push({ code, label, days, price });
  }
  const enabled = raw.enabled === true;
  if (enabled && !plans.length) throw new AssistanceError(400, "Ajoutez au moins une formule avant d'activer la mise en avant.");
  return { enabled, offersFirst: raw.offersFirst !== false, plans };
}

export function createBoost(deps: {
  pool: Pool;
  jeko?: CoreDeps["jeko"];
  sendWhatsApp?: CoreDeps["sendWhatsApp"];
}) {
  const { pool } = deps;
  let cache: { at: number; phones: Set<string> } | null = null;
  const invalidate = () => { cache = null; };

  async function init() { await pool.query(BOOST_SCHEMA_SQL); }

  async function getConfig(): Promise<BoostConfig> {
    const r = await pool.query("SELECT value FROM assistance_settings WHERE key=$1", [SETTINGS_KEY]);
    return parseBoostConfig(r.rows[0]?.value);
  }
  async function saveConfig(raw: any): Promise<BoostConfig> {
    const cfg = validateBoostConfig(raw);
    await pool.query(
      `INSERT INTO assistance_settings (key, value, updated_at) VALUES ($1,$2::jsonb,$3) ON CONFLICT (key) DO UPDATE SET value=$2::jsonb, updated_at=$3`,
      [SETTINGS_KEY, JSON.stringify(cfg), Date.now()]
    );
    return cfg;
  }

  // Numéros (format canonique) dont la mise en avant est en cours. Mis en cache 20 s : l'annuaire est consulté souvent.
  async function activePhones(): Promise<Set<string>> {
    if (cache && Date.now() - cache.at < 20_000) return cache.phones;
    const r = await pool.query(`SELECT DISTINCT pro_phone FROM assistance_boosts WHERE status='actif' AND starts_at<=$1 AND ends_at>$1`, [Date.now()]);
    const phones = new Set<string>(r.rows.map((x) => x.pro_phone));
    cache = { at: Date.now(), phones };
    return phones;
  }

  async function currentBoost(phone: string) {
    const r = await pool.query(
      `SELECT plan_label, starts_at, ends_at FROM assistance_boosts WHERE pro_phone=$1 AND status='actif' AND ends_at>$2 ORDER BY ends_at DESC LIMIT 1`,
      [phone, Date.now()]
    );
    return r.rows[0] ? { planLabel: r.rows[0].plan_label as string, startsAt: Number(r.rows[0].starts_at), endsAt: Number(r.rows[0].ends_at) } : null;
  }

  // Active un achat confirmé : la nouvelle période commence à la fin de celle en cours (les achats s'additionnent).
  async function activate(reference: string, by: string): Promise<void> {
    const c = await pool.connect();
    let phone = "", label = "", endsAt = 0;
    try {
      await c.query("BEGIN");
      const b = (await c.query("SELECT * FROM assistance_boosts WHERE reference=$1 FOR UPDATE", [reference])).rows[0];
      // Déjà traité : idempotent. Un achat remplacé par un autre (« annule » sans date de début) reste payable ; un retrait admin non.
      if (!b || !(b.status === "en_attente" || (b.status === "annule" && b.starts_at == null))) { await c.query("ROLLBACK"); return; }
      const now = Date.now();
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [b.pro_phone]);
      const last = (await c.query(`SELECT COALESCE(MAX(ends_at),0)::bigint AS e FROM assistance_boosts WHERE pro_phone=$1 AND status='actif'`, [b.pro_phone])).rows[0];
      const start = Math.max(now, Number(last.e));
      endsAt = start + b.days * DAY;
      await c.query(`UPDATE assistance_boosts SET status='actif', starts_at=$2, ends_at=$3, granted_by=COALESCE(granted_by,$4), updated_at=$5 WHERE reference=$1`, [reference, start, endsAt, by, now]);
      await c.query("COMMIT");
      phone = b.pro_phone; label = b.plan_label;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally { c.release(); }
    invalidate();
    await pool.query(
      `INSERT INTO assistance_notifications (phone, request_id, type, title, body, created_at) VALUES ($1,NULL,'mise_en_avant','Mise en avant activée',$2,$3)`,
      [phone, `Votre mise en avant (${label}) est active jusqu'au ${new Date(endsAt).toLocaleDateString("fr-FR")}. Vous apparaissez en premier dans l'annuaire.`, Date.now()]
    ).catch(() => {});
  }

  async function fail(reference: string) {
    await pool.query(`UPDATE assistance_boosts SET status='echoue', updated_at=$2 WHERE reference=$1 AND status='en_attente'`, [reference, Date.now()]);
  }

  // Webhook Jèko (signature déjà vérifiée) : contrôle montant et identifiant puis active.
  async function handleWebhook(reference: string, status: string, body: any): Promise<boolean> {
    const b = (await pool.query("SELECT * FROM assistance_boosts WHERE reference=$1", [reference])).rows[0];
    if (!b) return false;
    if (b.provider !== "jeko" || !(b.status === "en_attente" || (b.status === "annule" && b.starts_at == null))) return true;
    const amt = Number(body?.amount?.amount);
    if (Number.isFinite(amt) && amt !== b.amount * 100) { console.warn(`[BOOST][Webhook] Montant différent pour ${reference}.`); return true; }
    const jid = body?.transactionDetails?.id;
    if (b.provider_ref && jid && String(jid) !== String(b.provider_ref)) { console.warn(`[BOOST][Webhook] Identifiant Jèko différent pour ${reference}.`); return true; }
    const s = status.toLowerCase();
    if (s === "success" || s === "completed") await activate(reference, "jeko");
    else await fail(reference);
    return true;
  }

  // Filet de sécurité si le webhook n'est jamais arrivé : on interroge Jèko.
  async function reconcile(reference: string) {
    const b = (await pool.query("SELECT * FROM assistance_boosts WHERE reference=$1", [reference])).rows[0];
    if (!b || b.status !== "en_attente" || b.provider !== "jeko" || !b.provider_ref || !deps.jeko?.isConfigured()) return;
    try {
      const s = (await deps.jeko.fetchStatus(b.provider_ref)).toLowerCase();
      if (s === "success" || s === "completed") await activate(reference, "jeko");
      else if (s === "error" || s === "failed") await fail(reference);
    } catch (e: any) { console.error("[BOOST] Réconciliation Jèko impossible:", e.message); }
  }

  // Vue du mécanicien : formules, mise en avant en cours, paiement en attente (réconcilié au passage).
  async function proView(phone: string) {
    const pending0 = (await pool.query(`SELECT reference FROM assistance_boosts WHERE pro_phone=$1 AND status='en_attente' AND provider='jeko' AND created_at>$2 ORDER BY created_at DESC LIMIT 1`, [phone, Date.now() - 60 * 60000])).rows[0];
    if (pending0) await reconcile(pending0.reference);
    const [cfg, active, pending, history] = await Promise.all([
      getConfig(),
      currentBoost(phone),
      pool.query(`SELECT reference, plan_label, amount, redirect_url, created_at FROM assistance_boosts WHERE pro_phone=$1 AND status='en_attente' AND provider='jeko' AND created_at>$2 ORDER BY created_at DESC LIMIT 1`, [phone, Date.now() - 60 * 60000]),
      pool.query(`SELECT plan_label, amount, provider, status, starts_at, ends_at, created_at FROM assistance_boosts WHERE pro_phone=$1 AND status IN ('actif','echoue') ORDER BY created_at DESC LIMIT 10`, [phone]),
    ]);
    return {
      enabled: cfg.enabled, plans: cfg.enabled ? cfg.plans : [], active,
      paymentConfigured: !!deps.jeko?.isConfigured(),
      pending: pending.rows[0] ? { reference: pending.rows[0].reference, planLabel: pending.rows[0].plan_label, amount: pending.rows[0].amount, redirectUrl: pending.rows[0].redirect_url } : null,
      history: history.rows.map((h) => ({ planLabel: h.plan_label, amount: h.amount, free: h.provider === "admin", status: h.status, startsAt: h.starts_at ? Number(h.starts_at) : null, endsAt: h.ends_at ? Number(h.ends_at) : null, createdAt: Number(h.created_at) })),
    };
  }

  async function startPayment(phone: string, planCode: string, method: string, payerPhone: string | undefined, origin: string) {
    const cfg = await getConfig();
    if (!cfg.enabled) throw new AssistanceError(409, "La mise en avant n'est pas ouverte pour le moment.");
    const plan = cfg.plans.find((p) => p.code === planCode);
    if (!plan) throw new AssistanceError(400, "Formule de mise en avant inconnue.");
    if (!(PAYMENT_METHODS as readonly string[]).includes(method)) throw new AssistanceError(400, "Moyen de paiement invalide (Wave, Orange Money, MTN MoMo ou Moov Money).");
    if (!deps.jeko?.isConfigured()) throw new AssistanceError(503, "Le paiement en ligne n'est pas encore activé. Réessayez plus tard.", "PAYMENT_NOT_CONFIGURED");
    const pro = (await pool.query("SELECT validation_status FROM assistance_pros WHERE phone=$1", [phone])).rows[0];
    if (!pro) throw new AssistanceError(403, "Créez d'abord votre profil mécanicien.", "NO_PRO_PROFILE");
    if (!["valide", "en_attente"].includes(pro.validation_status)) throw new AssistanceError(403, "Votre profil ne permet pas la mise en avant. Contactez DiagAssist.");
    const recent = (await pool.query(`SELECT * FROM assistance_boosts WHERE pro_phone=$1 AND status='en_attente' AND provider='jeko' AND created_at>$2 ORDER BY created_at DESC LIMIT 1`, [phone, Date.now() - 10 * 60000])).rows[0];
    if (recent && recent.plan_code === plan.code && recent.method === method && recent.redirect_url) return { reference: recent.reference, redirectUrl: recent.redirect_url };
    if (recent) throw new AssistanceError(409, "Un paiement est déjà en cours. Patientez quelques minutes avant de changer de formule.");
    const reference = `dgas-boost-${crypto.randomBytes(6).toString("hex")}`;
    const created = await deps.jeko.create({
      reference, amountXof: plan.price, paymentMethod: method,
      payerPhone: payerPhone ? normalizePhone(payerPhone) : undefined,
      successUrl: `${origin}/?boost=return`, errorUrl: `${origin}/?boost=return`,
    });
    const now = Date.now();
    await pool.query(`UPDATE assistance_boosts SET status='annule', updated_at=$2 WHERE pro_phone=$1 AND status='en_attente' AND provider='jeko'`, [phone, now]);
    await pool.query(
      `INSERT INTO assistance_boosts (reference, pro_phone, plan_code, plan_label, days, amount, method, provider, status, provider_ref, redirect_url, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'jeko','en_attente',$8,$9,$10,$10)`,
      [reference, phone, plan.code, plan.label, plan.days, plan.price, method, created.id || null, created.redirectUrl || null, now]
    );
    return { reference, redirectUrl: created.redirectUrl };
  }

  // Offre ou prolonge une mise en avant sans paiement (geste commercial, test).
  async function grant(phoneRaw: string, days: number, admin: string, note?: string) {
    const phone = canonicalPhone(phoneRaw);
    if (normalizePhone(phoneRaw).length < 8) throw new AssistanceError(400, "Numéro de téléphone invalide.");
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new AssistanceError(400, "La durée doit être de 1 à 365 jours.");
    const reference = `boost-adm-${crypto.randomBytes(6).toString("hex")}`;
    const now = Date.now();
    await pool.query(
      `INSERT INTO assistance_boosts (reference, pro_phone, plan_code, plan_label, days, amount, provider, status, granted_by, note, created_at, updated_at) VALUES ($1,$2,'offert',$3,$4,0,'admin','en_attente',$5,$6,$7,$7)`,
      [reference, phone, `Offert (${days} j)`, days, admin, note ? clean(note, 200) : null, now]
    );
    await activate(reference, admin);
    return reference;
  }

  async function revoke(reference: string) {
    const r = await pool.query(`UPDATE assistance_boosts SET status='annule', ends_at=LEAST(ends_at,$2), updated_at=$2 WHERE reference=$1 AND status='actif' RETURNING reference`, [reference, Date.now()]);
    if (!r.rowCount) throw new AssistanceError(404, "Mise en avant active introuvable.");
    invalidate();
  }

  async function adminList() {
    const r = await pool.query(
      `SELECT b.reference, b.pro_phone, pr.display_name, pr.garage_name, b.plan_label, b.days, b.amount, b.provider, b.status, b.starts_at, b.ends_at, b.granted_by, b.note, b.created_at
       FROM assistance_boosts b LEFT JOIN assistance_pros pr ON pr.phone=b.pro_phone ORDER BY b.created_at DESC LIMIT 300`
    );
    const now = Date.now();
    const rows = r.rows.map((x) => ({
      reference: x.reference, phone: x.pro_phone, name: x.garage_name || x.display_name || null, planLabel: x.plan_label, days: x.days, amount: x.amount,
      provider: x.provider, status: x.status, startsAt: x.starts_at ? Number(x.starts_at) : null, endsAt: x.ends_at ? Number(x.ends_at) : null,
      running: x.status === "actif" && Number(x.ends_at) > now && Number(x.starts_at) <= now, grantedBy: x.granted_by, note: x.note, createdAt: Number(x.created_at),
    }));
    const revenue = rows.filter((x) => x.provider === "jeko" && x.status === "actif").reduce((s, x) => s + x.amount, 0);
    return { boosts: rows, revenue, runningCount: rows.filter((x) => x.running).length };
  }

  return { init, getConfig, saveConfig, activePhones, proView, startPayment, handleWebhook, reconcile, grant, revoke, adminList, invalidate };
}
export type BoostService = ReturnType<typeof createBoost>;
