// Abonnement mensuel du logiciel de gestion (garages et vendeurs).
// - Chaque abonné = un compte DiagAssist (téléphone + mot de passe) ; ses données sont séparées par « owner ».
// - Essai gratuit puis paiement via Jèko (Orange / Wave / MTN / Moov). Prix, durée d'essai et délai de rappel
//   sont réglables par l'administrateur.
// - À l'expiration : blocage doux. Lecture seule, toutes les données sont conservées.
import crypto from "crypto";

const DAY = 86_400_000;
export const PAYMENT_METHODS = ["orange", "wave", "mtn", "moov"];

export const DEFAULT_SUB_SETTINGS = { price_fcfa: 10000, trial_days: 14, reminder_days: 5 };
export type SubSettings = typeof DEFAULT_SUB_SETTINGS;

export type SubRow = { owner: string; phone: string; trial_ends_at: number | null; paid_until: number | null; last_reminder_for: number | null; created_at: number };
export type SubState = { state: "none" | "trial" | "active" | "expired"; until: number | null; daysLeft: number | null };

// État d'un abonnement à l'instant `now` : essai en cours, abonnement payé, expiré, ou jamais démarré.
export function computeState(sub: Pick<SubRow, "trial_ends_at" | "paid_until"> | null | undefined, now = Date.now()): SubState {
  if (!sub) return { state: "none", until: null, daysLeft: null };
  const paid = Number(sub.paid_until || 0), trial = Number(sub.trial_ends_at || 0);
  const until = Math.max(paid, trial) || null;
  if (paid > now) return { state: "active", until, daysLeft: Math.ceil((paid - now) / DAY) };
  if (trial > now) return { state: "trial", until, daysLeft: Math.ceil((trial - now) / DAY) };
  return { state: "expired", until, daysLeft: 0 };
}

export type SubDeps = {
  requireAdminAuth: any;
  isAdmin: (req: any) => Promise<boolean>;
  requireAuth: any;
  sendWhatsApp?: (phone: string, message: string) => Promise<void>;
  jeko?: {
    isConfigured: () => boolean;
    create: (p: { reference: string; amountXof: number; paymentMethod: string; payerPhone?: string; successUrl: string; errorUrl: string }) => Promise<{ id?: string; redirectUrl?: string }>;
    fetchStatus: (jekoId: string) => Promise<string>;
  };
  getOrigin: (req: any) => string;
};

// Exécute requireAuth sans bloquer : vrai si la session est valide, faux si requireAuth a déjà répondu (401).
export function runAuth(requireAuth: any, req: any, res: any): Promise<boolean> {
  return new Promise((resolve) => {
    res.once("close", () => resolve(false));
    requireAuth(req, res, () => resolve(true));
  });
}

const clampInt = (v: any, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export function createSubscriptions(pool: any, deps: SubDeps) {
  async function getSettings(): Promise<SubSettings> {
    const { rows } = await pool.query("SELECT key, value FROM gestion_settings");
    const m = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
    return {
      price_fcfa: clampInt(m.price_fcfa, 0, 1_000_000, DEFAULT_SUB_SETTINGS.price_fcfa),
      trial_days: clampInt(m.trial_days, 0, 90, DEFAULT_SUB_SETTINGS.trial_days),
      reminder_days: clampInt(m.reminder_days, 1, 30, DEFAULT_SUB_SETTINGS.reminder_days),
    };
  }

  async function getSub(owner: string): Promise<SubRow | null> {
    const { rows } = await pool.query("SELECT * FROM gestion_subscriptions WHERE owner = $1", [owner]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { ...r, trial_ends_at: r.trial_ends_at === null ? null : Number(r.trial_ends_at), paid_until: r.paid_until === null ? null : Number(r.paid_until),
      last_reminder_for: r.last_reminder_for === null ? null : Number(r.last_reminder_for), created_at: Number(r.created_at) };
  }

  async function stateFor(owner: string): Promise<SubState> {
    return computeState(await getSub(owner));
  }

  // Ajoute `months` mois (30 jours chacun) à partir de la fin actuelle (ou de maintenant si c'est expiré).
  async function extend(c: any, owner: string, phone: string, ms: number) {
    const now = Date.now();
    const { rows } = await c.query("SELECT * FROM gestion_subscriptions WHERE owner = $1 FOR UPDATE", [owner]);
    const cur = rows[0];
    const base = Math.max(now, Number(cur?.paid_until || 0), Number(cur?.trial_ends_at || 0));
    if (cur) await c.query("UPDATE gestion_subscriptions SET paid_until = $2 WHERE owner = $1", [owner, base + ms]);
    else await c.query("INSERT INTO gestion_subscriptions (owner, phone, paid_until, created_at) VALUES ($1,$2,$3,$4)", [owner, phone, base + ms, now]);
  }

  async function withTx<T>(work: (c: any) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const r = await work(c);
      await c.query("COMMIT");
      return r;
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }

  // Applique le résultat d'un paiement (idempotent : un paiement n'est compté qu'une fois).
  async function applyPayment(reference: string, outcome: "paye" | "echoue") {
    await withTx(async (c) => {
      const { rows } = await c.query("SELECT * FROM gestion_payments WHERE reference = $1 FOR UPDATE", [reference]);
      const p = rows[0];
      if (!p || p.status !== "en_attente") return;
      if (outcome === "echoue") { await c.query("UPDATE gestion_payments SET status = 'echoue' WHERE reference = $1", [reference]); return; }
      await c.query("UPDATE gestion_payments SET status = 'paye', paid_at = $2 WHERE reference = $1", [reference, Date.now()]);
      await extend(c, p.owner, p.phone, p.months * 30 * DAY);
    });
  }

  // Webhook Jèko (signature déjà vérifiée par jeko.routes) : renvoie true si la référence nous appartient.
  async function onWebhook(reference: string, status: string, body: any): Promise<boolean> {
    if (!reference.startsWith("dggs-")) return false;
    const { rows } = await pool.query("SELECT * FROM gestion_payments WHERE reference = $1", [reference]);
    const p = rows[0];
    if (!p) return false;
    if (p.status !== "en_attente") return true;
    const amount = Number(body?.amount?.amount);
    if (Number.isFinite(amount) && amount !== p.amount_fcfa * 100) {
      console.warn(`[GESTION][Webhook] Montant différent pour ${reference} : reçu=${amount}, attendu=${p.amount_fcfa * 100}.`);
      return true;
    }
    const jid = body?.transactionDetails?.id;
    if (p.provider_ref && jid && String(jid) !== String(p.provider_ref)) return true;
    const s = status.toLowerCase();
    if (s === "success" || s === "completed") await applyPayment(reference, "paye");
    else await applyPayment(reference, "echoue");
    return true;
  }

  // Filet de sécurité si le webhook n'est pas arrivé : on interroge Jèko directement.
  async function reconcile(reference: string) {
    const { rows } = await pool.query("SELECT * FROM gestion_payments WHERE reference = $1", [reference]);
    const p = rows[0];
    if (!p || p.status !== "en_attente" || !p.provider_ref || !deps.jeko?.isConfigured()) return;
    try {
      const s = (await deps.jeko.fetchStatus(p.provider_ref)).toLowerCase();
      if (s === "success" || s === "completed") await applyPayment(reference, "paye");
      else if (s === "error" || s === "failed") await applyPayment(reference, "echoue");
    } catch (e: any) {
      console.error("[GESTION] Réconciliation Jèko impossible:", e.message);
    }
  }

  // Rappel WhatsApp avant l'échéance (une seule fois par échéance). Sans WhatsApp configuré, le bandeau dans
  // l'application prend le relais et rien n'est marqué comme envoyé.
  async function runReminders(): Promise<number> {
    if (!deps.sendWhatsApp) return 0;
    const { reminder_days } = await getSettings();
    const now = Date.now();
    const { rows } = await pool.query(
      `SELECT *, GREATEST(COALESCE(paid_until,0), COALESCE(trial_ends_at,0)) AS ends FROM gestion_subscriptions
       WHERE GREATEST(COALESCE(paid_until,0), COALESCE(trial_ends_at,0)) > $1
         AND GREATEST(COALESCE(paid_until,0), COALESCE(trial_ends_at,0)) <= $1 + $2::bigint * 86400000
         AND last_reminder_for IS DISTINCT FROM GREATEST(COALESCE(paid_until,0), COALESCE(trial_ends_at,0))`,
      [now, reminder_days]);
    let sent = 0;
    for (const r of rows) {
      const ends = Number(r.ends), left = Math.max(1, Math.ceil((ends - now) / DAY));
      const message = `Bonjour, votre abonnement au logiciel de gestion DiagAssist se termine dans ${left} jour${left > 1 ? "s" : ""} (le ${new Date(ends).toLocaleDateString("fr-FR")}). Renouvelez-le sur /gestion pour garder l'accès complet. Vos données restent conservées.`;
      try {
        await deps.sendWhatsApp(r.phone, message);
        await pool.query("UPDATE gestion_subscriptions SET last_reminder_for = $2 WHERE owner = $1", [r.owner, ends]);
        sent++;
      } catch (e: any) {
        console.error("[GESTION] Rappel non envoyé:", e?.message || e);
      }
    }
    return sent;
  }

  const wrap = (h: (req: any, res: any) => Promise<any>) => async (req: any, res: any) => {
    try { await h(req, res); } catch (e: any) {
      console.error("[gestion][abonnement]", e?.message || e);
      const status = e?.status || 400;
      res.status(status).json({ success: false, message: status < 500 || status === 502 || status === 503 ? e?.message || "Erreur" : "Service momentanément indisponible." });
    }
  };
  // Compte DiagAssist connecté (les administrateurs n'ont pas d'abonnement).
  const withUser = (h: (req: any, res: any, owner: string, phone: string) => Promise<any>) => wrap(async (req, res) => {
    if (await deps.isAdmin(req)) return res.json({ success: true, admin: true });
    if (!(await runAuth(deps.requireAuth, req, res))) return;
    await h(req, res, `u:${req.session.phone}`, req.session.phone);
  });

  function register(app: any) {
    const base = "/api/gestion";

    const view = async (owner: string) => {
      const [sub, settings] = await Promise.all([getSub(owner), getSettings()]);
      return { ...computeState(sub), price_fcfa: settings.price_fcfa, trial_days: settings.trial_days, reminder_days: settings.reminder_days,
        trial_available: !sub && settings.trial_days > 0, payments_enabled: !!deps.jeko?.isConfigured() };
    };

    app.get(`${base}/subscription`, withUser(async (_req, res, owner) => res.json({ success: true, ...(await view(owner)) })));

    app.post(`${base}/subscription/trial`, withUser(async (_req, res, owner, phone) => {
      const { trial_days } = await getSettings();
      if (trial_days <= 0) throw new Error("L'essai gratuit n'est pas proposé pour le moment.");
      const now = Date.now();
      const ins = await pool.query(
        "INSERT INTO gestion_subscriptions (owner, phone, trial_ends_at, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (owner) DO NOTHING",
        [owner, phone, now + trial_days * DAY, now]);
      if (!ins.rowCount) throw new Error("L'essai gratuit a déjà été utilisé.");
      res.json({ success: true, ...(await view(owner)) });
    }));

    app.post(`${base}/subscription/pay`, withUser(async (req, res, owner, phone) => {
      if (!deps.jeko?.isConfigured()) throw Object.assign(new Error("Le paiement en ligne n'est pas encore activé. Réessayez plus tard."), { status: 503 });
      const method = String(req.body?.paymentMethod || "");
      if (!PAYMENT_METHODS.includes(method)) throw new Error("Moyen de paiement invalide (Orange Money, Wave, MTN MoMo ou Moov Money).");
      const months = clampInt(req.body?.months, 1, 12, 1);
      const { price_fcfa } = await getSettings();
      const amount = price_fcfa * months;
      if (amount <= 0) throw new Error("Le prix de l'abonnement n'est pas encore défini.");
      const reference = `dggs-${crypto.randomBytes(12).toString("hex")}`;
      const origin = deps.getOrigin(req);
      const created = await deps.jeko.create({
        reference, amountXof: amount, paymentMethod: method,
        payerPhone: req.body?.payerPhone ? String(req.body.payerPhone) : undefined,
        successUrl: `${origin}/gestion?abonnement=retour&reference=${encodeURIComponent(reference)}`,
        errorUrl: `${origin}/gestion?abonnement=retour&reference=${encodeURIComponent(reference)}`,
      }).catch((e: any) => {
        console.error("[GESTION] Paiement non créé:", e?.message || e);
        throw Object.assign(new Error("Le paiement n'a pas pu être initié. Réessayez dans un instant."), { status: 502 });
      });
      await pool.query(
        "INSERT INTO gestion_payments (reference, owner, phone, months, amount_fcfa, status, provider_ref, created_at) VALUES ($1,$2,$3,$4,$5,'en_attente',$6,$7)",
        [reference, owner, phone, months, amount, created.id || null, Date.now()]);
      res.json({ success: true, reference, redirectUrl: created.redirectUrl, amount_fcfa: amount });
    }));

    app.get(`${base}/subscription/payment/:reference`, withUser(async (req, res, owner) => {
      const reference = String(req.params.reference);
      const { rows: own } = await pool.query("SELECT 1 FROM gestion_payments WHERE reference = $1 AND owner = $2", [reference, owner]);
      if (!own.length) throw Object.assign(new Error("Paiement introuvable."), { status: 404 });
      await reconcile(reference);
      const { rows } = await pool.query("SELECT status FROM gestion_payments WHERE reference = $1", [reference]);
      res.json({ success: true, status: rows[0].status, ...(await view(owner)) });
    }));

    // --- Administration : réglages, liste des abonnés, jours offerts, rappels ---
    const admin = deps.requireAdminAuth;
    app.get(`${base}/admin/subscription-settings`, admin, wrap(async (_req, res) => res.json({ success: true, settings: await getSettings() })));
    app.put(`${base}/admin/subscription-settings`, admin, wrap(async (req, res) => {
      const b = req.body || {};
      const cur = await getSettings();
      const next: SubSettings = {
        price_fcfa: b.price_fcfa === undefined ? cur.price_fcfa : clampInt(b.price_fcfa, 0, 1_000_000, NaN),
        trial_days: b.trial_days === undefined ? cur.trial_days : clampInt(b.trial_days, 0, 90, NaN),
        reminder_days: b.reminder_days === undefined ? cur.reminder_days : clampInt(b.reminder_days, 1, 30, NaN),
      };
      if (Object.values(next).some((v) => !Number.isFinite(v))) throw new Error("Valeurs invalides (prix 0 à 1 000 000, essai 0 à 90 jours, rappel 1 à 30 jours).");
      for (const [k, v] of Object.entries(next)) {
        await pool.query("INSERT INTO gestion_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2", [k, String(v)]);
      }
      res.json({ success: true, settings: next });
    }));
    app.get(`${base}/admin/subscribers`, admin, wrap(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT s.*, COALESCE((SELECT SUM(amount_fcfa) FROM gestion_payments p WHERE p.owner = s.owner AND p.status = 'paye'), 0)::int AS paid_total_fcfa
         FROM gestion_subscriptions s ORDER BY s.created_at DESC LIMIT 500`);
      const items = rows.map((r: any) => ({ owner: r.owner, phone: r.phone, created_at: Number(r.created_at), paid_total_fcfa: r.paid_total_fcfa,
        trial_ends_at: r.trial_ends_at === null ? null : Number(r.trial_ends_at), paid_until: r.paid_until === null ? null : Number(r.paid_until),
        ...computeState({ trial_ends_at: r.trial_ends_at === null ? null : Number(r.trial_ends_at), paid_until: r.paid_until === null ? null : Number(r.paid_until) }) }));
      res.json({ success: true, subscribers: items });
    }));
    app.post(`${base}/admin/subscribers/:owner/grant`, admin, wrap(async (req, res) => {
      const days = clampInt(req.body?.days, 1, 365, NaN);
      if (!Number.isFinite(days)) throw new Error("Nombre de jours invalide (1 à 365).");
      const { rows } = await pool.query("SELECT phone FROM gestion_subscriptions WHERE owner = $1", [String(req.params.owner)]);
      if (!rows[0]) throw Object.assign(new Error("Abonné introuvable."), { status: 404 });
      await withTx((c) => extend(c, String(req.params.owner), rows[0].phone, days * DAY));
      res.json({ success: true });
    }));
    app.post(`${base}/admin/subscription-reminders`, admin, wrap(async (_req, res) => res.json({ success: true, sent: await runReminders(), whatsapp: !!deps.sendWhatsApp })));

    // Vérification toutes les heures (sans bloquer l'arrêt du serveur).
    if (deps.sendWhatsApp && process.env.NODE_ENV !== "test") {
      const timer = setInterval(() => runReminders().catch((e) => console.error("[GESTION] Rappels:", e?.message || e)), 60 * 60 * 1000);
      timer.unref?.();
    }
  }

  return { getSettings, getSub, stateFor, onWebhook, reconcile, runReminders, register };
}
