import type { Express, NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import rateLimit from "express-rate-limit";
import {
  ACTIVE_MISSION_STATUSES, DOC_MAX_BYTES, DOC_MIMES, SERVICE_CODES, clean, magicMatches, mediaRuleFor, validCoords,
} from "./domain";
import { AssistanceError, createAssistanceCore, canonicalPhone, type AssistanceCore, type CoreDeps, type DirectoryMechanic } from "./core";

export type AssistanceRouteDeps = {
  app: Express;
  pool: Pool | null;
  requireAuth: any;
  requireAdminAuth: any;
  sessions: Map<string, { phone: string; plan: string; createdAt: number }>;
  isAdminPhone: (phone: string) => boolean;
  getDirectory: () => DirectoryMechanic[];
  sendWhatsApp?: (phone: string, message: string) => Promise<void>;
  jeko?: CoreDeps["jeko"];
  isProSubscribed: CoreDeps["isProSubscribed"];
  analyze?: CoreDeps["analyze"];
  getOrigin: (req: Request) => string;
};

function decodeBase64(raw: unknown): Buffer | null {
  if (typeof raw !== "string" || !raw) return null;
  const b64 = raw.replace(/^data:[^;]+;base64,/, "");
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) return null;
  const buf = Buffer.from(b64, "base64");
  return buf.length ? buf : null;
}

export function registerAssistance(d: AssistanceRouteDeps): { core: AssistanceCore | null; onExternalWebhook: (ref: string, status: string, body: any) => Promise<boolean>; syncDirectory: () => Promise<void> } {
  const { app, pool } = d;
  const core = pool ? createAssistanceCore({ pool, sendWhatsApp: d.sendWhatsApp, jeko: d.jeko, isProSubscribed: d.isProSubscribed, analyze: d.analyze, appUrl: process.env.APP_URL }) : null;

  const wrap = (fn: (req: any, res: Response) => Promise<any>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      if (e instanceof AssistanceError) return res.status(e.status).json({ success: false, message: e.message, code: e.code });
      if (e?.status === 502) return res.status(502).json({ success: false, message: e.message });
      console.error("[ASSISTANCE] Erreur:", e?.stack || e);
      res.status(500).json({ success: false, message: "Une erreur est survenue. Réessayez dans un instant." });
    }
  };

  // Sans base PostgreSQL, le choix atomique de l'offre est impossible : état explicite plutôt qu'un faux service.
  const needDb = (req: any, res: Response, next: NextFunction) => {
    if (!core) return res.status(503).json({ success: false, code: "ASSISTANCE_DB_MISSING", message: "L'assistance automobile est indisponible : la base de données n'est pas configurée sur ce serveur." });
    next();
  };

  const createLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req: any) => `assist-create-${req.session?.phone || "anon"}`,
    validate: { keyGeneratorIpFallback: false },
    message: { success: false, message: "Trop de demandes en peu de temps. Patientez quelques minutes." },
  });
  const writeLimiter = rateLimit({
    windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req: any) => `assist-w-${req.session?.phone || "anon"}`,
    validate: { keyGeneratorIpFallback: false },
    message: { success: false, message: "Trop d'actions à la suite. Patientez un instant." },
  });
  const uploadLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req: any) => `assist-up-${req.session?.phone || "anon"}`,
    validate: { keyGeneratorIpFallback: false },
    message: { success: false, message: "Trop de fichiers envoyés. Patientez quelques minutes." },
  });

  const auth = [d.requireAuth, needDb];
  const adminActor = (req: any): string => {
    const t = String(req.headers.authorization || "").replace("Bearer ", "");
    return d.sessions.get(t)?.phone || "admin";
  };
  const phoneOf = (req: any): string => req.session.phone;

  // Garde professionnel : profil existant et validé pour tout ce qui touche aux missions.
  const requireValidatedPro = async (req: any, res: Response, next: NextFunction) => {
    try {
      const r = await core!.pool.query("SELECT validation_status FROM assistance_pros WHERE phone=$1", [phoneOf(req)]);
      if (!r.rowCount) return res.status(403).json({ success: false, code: "NO_PRO_PROFILE", message: "Créez d'abord votre profil dépannage." });
      if (r.rows[0].validation_status !== "valide") return res.status(403).json({ success: false, code: "NOT_VALIDATED", message: "Votre profil doit être validé par DiagAssist avant de recevoir des missions." });
      next();
    } catch (e) { next(e); }
  };

  // ---------- Statut public ----------
  app.get("/api/assistance/status", d.requireAuth, wrap(async (req, res) => {
    if (!core) return res.json({ success: true, enabled: false, dbConfigured: false, paymentConfigured: false, whatsappConfigured: false, services: [], zones: [], paymentMethods: [], message: "Base de données non configurée : l'assistance automobile est indisponible." });
    const [services, zones, settings] = await Promise.all([core.servicesStatus(), core.pool.query("SELECT id, name FROM assistance_zones WHERE active ORDER BY name"), core.getSettings()]);
    const paymentConfigured = !!d.jeko?.isConfigured();
    res.json({
      success: true, enabled: true, dbConfigured: true, paymentConfigured, whatsappConfigured: !!d.sendWhatsApp && settings.whatsapp_notifications,
      services, zones: zones.rows, paymentMethods: paymentConfigured ? ["wave", "orange", "mtn", "moov"] : [],
    });
  }));

  app.get("/api/assistance/tariffs", ...auth, wrap(async (_req, res) => {
    const s = await core!.getSettings();
    res.json({ success: true, tariffs: s.tariffs, currency: "XOF" });
  }));

  // ---------- Client : demandes ----------
  app.post("/api/assistance/requests", ...auth, createLimiter, wrap(async (req, res) => {
    const r = await core!.createRequest(phoneOf(req), req.body || {});
    res.json({ success: true, request: core!.summary(r, undefined, (await core!.getSettings()).tariffs), id: r.id });
  }));

  app.patch("/api/assistance/requests/:id", ...auth, writeLimiter, wrap(async (req, res) => {
    const r = await core!.updateDraft(String(req.params.id), phoneOf(req), req.body || {});
    res.json({ success: true, request: core!.summary(r, undefined, (await core!.getSettings()).tariffs) });
  }));

  app.get("/api/assistance/requests", ...auth, wrap(async (req, res) => {
    res.json({ success: true, requests: await core!.listForClient(phoneOf(req)) });
  }));

  app.get("/api/assistance/requests/:id", ...auth, wrap(async (req, res) => {
    res.json({ success: true, ...(await core!.clientDetail(String(req.params.id), phoneOf(req))) });
  }));

  app.post("/api/assistance/requests/:id/submit", ...auth, writeLimiter, wrap(async (req, res) => {
    await core!.submitRequest(String(req.params.id), phoneOf(req));
    res.json({ success: true, ...(await core!.clientDetail(String(req.params.id), phoneOf(req))) });
  }));
  app.post("/api/assistance/requests/:id/cancel", ...auth, writeLimiter, wrap(async (req, res) => {
    await core!.cancelRequest(String(req.params.id), phoneOf(req), "client", String(req.body?.reason || ""));
    res.json({ success: true });
  }));
  // Mode atelier : le client confirme (ou refuse) le garage qui a accepté de le recevoir, puis indique son départ.
  app.post("/api/assistance/requests/:id/visit", ...auth, writeLimiter, wrap(async (req, res) => {
    if (typeof req.body?.accept !== "boolean") return res.status(400).json({ success: false, message: "Indiquez si vous confirmez votre venue (accept: true ou false)." });
    await core!.decideVisit(String(req.params.id), phoneOf(req), req.body.accept);
    res.json({ success: true, ...(await core!.clientDetail(String(req.params.id), phoneOf(req))) });
  }));
  app.post("/api/assistance/requests/:id/leaving", ...auth, writeLimiter, wrap(async (req, res) => {
    await core!.clientLeaving(String(req.params.id), phoneOf(req));
    res.json({ success: true, ...(await core!.clientDetail(String(req.params.id), phoneOf(req))) });
  }));
  // Le client valide l'offre de son choix (atomique) : le mécanicien est affecté, les autres offres sont annulées.
  app.post("/api/assistance/requests/:id/bids/:offerId/select", ...auth, writeLimiter, wrap(async (req, res) => {
    await core!.selectBid(String(req.params.id), Number(req.params.offerId), phoneOf(req));
    res.json({ success: true, ...(await core!.clientDetail(String(req.params.id), phoneOf(req))) });
  }));
  app.post("/api/assistance/requests/:id/retry", ...auth, writeLimiter, wrap(async (req, res) => {
    await core!.retryRequest(String(req.params.id), phoneOf(req));
    res.json({ success: true });
  }));
  app.post("/api/assistance/requests/:id/manual", ...auth, writeLimiter, wrap(async (req, res) => {
    await core!.requestManual(String(req.params.id), phoneOf(req));
    res.json({ success: true, message: "Votre demande a été transmise à l'équipe DiagAssist qui va vous trouver un mécanicien." });
  }));

  // ---------- Médias ----------
  app.post("/api/assistance/media", ...auth, uploadLimiter, wrap(async (req, res) => {
    const mime = String(req.body?.mime || "");
    const match = mediaRuleFor(mime);
    if (!match) return res.status(400).json({ success: false, message: "Type de fichier non accepté (photo, vidéo ou enregistrement audio)." });
    const buf = decodeBase64(req.body?.dataBase64);
    if (!buf) return res.status(400).json({ success: false, message: "Fichier illisible." });
    if (buf.length > match.rule.maxBytes) return res.status(413).json({ success: false, message: `Fichier trop lourd (${Math.round(match.rule.maxBytes / 1048576)} Mo maximum).` });
    if (!magicMatches(match.base, buf)) return res.status(400).json({ success: false, message: "Le contenu du fichier ne correspond pas à son type." });
    let requestId: string | null = null;
    if (req.body?.requestId) {
      const r = await core!.getRequestRow(String(req.body.requestId));
      if (!r || r.client_phone !== phoneOf(req)) return res.status(404).json({ success: false, message: "Demande introuvable." });
      if (["terminee", "annulee"].includes(r.status)) return res.status(409).json({ success: false, message: "Cette demande est clôturée." });
      requestId = r.id;
    }
    const id = await core!.storeMedia(phoneOf(req), requestId, match.rule.kind, match.base, buf);
    res.json({ success: true, media: { id, kind: match.rule.kind, mime: match.base, size: buf.length } });
  }));

  // Lecture : en-tête Authorization (le client récupère le blob) ou ?token= pour les balises <img>/<video>.
  const mediaViewer = (req: any): { phone?: string; admin?: boolean } => {
    const q = typeof req.query.token === "string" ? req.query.token : "";
    const t = String(req.headers.authorization || "").replace("Bearer ", "") || q;
    const s = t ? d.sessions.get(t) : undefined;
    const adminCode = process.env.ADMIN_SECRET && req.headers["x-admin-code"] === process.env.ADMIN_SECRET;
    return { phone: s?.phone, admin: !!adminCode || (!!s && d.isAdminPhone(s.phone)) };
  };
  app.get("/api/assistance/media/:id", needDb, wrap(async (req, res) => {
    const v = mediaViewer(req);
    if (!v.phone && !v.admin) return res.status(401).json({ success: false, message: "Session invalide ou expirée." });
    const m = await core!.accessMedia(String(req.params.id), v);
    if (!m) return res.status(404).json({ success: false, message: "Fichier introuvable." });
    res.setHeader("Content-Type", m.mime);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(m.data);
  }));

  // ---------- Messagerie ----------
  const roleFor = async (req: any): Promise<"client" | "pro"> => {
    const r = await core!.getRequestRow(String(req.params.id));
    if (r && r.client_phone === phoneOf(req)) return "client";
    if (r && r.assigned_phone === phoneOf(req)) return "pro";
    throw new AssistanceError(404, "Conversation introuvable.");
  };
  app.get("/api/assistance/requests/:id/messages", ...auth, wrap(async (req, res) => {
    await roleFor(req);
    res.json({ success: true, messages: await core!.listMessages(String(req.params.id), Number(req.query.since) || 0) });
  }));
  app.post("/api/assistance/requests/:id/messages", ...auth, writeLimiter, wrap(async (req, res) => {
    const role = await roleFor(req);
    const id = await core!.addMessage(String(req.params.id), phoneOf(req), role, String(req.body?.body || ""));
    res.json({ success: true, id: Number(id) });
  }));

  // ---------- Devis, paiement, avis ----------
  app.post("/api/assistance/requests/:id/quotes/:quoteId/decision", ...auth, writeLimiter, wrap(async (req, res) => {
    await core!.decideQuote(String(req.params.id), Number(req.params.quoteId), phoneOf(req), req.body?.accept === true);
    res.json({ success: true });
  }));
  app.post("/api/assistance/requests/:id/pay", ...auth, writeLimiter, wrap(async (req, res) => {
    const out = await core!.startPayment(String(req.params.id), phoneOf(req), String(req.body?.method || ""), req.body?.payerPhone ? String(req.body.payerPhone) : undefined, d.getOrigin(req));
    res.json({ success: true, ...out });
  }));
  app.get("/api/assistance/requests/:id/payment", ...auth, wrap(async (req, res) => {
    const detail = await core!.clientDetail(String(req.params.id), phoneOf(req));
    if (detail.payment?.status === "en_attente") {
      await core!.reconcilePayment(detail.payment.reference);
      const again = await core!.clientDetail(String(req.params.id), phoneOf(req));
      return res.json({ success: true, payment: again.payment, paymentStatus: again.request.paymentStatus });
    }
    res.json({ success: true, payment: detail.payment, paymentStatus: detail.request.paymentStatus });
  }));
  app.post("/api/assistance/requests/:id/review", ...auth, writeLimiter, wrap(async (req, res) => {
    await core!.addReview(String(req.params.id), phoneOf(req), Number(req.body?.rating), String(req.body?.comment || ""));
    res.json({ success: true });
  }));
  app.post("/api/assistance/requests/:id/claims", ...auth, writeLimiter, wrap(async (req, res) => {
    await core!.addClaim(String(req.params.id), phoneOf(req), String(req.body?.kind || "autre"), String(req.body?.message || ""));
    res.json({ success: true });
  }));

  // ---------- Notifications ----------
  app.get("/api/assistance/notifications", ...auth, wrap(async (req, res) => {
    const r = await core!.pool.query("SELECT id, type, title, body, request_id, created_at, read_at FROM assistance_notifications WHERE phone=$1 ORDER BY id DESC LIMIT 50", [phoneOf(req)]);
    const unread = r.rows.filter((n) => !n.read_at).length;
    res.json({ success: true, unread, notifications: r.rows.map((n) => ({ id: Number(n.id), type: n.type, title: n.title, body: n.body, requestId: n.request_id, at: Number(n.created_at), read: !!n.read_at })) });
  }));
  app.post("/api/assistance/notifications/read", ...auth, wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : null;
    await core!.pool.query(`UPDATE assistance_notifications SET read_at=$2 WHERE phone=$1 AND read_at IS NULL AND ($3::bigint[] IS NULL OR id = ANY($3))`, [phoneOf(req), Date.now(), ids]);
    res.json({ success: true });
  }));

  // ---------- Mécanicien ----------
  app.get("/api/assistance/pro/me", ...auth, wrap(async (req, res) => {
    const profile = await core!.proProfile(phoneOf(req));
    const dirMatch = d.getDirectory().some((m) => m.type === "mechanic" && m.active && canonicalPhone(m.phone) === phoneOf(req));
    res.json({ success: true, profile, directoryMatch: dirMatch });
  }));
  app.put("/api/assistance/pro/me", ...auth, writeLimiter, wrap(async (req, res) => {
    res.json({ success: true, profile: await core!.upsertProProfile(phoneOf(req), req.body || {}) });
  }));
  app.post("/api/assistance/pro/documents", ...auth, uploadLimiter, wrap(async (req, res) => {
    const mime = String(req.body?.mime || "").toLowerCase();
    if (!DOC_MIMES.includes(mime)) return res.status(400).json({ success: false, message: "Justificatif accepté : PDF, JPEG ou PNG." });
    const buf = decodeBase64(req.body?.dataBase64);
    if (!buf) return res.status(400).json({ success: false, message: "Fichier illisible." });
    if (buf.length > DOC_MAX_BYTES) return res.status(413).json({ success: false, message: "Fichier trop lourd (4 Mo maximum)." });
    if (!magicMatches(mime, buf)) return res.status(400).json({ success: false, message: "Le contenu du fichier ne correspond pas à son type." });
    const p = await core!.pool.query("SELECT 1 FROM assistance_pros WHERE phone=$1", [phoneOf(req)]);
    if (!p.rowCount) return res.status(403).json({ success: false, message: "Créez d'abord votre profil dépannage." });
    const n = await core!.pool.query("SELECT COUNT(*)::int n FROM assistance_pro_documents WHERE pro_phone=$1", [phoneOf(req)]);
    if (n.rows[0].n >= 10) return res.status(400).json({ success: false, message: "10 justificatifs maximum." });
    const ins = await core!.pool.query(`INSERT INTO assistance_pro_documents (pro_phone, kind, label, mime, size, data, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [phoneOf(req), clean(req.body?.kind, 40) || "autre", clean(req.body?.label, 120) || null, mime, buf.length, buf, Date.now()]);
    res.json({ success: true, id: ins.rows[0].id });
  }));
  app.post("/api/assistance/pro/trainings", ...auth, writeLimiter, wrap(async (req, res) => {
    const title = clean(req.body?.title, 120);
    if (title.length < 3) return res.status(400).json({ success: false, message: "Indiquez l'intitulé de la formation." });
    const p = await core!.pool.query("SELECT 1 FROM assistance_pros WHERE phone=$1", [phoneOf(req)]);
    if (!p.rowCount) return res.status(403).json({ success: false, message: "Créez d'abord votre profil dépannage." });
    // Déclarée par le mécanicien : jamais affichée comme certifiée tant que l'admin ne l'a pas vérifiée.
    await core!.pool.query(`INSERT INTO assistance_trainings (pro_phone, title, issuer, completed_on, status, created_at) VALUES ($1,$2,$3,$4,'declaree',$5)`, [phoneOf(req), title, clean(req.body?.issuer, 120) || null, clean(req.body?.completedOn, 20) || null, Date.now()]);
    res.json({ success: true, profile: await core!.proProfile(phoneOf(req)) });
  }));
  app.post("/api/assistance/pro/availability", ...auth, writeLimiter, wrap(async (req, res) => {
    const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
    res.json({ success: true, profile: await core!.setPresence(phoneOf(req), req.body?.available === true, lat, lng) });
  }));
  app.post("/api/assistance/pro/location", ...auth, rateLimit({
    windowMs: 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false, keyGenerator: (req: any) => `assist-loc-${req.session?.phone || "anon"}`,
    validate: { keyGeneratorIpFallback: false }, message: { success: false, message: "Trop de mises à jour de position." },
  }), wrap(async (req, res) => {
    await core!.updateLocation(phoneOf(req), Number(req.body?.lat), Number(req.body?.lng));
    res.json({ success: true });
  }));

  app.get("/api/assistance/pro/offers", ...auth, requireValidatedPro, wrap(async (req, res) => {
    res.json({ success: true, offers: await core!.proOffers(phoneOf(req)) });
  }));
  // Offre de prix (ou révision) : le client compare et choisit. Remplace l'ancien « accept » (premier arrivé).
  app.post("/api/assistance/pro/offers/:id/bid", ...auth, requireValidatedPro, writeLimiter, wrap(async (req, res) => {
    const id = await core!.bidOffer(Number(req.params.id), phoneOf(req), req.body || {});
    res.json({ success: true, offer: (await core!.proOffers(phoneOf(req))).find((o: any) => o.id === id) || null });
  }));
  app.post("/api/assistance/pro/offers/:id/decline", ...auth, requireValidatedPro, writeLimiter, wrap(async (req, res) => {
    await core!.declineOffer(Number(req.params.id), phoneOf(req));
    res.json({ success: true });
  }));

  app.get("/api/assistance/pro/missions", ...auth, wrap(async (req, res) => {
    const exists = await core!.pool.query("SELECT 1 FROM assistance_pros WHERE phone=$1", [phoneOf(req)]);
    res.json({ success: true, missions: exists.rowCount ? await core!.proMissionList(phoneOf(req)) : [] });
  }));
  app.get("/api/assistance/pro/missions/:id", ...auth, wrap(async (req, res) => {
    res.json({ success: true, ...(await core!.proMissionDetail(String(req.params.id), phoneOf(req))) });
  }));
  app.post("/api/assistance/pro/missions/:id/status", ...auth, requireValidatedPro, writeLimiter, wrap(async (req, res) => {
    await core!.proProgress(String(req.params.id), phoneOf(req), String(req.body?.to) as any);
    res.json({ success: true, ...(await core!.proMissionDetail(String(req.params.id), phoneOf(req))) });
  }));
  app.post("/api/assistance/pro/missions/:id/release", ...auth, requireValidatedPro, writeLimiter, wrap(async (req, res) => {
    await core!.redispatch(String(req.params.id), phoneOf(req), "pro", clean(req.body?.reason, 300) || "désistement du professionnel", phoneOf(req));
    res.json({ success: true });
  }));
  app.post("/api/assistance/pro/missions/:id/diagnosis", ...auth, requireValidatedPro, writeLimiter, wrap(async (req, res) => {
    await core!.setProDiagnosis(String(req.params.id), phoneOf(req), String(req.body?.text || ""));
    res.json({ success: true });
  }));
  app.post("/api/assistance/pro/missions/:id/quotes", ...auth, requireValidatedPro, writeLimiter, wrap(async (req, res) => {
    await core!.proposeQuote(String(req.params.id), phoneOf(req), req.body || {});
    res.json({ success: true, ...(await core!.proMissionDetail(String(req.params.id), phoneOf(req))) });
  }));
  app.get("/api/assistance/pro/earnings", ...auth, wrap(async (req, res) => {
    const exists = await core!.pool.query("SELECT 1 FROM assistance_pros WHERE phone=$1", [phoneOf(req)]);
    if (!exists.rowCount) return res.status(403).json({ success: false, code: "NO_PRO_PROFILE", message: "Créez d'abord votre profil dépannage." });
    res.json({ success: true, ...(await core!.proEarnings(phoneOf(req))) });
  }));
  // ---------- Administration ----------
  const A = (path: string) => `/api/admin/assistance${path}`;
  const adm = [d.requireAdminAuth, needDb];

  app.get(A("/dashboard"), ...adm, wrap(async (_req, res) => {
    res.json({ success: true, dashboard: await core!.adminDashboard() });
  }));

  app.get(A("/requests"), ...adm, wrap(async (req, res) => {
    const w: string[] = []; const v: any[] = [];
    const add = (sql: string, val: any) => { v.push(val); w.push(sql.replace("?", `$${v.length}`)); };
    if (req.query.status) add("r.status = ?", String(req.query.status));
    if (req.query.zoneId) add("r.zone_id = ?", Number(req.query.zoneId));
    if (req.query.service) add("r.service = ?", String(req.query.service));
    if (req.query.from) add("r.created_at >= ?", Number(req.query.from));
    if (req.query.to) add("r.created_at <= ?", Number(req.query.to));
    if (req.query.manual === "1") w.push("r.manual_requested AND r.status IN ('recherche','sans_disponibilite')");
    const rows = await core!.pool.query(
      `SELECT r.*, z.name AS zone_name, p.display_name AS pro_name FROM assistance_requests r
       LEFT JOIN assistance_zones z ON z.id=r.zone_id LEFT JOIN assistance_pros p ON p.phone=r.assigned_phone
       ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY r.manual_requested DESC, r.created_at DESC LIMIT 300`, v);
    const labels = await core!.serviceLabels();
    const tariffs = (await core!.getSettings()).tariffs;
    res.json({ success: true, requests: rows.rows.map((r) => ({ ...core!.summary(r, labels[r.service], tariffs), clientPhone: r.client_phone, zoneId: r.zone_id, zoneName: r.zone_name, proPhone: r.assigned_phone, proName: r.pro_name })) });
  }));

  app.get(A("/requests/:id"), ...adm, wrap(async (req, res) => {
    const id = String(req.params.id);
    const r = await core!.getRequestRow(id);
    if (!r) return res.status(404).json({ success: false, message: "Demande introuvable." });
    const q = (sql: string) => core!.pool.query(sql, [id]).then((x) => x.rows);
    const [events, offers, quotes, payments, media, claims, review, labels] = await Promise.all([
      q("SELECT id, at, actor, actor_role, type, from_status, to_status, reason, meta FROM assistance_events WHERE request_id=$1 ORDER BY at, id"),
      q("SELECT id, pro_phone, status, distance_km, sent_at, expires_at, responded_at FROM assistance_offers WHERE request_id=$1 ORDER BY id"),
      q("SELECT id, version, kind, lines, total, status, note, created_by, created_at, decided_at, decided_by FROM assistance_quotes WHERE request_id=$1 ORDER BY version"),
      q("SELECT reference, method, provider, amount, commission_pct, commission_amount, pro_amount, status, payout_status, payout_at, payout_by, confirmed_by, created_at, updated_at FROM assistance_payments WHERE request_id=$1 ORDER BY created_at"),
      q("SELECT id, kind, mime, size FROM assistance_media WHERE request_id=$1 ORDER BY created_at"),
      q("SELECT id, kind, message, status, admin_note, created_at FROM assistance_claims WHERE request_id=$1 ORDER BY id"),
      q("SELECT rating, comment FROM assistance_reviews WHERE request_id=$1"),
      core!.serviceLabels(),
    ]);
    const messages = await core!.listMessages(id);
    res.json({
      success: true,
      request: { ...core!.summary(r, labels[r.service], (await core!.getSettings()).tariffs), clientPhone: r.client_phone, contactPhone: r.contact_phone, faultCodes: r.fault_codes, description: r.description, proPhone: r.assigned_phone, zoneId: r.zone_id, proDiagnosis: r.pro_diagnosis, aiAnalysis: r.ai_analysis, cancelReason: r.cancel_reason, shareDiagnostic: r.share_diagnostic, diagnostic: r.diagnostic, position: { lat: r.lat, lng: r.lng, address: r.address, landmark: r.landmark, source: r.position_source, confirmed: r.position_confirmed } },
      timeline: events.map((e: any) => ({ id: Number(e.id), at: Number(e.at), actor: e.actor, actorRole: e.actor_role, type: e.type, from: e.from_status, to: e.to_status, reason: e.reason, meta: e.meta })),
      offers: offers.map((o: any) => ({ ...o, sent_at: Number(o.sent_at), expires_at: Number(o.expires_at), responded_at: o.responded_at ? Number(o.responded_at) : null })),
      quotes, payments, media, claims, messages, review: review[0] || null,
    });
  }));

  app.post(A("/requests/:id/assign"), ...adm, writeLimiter, wrap(async (req, res) => {
    const proPhone = canonicalPhone(String(req.body?.proPhone || ""));
    await core!.adminAssign(String(req.params.id), proPhone, adminActor(req));
    res.json({ success: true });
  }));
  app.post(A("/requests/:id/redispatch"), ...adm, writeLimiter, wrap(async (req, res) => {
    await core!.redispatch(String(req.params.id), adminActor(req), "admin", clean(req.body?.reason, 300) || "relance par l'administration");
    res.json({ success: true });
  }));
  app.post(A("/requests/:id/cancel"), ...adm, writeLimiter, wrap(async (req, res) => {
    await core!.cancelRequest(String(req.params.id), adminActor(req), "admin", String(req.body?.reason || "annulée par l'administration"));
    res.json({ success: true });
  }));

  app.get(A("/pros"), ...adm, wrap(async (req, res) => {
    const status = String(req.query.status || "");
    const rows = await core!.pool.query(
      `SELECT p.*, (SELECT COUNT(*)::int FROM assistance_requests r WHERE r.assigned_phone=p.phone AND r.status='terminee') AS done,
              (SELECT COALESCE(json_agg(json_build_object('id',d.id,'kind',d.kind,'label',d.label,'status',d.status) ORDER BY d.id),'[]'::json) FROM assistance_pro_documents d WHERE d.pro_phone=p.phone) AS docs,
              (SELECT COALESCE(json_agg(json_build_object('id',t.id,'title',t.title,'issuer',t.issuer,'completedOn',t.completed_on,'status',t.status) ORDER BY t.id),'[]'::json) FROM assistance_trainings t WHERE t.pro_phone=p.phone) AS trainings,
              (SELECT COUNT(*)::int FROM assistance_trainings t WHERE t.pro_phone=p.phone AND t.status='verifiee') AS trainings_ok,
              (SELECT COUNT(*)::int FROM assistance_trainings t WHERE t.pro_phone=p.phone AND t.status='declaree') AS trainings_pending
       FROM assistance_pros p ${status ? "WHERE p.validation_status=$1" : ""} ORDER BY p.created_at DESC LIMIT 500`, status ? [status] : []);
    res.json({ success: true, pros: rows.rows.map((p) => ({ phone: p.phone, displayName: p.display_name, garageName: p.garage_name, specialties: p.specialties, zoneIds: p.zone_ids, mobility: p.mobility, validationStatus: p.validation_status, validationNote: p.validation_note, validatedBy: p.validated_by, validatedAt: p.validated_at ? Number(p.validated_at) : null, available: p.available, subscribed: d.isProSubscribed(p.phone), source: p.source, missionsDone: p.done, documents: p.docs, trainings: p.trainings, trainingsVerified: p.trainings_ok, trainingsPending: p.trainings_pending, createdAt: Number(p.created_at) })) });
  }));
  app.get(A("/pros/:phone"), ...adm, wrap(async (req, res) => {
    const phone = canonicalPhone(String(req.params.phone));
    const profile = await core!.proProfile(phone);
    if (!profile) return res.status(404).json({ success: false, message: "Professionnel introuvable." });
    res.json({ success: true, profile });
  }));

  const setProStatus = (status: "valide" | "suspendu" | "refuse") => wrap(async (req, res) => {
    const phone = canonicalPhone(String(req.params.phone));
    const r = await core!.pool.query(
      `UPDATE assistance_pros SET validation_status=$2, validation_note=$3, validated_by=$4, validated_at=$5, available=CASE WHEN $2='valide' THEN available ELSE false END, updated_at=$5 WHERE phone=$1 RETURNING phone`,
      [phone, status, clean(req.body?.note, 300) || null, adminActor(req), Date.now()]);
    if (!r.rowCount) return res.status(404).json({ success: false, message: "Professionnel introuvable." });
    console.log(`[ASSISTANCE] Professionnel ${phone} → ${status} par ${adminActor(req)}`);
    if (status !== "valide") {
      await core!.pool.query("UPDATE assistance_offers SET status='annulee', responded_at=$2 WHERE pro_phone=$1 AND status IN ('envoyee','offre_faite')", [phone, Date.now()]);
      // Les missions encore à venir d'un professionnel suspendu repartent en recherche.
      const active = await core!.pool.query("SELECT id FROM assistance_requests WHERE assigned_phone=$1 AND status IN ('affectee','en_route','sur_place')", [phone]);
      for (const m of active.rows) await core!.redispatch(m.id, adminActor(req), "admin", `professionnel ${status}`).catch((e: any) => console.error("[ASSISTANCE]", e.message));
      await core!.clearLocationIfIdle(phone);
    } else {
      await core!.notify(phone, null, "profil_valide", "Profil validé", "Vous pouvez passer disponible pour recevoir des missions.");
    }
    res.json({ success: true, profile: await core!.proProfile(phone) });
  });
  app.post(A("/pros/:phone/validate"), ...adm, writeLimiter, setProStatus("valide"));
  app.post(A("/pros/:phone/suspend"), ...adm, writeLimiter, setProStatus("suspendu"));
  app.post(A("/pros/:phone/refuse"), ...adm, writeLimiter, setProStatus("refuse"));
  app.post(A("/pros/validate-directory"), ...adm, writeLimiter, wrap(async (req, res) => {
    const r = await core!.pool.query(
      `UPDATE assistance_pros SET validation_status='valide', validated_by=$1, validated_at=$2, validation_note='Validation en lot (annuaire agréé)', updated_at=$2
       WHERE source='annuaire' AND validation_status='en_attente' AND cardinality(specialties)>0 AND cardinality(zone_ids)>0 RETURNING phone`,
      [adminActor(req), Date.now()]);
    console.log(`[ASSISTANCE] Validation en lot de ${r.rowCount} professionnels de l'annuaire par ${adminActor(req)}`);
    res.json({ success: true, validated: r.rowCount });
  }));
  app.patch(A("/pros/:phone"), ...adm, writeLimiter, wrap(async (req, res) => {
    const phone = canonicalPhone(String(req.params.phone));
    const cur = await core!.pool.query("SELECT display_name, garage_name FROM assistance_pros WHERE phone=$1", [phone]);
    if (!cur.rowCount) return res.status(404).json({ success: false, message: "Professionnel introuvable." });
    const profile = await core!.upsertProProfile(phone, { displayName: req.body?.displayName || cur.rows[0].display_name, garageName: req.body?.garageName ?? cur.rows[0].garage_name, specialties: req.body?.specialties, zoneIds: req.body?.zoneIds, mobility: req.body?.mobility });
    res.json({ success: true, profile });
  }));
  app.get(A("/pros/:phone/documents/:id"), ...adm, wrap(async (req, res) => {
    const r = await core!.pool.query("SELECT mime, data FROM assistance_pro_documents WHERE id=$1 AND pro_phone=$2", [Number(req.params.id), canonicalPhone(String(req.params.phone))]);
    if (!r.rowCount) return res.status(404).json({ success: false, message: "Document introuvable." });
    res.setHeader("Content-Type", r.rows[0].mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(r.rows[0].data);
  }));
  app.post(A("/pros/:phone/documents/:id/verify"), ...adm, writeLimiter, wrap(async (req, res) => {
    const status = req.body?.status === "refuse" ? "refuse" : "verifie";
    const r = await core!.pool.query("UPDATE assistance_pro_documents SET status=$3 WHERE id=$1 AND pro_phone=$2 RETURNING id", [Number(req.params.id), canonicalPhone(String(req.params.phone)), status]);
    if (!r.rowCount) return res.status(404).json({ success: false, message: "Document introuvable." });
    res.json({ success: true });
  }));
  app.post(A("/pros/:phone/trainings"), ...adm, writeLimiter, wrap(async (req, res) => {
    const phone = canonicalPhone(String(req.params.phone));
    const title = clean(req.body?.title, 120);
    if (title.length < 3) return res.status(400).json({ success: false, message: "Intitulé requis." });
    const verified = req.body?.status === "verifiee";
    const r = await core!.pool.query(
      `INSERT INTO assistance_trainings (pro_phone, title, issuer, completed_on, status, verified_by, verified_at, created_at)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE EXISTS (SELECT 1 FROM assistance_pros WHERE phone=$1) RETURNING id`,
      [phone, title, clean(req.body?.issuer, 120) || null, clean(req.body?.completedOn, 20) || null, verified ? "verifiee" : "declaree", verified ? adminActor(req) : null, verified ? Date.now() : null, Date.now()]);
    if (!r.rowCount) return res.status(404).json({ success: false, message: "Professionnel introuvable." });
    res.json({ success: true, id: r.rows[0].id });
  }));
  app.post(A("/trainings/:id/verify"), ...adm, writeLimiter, wrap(async (req, res) => {
    const status = req.body?.status === "refusee" ? "refusee" : "verifiee";
    const r = await core!.pool.query("UPDATE assistance_trainings SET status=$2, verified_by=$3, verified_at=$4 WHERE id=$1 RETURNING id", [Number(req.params.id), status, adminActor(req), Date.now()]);
    if (!r.rowCount) return res.status(404).json({ success: false, message: "Formation introuvable." });
    res.json({ success: true });
  }));
  app.post(A("/sync-directory"), ...adm, writeLimiter, wrap(async (_req, res) => {
    res.json({ success: true, ...(await core!.syncDirectory(d.getDirectory())) });
  }));

  // Zones, services, réglages
  app.get(A("/zones"), ...adm, wrap(async (_req, res) => {
    const r = await core!.pool.query("SELECT id, name, center_lat, center_lng, radius_km, active FROM assistance_zones ORDER BY name");
    res.json({ success: true, zones: r.rows.map((z) => ({ id: z.id, name: z.name, centerLat: z.center_lat, centerLng: z.center_lng, radiusKm: z.radius_km, active: z.active })) });
  }));
  const zoneInput = (b: any) => {
    const name = clean(b?.name, 80);
    const lat = Number(b?.centerLat ?? b?.lat), lng = Number(b?.centerLng ?? b?.lng), radius = Number(b?.radiusKm ?? b?.radius_km);
    if (name.length < 2 || !validCoords(lat, lng) || !(radius > 0 && radius <= 500)) throw new AssistanceError(400, "Zone invalide : nom, centre (latitude/longitude) et rayon en km requis.");
    return { name, lat, lng, radius, active: b?.active !== false };
  };
  app.post(A("/zones"), ...adm, writeLimiter, wrap(async (req, res) => {
    const z = zoneInput(req.body);
    const r = await core!.pool.query("INSERT INTO assistance_zones (name, center_lat, center_lng, radius_km, active, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [z.name, z.lat, z.lng, z.radius, z.active, Date.now()]).catch((e: any) => { if (e.code === "23505") throw new AssistanceError(409, "Une zone porte déjà ce nom."); throw e; });
    res.json({ success: true, id: r.rows[0].id });
  }));
  app.patch(A("/zones/:id"), ...adm, writeLimiter, wrap(async (req, res) => {
    const z = zoneInput(req.body);
    const r = await core!.pool.query("UPDATE assistance_zones SET name=$2, center_lat=$3, center_lng=$4, radius_km=$5, active=$6 WHERE id=$1 RETURNING id", [Number(req.params.id), z.name, z.lat, z.lng, z.radius, z.active]);
    if (!r.rowCount) return res.status(404).json({ success: false, message: "Zone introuvable." });
    res.json({ success: true });
  }));
  app.delete(A("/zones/:id"), ...adm, writeLimiter, wrap(async (req, res) => {
    const used = await core!.pool.query("SELECT 1 FROM assistance_requests WHERE zone_id=$1 LIMIT 1", [Number(req.params.id)]);
    if (used.rowCount) return res.status(409).json({ success: false, message: "Cette zone a des demandes : désactivez-la plutôt que de la supprimer." });
    await core!.pool.query("UPDATE assistance_pros SET zone_ids = array_remove(zone_ids, $1) WHERE $1 = ANY(zone_ids)", [Number(req.params.id)]);
    await core!.pool.query("DELETE FROM assistance_zones WHERE id=$1", [Number(req.params.id)]);
    res.json({ success: true });
  }));
  app.get(A("/services"), ...adm, wrap(async (_req, res) => {
    const [s, status] = await Promise.all([core!.pool.query("SELECT code, label, description, enabled FROM assistance_services ORDER BY sort, code"), core!.servicesStatus()]);
    res.json({ success: true, services: s.rows.map((x) => ({ ...x, proCount: status.find((y) => y.code === x.code)?.proCount ?? 0 })) });
  }));
  app.patch(A("/services/:code"), ...adm, writeLimiter, wrap(async (req, res) => {
    if (!SERVICE_CODES.includes(String(req.params.code))) return res.status(404).json({ success: false, message: "Service inconnu." });
    await core!.pool.query("UPDATE assistance_services SET enabled=COALESCE($2,enabled), label=COALESCE($3,label) WHERE code=$1", [req.params.code, typeof req.body?.enabled === "boolean" ? req.body.enabled : null, req.body?.label ? clean(req.body.label, 80) : null]);
    res.json({ success: true });
  }));
  app.get(A("/settings"), ...adm, wrap(async (_req, res) => { res.json({ success: true, settings: await core!.getSettings(true) }); }));
  app.put(A("/settings"), ...adm, writeLimiter, wrap(async (req, res) => { res.json({ success: true, settings: await core!.saveSettings(req.body || {}) }); }));

  // Paiements (Jèko), commissions, reversements
  app.get(A("/payments"), ...adm, wrap(async (_req, res) => {
    const r = await core!.pool.query(`SELECT p.reference, p.request_id, p.payer_phone, p.pro_phone, pr.display_name AS pro_name, p.method, p.provider, p.amount, p.commission_pct, p.commission_amount, p.pro_amount, p.status, p.payout_status, p.payout_at, p.payout_by, p.confirmed_by, p.created_at, p.updated_at
      FROM assistance_payments p LEFT JOIN assistance_pros pr ON pr.phone=p.pro_phone ORDER BY p.created_at DESC LIMIT 300`);
    res.json({ success: true, payments: r.rows.map((p) => ({ ...p, payout_at: p.payout_at ? Number(p.payout_at) : null, created_at: Number(p.created_at), updated_at: Number(p.updated_at) })) });
  }));
  app.post(A("/payments/:reference/payout"), ...adm, writeLimiter, wrap(async (req, res) => {
    await core!.markPayout(String(req.params.reference), adminActor(req));
    res.json({ success: true });
  }));
  app.post(A("/payments/:reference/reconcile"), ...adm, writeLimiter, wrap(async (req, res) => {
    await core!.reconcilePayment(String(req.params.reference));
    res.json({ success: true });
  }));

  // Réclamations
  app.get(A("/claims"), ...adm, wrap(async (_req, res) => {
    const r = await core!.pool.query(`SELECT id, request_id, author_phone, kind, message, status, admin_note, created_at, resolved_at FROM assistance_claims ORDER BY status, created_at DESC LIMIT 300`);
    res.json({ success: true, claims: r.rows.map((c) => ({ ...c, created_at: Number(c.created_at), resolved_at: c.resolved_at ? Number(c.resolved_at) : null })) });
  }));
  app.post(A("/claims/:id/resolve"), ...adm, writeLimiter, wrap(async (req, res) => {
    const r = await core!.pool.query("UPDATE assistance_claims SET status='resolue', admin_note=$2, resolved_at=$3 WHERE id=$1 RETURNING id", [Number(req.params.id), clean(req.body?.note, 500) || null, Date.now()]);
    if (!r.rowCount) return res.status(404).json({ success: false, message: "Réclamation introuvable." });
    res.json({ success: true });
  }));

  return {
    core,
    onExternalWebhook: async (ref, status, body) => (core ? core.handleJekoWebhook(ref, status, body) : false),
    syncDirectory: async () => { if (core) { const r = await core.syncDirectory(d.getDirectory()); console.log(`[ASSISTANCE] Annuaire synchronisé : ${r.created} profils créés (en attente de validation), ${r.linked} rattachés, ${r.suspended} suspendus.`); } },
  };
}

export async function initAssistance(handle: ReturnType<typeof registerAssistance>) {
  if (!handle.core) { console.warn("[ASSISTANCE] DATABASE_URL absent : module Assistance automobile désactivé (état explicite côté interface)."); return; }
  await handle.core.init();
  await handle.syncDirectory();
  handle.core.startWorker();
  console.log("[ASSISTANCE] Module prêt (schéma vérifié, affectation active).");
}
