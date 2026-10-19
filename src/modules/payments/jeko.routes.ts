import crypto from "crypto";
import type { Express } from "express";

type Query = (sql: string, params?: any[]) => Promise<any>;

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

// Client Jèko réutilisable par d'autres modules (ex: Assistance automobile) : mêmes variables
// d'environnement, mêmes en-têtes que les paiements d'abonnement.
export function jekoIsConfigured(): boolean {
  const hasSecret = Boolean((process.env.JEKO_WEBHOOK_SECRETS || process.env.JEKO_WEBHOOK_SECRET || "").trim());
  return Boolean(process.env.JEKO_API_KEY && process.env.JEKO_API_KEY_ID && process.env.JEKO_STORE_ID && hasSecret);
}

export async function createJekoRedirectPayment(p: {
  reference: string; amountXof: number; paymentMethod: string; payerPhone?: string; successUrl: string; errorUrl: string;
}): Promise<{ id?: string; redirectUrl?: string }> {
  if (!ALLOWED_METHODS.has(p.paymentMethod)) throw new Error("Moyen de paiement invalide.");
  const paymentData: Record<string, any> = { paymentMethod: p.paymentMethod, successUrl: p.successUrl, errorUrl: p.errorUrl };
  const raw = (p.payerPhone || "").replace(/\D/g, "");
  if (raw) {
    paymentData.forceProviderDirect = true;
    paymentData.payerPhone = `+${raw.startsWith("225") ? raw : `225${raw}`}`;
  }
  const response = await fetch(`${JEKO_API_BASE}/partner_api/payment_requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": process.env.JEKO_API_KEY!, "X-API-KEY-ID": process.env.JEKO_API_KEY_ID! },
    body: JSON.stringify({
      storeId: process.env.JEKO_STORE_ID, amountCents: p.amountXof * 100, currency: "XOF", reference: p.reference,
      paymentDetails: { type: "redirect", data: paymentData },
    }),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[JEKO] Création du paiement refusée:", response.status, data);
    throw Object.assign(new Error(data?.message || "Le paiement n'a pas pu être initié."), { status: 502 });
  }
  return { id: data?.id, redirectUrl: data?.redirectUrl };
}

export async function fetchJekoPaymentStatus(jekoId: string): Promise<string> {
  const response = await fetch(`${JEKO_API_BASE}/partner_api/payment_requests/${jekoId}`, {
    headers: { "X-API-KEY": process.env.JEKO_API_KEY!, "X-API-KEY-ID": process.env.JEKO_API_KEY_ID! },
  });
  if (!response.ok) return "";
  const data: any = await response.json().catch(() => ({}));
  return String(data?.status || data?.transaction?.status || "").toLowerCase();
}

type PendingPayment = {
  phone: string;
  plan: string;
  kind: "plan" | "shop";
  orderRef?: string;
  amountCents: number;
  status: "pending" | "success" | "error";
  createdAt: number;
  jekoId?: string;
};

export function registerJekoPayments(
  app: Express,
  deps: {
    requireAuth: any;
    requireAdminAuth: any;
    diagnosticWebhook?: (body: any) => Promise<boolean>;
    setUserPlan: (phone: string, plan: string, customDurationMs?: number) => void | Promise<void>;
    onPlanActivated: (phone: string, plan: string, activatedAt?: number) => void;
    dbQuery?: Query;
    dbTransaction?: <T>(work: (query: Query) => Promise<T>) => Promise<T>;
    // Paiements de la boutique (clients sans compte) : le serveur calcule le montant dû.
    shop?: {
      limiter: any;
      quote: (orderRef: string, phone: string, mode: "deposit" | "full") => Promise<{ amountXof: number } | { error: string }>;
      onPaid: (orderRef: string, query?: Query) => Promise<void>;
    };
    // Paiements d'autres modules (références "dgas-…") : le webhook, une fois sa signature vérifiée,
    // leur délègue le traitement. Renvoie true si la référence leur appartient.
    onExternalWebhook?: (reference: string, status: string, body: any) => Promise<boolean>;
  }
) {
  const pending = new Map<string, PendingPayment>();

  const apiKey = process.env.JEKO_API_KEY;
  const apiKeyId = process.env.JEKO_API_KEY_ID;
  const storeId = process.env.JEKO_STORE_ID;
  // Jèko permet un webhook "business" global ET un webhook par magasin, chacun avec son propre
  // secret. Plutôt que de deviner lequel est réellement actif, on accepte les deux : n'importe
  // quel secret listé ici valide la signature reçue. JEKO_WEBHOOK_SECRETS accepte une liste
  // séparée par des virgules (JEKO_WEBHOOK_SECRET reste supporté seul, pour un unique secret).
  const webhookSecrets = (process.env.JEKO_WEBHOOK_SECRETS || process.env.JEKO_WEBHOOK_SECRET || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const isConfigured = () => Boolean(apiKey && apiKeyId && storeId && webhookSecrets.length > 0 && (process.env.NODE_ENV !== "production" || (deps.dbQuery && deps.dbTransaction)));
  if (!isConfigured()) {
    console.warn("[JEKO] Variables JEKO_API_KEY / JEKO_API_KEY_ID / JEKO_STORE_ID / JEKO_WEBHOOK_SECRET(S) manquantes — paiements en ligne désactivés.");
  }

  const persistPayment = async (reference: string, p: PendingPayment) => {
    if (!deps.dbQuery) return;
    try {
      await deps.dbQuery(
        `INSERT INTO jeko_payments (reference, phone, plan, amount_cents, status, created_at, jeko_id, kind, order_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (reference) DO UPDATE SET jeko_id = COALESCE($7, jeko_payments.jeko_id)`,
        [reference, p.phone, p.plan, p.amountCents, p.status, p.createdAt, p.jekoId || null, p.kind, p.orderRef || null]
      );
    } catch (err: any) {
      console.error("[JEKO][DB] Sauvegarde échouée:", err.message);
      throw err;
    }
  };

  const findPayment = async (reference: string): Promise<PendingPayment | null> => {
    const cached = pending.get(reference);
    if (!deps.dbQuery) return cached || null;
    try {
      const result = await deps.dbQuery(
        `SELECT phone, plan, amount_cents, status, created_at, jeko_id, kind, order_ref FROM jeko_payments WHERE reference = $1`,
        [reference]
      );
      const row = result.rows?.[0];
      if (!row) return null;
      const record: PendingPayment = {
        phone: row.phone,
        plan: row.plan,
        kind: row.kind === "shop" ? "shop" : "plan",
        orderRef: row.order_ref || undefined,
        amountCents: Number(row.amount_cents),
        status: row.status,
        createdAt: Number(row.created_at),
        jekoId: row.jeko_id || undefined,
      };
      pending.set(reference, record);
      return record;
    } catch (err: any) {
      console.error("[JEKO][DB] Lecture échouée:", err.message);
      throw err;
    }
  };

  // Marque un paiement confirmé et active le forfait — chemin commun au webhook et au filet de
  // sécurité par sondage ci-dessous, pour ne jamais dupliquer la logique d'activation.
  const markFailed = async (reference: string, record: PendingPayment) => {
    if (deps.dbQuery) {
      await deps.dbQuery("UPDATE jeko_payments SET status='error' WHERE reference=$1 AND status='pending'", [reference]);
      const saved = await findPayment(reference);
      if (saved) Object.assign(record, saved);
    } else if (record.status !== "success") {
      record.status = "error";
      await persistPayment(reference, record);
    }
  };

  const confirmations = new Map<string, Promise<void>>();
  const confirmPayment = async (reference: string, record: PendingPayment) => {
    const running = confirmations.get(reference);
    if (running) return running;
    const work = (async () => {
      let activatedAt = Date.now();
      let changed = true;
      if (deps.dbTransaction) {
        activatedAt = await deps.dbTransaction(async query => {
          const locked = await query("SELECT * FROM jeko_payments WHERE reference=$1 FOR UPDATE", [reference]);
          const saved = locked.rows[0];
          if (!saved) throw new Error("Paiement non enregistré.");
          if (saved.status === "success") { changed = false; return Number(saved.confirmed_at || saved.created_at); }
          await query("UPDATE jeko_payments SET status='success',confirmed_at=$2 WHERE reference=$1", [reference, activatedAt]);
          if (record.kind === "shop") {
            if (!record.orderRef || !deps.shop) throw new Error("Commande non disponible.");
            // Serialize payments for the same order before recomputing totals.
            await query("SELECT id FROM shop_orders WHERE order_ref=$1 ORDER BY id FOR UPDATE", [record.orderRef]);
            await deps.shop.onPaid(record.orderRef, query);
          } else {
            await query(`INSERT INTO plans (phone,plan,activated_at,custom_duration_ms) VALUES ($1,$2,$3,NULL)
              ON CONFLICT (phone) DO UPDATE SET plan=$2,activated_at=$3,custom_duration_ms=NULL`,
              [record.phone, record.plan, activatedAt]);
          }
          return activatedAt;
        });
      } else {
        if (record.status === "success") return;
        if (record.kind === "shop") {
          if (!record.orderRef || !deps.shop) throw new Error("Commande non disponible.");
          await deps.shop.onPaid(record.orderRef);
        } else await deps.setUserPlan(record.phone, record.plan);
        await persistPayment(reference, { ...record, status: "success" });
      }
      // Publish cache only after the durable transaction commits.
      record.status = "success";
      pending.set(reference, record);
      if (record.kind === "plan" && changed) deps.onPlanActivated(record.phone, record.plan, activatedAt);
      console.log("[JEKO] Confirmation durable du paiement.");
    })();
    confirmations.set(reference, work);
    try { await work; } finally { confirmations.delete(reference); }
  };

  // Filet de sécurité : si le webhook n'est jamais arrivé (ex: redémarrage du serveur pile au
  // mauvais moment — déjà arrivé une fois en test), on interroge directement Jèko pour l'état
  // réel de la transaction plutôt que de rester bloqué sur "pending" indéfiniment.
  const reconcileWithJeko = async (reference: string, record: PendingPayment): Promise<PendingPayment> => {
    if (record.status !== "pending" || !record.jekoId || !isConfigured()) return record;
    try {
      const response = await fetch(`${JEKO_API_BASE}/partner_api/payment_requests/${record.jekoId}`, {
        signal: AbortSignal.timeout(15000),
        headers: { "X-API-KEY": apiKey!, "X-API-KEY-ID": apiKeyId! },
      });
      if (!response.ok) return record;
      const data: any = await response.json().catch(() => ({}));
      const status = String(data?.status || data?.transaction?.status || "").toLowerCase();
      if (status === "success" || status === "completed") {
        await confirmPayment(reference, record);
      } else if (status === "error" || status === "failed") {
        await markFailed(reference, record);
      }
    } catch (err: any) {
      console.error("[JEKO] Réconciliation impossible:", err.message);
      throw err;
    }
    return record;
  };

  // Crée la demande de paiement chez Jèko (Orange/Wave/MTN/Moov) et renvoie l'URL de redirection.
  const createJekoRequest = async (o: {
    reference: string; amountXof: number; paymentMethod: string; rawPhone: string; successUrl: string; errorUrl: string;
  }): Promise<{ ok: boolean; redirectUrl?: string; jekoId?: string; message?: string }> => {
    const paymentData: Record<string, any> = { paymentMethod: o.paymentMethod, successUrl: o.successUrl, errorUrl: o.errorUrl };
    // Mode direct : évite le clic supplémentaire de sélection du numéro côté opérateur.
    // Nécessaire pour le push USSD MTN/Moov ; optionnel mais utile pour Orange/Wave.
    if (o.rawPhone) {
      const withCountryCode = o.rawPhone.startsWith("225") ? o.rawPhone : `225${o.rawPhone}`;
      paymentData.forceProviderDirect = true;
      paymentData.payerPhone = `+${withCountryCode}`;
    }
    try {
      const response = await fetch(`${JEKO_API_BASE}/partner_api/payment_requests`, {
        signal: AbortSignal.timeout(15000),
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": apiKey!, "X-API-KEY-ID": apiKeyId! },
        body: JSON.stringify({
          storeId,
          amountCents: o.amountXof * 100,
          currency: "XOF",
          reference: o.reference,
          paymentDetails: { type: "redirect", data: paymentData },
        }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error("[JEKO] Création du paiement refusée:", response.status, data);
        return { ok: false, message: data?.message || "Le paiement n'a pas pu être initié." };
      }
      return { ok: true, redirectUrl: data.redirectUrl, jekoId: data?.id };
    } catch (err: any) {
      console.error("[JEKO] Erreur réseau lors de la création du paiement:", err.message);
      return { ok: false, message: "Impossible de contacter le service de paiement." };
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
    const reference = `dgst-${crypto.randomBytes(16).toString("hex")}`;
    const origin = process.env.APP_URL || "https://www.diagassist.app";
    const result = await createJekoRequest({
      reference, amountXof, paymentMethod, rawPhone,
      successUrl: `${origin}/?payment=success&reference=${encodeURIComponent(reference)}`,
      errorUrl: `${origin}/?payment=error&reference=${encodeURIComponent(reference)}`,
    });
    if (!result.ok) return res.status(502).json({ success: false, message: result.message });

    const record: PendingPayment = { phone: req.session.phone, plan, kind: "plan", amountCents: amountXof * 100, status: "pending", createdAt: Date.now(), jekoId: result.jekoId };
    pending.set(reference, record);
    await persistPayment(reference, record);
    res.json({ success: true, reference, redirectUrl: result.redirectUrl });
  });

  // Paiement d'une commande de la boutique (client sans compte, identifié par référence + téléphone).
  // Le montant ne vient jamais du client : le serveur le recalcule depuis la commande.
  if (deps.shop) {
    const shop = deps.shop;
    app.post("/api/shop/pay", shop.limiter, async (req: any, res) => {
      if (!isConfigured()) {
        return res.status(503).json({ success: false, message: "Le paiement en ligne est momentanément indisponible. Contactez-nous sur WhatsApp." });
      }
      const orderRef = String(req.body?.order_ref || "").trim();
      const phone = String(req.body?.phone || "").trim();
      const paymentMethod = String(req.body?.paymentMethod || "");
      const mode = req.body?.mode === "deposit" ? "deposit" : "full";
      const rawPhone = req.body?.payerPhone ? String(req.body.payerPhone).replace(/\D/g, "") : "";
      if (!orderRef || !phone) return res.status(400).json({ success: false, message: "Référence et téléphone requis." });
      if (!ALLOWED_METHODS.has(paymentMethod)) return res.status(400).json({ success: false, message: "Moyen de paiement invalide." });

      const quote = await shop.quote(orderRef, phone, mode);
      if ("error" in quote) return res.status(400).json({ success: false, message: quote.error });

      const reference = `dgsh-${orderRef}-${crypto.randomBytes(6).toString("hex")}`;
      const origin = process.env.APP_URL || "https://www.diagassist.app";
      const result = await createJekoRequest({
        reference, amountXof: quote.amountXof, paymentMethod, rawPhone,
        successUrl: `${origin}/boutique?payment=success&reference=${encodeURIComponent(reference)}`,
        errorUrl: `${origin}/boutique?payment=error&reference=${encodeURIComponent(reference)}`,
      });
      if (!result.ok) return res.status(502).json({ success: false, message: result.message });

      const record: PendingPayment = { phone, plan: "boutique", kind: "shop", orderRef, amountCents: quote.amountXof * 100, status: "pending", createdAt: Date.now(), jekoId: result.jekoId };
      pending.set(reference, record);
      await persistPayment(reference, record);
      res.json({ success: true, reference, amount_fcfa: quote.amountXof, redirectUrl: result.redirectUrl });
    });

    // Statut d'un paiement boutique après retour de l'opérateur. La référence est aléatoire et
    // ne révèle que le statut, la commande et le montant.
    app.get("/api/shop/pay/status/:reference", shop.limiter, async (req: any, res) => {
      const reference = String(req.params.reference || "");
      let record = await findPayment(reference);
      if (!record || record.kind !== "shop") return res.status(404).json({ success: false, message: "Paiement introuvable." });
      record = await reconcileWithJeko(reference, record);
      res.json({ success: true, status: record.status, order_ref: record.orderRef, amount_fcfa: Math.round(record.amountCents / 100) });
    });
  }

  // Tableau de bord admin : liste des paiements Jèko (toutes formules confondues), pour vérifier
  // en ligne sans dépendre des logs serveur ou d'une commande manuelle.
  app.get("/api/admin/jeko/payments", deps.requireAdminAuth, async (req: any, res) => {
    if (deps.dbQuery) {
      try {
        const result = await deps.dbQuery(
          `SELECT reference, phone, plan, amount_cents, status, created_at, jeko_id, kind, order_ref
           FROM jeko_payments ORDER BY created_at DESC LIMIT 200`
        );
        return res.json({ success: true, payments: result.rows });
      } catch (err: any) {
        return res.status(500).json({ success: false, message: "Lecture des paiements impossible." });
      }
    }
    const payments = Array.from(pending.entries())
      .map(([reference, p]) => ({ reference, phone: p.phone, plan: p.plan, amount_cents: p.amountCents, status: p.status, created_at: p.createdAt, jeko_id: p.jekoId || null, kind: p.kind, order_ref: p.orderRef || null }))
      .sort((a, b) => b.created_at - a.created_at);
    res.json({ success: true, payments });
  });

  // Revérifie manuellement un paiement encore "pending" auprès de Jèko (même filet de sécurité
  // que le sondage automatique du statut client, déclenchable depuis le tableau de bord admin).
  app.post("/api/admin/jeko/payments/:reference/reconcile", deps.requireAdminAuth, async (req: any, res) => {
    const reference = String(req.params.reference || "");
    const record = await findPayment(reference);
    if (!record) return res.status(404).json({ success: false, message: "Paiement introuvable." });
    const updated = await reconcileWithJeko(reference, record);
    res.json({ success: true, status: updated.status, plan: updated.plan });
  });

  // Permet au client de savoir si son paiement a été confirmé, pendant qu'il attend après
  // avoir été redirigé vers son opérateur (le webhook est la seule confirmation fiable ;
  // cette route ne fait que refléter ce que notre propre webhook a déjà enregistré).
  app.get("/api/payments/jeko/status/:reference", deps.requireAuth, async (req: any, res) => {
    const reference = String(req.params.reference || "");
    let record = await findPayment(reference);
    if (!record || record.phone !== req.session.phone) {
      return res.status(404).json({ success: false, message: "Paiement introuvable." });
    }
    record = await reconcileWithJeko(reference, record);
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

    const providedSig = signature.toLowerCase();
    const valid = webhookSecrets.some((secret) => {
      const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
      return computed.length === providedSig.length && crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(providedSig));
    });
    if (!valid) {
      console.warn("[JEKO][Webhook] Signature invalide.");
      return res.status(401).end();
    }

    // Le corps est la transaction elle-même, sans enveloppe (sauf variante "event"/"payload"
    // pour d'autres types de notification que nous n'utilisons pas ici).
    const body = req.body || {};
    if (deps.diagnosticWebhook && await deps.diagnosticWebhook(body)) return res.status(200).end();
    // Jèko envoie la référence dans transactionDetails.reference pour les webhooks
    // TRANSACTION_COMPLETED (la réponse de création, elle, expose reference à la racine).
    const reference = String(body?.transactionDetails?.reference || body?.reference || "");
    const status = String(body.status || "").toLowerCase();
    if (!reference) return res.status(200).end();

    if (deps.onExternalWebhook && reference.startsWith("dgas-")) {
      try {
        await deps.onExternalWebhook(reference, status, body);
        return res.status(200).end();
      } catch (err: any) {
        console.error("[JEKO][Webhook] Traitement externe en échec:", err.message);
        return res.status(500).end(); // Jèko renverra le webhook
      }
    }

    const record = await findPayment(reference);
    if (!record) {
      console.warn(`[JEKO][Webhook] Référence inconnue : ${reference}`);
      return res.status(200).end();
    }

    if (record.status === "success") {
      // Déjà traité (webhook potentiellement renvoyé jusqu'à 3 fois par Jèko) : ne pas
      // ré-activer/compter deux fois.
      return res.status(200).end();
    }

    // Vérifications métier supplémentaires : même avec une signature HMAC valide,
    // le webhook doit correspondre au paiement Jèko que nous avons créé.
    if (body.transactionType && String(body.transactionType) !== "PaymentRequest") {
      console.warn(`[JEKO][Webhook] Type de transaction inattendu : ${body.transactionType}`);
      return res.status(200).end();
    }
    if (record.jekoId && body?.transactionDetails?.id && String(body.transactionDetails.id) !== String(record.jekoId)) {
      console.warn(`[JEKO][Webhook] ID Jèko différent pour la référence ${reference}.`);
      return res.status(200).end();
    }
    const webhookAmount = Number(body?.amount?.amount);
    if (Number.isFinite(webhookAmount) && webhookAmount !== record.amountCents) {
      console.warn(`[JEKO][Webhook] Montant différent pour ${reference} : reçu=${webhookAmount}, attendu=${record.amountCents}.`);
      return res.status(200).end();
    }

    const succeeded = status === "success" || status === "completed";
    if (succeeded) {
      await confirmPayment(reference, record);
    } else if (["error", "failed", "cancelled", "canceled"].includes(status)) {
      await markFailed(reference, record);
      console.warn(`[JEKO] Paiement en échec pour ${record.phone} (réf. ${reference}, statut "${status}").`);
    }

    res.status(200).end();
  });
}
