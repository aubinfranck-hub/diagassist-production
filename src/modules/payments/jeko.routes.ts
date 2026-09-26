import crypto from "crypto";
import type { Express } from "express";

const JEKO_API_BASE = "https://api.jeko.africa";

// Correspondance entre les forfaits vendus sur la page tarifs et les clés de plan internes
// (voir PLAN_LIMITS / PLAN_DURATIONS_MS dans server.ts). Le montant est en XOF (F CFA) ;
// Jèko attend "amountCents" = montant_XOF * 100 (le franc CFA n'a pas de subdivision réelle,
// c'est une convention d'unité de leur API — ex: amountCents 50000 = 500 XOF).
const PLAN_PRICES_XOF: Record<string, number> = {
  payg_active: 500,
  owner_week: 500,
  lite: 6000,
  premium: 15000,
};

const ALLOWED_METHODS = new Set(["orange", "wave", "mtn", "moov"]);

type PendingPayment = {
  phone: string;
  plan: string;
  amountCents: number;
  status: "pending" | "success" | "error";
  createdAt: number;
};

export function registerJekoPayments(
  app: Express,
  deps: {
    requireAuth: any;
    setUserPlan: (phone: string, plan: string, customDurationMs?: number) => void;
    onPlanActivated: (phone: string, plan: string) => void;
    dbQuery?: (sql: string, params?: any[]) => Promise<any>;
  }
) {
  const pending = new Map<string, PendingPayment>();

  const apiKey = process.env.JEKO_API_KEY;
  const apiKeyId = process.env.JEKO_API_KEY_ID;
  const storeId = process.env.JEKO_STORE_ID;
  const webhookSecret = process.env.JEKO_WEBHOOK_SECRET;

  const isConfigured = () => Boolean(apiKey && apiKeyId && storeId && webhookSecret);
  if (!isConfigured()) {
    console.warn("[JEKO] Variables JEKO_API_KEY / JEKO_API_KEY_ID / JEKO_STORE_ID / JEKO_WEBHOOK_SECRET manquantes — paiements en ligne désactivés.");
  }

  const persistPayment = async (reference: string, p: PendingPayment) => {
    if (!deps.dbQuery) return;
    try {
      await deps.dbQuery(
        `INSERT INTO jeko_payments (reference, phone, plan, amount_cents, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (reference) DO UPDATE SET status = $5`,
        [reference, p.phone, p.plan, p.amountCents, p.status, p.createdAt]
      );
    } catch (err: any) {
      console.error("[JEKO][DB] Sauvegarde échouée:", err.message);
    }
  };

  const findPayment = async (reference: string): Promise<PendingPayment | null> => {
    const cached = pending.get(reference);
    if (cached) return cached;
    if (!deps.dbQuery) return null;
    try {
      const result = await deps.dbQuery(
        `SELECT phone, plan, amount_cents, status, created_at FROM jeko_payments WHERE reference = $1`,
        [reference]
      );
      const row = result.rows?.[0];
      if (!row) return null;
      const record: PendingPayment = {
        phone: row.phone,
        plan: row.plan,
        amountCents: Number(row.amount_cents),
        status: row.status,
        createdAt: Number(row.created_at),
      };
      pending.set(reference, record);
      return record;
    } catch (err: any) {
      console.error("[JEKO][DB] Lecture échouée:", err.message);
      return null;
    }
  };

  // Crée une demande de paiement Jèko (Orange/Wave/MTN/Moov) pour un forfait donné et renvoie
  // l'URL vers laquelle rediriger le mécanicien pour finaliser le paiement sur son opérateur.
  app.post("/api/payments/jeko/create", deps.requireAuth, async (req: any, res) => {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, message: "Le paiement en ligne est momentanément indisponible. Utilisez WhatsApp en attendant." });
    }

    const plan = String(req.body?.plan || "");
    const paymentMethod = String(req.body?.paymentMethod || "");
    const rawPhone = req.body?.payerPhone ? String(req.body.payerPhone).replace(/\D/g, "") : "";

    if (!(plan in PLAN_PRICES_XOF)) {
      return res.status(400).json({ success: false, message: `Forfait inconnu : "${plan}".` });
    }
    if (!ALLOWED_METHODS.has(paymentMethod)) {
      return res.status(400).json({ success: false, message: "Moyen de paiement invalide." });
    }

    const amountXof = PLAN_PRICES_XOF[plan];
    const amountCents = amountXof * 100;
    const reference = `dgst-${req.session.phone.replace(/\D/g, "")}-${plan}-${Date.now()}`;
    const origin = process.env.APP_URL || `https://${req.headers.host}`;

    const paymentData: Record<string, any> = {
      paymentMethod,
      successUrl: `${origin}/?payment=success&reference=${encodeURIComponent(reference)}`,
      errorUrl: `${origin}/?payment=error&reference=${encodeURIComponent(reference)}`,
    };

    // Mode direct : évite le clic supplémentaire de sélection du numéro côté opérateur.
    // Nécessaire pour le push USSD MTN/Moov ; optionnel mais utile pour Orange/Wave.
    if (rawPhone) {
      const withCountryCode = rawPhone.startsWith("225") ? rawPhone : `225${rawPhone}`;
      paymentData.forceProviderDirect = true;
      paymentData.payerPhone = `+${withCountryCode}`;
    }

    try {
      const response = await fetch(`${JEKO_API_BASE}/partner_api/payment_requests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey!,
          "X-API-KEY-ID": apiKeyId!,
        },
        body: JSON.stringify({
          storeId,
          amountCents,
          currency: "XOF",
          reference,
          paymentDetails: { type: "redirect", data: paymentData },
        }),
      });

      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error("[JEKO] Création du paiement refusée:", response.status, data);
        return res.status(502).json({ success: false, message: data?.message || "Le paiement n'a pas pu être initié." });
      }

      const record: PendingPayment = { phone: req.session.phone, plan, amountCents, status: "pending", createdAt: Date.now() };
      pending.set(reference, record);
      await persistPayment(reference, record);

      res.json({ success: true, reference, redirectUrl: data.redirectUrl });
    } catch (err: any) {
      console.error("[JEKO] Erreur réseau lors de la création du paiement:", err.message);
      res.status(502).json({ success: false, message: "Impossible de contacter le service de paiement." });
    }
  });

  // Permet au client de savoir si son paiement a été confirmé, pendant qu'il attend après
  // avoir été redirigé vers son opérateur (le webhook est la seule confirmation fiable ;
  // cette route ne fait que refléter ce que notre propre webhook a déjà enregistré).
  app.get("/api/payments/jeko/status/:reference", deps.requireAuth, async (req: any, res) => {
    const reference = String(req.params.reference || "");
    const record = await findPayment(reference);
    if (!record || record.phone !== req.session.phone) {
      return res.status(404).json({ success: false, message: "Paiement introuvable." });
    }
    res.json({ success: true, status: record.status, plan: record.plan });
  });

  // Webhook Jèko : notifie la confirmation (ou l'échec) d'un paiement. Le corps DOIT être
  // vérifié avec le secret webhook avant toute action (voir express.json({ verify }) dans
  // server.ts, qui conserve req.rawBody pour ce calcul).
  app.post("/api/payments/jeko/webhook", async (req: any, res) => {
    if (!isConfigured()) return res.status(503).end();

    const signature = String(req.headers["jeko-signature"] || "");
    const rawBody: Buffer | undefined = req.rawBody;
    if (!rawBody || !signature) {
      console.warn("[JEKO][Webhook] Signature ou corps brut manquant.");
      return res.status(400).end();
    }

    const computed = crypto.createHmac("sha256", webhookSecret!).update(rawBody).digest("hex");
    const valid =
      computed.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature.toLowerCase()));
    if (!valid) {
      console.warn("[JEKO][Webhook] Signature invalide.");
      return res.status(401).end();
    }

    // Le corps est la transaction elle-même, sans enveloppe (sauf variante "event"/"payload"
    // pour d'autres types de notification que nous n'utilisons pas ici).
    const body = req.body || {};
    const reference = String(body.reference || "");
    const status = String(body.status || "").toLowerCase();
    if (!reference) return res.status(200).end();

    const record = await findPayment(reference);
    if (!record) {
      console.warn(`[JEKO][Webhook] Référence inconnue : ${reference}`);
      return res.status(200).end();
    }

    if (record.status !== "pending") {
      // Déjà traité (webhook potentiellement renvoyé jusqu'à 3 fois par Jèko) : ne pas
      // ré-activer/compter deux fois.
      return res.status(200).end();
    }

    const succeeded = status === "success" || status === "completed";
    record.status = succeeded ? "success" : "error";
    pending.set(reference, record);
    await persistPayment(reference, record);

    if (succeeded) {
      deps.setUserPlan(record.phone, record.plan);
      deps.onPlanActivated(record.phone, record.plan);
      console.log(`[JEKO] Paiement confirmé : forfait "${record.plan}" activé pour ${record.phone} (réf. ${reference}).`);
    } else {
      console.warn(`[JEKO] Paiement en échec pour ${record.phone} (réf. ${reference}, statut "${status}").`);
    }

    res.status(200).end();
  });
}
