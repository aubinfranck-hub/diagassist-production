import crypto from "crypto";
import type { Express } from "express";
import { CreditStore, CreditSource, sanitizeCreditSettings } from "./core";

type Query = (sql: string, params?: any[]) => Promise<any>;

const METHODS = new Set(["orange", "wave", "mtn", "moov"]);
// Après un diagnostic, le suivi par chat / voix reste ouvert quelques heures même si le solde est tombé à zéro.
const FOLLOW_UP_WINDOW_MS = 3 * 60 * 60 * 1000;

/** Comptes « gratuits » : ils passent par les crédits. Les abonnements (Lite, Premium, pass…) gardent leurs règles. */
export const isCreditPlan = (plan: string) => plan === "free_trial" || plan === "free_expired";

export const CREDITS_EXHAUSTED_MESSAGE = "Vos diagnostics gratuits sont terminés. Choisissez un pack pour continuer : l'urgence et le SOS restent toujours gratuits.";

export async function registerCredits(app: Express, deps: {
  dbQuery?: Query;
  requireAuth: any;
  requireAdminAuth: any;
  accountExists: (phone: string) => boolean;
  getOrigin: (req: any) => string;
  jeko: {
    isConfigured: () => boolean;
    create: (p: { reference: string; amountXof: number; paymentMethod: string; payerPhone?: string; successUrl: string; errorUrl: string }) => Promise<{ id?: string; redirectUrl?: string }>;
    fetchStatus: (jekoId: string) => Promise<string>;
  };
}) {
  const store = new CreditStore(deps.dbQuery);
  await store.init();

  /**
   * Décompte d'un diagnostic pour un compte gratuit. `charged` vaut null pour les abonnés (rien à décompter).
   * À appeler AVANT de lancer l'IA ; `refund` rend le diagnostic si l'IA échoue.
   */
  async function charge(phone: string, plan: string): Promise<{ allowed: boolean; source: CreditSource | null }> {
    if (!isCreditPlan(plan)) return { allowed: true, source: null };
    const { freeCount } = await store.getSettings();
    const source = await store.consume(phone, freeCount);
    return { allowed: source !== null, source };
  }
  const refund = (phone: string, source: CreditSource | null) => source ? store.refund(phone, source) : Promise.resolve();

  /** Suivi (chat, voix) d'un compte gratuit : permis s'il lui reste des diagnostics ou s'il vient d'en lancer un. */
  async function canFollowUp(phone: string, plan: string): Promise<boolean> {
    if (!isCreditPlan(plan)) return true;
    const { freeCount } = await store.getSettings();
    const b = await store.balance(phone, freeCount);
    return b.total > 0 || Date.now() - b.lastDiagAt < FOLLOW_UP_WINDOW_MS;
  }

  async function view(phone: string) {
    const settings = await store.getSettings();
    const b = await store.balance(phone, settings.freeCount);
    return {
      freeTotal: b.freeTotal, freeRemaining: b.freeRemaining, paidBalance: b.paidBalance, total: b.total,
      packs: settings.packs.filter(p => p.active).map(({ id, label, credits, priceXof }) => ({ id, label, credits, priceXof })),
      paymentEnabled: deps.jeko.isConfigured(),
    };
  }

  /** Crédite (une seule fois) selon l'issue du paiement. */
  async function settle(reference: string, status: string) {
    const s = status.toLowerCase();
    if (s === "success" || s === "completed") return store.markPaid(reference);
    if (["error", "failed", "cancelled", "canceled"].includes(s)) await store.markFailed(reference);
    return false;
  }

  app.get("/api/credits", deps.requireAuth, async (req: any, res) => {
    const plan = req.session.plan;
    // Un abonné n'a pas de compteur : son forfait s'applique.
    if (!isCreditPlan(plan)) return res.json({ success: true, unlimited: true, ...(await view(req.session.phone)) });
    res.json({ success: true, unlimited: false, ...(await view(req.session.phone)) });
  });

  app.post("/api/credits/buy", deps.requireAuth, async (req: any, res) => {
    if (!deps.jeko.isConfigured()) return res.status(503).json({ success: false, message: "Le paiement en ligne est momentanément indisponible. Réessayez plus tard." });
    const method = String(req.body?.paymentMethod || "");
    if (!METHODS.has(method)) return res.status(400).json({ success: false, message: "Moyen de paiement invalide." });
    // Le prix et la taille du pack viennent TOUJOURS du serveur, jamais de l'application.
    const pack = (await store.getSettings()).packs.find(p => p.id === String(req.body?.packId || "") && p.active);
    if (!pack) return res.status(404).json({ success: false, message: "Ce pack n'existe plus. Rechargez la page." });
    const reference = `dgcr-${crypto.randomBytes(12).toString("hex")}`;
    const origin = deps.getOrigin(req);
    const created = await deps.jeko.create({
      reference, amountXof: pack.priceXof, paymentMethod: method,
      payerPhone: req.body?.payerPhone ? String(req.body.payerPhone) : undefined,
      successUrl: `${origin}/?credits=return&reference=${encodeURIComponent(reference)}`,
      errorUrl: `${origin}/?credits=return&reference=${encodeURIComponent(reference)}`,
    });
    await store.createPurchase({
      reference, phone: req.session.phone, packId: pack.id, packLabel: pack.label, credits: pack.credits, amountXof: pack.priceXof,
      method, status: "en_attente", providerRef: created.id || null, redirectUrl: created.redirectUrl || null, createdAt: Date.now(),
    });
    res.json({ success: true, reference, redirectUrl: created.redirectUrl });
  });

  // Suivi du paiement par l'application ; si le webhook tarde, on interroge Jèko (la réponse de Jèko fait foi, jamais le client).
  app.get("/api/credits/status/:reference", deps.requireAuth, async (req: any, res) => {
    const p = await store.getPurchase(String(req.params.reference));
    if (!p || p.phone !== req.session.phone) return res.status(404).json({ success: false, message: "Paiement introuvable." });
    if (p.status === "en_attente" && p.providerRef && deps.jeko.isConfigured()) {
      try { await settle(p.reference, await deps.jeko.fetchStatus(p.providerRef)); } catch { /* on réessaiera au prochain passage */ }
    }
    const now = await store.getPurchase(p.reference);
    res.json({ success: true, status: now?.status || p.status, credits: p.credits, ...(await view(p.phone)) });
  });

  /** Appelé par le webhook Jèko (signature déjà vérifiée) pour les références « dgcr-… ». */
  async function webhook(reference: string, status: string, body: any): Promise<boolean> {
    const p = await store.getPurchase(reference);
    if (!p) return false;
    if (p.status === "paye") return true;
    const amount = Number(body?.amount?.amount);
    if (Number.isFinite(amount) && amount !== p.amountXof * 100) { console.warn(`[CREDITS][Webhook] Montant différent pour ${reference} : reçu=${amount}, attendu=${p.amountXof * 100}.`); return true; }
    const jid = body?.transactionDetails?.id;
    if (p.providerRef && jid && String(jid) !== String(p.providerRef)) { console.warn(`[CREDITS][Webhook] Identifiant Jèko différent pour ${reference}.`); return true; }
    await settle(reference, status);
    return true;
  }

  // ---- Admin ----
  app.get("/api/admin/credits", deps.requireAdminAuth, async (_req, res) => {
    res.json({ success: true, settings: await store.getSettings(), stats: await store.stats() });
  });

  app.put("/api/admin/credits/settings", deps.requireAdminAuth, async (req, res) => {
    let next;
    try { next = sanitizeCreditSettings(req.body); } catch (e: any) { return res.status(400).json({ success: false, message: e.message }); }
    await store.saveSettings(next);
    res.json({ success: true, settings: next });
  });

  // Offrir des diagnostics à un numéro (geste commercial, test en production).
  app.post("/api/admin/credits/grant", deps.requireAdminAuth, async (req, res) => {
    const phone = String(req.body?.phone || "").trim();
    const credits = Number(req.body?.credits);
    if (!deps.accountExists(phone)) return res.status(404).json({ success: false, message: "Aucun compte avec ce numéro." });
    if (!Number.isInteger(credits) || credits < 1 || credits > 1000) return res.status(400).json({ success: false, message: "Entrez un nombre de diagnostics entre 1 et 1000." });
    await store.addPaid(phone, credits);
    const settings = await store.getSettings();
    res.json({ success: true, balance: await store.balance(phone, settings.freeCount) });
  });

  return { store, charge, refund, canFollowUp, webhook };
}
