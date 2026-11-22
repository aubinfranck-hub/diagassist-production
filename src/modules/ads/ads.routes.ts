import crypto from "crypto";
import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import rateLimit from "express-rate-limit";

// Publicité locale : des commerces (pièces, huiles, pneus…) achètent un emplacement discret sur le blog
// et la page d'accueil publique. Jamais dans le diagnostic, le live ni les écrans d'urgence/assistance.

export const AD_DURATIONS = [7, 30, 90] as const;
export type AdDuration = (typeof AD_DURATIONS)[number];
const DAY = 86_400_000;
const MAX_IMAGE_BYTES = 500 * 1024;
const IMAGE_TYPES: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.length > 8 && b.subarray(0, 4).toString("hex") === "89504e47",
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8,
  "image/webp": (b) => b.length > 12 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
  "image/gif": (b) => b.length > 6 && b.subarray(0, 3).toString() === "GIF",
};

const DEFAULT_SLOTS = [
  { id: "blog_haut", label: "Blog : haut de page", description: "Sous le titre de chaque page du blog.", p7: 5000, p30: 15000, p90: 36000 },
  { id: "blog_bas", label: "Blog : bas de page", description: "En fin d'article, avant l'appel à essayer DiagAssist.", p7: 3000, p30: 9000, p90: 22000 },
  { id: "accueil", label: "Page d'accueil publique", description: "Sur la page de présentation, avant connexion (jamais dans le diagnostic).", p7: 10000, p30: 30000, p90: 75000 },
];

export class AdsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type AdsDeps = {
  app: Express;
  pool: Pool | null;
  requireAdminAuth: any;
  jeko?: {
    isConfigured: () => boolean;
    create: (p: { reference: string; amountXof: number; paymentMethod: string; payerPhone?: string; successUrl: string; errorUrl: string }) => Promise<{ id?: string; redirectUrl?: string }>;
    fetchStatus: (jekoId: string) => Promise<string>;
  };
  getOrigin: (req: Request) => string;
};

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const httpsLink = (v: unknown): string | null => {
  const s = clean(v, 500);
  try { const u = new URL(s); return u.protocol === "https:" ? u.toString() : null; } catch { return null; }
};

export async function initAdsSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_slots (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      price_7 INTEGER NOT NULL DEFAULT 0, price_30 INTEGER NOT NULL DEFAULT 0, price_90 INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS ad_campaigns (
      id TEXT PRIMARY KEY, slot_id TEXT NOT NULL REFERENCES ad_slots(id),
      advertiser TEXT NOT NULL, phone TEXT, link_url TEXT NOT NULL,
      image_mime TEXT, image_data BYTEA,
      duration_days INTEGER NOT NULL, amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'a_payer',
      starts_at BIGINT, ends_at BIGINT, paid_at BIGINT, paid_how TEXT,
      views INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ad_campaigns_slot ON ad_campaigns (slot_id, status, ends_at);
    CREATE TABLE IF NOT EXISTS ad_payments (
      reference TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL, method TEXT, status TEXT NOT NULL DEFAULT 'en_attente',
      provider_ref TEXT, redirect_url TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
    );
  `);
  for (const s of DEFAULT_SLOTS) {
    await pool.query(
      `INSERT INTO ad_slots (id, label, description, price_7, price_30, price_90) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [s.id, s.label, s.description, s.p7, s.p30, s.p90]
    );
  }
}

export function registerLocalAds(d: AdsDeps): { onExternalWebhook: (ref: string, status: string, body: any) => Promise<boolean> } {
  const { app, pool } = d;
  let ready: Promise<void> | null = pool ? initAdsSchema(pool).catch((e) => { console.error("[ADS] Initialisation échouée:", e.message); }) : null;

  const wrap = (fn: (req: any, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
    try {
      if (ready) await ready;
      await fn(req, res);
    } catch (e: any) {
      if (e instanceof AdsError) return res.status(e.status).json({ success: false, message: e.message });
      if (e?.status === 502) return res.status(502).json({ success: false, message: e.message });
      console.error("[ADS] Erreur:", e?.message || e);
      res.status(500).json({ success: false, message: "Une erreur est survenue. Réessayez dans un instant." });
    }
  };
  const needDb = (_req: Request, res: Response, next: NextFunction) => {
    if (!pool) return res.status(503).json({ success: false, message: "La publicité locale nécessite la base de données PostgreSQL." });
    next();
  };

  const publicLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false, message: { success: false, ad: null } });
  const adminLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Trop de requêtes." } });

  // Annonce visible : active, dans sa période, avec une image. `p` = préfixe de table, `n` = numéro du paramètre « maintenant ».
  const liveWhere = (n: number, p = "") => `${p}status = 'active' AND ${p}starts_at <= $${n} AND ${p}ends_at > $${n} AND ${p}image_data IS NOT NULL`;

  // Une même personne qui recharge la page ne gonfle pas les compteurs : 1 vue / 1 clic par annonce et par minute.
  const seen = new Map<string, number>();
  const firstTime = (kind: string, id: string, req: Request) => {
    const key = `${kind}:${id}:${req.ip}`;
    const now = Date.now();
    if ((seen.get(key) || 0) > now - 60_000) return false;
    seen.set(key, now);
    if (seen.size > 20_000) for (const [k, t] of seen) if (t < now - 60_000) seen.delete(k);
    return true;
  };

  // ---------------------------------------------------------------- Public
  app.get("/api/pub/ads", publicLimiter, wrap(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const slot = clean(req.query.slot, 40);
    if (!pool || !slot) return res.json({ success: true, ad: null });
    const now = Date.now();
    const r = await pool.query(
      `SELECT c.id, c.advertiser FROM ad_campaigns c JOIN ad_slots s ON s.id = c.slot_id
       WHERE c.slot_id = $1 AND s.active AND ${liveWhere(2, "c.")} ORDER BY random() LIMIT 1`,
      [slot, now]
    );
    const row = r.rows[0];
    if (!row) return res.json({ success: true, ad: null });
    if (firstTime("v", row.id, req)) await pool.query("UPDATE ad_campaigns SET views = views + 1 WHERE id = $1", [row.id]);
    res.json({ success: true, ad: { id: row.id, advertiser: row.advertiser, imageUrl: `/api/pub/ads/${row.id}/image`, goUrl: `/api/pub/ads/${row.id}/go` } });
  }));

  app.get("/api/pub/ads/:id/image", publicLimiter, wrap(async (req, res) => {
    if (!pool) return res.status(404).end();
    const r = await pool.query(`SELECT image_mime, image_data FROM ad_campaigns WHERE id = $1 AND ${liveWhere(2)}`, [req.params.id, Date.now()]);
    const row = r.rows[0];
    if (!row) return res.status(404).end();
    res.setHeader("Content-Type", row.image_mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(row.image_data);
  }));

  app.get("/api/pub/ads/:id/go", publicLimiter, wrap(async (req, res) => {
    if (!pool) return res.redirect(302, "/");
    const r = await pool.query(`SELECT id, link_url FROM ad_campaigns WHERE id = $1 AND ${liveWhere(2)}`, [req.params.id, Date.now()]);
    const row = r.rows[0];
    if (!row || !httpsLink(row.link_url)) return res.redirect(302, "/");
    if (firstTime("c", row.id, req)) await pool.query("UPDATE ad_campaigns SET clicks = clicks + 1 WHERE id = $1", [row.id]);
    res.setHeader("Referrer-Policy", "no-referrer");
    res.redirect(302, row.link_url);
  }));

  // ---------------------------------------------------------------- Admin
  const admin = [adminLimiter, d.requireAdminAuth, needDb];

  const campaignRow = (c: any) => ({
    id: c.id, slotId: c.slot_id, slotLabel: c.slot_label, advertiser: c.advertiser, phone: c.phone, linkUrl: c.link_url,
    hasImage: !!c.has_image, durationDays: c.duration_days, amount: c.amount, status: c.status,
    effectiveStatus: c.status === "active" && Number(c.ends_at) <= Date.now() ? "terminee" : c.status,
    startsAt: c.starts_at == null ? null : Number(c.starts_at), endsAt: c.ends_at == null ? null : Number(c.ends_at),
    paidAt: c.paid_at == null ? null : Number(c.paid_at), paidHow: c.paid_how,
    views: c.views, clicks: c.clicks, createdAt: Number(c.created_at),
    pendingPayment: c.pending_payment || null,
  });

  app.get("/api/admin/ads", ...admin, wrap(async (_req, res) => {
    const slots = (await pool!.query("SELECT * FROM ad_slots ORDER BY id")).rows.map((s) => ({
      id: s.id, label: s.label, description: s.description, price7: s.price_7, price30: s.price_30, price90: s.price_90, active: s.active,
    }));
    const rows = (await pool!.query(
      `SELECT c.*, s.label AS slot_label, (c.image_data IS NOT NULL) AS has_image,
        (SELECT p.redirect_url FROM ad_payments p WHERE p.campaign_id = c.id AND p.status = 'en_attente' ORDER BY p.created_at DESC LIMIT 1) AS pending_payment
       FROM ad_campaigns c JOIN ad_slots s ON s.id = c.slot_id ORDER BY c.created_at DESC LIMIT 300`
    )).rows;
    const campaigns = rows.map(campaignRow);
    const revenue = (await pool!.query("SELECT COALESCE(SUM(amount),0) AS t FROM ad_campaigns WHERE paid_at IS NOT NULL")).rows[0].t;
    res.json({ success: true, slots, campaigns, revenue: Number(revenue), paymentConfigured: !!d.jeko?.isConfigured() });
  }));

  const priceFor = (slot: any, days: number) => (days === 7 ? slot.price_7 : days === 30 ? slot.price_30 : slot.price_90);

  app.put("/api/admin/ads/slots/:id", ...admin, express.json({ limit: "20kb" }), wrap(async (req, res) => {
    const cur = (await pool!.query("SELECT * FROM ad_slots WHERE id = $1", [req.params.id])).rows[0];
    if (!cur) throw new AdsError(404, "Emplacement introuvable.");
    const num = (v: unknown, old: number) => {
      if (v === undefined) return old;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new AdsError(400, "Les prix doivent être des nombres entiers de FCFA (0 ou plus).");
      return n;
    };
    const b = req.body || {};
    await pool!.query(
      "UPDATE ad_slots SET price_7=$2, price_30=$3, price_90=$4, active=$5 WHERE id=$1",
      [cur.id, num(b.price7, cur.price_7), num(b.price30, cur.price_30), num(b.price90, cur.price_90), typeof b.active === "boolean" ? b.active : cur.active]
    );
    res.json({ success: true });
  }));

  app.post("/api/admin/ads/campaigns", ...admin, express.json({ limit: "20kb" }), wrap(async (req, res) => {
    const b = req.body || {};
    const slot = (await pool!.query("SELECT * FROM ad_slots WHERE id = $1", [clean(b.slotId, 40)])).rows[0];
    if (!slot) throw new AdsError(400, "Choisissez un emplacement.");
    const advertiser = clean(b.advertiser, 80);
    if (advertiser.length < 2) throw new AdsError(400, "Indiquez le nom du commerce.");
    const link = httpsLink(b.linkUrl);
    if (!link) throw new AdsError(400, "Le lien doit commencer par https:// (site, page Facebook, WhatsApp…).");
    const days = Number(b.durationDays);
    if (!(AD_DURATIONS as readonly number[]).includes(days)) throw new AdsError(400, "Durée : 7, 30 ou 90 jours.");
    const amount = b.amount === undefined || b.amount === "" ? priceFor(slot, days) : Number(b.amount);
    if (!Number.isInteger(amount) || amount < 0 || amount > 10_000_000) throw new AdsError(400, "Montant invalide.");
    const id = `ad_${crypto.randomBytes(6).toString("hex")}`;
    await pool!.query(
      `INSERT INTO ad_campaigns (id, slot_id, advertiser, phone, link_url, duration_days, amount, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'a_payer',$8)`,
      [id, slot.id, advertiser, clean(b.phone, 20) || null, link, days, amount, Date.now()]
    );
    res.json({ success: true, id });
  }));

  // Image : envoyée en binaire brut (png, jpeg, webp, gif), 500 Ko maximum ; vérifiée sur ses premiers octets.
  app.put("/api/admin/ads/campaigns/:id/image", ...admin, express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }), wrap(async (req, res) => {
    const mime = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!IMAGE_TYPES[mime] || !IMAGE_TYPES[mime](body)) throw new AdsError(400, "Image invalide : utilisez un fichier PNG, JPEG, WebP ou GIF.");
    const r = await pool!.query("UPDATE ad_campaigns SET image_mime=$2, image_data=$3 WHERE id=$1", [req.params.id, mime, body]);
    if (!r.rowCount) throw new AdsError(404, "Annonce introuvable.");
    res.json({ success: true });
  }));

  // Active l'annonce à partir de maintenant pour sa durée. Idempotent : ne prolonge pas une annonce déjà active.
  async function activate(client: { query: Pool["query"] }, campaignId: string, how: string) {
    const c = (await client.query("SELECT * FROM ad_campaigns WHERE id = $1 FOR UPDATE", [campaignId])).rows[0];
    if (!c) throw new AdsError(404, "Annonce introuvable.");
    if (c.status === "active" && Number(c.ends_at) > Date.now()) return c;
    const now = Date.now();
    await client.query(
      "UPDATE ad_campaigns SET status='active', starts_at=$2, ends_at=$3, paid_at=COALESCE(paid_at,$2), paid_how=COALESCE(paid_how,$4) WHERE id=$1",
      [campaignId, now, now + c.duration_days * DAY, how]
    );
    return c;
  }

  const inTx = async <T>(work: (c: any) => Promise<T>): Promise<T> => {
    const c = await pool!.connect();
    try { await c.query("BEGIN"); const r = await work(c); await c.query("COMMIT"); return r; }
    catch (e) { await c.query("ROLLBACK"); throw e; }
    finally { c.release(); }
  };

  app.post("/api/admin/ads/campaigns/:id/activate", ...admin, wrap(async (req, res) => {
    const c = (await pool!.query("SELECT image_data IS NOT NULL AS has_image FROM ad_campaigns WHERE id = $1", [req.params.id])).rows[0];
    if (!c) throw new AdsError(404, "Annonce introuvable.");
    if (!c.has_image) throw new AdsError(400, "Ajoutez d'abord l'image de l'annonce.");
    await inTx((cl) => activate(cl, req.params.id, "manuel"));
    res.json({ success: true });
  }));

  app.post("/api/admin/ads/campaigns/:id/pause", ...admin, wrap(async (req, res) => {
    const r = await pool!.query("UPDATE ad_campaigns SET status = CASE WHEN status='active' THEN 'pause' ELSE status END WHERE id = $1 RETURNING status", [req.params.id]);
    if (!r.rowCount) throw new AdsError(404, "Annonce introuvable.");
    res.json({ success: true });
  }));

  app.post("/api/admin/ads/campaigns/:id/resume", ...admin, wrap(async (req, res) => {
    const r = await pool!.query("UPDATE ad_campaigns SET status = CASE WHEN status='pause' THEN 'active' ELSE status END WHERE id = $1", [req.params.id]);
    if (!r.rowCount) throw new AdsError(404, "Annonce introuvable.");
    res.json({ success: true });
  }));

  app.delete("/api/admin/ads/campaigns/:id", ...admin, wrap(async (req, res) => {
    await pool!.query("DELETE FROM ad_campaigns WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  }));

  // Lien de paiement Jèko à envoyer au commerçant (WhatsApp, SMS…). L'annonce s'active toute seule au paiement.
  app.post("/api/admin/ads/campaigns/:id/pay-link", ...admin, express.json({ limit: "20kb" }), wrap(async (req, res) => {
    if (!d.jeko?.isConfigured()) throw new AdsError(503, "Le paiement Jèko n'est pas configuré sur ce serveur.");
    const c = (await pool!.query("SELECT id, amount, phone, paid_at, image_data IS NOT NULL AS has_image FROM ad_campaigns WHERE id = $1", [req.params.id])).rows[0];
    if (!c) throw new AdsError(404, "Annonce introuvable.");
    if (c.paid_at) throw new AdsError(409, "Cette annonce est déjà payée.");
    if (c.amount <= 0) throw new AdsError(400, "Le montant est à 0 FCFA : activez l'annonce directement.");
    const method = clean(req.body?.method, 10);
    if (!["orange", "wave", "mtn", "moov"].includes(method)) throw new AdsError(400, "Choisissez Orange, Wave, MTN ou Moov.");
    const reference = `dgad-${c.id}-${crypto.randomBytes(4).toString("hex")}`;
    const origin = d.getOrigin(req);
    const payerPhone = clean(req.body?.payerPhone, 20) || c.phone || undefined;
    const created = await d.jeko.create({ reference, amountXof: c.amount, paymentMethod: method, payerPhone, successUrl: `${origin}/?pub=merci`, errorUrl: `${origin}/?pub=echec` });
    const now = Date.now();
    await pool!.query("UPDATE ad_payments SET status='annule', updated_at=$2 WHERE campaign_id=$1 AND status='en_attente'", [c.id, now]);
    await pool!.query(
      "INSERT INTO ad_payments (reference, campaign_id, amount, method, status, provider_ref, redirect_url, created_at, updated_at) VALUES ($1,$2,$3,$4,'en_attente',$5,$6,$7,$7)",
      [reference, c.id, c.amount, method, created.id || null, created.redirectUrl || null, now]
    );
    res.json({ success: true, redirectUrl: created.redirectUrl || null, hasImage: !!c.has_image });
  }));

  // Vérifie auprès de Jèko si un paiement en attente a été réglé (si le webhook n'est pas arrivé).
  app.post("/api/admin/ads/campaigns/:id/reconcile", ...admin, wrap(async (req, res) => {
    if (!d.jeko?.isConfigured()) throw new AdsError(503, "Le paiement Jèko n'est pas configuré sur ce serveur.");
    const pays = (await pool!.query("SELECT * FROM ad_payments WHERE campaign_id = $1 AND status = 'en_attente' AND provider_ref IS NOT NULL", [req.params.id])).rows;
    let paid = false;
    for (const p of pays) {
      const s = (await d.jeko.fetchStatus(p.provider_ref)).toLowerCase();
      if (s === "success" || s === "completed") { await applyPayment(p.reference, true); paid = true; }
    }
    res.json({ success: true, paid });
  }));

  async function applyPayment(reference: string, success: boolean) {
    await inTx(async (c) => {
      const p = (await c.query("SELECT * FROM ad_payments WHERE reference = $1 FOR UPDATE", [reference])).rows[0];
      if (!p || !["en_attente", "annule"].includes(p.status)) return; // inconnu ou déjà traité : idempotent
      await c.query("UPDATE ad_payments SET status = $2, updated_at = $3 WHERE reference = $1", [reference, success ? "paye" : "echoue", Date.now()]);
      if (success) await activate(c, p.campaign_id, "jeko");
    });
  }

  // Appelé par le webhook Jèko (signature déjà vérifiée) pour les références « dgad-… ».
  async function onExternalWebhook(reference: string, status: string, body: any): Promise<boolean> {
    if (!pool) return false;
    if (ready) await ready;
    const p = (await pool.query("SELECT * FROM ad_payments WHERE reference = $1", [reference])).rows[0];
    if (!p) return false;
    if (!["en_attente", "annule"].includes(p.status)) return true;
    const webhookAmount = Number(body?.amount?.amount);
    if (Number.isFinite(webhookAmount) && webhookAmount !== p.amount * 100) {
      console.warn(`[ADS][Webhook] Montant différent pour ${reference} : reçu=${webhookAmount}, attendu=${p.amount * 100}.`);
      return true;
    }
    const jid = body?.transactionDetails?.id;
    if (p.provider_ref && jid && String(jid) !== String(p.provider_ref)) {
      console.warn(`[ADS][Webhook] Identifiant Jèko différent pour ${reference}.`);
      return true;
    }
    const s = status.toLowerCase();
    await applyPayment(reference, s === "success" || s === "completed");
    return true;
  }

  return { onExternalWebhook };
}
