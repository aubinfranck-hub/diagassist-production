// Test d'intégration du module Assistance automobile contre un vrai PostgreSQL.
// Usage : ASSISTANCE_TEST_DATABASE_URL=postgres://... npx tsx src/modules/assistance/assistance.test.ts
import assert from "node:assert/strict";
import crypto from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import { Pool } from "pg";
import { registerAssistance, initAssistance } from "./assistance.routes";

const url = process.env.ASSISTANCE_TEST_DATABASE_URL;
if (!url) { console.log("ASSISTANCE_TEST_DATABASE_URL absent : test ignoré."); process.exit(0); }

const pool = new Pool({ connectionString: url });
const sessions = new Map<string, { phone: string; plan: string; createdAt: number }>();
const admins = new Set<string>(["+2250100000000"]);
const sent: { to: string; msg: string }[] = [];
const subscribed = new Set<string>(); // mécaniciens à jour de leur abonnement
let jekoStatus = "pending"; // statut renvoyé par le faux Jèko lors d'une réconciliation
const tokenFor = (phone: string) => { const t = crypto.randomBytes(8).toString("hex"); sessions.set(t, { phone, plan: "premium", createdAt: Date.now() }); return t; };
const requireAuth = (req: any, res: any, next: any) => {
  const s = sessions.get(String(req.headers.authorization || "").replace("Bearer ", ""));
  if (!s) return res.status(401).json({ success: false, message: "Session invalide" });
  req.session = s; next();
};
const requireAdminAuth = (req: any, res: any, next: any) => {
  const s = sessions.get(String(req.headers.authorization || "").replace("Bearer ", ""));
  if (s && admins.has(s.phone)) return next();
  res.status(401).json({ success: false });
};

const CLIENT = "+2250700000001", CLIENT2 = "+2250700000002", PRO1 = "+2250700000011", PRO2 = "+2250700000012", OUTSIDER = "+2250700000099", ADMIN = "+2250100000000";
const directory = [
  { id: "d1", type: "mechanic", name: "Koffi Garage", garageName: "Garage Koffi", phone: "07 00 00 00 11", city: "Abidjan", area: "Yopougon", specialties: "mécanique générale", hasScanner: true, certified: true, active: true },
  { id: "d2", type: "mechanic", name: "Awa Auto", phone: "0700000012", city: "Abidjan", specialties: "électricité, batterie", hasScanner: false, certified: true, active: true },
  { id: "d3", type: "parts_vendor", name: "Pièces Plus", phone: "0700000050", city: "Abidjan", hasScanner: false, certified: true, active: true },
];

async function main() {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const app = express();
  app.use(express.json({ limit: "20mb", verify: (req: any, _r, buf) => { req.rawBody = buf; } }));
  const handle = registerAssistance({
    app, pool, requireAuth, requireAdminAuth, sessions, isAdminPhone: (p) => admins.has(p),
    getDirectory: () => directory as any, getOrigin: () => "http://x",
    isProSubscribed: (phone) => subscribed.has(phone),
    jeko: { isConfigured: () => true, create: async (p) => ({ id: "jk-" + p.reference, redirectUrl: "http://pay/" + p.reference }), fetchStatus: async () => jekoStatus },
    sendWhatsApp: async (to, msg) => { sent.push({ to, msg }); },
    analyze: async () => "Piste : démarreur ou batterie (à vérifier)",
  });
  await initAssistance(handle);
  handle.core!.stopWorker(); // le test pilote le dispatch à la main
  const core = handle.core!;
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const T = { client: tokenFor(CLIENT), client2: tokenFor(CLIENT2), pro1: tokenFor(PRO1), pro2: tokenFor(PRO2), out: tokenFor(OUTSIDER), admin: tokenFor(ADMIN) };
  const api = async (tok: string, method: string, path: string, body?: any) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  let n = 0;
  const ok = (name: string) => console.log(`  ✓ ${++n}. ${name}`);

  // 1. Annuaire -> profils en attente (non validés d'office)
  let pros = (await api(T.admin, "GET", "/api/admin/assistance/pros")).body.pros;
  assert.equal(pros.length, 2);
  assert.ok(pros.every((p: any) => p.validationStatus === "en_attente" && p.source === "annuaire"));
  ok("Les mécaniciens de l'annuaire (pas les vendeurs) reçoivent un profil dépannage en attente de validation");

  // 2. Un pro non validé ne reçoit rien et ne peut pas passer disponible
  let r = await api(T.pro1, "POST", "/api/assistance/pro/availability", { available: true, lat: 5.36, lng: -4.0 });
  assert.equal(r.status, 403);
  assert.equal((await api(T.pro1, "GET", "/api/assistance/pro/offers")).status, 403);
  ok("Un professionnel non validé ne peut ni passer disponible ni lire des offres");

  // 3. Services : aucun disponible tant qu'aucun pro validé
  let st = (await api(T.client, "GET", "/api/assistance/status")).body;
  assert.ok(st.services.every((s: any) => s.available === false));
  ok("Aucun service n'est actif sans professionnel validé compétent");

  // 4. Validation admin (un par un), spécialités ajustées
  assert.equal((await api(T.pro1, "POST", "/api/admin/assistance/pros/+2250700000011/validate", {})).status, 401);
  for (const p of [PRO1, PRO2]) assert.equal((await api(T.admin, "POST", `/api/admin/assistance/pros/${encodeURIComponent(p)}/validate`, { note: "ok" })).status, 200);
  st = (await api(T.client, "GET", "/api/assistance/status")).body;
  ok("Validation réservée à l'admin");

  // 4b. Abonnement : un pro validé mais non abonné ne peut pas passer disponible
  r = await api(T.pro1, "POST", "/api/assistance/pro/availability", { available: true, lat: 5.34, lng: -4.03 });
  assert.equal(r.status, 409);
  assert.match(r.body.message, /abonnement/i);
  st = (await api(T.client, "GET", "/api/assistance/status")).body;
  assert.ok(st.services.every((s: any) => s.available === false));
  subscribed.add(PRO1); subscribed.add(PRO2);
  await pool.query("UPDATE assistance_pros SET specialties=array_append(specialties,'mecanique') WHERE phone=$1", [PRO2]);
  ok("Sans abonnement à jour, un mécanicien validé ne reçoit rien et ne compte pas dans les services actifs");

  // 5. Disponibilité avec position
  assert.equal((await api(T.pro1, "POST", "/api/assistance/pro/availability", { available: true })).status, 400);
  assert.equal((await api(T.pro1, "POST", "/api/assistance/pro/availability", { available: true, lat: 5.3400, lng: -4.0300 })).status, 200);
  assert.equal((await api(T.pro2, "POST", "/api/assistance/pro/availability", { available: true, lat: 5.4500, lng: -3.9000 })).status, 200);
  ok("Disponibilité exige une position");

  // 6. Création : position non confirmée refusée, hors zone refusé
  const base_req = { service: "mecanique", vehicle: { brand: "Toyota", model: "Corolla" }, symptoms: "Ne démarre pas", contactPhone: "0700000001" };
  r = await api(T.client, "POST", "/api/assistance/requests", { ...base_req, position: { lat: 5.35, lng: -4.01, source: "gps", confirmed: false }, submit: true });
  assert.equal(r.status, 400);
  r = await api(T.client, "POST", "/api/assistance/requests", { ...base_req, position: { lat: 48.85, lng: 2.35, source: "carte", confirmed: true }, submit: true });
  assert.equal(r.status, 422);
  ok("Position non confirmée ou hors zone : refus avec message clair");

  // 7. Demande valide, envoyée => analyse IA puis envoi SIMULTANÉ aux deux mécaniciens de la zone
  r = await api(T.client, "POST", "/api/assistance/requests", { ...base_req, position: { lat: 5.35, lng: -4.01, source: "gps", confirmed: true, landmark: "Portail bleu" }, shareDiagnostic: true, diagnostic: { summary: "Piste : démarreur" }, submit: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const reqId = r.body.id;
  let offers = (await api(T.pro1, "GET", "/api/assistance/pro/offers")).body.offers;
  const offers2 = (await api(T.pro2, "GET", "/api/assistance/pro/offers")).body.offers;
  assert.equal(offers.length, 1);
  assert.equal(offers2.length, 1);
  assert.equal(offers[0].requestId, reqId);
  assert.match(offers[0].aiAnalysis, /démarreur/);
  assert.equal(JSON.stringify(offers[0]).includes("Portail bleu"), false);
  assert.equal(JSON.stringify(offers[0]).includes("0700000001"), false);
  ok("La demande part à plusieurs mécaniciens en même temps, avec l'analyse IA, sans repère ni téléphone du client");

  // 8. Accès : tiers ne voit pas la demande ; pro non affecté non plus
  assert.equal((await api(T.out, "GET", `/api/assistance/requests/${reqId}`)).status, 404);
  assert.equal((await api(T.client2, "GET", `/api/assistance/requests/${reqId}`)).status, 404);
  assert.equal((await api(T.pro1, "GET", `/api/assistance/pro/missions/${reqId}`)).status, 404);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${reqId}/cancel`, {})).status, 404);
  ok("Un tiers ou un pro non affecté ne voit pas la demande (404)");

  // 9. Une demande déjà ouverte bloque une 2e
  r = await api(T.client, "POST", "/api/assistance/requests", { ...base_req, position: { lat: 5.35, lng: -4.01, source: "gps", confirmed: true }, submit: true });
  assert.equal(r.status, 409);
  ok("Une seule demande ouverte par client");

  // 10. Acceptations simultanées de DEUX mécaniciens différents : un seul gagne
  const results = await Promise.all([
    ...[1, 2, 3].map(() => api(T.pro1, "POST", `/api/assistance/pro/offers/${offers[0].id}/accept`)),
    ...[1, 2, 3].map(() => api(T.pro2, "POST", `/api/assistance/pro/offers/${offers2[0].id}/accept`)),
  ]);
  assert.equal(results.filter((x) => x.status === 200).length, 1, JSON.stringify(results.map((x) => x.status)));
  assert.ok(results.filter((x) => x.status !== 200).every((x) => x.status === 409));
  const assignments = await pool.query("SELECT * FROM assistance_assignments WHERE request_id=$1 AND ended_at IS NULL", [reqId]);
  assert.equal(assignments.rowCount, 1);
  const winner = assignments.rows[0].pro_phone;
  const winTok = winner === PRO1 ? T.pro1 : T.pro2;
  const loseTok = winner === PRO1 ? T.pro2 : T.pro1;
  assert.equal((await api(loseTok, "GET", "/api/assistance/pro/offers")).body.offers.length, 0);
  ok("6 acceptations simultanées de 2 mécaniciens => une seule affectation, l'autre reçoit « déjà pris »");

  // 11. Déroulé
  let d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.request.status, "affectee");
  assert.equal(d.pro.phone, winner);
  assert.match(d.request.aiAnalysis, /démarreur/);
  assert.equal(d.request.diagnostic.summary, "Piste : démarreur");
  const m = (await api(winTok, "GET", `/api/assistance/pro/missions/${reqId}`)).body;
  assert.equal(m.mission.position.landmark, "Portail bleu");
  assert.equal(m.mission.diagnostic.summary, "Piste : démarreur");
  ok("Le client voit le pro ; le pro affecté voit position exacte et dossier IA (consentement)");

  // 12. Étapes dans l'ordre, devis requis avant intervention
  assert.equal((await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "sur_place" })).status, 409);
  assert.equal((await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "en_route" })).status, 200);
  assert.equal((await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "sur_place" })).status, 200);
  assert.equal((await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "en_intervention" })).body.code, "QUOTE_NOT_ACCEPTED");
  const q1 = await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/quotes`, { kind: "initial", lines: [{ kind: "deplacement", amount: 2000 }, { kind: "diagnostic", amount: 3000 }, { kind: "main_oeuvre", amount: 5000 }] });
  assert.equal(q1.status, 200, JSON.stringify(q1.body));
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.request.quoteStatus, "propose");
  assert.equal((await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "en_intervention" })).status, 409);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${reqId}/quotes/${d.quotes[0].id}/decision`, { accept: true })).status, 404);
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/quotes/${d.quotes[0].id}/decision`, { accept: true })).status, 200);
  assert.equal((await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "en_intervention" })).status, 200);
  ok("Étapes ordonnées ; l'intervention ne démarre qu'avec un devis accepté par le client");

  // 13. Travaux supplémentaires : accord requis avant de terminer
  const q2 = await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/quotes`, { kind: "supplementaire", lines: [{ kind: "pieces", label: "Démarreur", amount: 40000 }] });
  assert.equal(q2.status, 200);
  assert.equal((await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "terminee" })).body.code, "QUOTE_PENDING");
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  const sup = d.quotes.find((q: any) => q.kind === "supplementaire");
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/quotes/${sup.id}/decision`, { accept: true })).status, 200);
  assert.equal((await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "terminee" })).status, 200);
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.request.amountAgreed, 50000);
  assert.equal(d.request.paymentStatus, "aucun");
  assert.equal(d.request.mode, "depannage");
  assert.equal(d.allowed.pay, true);
  ok("Les travaux supplémentaires exigent l'accord enregistré ; montant convenu 50000 XOF (mode dépannage par défaut)");

  // 14. Paiement via Jèko : montant côté serveur, webhook idempotent, commission 10 %, reversement admin
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${reqId}/pay`, { method: "wave" })).status, 404);
  assert.equal((await api(T.client2, "GET", `/api/assistance/requests/${reqId}/payment`)).status, 404);
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/pay`, { method: "especes" })).status, 400);
  assert.deepEqual((await api(T.client, "GET", "/api/assistance/status")).body.paymentMethods, ["wave", "orange", "mtn", "moov"]);
  assert.equal((await api(T.admin, "GET", "/api/admin/assistance/settings")).body.settings.commission_pct, 10);
  const pay1 = await api(T.client, "POST", `/api/assistance/requests/${reqId}/pay`, { method: "wave", amount: 1 });
  assert.equal(pay1.status, 200, JSON.stringify(pay1.body));
  const ref1 = pay1.body.reference;
  assert.match(ref1, /^dgas-/);
  assert.equal((await pool.query("SELECT amount FROM assistance_payments WHERE reference=$1", [ref1])).rows[0].amount, 50000); // jamais le montant du client
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/pay`, { method: "wave" })).body.reference, ref1); // idempotent
  assert.equal(await core.handleJekoWebhook(ref1, "success", { amount: { amount: 123 } }), true); // montant faux : ignoré
  assert.equal((await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body.request.paymentStatus, "en_attente");
  assert.equal(await core.handleJekoWebhook("dgas-inconnu", "success", {}), false);
  assert.equal(await core.handleJekoWebhook(ref1, "success", { amount: { amount: 5000000 }, transactionDetails: { id: "jk-" + ref1 } }), true);
  assert.equal(await core.handleJekoWebhook(ref1, "success", { amount: { amount: 5000000 } }), true); // double webhook
  assert.equal(await core.handleJekoWebhook(ref1, "failed", {}), true); // rejeu contradictoire sans effet
  let p1 = (await pool.query("SELECT * FROM assistance_payments WHERE reference=$1", [ref1])).rows[0];
  assert.equal(p1.status, "paye");
  assert.equal(p1.commission_amount, 5000);
  assert.equal(p1.pro_amount, 45000);
  assert.equal(p1.payout_status, "a_reverser");
  assert.equal(p1.pro_phone, winner);
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM assistance_events WHERE request_id=$1 AND type='paiement_confirme'", [reqId])).rows[0].n, 1);
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.request.paymentStatus, "paye");
  assert.equal(d.allowed.pay, false);
  assert.equal(JSON.stringify(d).includes("commission"), false); // le client ne voit pas la commission
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/pay`, { method: "wave" })).status, 409);
  let earn = (await api(winTok, "GET", "/api/assistance/pro/earnings")).body;
  assert.equal(earn.paid, 45000); assert.equal(earn.toReceive, 45000); assert.equal(earn.received, 0); assert.equal(earn.commissionPct, 10);
  assert.equal(earn.payments[0].commissionAmount, 5000);
  assert.equal((await api(winTok, "GET", `/api/assistance/pro/missions/${reqId}`)).body.payment.payoutStatus, "a_reverser");
  assert.equal((await api(T.client, "GET", "/api/assistance/pro/earnings")).status, 403);
  let dash = (await api(T.admin, "GET", "/api/admin/assistance/dashboard")).body.dashboard.payments;
  assert.equal(dash.collected, 50000); assert.equal(dash.commission, 5000); assert.equal(dash.toReverse, 45000);
  assert.equal((await api(winTok, "POST", `/api/admin/assistance/payments/${ref1}/payout`)).status, 401);
  assert.equal((await api(T.admin, "POST", `/api/admin/assistance/payments/${ref1}/payout`)).status, 200);
  assert.equal((await api(T.admin, "POST", `/api/admin/assistance/payments/${ref1}/payout`)).status, 409);
  earn = (await api(winTok, "GET", "/api/assistance/pro/earnings")).body;
  assert.equal(earn.toReceive, 0); assert.equal(earn.received, 45000);
  assert.equal((await api(T.admin, "GET", "/api/admin/assistance/payments")).body.payments[0].payout_status, "reverse");
  dash = (await api(T.admin, "GET", "/api/admin/assistance/dashboard")).body.dashboard.payments;
  assert.equal(dash.toReverse, 0); assert.equal(dash.reversed, 45000);
  ok("Paiement Jèko : montant serveur, webhook signé idempotent, commission 10 % (5000), reversement admin, gains du mécanicien");

  // 15. Avis une fois ; le partage de position s'arrête quand il n'est plus nécessaire
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/review`, { rating: 5 })).status, 200);
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/review`, { rating: 1 })).status, 409);
  await api(winTok, "POST", "/api/assistance/pro/availability", { available: false });
  assert.equal((await api(winTok, "POST", "/api/assistance/pro/location", { lat: 5.3, lng: -4.0 })).status, 409); // mission finie, indisponible
  ok("Avis unique ; position refusée dès qu'elle n'est plus nécessaire");

  // 16. Annulation : clôt toutes les propositions ouvertes
  await api(T.pro1, "POST", "/api/assistance/pro/availability", { available: true, lat: 5.34, lng: -4.03 });
  await api(T.pro2, "POST", "/api/assistance/pro/availability", { available: true, lat: 5.45, lng: -3.9 });
  r = await api(T.client2, "POST", "/api/assistance/requests", { ...base_req, position: { lat: 5.35, lng: -4.01, source: "carte", confirmed: true }, submit: true });
  const id2 = r.body.id;
  assert.equal((await api(T.pro1, "GET", "/api/assistance/pro/offers")).body.offers.length, 1);
  assert.equal((await api(T.pro2, "GET", "/api/assistance/pro/offers")).body.offers.length, 1);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${id2}/cancel`, { reason: "réparé" })).status, 200);
  assert.equal((await api(T.pro1, "GET", "/api/assistance/pro/offers")).body.offers.length, 0);
  assert.equal((await api(T.pro2, "GET", "/api/assistance/pro/offers")).body.offers.length, 0);
  ok("L'annulation clôt les propositions ouvertes de tous les mécaniciens contactés");

  // 17. Expiration => sans_disponibilite (tous déjà contactés) ; réessai ; prise en charge manuelle
  r = await api(T.client2, "POST", "/api/assistance/requests", { ...base_req, position: { lat: 5.35, lng: -4.01, source: "carte", confirmed: true }, submit: true });
  const id3 = r.body.id;
  await pool.query("UPDATE assistance_offers SET expires_at=1 WHERE request_id=$1 AND status='envoyee'", [id3]);
  await core.dispatchTick();
  d = (await api(T.client2, "GET", `/api/assistance/requests/${id3}`)).body;
  assert.equal(d.request.status, "sans_disponibilite");
  assert.equal(d.allowed.retry, true);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${id3}/manual`)).status, 200);
  ok("Expiration => plus personne => sans_disponibilite + réessai / prise en charge manuelle");

  // 18. Une proposition expirée ne peut plus être acceptée
  await api(T.client2, "POST", `/api/assistance/requests/${id3}/retry`);
  const o = (await api(T.pro1, "GET", "/api/assistance/pro/offers")).body.offers[0];
  await pool.query("UPDATE assistance_offers SET expires_at=1 WHERE id=$1", [o.id]);
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/offers/${o.id}/accept`)).status, 409);
  ok("Une proposition expirée est refusée");

  // 19. Abonnement expiré entre la proposition et l'acceptation => refus
  await pool.query("UPDATE assistance_offers SET expires_at=$2 WHERE request_id=$1 AND status='envoyee'", [id3, Date.now() + 60000]);
  const o2 = (await api(T.pro2, "GET", "/api/assistance/pro/offers")).body.offers[0];
  subscribed.delete(PRO2);
  const rej = await api(T.pro2, "POST", `/api/assistance/pro/offers/${o2.id}/accept`);
  assert.equal(rej.status, 403);
  assert.equal(rej.body.code, "SUBSCRIPTION_REQUIRED");
  subscribed.add(PRO2);
  ok("Un mécanicien dont l'abonnement n'est plus à jour ne peut pas accepter");

  // 20. Acceptation vs réaffectation admin simultanées => une seule affectation active
  const acc = await Promise.all([
    api(T.pro2, "POST", `/api/assistance/pro/offers/${o2.id}/accept`),
    api(T.admin, "POST", `/api/admin/assistance/requests/${id3}/assign`, { proPhone: PRO1 }),
  ]);
  assert.ok(acc.some((x) => x.status === 200));
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM assistance_assignments WHERE request_id=$1 AND ended_at IS NULL", [id3])).rows[0].n, 1);
  const ev = (await api(T.admin, "GET", `/api/admin/assistance/requests/${id3}`)).body;
  assert.ok(ev.timeline.length >= 5 && ev.timeline.every((e: any) => e.at && e.actor && e.type));
  ok("Acceptation et réaffectation admin simultanées => une seule affectation ; chronologie horodatée");

  // 21. Médias : type vérifié, accès contrôlé
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").toString("base64");
  assert.equal((await api(T.client2, "POST", "/api/assistance/media", { mime: "image/png", dataBase64: Buffer.from("not a png at all").toString("base64") })).status, 400);
  assert.equal((await api(T.client2, "POST", "/api/assistance/media", { mime: "application/x-sh", dataBase64: png })).status, 400);
  const up = await api(T.client, "POST", "/api/assistance/media", { mime: "image/png", dataBase64: png });
  assert.equal(up.status, 200);
  assert.equal((await api(T.out, "GET", `/api/assistance/media/${up.body.media.id}`)).status, 404);
  assert.equal((await api(T.client, "GET", `/api/assistance/media/${up.body.media.id}`)).status, 200);
  ok("Médias : type/signature contrôlés, lecture réservée au propriétaire / pro affecté / admin");

  // 21b. Invitation automatique des mécaniciens non abonnés (sans détails privés du client)
  subscribed.delete(PRO2);
  await pool.query("DELETE FROM assistance_notifications WHERE type='abonnement_invite'");
  await pool.query("UPDATE assistance_requests SET status='annulee' WHERE status IN ('recherche','sans_disponibilite')");
  r = await api(T.client, "POST", "/api/assistance/requests", { ...base_req, position: { lat: 5.35, lng: -4.01, source: "gps", confirmed: true, landmark: "Portail bleu" }, submit: true });
  await new Promise((res) => setTimeout(res, 300));
  const inv = await pool.query("SELECT * FROM assistance_notifications WHERE type='abonnement_invite'");
  assert.equal(inv.rowCount, 1);
  assert.equal(inv.rows[0].phone, PRO2);
  assert.ok(!/Portail|0700000001|5\.35/.test(inv.rows[0].body));
  assert.ok(sent.length === 1 && sent[0].to === PRO2, JSON.stringify(sent));
  ok("Un mécanicien non abonné de la zone reçoit une invitation WhatsApp à s'abonner, sans donnée privée du client");

  // 22. Montant indicatif configurable, jamais inventé
  st = (await api(T.client, "GET", "/api/assistance/status")).body;
  assert.equal(st.services.find((s: any) => s.code === "mecanique").indicativeAmount, null);
  assert.equal((await api(T.admin, "PUT", "/api/admin/assistance/settings", { tariffs: { mecanique: { indicatif: 15000 } } })).status, 200);
  st = (await api(T.client, "GET", "/api/assistance/status")).body;
  assert.equal(st.services.find((s: any) => s.code === "mecanique").indicativeAmount, 15000);
  assert.equal(st.services.find((s: any) => s.code === "mecanique").tariff, 15000);
  assert.equal(st.services.find((s: any) => s.code === "mecanique").atelierAvailable, false);
  ok("Le montant indicatif est vide tant que l'admin ne l'a pas configuré");

  // ---- Mode atelier (double accord) ----
  assert.equal((await api(T.admin, "PUT", "/api/admin/assistance/settings", { commission_pct: 150 })).status, 400);
  // Nettoyage : plus aucune demande ouverte, pros libres et abonnés. PRO1 = garage seul, PRO2 = les deux.
  await pool.query("UPDATE assistance_requests SET status='annulee' WHERE status IN ('recherche','sans_disponibilite')");
  await api(T.client2, "POST", `/api/assistance/requests/${id3}/cancel`, {});
  subscribed.add(PRO1); subscribed.add(PRO2);
  await pool.query("UPDATE assistance_pros SET mobility='garage' WHERE phone=$1", [PRO1]);
  await pool.query("UPDATE assistance_pros SET mobility='both' WHERE phone=$1", [PRO2]);
  await pool.query("UPDATE assistance_pros SET specialties=array_append(specialties,'mecanique') WHERE phone=$1 AND NOT ('mecanique' = ANY(specialties))", [PRO1]);
  assert.equal((await api(T.pro1, "POST", "/api/assistance/pro/availability", { available: true, lat: 5.34, lng: -4.03 })).status, 200);
  assert.equal((await api(T.pro2, "POST", "/api/assistance/pro/availability", { available: true, lat: 5.45, lng: -3.9 })).status, 200);
  const posAtelier = { lat: 5.35, lng: -4.01, source: "gps", confirmed: true, landmark: "Portail bleu" };

  // 23. Un garage fixe ne reçoit pas de dépannage ; PATCH immobilised bascule le mode d'un brouillon
  r = await api(T.client, "POST", "/api/assistance/requests", { ...base_req, immobilised: false, position: posAtelier });
  assert.equal(r.body.request.mode, "atelier");
  r = await api(T.client, "PATCH", `/api/assistance/requests/${r.body.id}`, { immobilised: true });
  assert.equal(r.body.request.mode, "depannage");
  await api(T.client, "POST", `/api/assistance/requests/${r.body.request.id}/submit`);
  assert.equal((await api(T.pro1, "GET", "/api/assistance/pro/offers")).body.offers.length, 0);
  assert.equal((await api(T.pro2, "GET", "/api/assistance/pro/offers")).body.offers.length, 1);
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${r.body.request.id}/cancel`, {})).status, 200);
  ok("Immobilisée => dépannage (pas de garage fixe) ; le mode se modifie sur un brouillon");

  // 24. Atelier : offres aux garages (garage + both) sans position du client ; tarif connu initialisé
  r = await api(T.client, "POST", "/api/assistance/requests", { ...base_req, immobilised: false, position: posAtelier, submit: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const aId = r.body.id;
  assert.equal(r.body.request.mode, "atelier");
  assert.equal(r.body.request.tariff, 15000);
  assert.equal(r.body.request.amountAgreed, 15000);
  const ao1 = (await api(T.pro1, "GET", "/api/assistance/pro/offers")).body.offers;
  const ao2 = (await api(T.pro2, "GET", "/api/assistance/pro/offers")).body.offers;
  assert.equal(ao1.length, 1); assert.equal(ao2.length, 1);
  assert.equal(ao1[0].mode, "atelier");
  assert.equal(ao1[0].approxPosition, null);
  assert.ok(ao1[0].distanceKm > 0);
  assert.ok(!/Portail|0700000001|5\.35|-4\.01/.test(JSON.stringify(ao1[0])), JSON.stringify(ao1[0]));
  ok("Atelier : offre aux garages avec distance, sans position, repère ni téléphone du client");

  // 25. Le garage accepte -> proposée ; rien n'avance sans le client ; aucune position exacte côté pro
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/offers/${ao1[0].id}/accept`)).status, 200);
  let cd = (await api(T.client, "GET", `/api/assistance/requests/${aId}`)).body;
  assert.equal(cd.request.status, "affectee"); assert.equal(cd.request.visitStatus, "proposee");
  assert.equal(cd.allowed.confirmVisit, true); assert.equal(cd.allowed.leaving, false);
  assert.equal(cd.pro.location.lat, 5.34); assert.equal(cd.pro.location.lng, -4.03);
  assert.ok(cd.pro.eta.minutes >= 1 && cd.pro.eta.approximate === true);
  let pm = (await api(T.pro1, "GET", `/api/assistance/pro/missions/${aId}`)).body;
  assert.equal(pm.mission.visitStatus, "proposee"); assert.equal(pm.mission.position, null); assert.equal(pm.mission.clientPhone, null);
  assert.ok(!/Portail|0700000001|5\.35|-4\.01/.test(JSON.stringify(pm)));
  for (const to of ["en_route", "sur_place", "en_intervention", "terminee"]) {
    const x = await api(T.pro1, "POST", `/api/assistance/pro/missions/${aId}/status`, { to });
    assert.equal(x.status, 409); assert.equal(x.body.code, "VISIT_NOT_CONFIRMED");
  }
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${aId}/leaving`)).status, 409);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${aId}/visit`, { accept: true })).status, 404);
  assert.equal((await api(T.pro1, "POST", `/api/assistance/requests/${aId}/visit`, { accept: true })).status, 404);
  ok("Atelier : le pro est bloqué (409 VISIT_NOT_CONFIRMED) avant la confirmation du client ; il ne reçoit jamais la position");

  // 26. Le client confirme (double accord) -> téléphone ouvert au pro, « Je pars », arrivée, tarif connu, paiement réconcilié
  cd = (await api(T.client, "POST", `/api/assistance/requests/${aId}/visit`, { accept: true })).body;
  assert.equal(cd.request.visitStatus, "confirmee"); assert.equal(cd.allowed.leaving, true); assert.equal(cd.allowed.confirmVisit, false);
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${aId}/visit`, { accept: true })).status, 409);
  pm = (await api(T.pro1, "GET", `/api/assistance/pro/missions/${aId}`)).body;
  assert.equal(pm.mission.clientPhone, "0700000001"); assert.equal(pm.mission.position, null);
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${aId}/status`, { to: "en_route" })).status, 409); // c'est le client qui part
  cd = (await api(T.client, "POST", `/api/assistance/requests/${aId}/leaving`)).body;
  assert.equal(cd.request.status, "en_route");
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${aId}/status`, { to: "sur_place" })).status, 200);
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${aId}/status`, { to: "en_intervention" })).status, 200); // tarif connu : pas de devis obligatoire
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${aId}/status`, { to: "terminee" })).status, 200);
  cd = (await api(T.client, "GET", `/api/assistance/requests/${aId}`)).body;
  assert.equal(cd.request.amountAgreed, 15000); assert.equal(cd.allowed.pay, true);
  assert.equal((await api(T.admin, "PUT", "/api/admin/assistance/settings", { commission_pct: 20 })).status, 200);
  const pay2 = await api(T.client, "POST", `/api/assistance/requests/${aId}/pay`, { method: "orange", payerPhone: "0700000001" });
  assert.equal(pay2.status, 200);
  jekoStatus = "success";
  d = (await api(T.client, "GET", `/api/assistance/requests/${aId}/payment`)).body; // réconciliation auprès de Jèko
  assert.equal(d.paymentStatus, "paye");
  const p2 = (await pool.query("SELECT * FROM assistance_payments WHERE reference=$1", [pay2.body.reference])).rows[0];
  assert.equal(p2.commission_amount, 3000); assert.equal(p2.pro_amount, 12000); assert.equal(Number(p2.commission_pct), 20);
  earn = (await api(T.pro1, "GET", "/api/assistance/pro/earnings")).body;
  assert.equal(earn.toReceive, 12000); assert.equal(earn.commissionPct, 20);
  jekoStatus = "pending";
  ok("Atelier : double accord, « Je pars », arrivée, tarif connu sans devis, paiement réconcilié avec commission configurable (20 %)");

  // 27. Refus du client -> le pro est libéré et exclu, la demande repart en recherche
  r = await api(T.client2, "POST", "/api/assistance/requests", { ...base_req, immobilised: false, position: posAtelier, submit: true });
  const bId = r.body.id;
  const bo1 = (await api(T.pro1, "GET", "/api/assistance/pro/offers")).body.offers;
  assert.equal(bo1.length, 1);
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/offers/${bo1[0].id}/accept`)).status, 200);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${bId}/visit`, { accept: false })).status, 200);
  cd = (await api(T.client2, "GET", `/api/assistance/requests/${bId}`)).body;
  assert.equal(cd.request.status, "recherche"); assert.equal(cd.request.visitStatus, "aucune"); assert.equal(cd.pro, null);
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM assistance_assignments WHERE request_id=$1 AND ended_at IS NULL", [bId])).rows[0].n, 0);
  assert.equal((await api(T.pro1, "GET", `/api/assistance/pro/missions/${bId}`)).status, 404);
  assert.equal((await api(T.pro1, "GET", "/api/assistance/pro/offers")).body.offers.length, 0);
  const bo2 = (await api(T.pro2, "GET", "/api/assistance/pro/offers")).body.offers;
  assert.equal(bo2.length, 1);
  assert.equal((await api(T.pro2, "POST", `/api/assistance/pro/offers/${bo2[0].id}/accept`)).status, 200);
  cd = (await api(T.client2, "GET", `/api/assistance/requests/${bId}`)).body;
  assert.equal(cd.request.visitStatus, "proposee");
  assert.equal(cd.timeline.some((t: any) => /refus/i.test(t.label)), true);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${bId}/cancel`, {})).status, 200);
  ok("Refus du client : pro libéré et exclu pour cette demande, redispatch vers un autre garage");

  console.log(`\n${n} scénarios OK`);
  srv.close();
  await pool.end();
}
main().catch((e) => { console.error("ÉCHEC:", e); process.exit(1); });
