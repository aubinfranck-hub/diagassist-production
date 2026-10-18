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
  let d: any, cd: any, earn: any, dash: any, p1: any;
  const live = async (tok: string) => (await api(tok, "GET", "/api/assistance/pro/offers")).body.offers.filter((o: any) => o.canBid);
  const notifsOf = async (phone: string, type: string) => (await pool.query("SELECT * FROM assistance_notifications WHERE phone=$1 AND type=$2 ORDER BY id", [phone, type])).rows;
  const bidUrl = (id: number) => `/api/assistance/pro/offers/${id}/bid`;
  r = await api(T.client, "POST", "/api/assistance/requests", { ...base_req, position: { lat: 5.35, lng: -4.01, source: "gps", confirmed: true, landmark: "Portail bleu" }, shareDiagnostic: true, diagnostic: { summary: "Piste : démarreur" }, submit: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const reqId = r.body.id;
  let offers = await live(T.pro1);
  const offers2 = await live(T.pro2);
  assert.equal(offers.length, 1);
  assert.equal(offers2.length, 1);
  assert.equal(offers[0].requestId, reqId);
  assert.equal(offers[0].status, "ouverte");
  assert.equal(offers[0].myBid, null);
  assert.deepEqual(offers[0].range, { min: 1, max: 500000 }); // rien de configuré : 1..500000
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

  // 10. Offres de prix : validation, fourchette, ETA approximatif, révision
  assert.equal((await api(T.pro1, "POST", bidUrl(offers[0].id), {})).status, 400);
  for (const amount of [0, 500001, -5]) {
    r = await api(T.pro1, "POST", bidUrl(offers[0].id), { amount });
    assert.equal(r.status, 400); assert.equal(r.body.code, "BID_OUT_OF_RANGE"); assert.match(r.body.message, /entre 1 et 500000/);
  }
  assert.equal((await api(T.pro1, "POST", bidUrl(offers[0].id), { amount: 1500.5 })).status, 400);
  assert.equal((await api(T.pro1, "POST", bidUrl(offers[0].id), { amount: 20000, etaMinutes: 0 })).status, 400);
  assert.equal((await api(T.pro1, "POST", bidUrl(offers[0].id), { amount: 20000, etaMinutes: 241 })).status, 400);
  assert.equal((await api(T.pro2, "POST", bidUrl(offers[0].id), { amount: 20000 })).status, 404); // l'offre d'un autre
  assert.equal((await api(T.client, "POST", bidUrl(offers[0].id), { amount: 20000 })).status, 403); // un client n'est pas mécanicien
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/offers/${offers[0].id}/accept`)).status, 404); // l'ancien « premier qui accepte » n'existe plus
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM assistance_offers WHERE request_id=$1 AND bid_amount IS NOT NULL", [reqId])).rows[0].n, 0);
  r = await api(T.pro1, "POST", bidUrl(offers[0].id), { amount: 30000, etaMinutes: 20 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.offer.status, "offre_envoyee"); assert.equal(r.body.offer.myBid.amount, 30000); assert.equal(r.body.offer.myBid.etaMinutes, 20);
  r = await api(T.pro2, "POST", bidUrl(offers2[0].id), { amount: 25000 }); // ETA calculé
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.offer.myBid.etaMinutes >= 1 && r.body.offer.myBid.validUntil > Date.now());
  assert.equal((await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body.request.status, "recherche"); // reste en recherche
  ok("Offre de prix : montant entier dans la fourchette, ETA facultatif sinon calculé, la demande reste en recherche");

  // 11. Le client reçoit les offres, triées par prix puis délai, sans donnée privée du mécanicien
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.bids.length, 2);
  assert.deepEqual(d.bids.map((b: any) => b.amount), [25000, 30000]);
  assert.equal(d.allowed.selectBid, true);
  const b0 = d.bids[0];
  assert.equal(b0.approximate, true); assert.ok(b0.validUntil > Date.now()); assert.equal(b0.isRevised, false);
  assert.equal(b0.pro.photoUrl, null); assert.equal(b0.pro.rating, null); assert.deepEqual(b0.pro.trainings, []);
  assert.ok(b0.pro.displayName && Array.isArray(b0.pro.specialties) && b0.distanceKm > 0 && b0.etaMinutes >= 1 && b0.sentAt > 0);
  assert.equal(b0.pro.location, undefined); // dépannage : pas de position du mécanicien dans l'offre
  assert.ok(!/0700000011|0700000012/.test(JSON.stringify(d.bids)));
  const nn = await notifsOf(CLIENT, "nouvelle_offre");
  assert.equal(nn.length, 2);
  assert.match(nn[0].body, /Nouvelle offre : 30000 F CFA, arrive dans ~20 min/);
  // Révision : un seul bid par offre, mise à jour en place
  r = await api(T.pro1, "POST", bidUrl(offers[0].id), { amount: 22000, etaMinutes: 15 });
  assert.equal(r.status, 200);
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM assistance_offers WHERE request_id=$1 AND pro_phone=$2", [reqId, PRO1])).rows[0].n, 1);
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.deepEqual(d.bids.map((b: any) => b.amount), [22000, 25000]);
  assert.equal(d.bids[0].isRevised, true); assert.equal(d.bids[0].etaMinutes, 15); assert.equal(d.bids[1].isRevised, false);
  assert.equal((await live(T.pro1))[0].myBid.amount, 22000);
  ok("Plusieurs offres affichées au client, triées par prix ; un mécanicien révise sa propre offre (une seule ligne)");

  // 12. Offre expirée non sélectionnable ; étrangers => 404
  const proBid = (await pool.query("SELECT id, pro_phone FROM assistance_offers WHERE request_id=$1 AND bid_amount IS NOT NULL", [reqId])).rows;
  const offerOf = (phone: string) => proBid.find((x) => x.pro_phone === phone).id as number;
  await pool.query("UPDATE assistance_offers SET bid_expires_at=1 WHERE id=$1", [offerOf(PRO2)]);
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.deepEqual(d.bids.map((b: any) => b.amount), [22000]);
  r = await api(T.client, "POST", `/api/assistance/requests/${reqId}/bids/${offerOf(PRO2)}/select`);
  assert.equal(r.status, 409); assert.equal(r.body.code, "BID_EXPIRED");
  assert.equal((await api(T.pro2, "POST", bidUrl(offerOf(PRO2)), { amount: 20000 })).status, 409); // plus de révision d'une offre expirée
  await pool.query("UPDATE assistance_offers SET bid_expires_at=$2 WHERE id=$1", [offerOf(PRO2), Date.now() + 300000]);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${reqId}/bids/${offerOf(PRO1)}/select`)).status, 404);
  assert.equal((await api(T.out, "POST", `/api/assistance/requests/${reqId}/bids/${offerOf(PRO1)}/select`)).status, 404);
  assert.equal((await api(T.pro1, "POST", `/api/assistance/requests/${reqId}/bids/${offerOf(PRO1)}/select`)).status, 404);
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/bids/999999/select`)).status, 404);
  assert.equal((await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body.bids.length, 2);
  ok("Une offre expirée n'est ni affichée ni sélectionnable (409) ; un étranger ou un pro reçoit 404");

  // 13. Choix du client ATOMIQUE : 2 mécaniciens, 4 requêtes simultanées => une seule affectation
  const results = await Promise.all([
    api(T.client, "POST", `/api/assistance/requests/${reqId}/bids/${offerOf(PRO1)}/select`),
    api(T.client, "POST", `/api/assistance/requests/${reqId}/bids/${offerOf(PRO1)}/select`),
    api(T.client, "POST", `/api/assistance/requests/${reqId}/bids/${offerOf(PRO2)}/select`),
    api(T.client, "POST", `/api/assistance/requests/${reqId}/bids/${offerOf(PRO2)}/select`),
  ]);
  assert.equal(results.filter((x) => x.status === 200).length, 1, JSON.stringify(results.map((x) => x.status)));
  assert.ok(results.filter((x) => x.status !== 200).every((x) => x.status === 409));
  const assignments = await pool.query("SELECT * FROM assistance_assignments WHERE request_id=$1 AND ended_at IS NULL", [reqId]);
  assert.equal(assignments.rowCount, 1);
  const winner = assignments.rows[0].pro_phone;
  const loser = winner === PRO1 ? PRO2 : PRO1;
  const winTok = winner === PRO1 ? T.pro1 : T.pro2;
  const loseTok = winner === PRO1 ? T.pro2 : T.pro1;
  const winAmount = winner === PRO1 ? 22000 : 25000;
  const offerStates = (await pool.query("SELECT pro_phone, status FROM assistance_offers WHERE request_id=$1", [reqId])).rows;
  assert.equal(offerStates.find((x) => x.pro_phone === winner).status, "acceptee");
  assert.equal(offerStates.find((x) => x.pro_phone === loser).status, "annulee");
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.request.status, "affectee"); assert.equal(d.request.amountAgreed, winAmount); assert.deepEqual(d.bids, []); assert.equal(d.allowed.selectBid, false);
  assert.equal((await api(loseTok, "POST", bidUrl(offerOf(loser)), { amount: 10000 })).body.code, "ALREADY_TAKEN");
  assert.equal((await api(winTok, "POST", bidUrl(offerOf(winner)), { amount: 10000 })).body.code, "ALREADY_TAKEN");
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/bids/${offerOf(loser)}/select`)).status, 409);
  ok("4 sélections simultanées => une seule affectation, les autres 409 ; prix de l'offre retenue = montant convenu");

  // 14. Notifications : le pro retenu et les autres
  const won = await notifsOf(winner, "offre_retenue");
  assert.equal(won.length, 1); assert.match(won[0].body, new RegExp(`Le client vous a choisi, ${winAmount} F CFA`));
  const lost = await notifsOf(loser, "offre_non_retenue");
  assert.equal(lost.length, 1); assert.match(lost[0].body, /Le client a choisi un autre mécanicien/);
  assert.equal((await notifsOf(winner, "offre_non_retenue")).length, 0);
  assert.equal((await live(loseTok)).length, 0);
  assert.equal((await api(loseTok, "GET", "/api/assistance/pro/offers")).body.offers[0].status, "non_retenue");
  assert.equal((await api(winTok, "GET", "/api/assistance/pro/offers")).body.offers[0].status, "retenue");
  ok("Le mécanicien retenu et les autres sont notifiés ; statuts « retenue » / « non retenue » côté pro");

  // 15. Déroulé
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.pro.phone, winner);
  assert.match(d.request.aiAnalysis, /démarreur/);
  assert.equal(d.request.diagnostic.summary, "Piste : démarreur");
  assert.ok(d.timeline.some((t: any) => t.label === "Mécanicien choisi"));
  const m = (await api(winTok, "GET", `/api/assistance/pro/missions/${reqId}`)).body;
  assert.equal(m.mission.position.landmark, "Portail bleu");
  assert.equal(m.mission.diagnostic.summary, "Piste : démarreur");
  assert.equal(m.mission.amountAgreed, winAmount);
  ok("Le client voit le pro choisi ; le pro affecté voit position exacte et dossier IA (consentement)");

  // 16. Étapes dans l'ordre ; le prix est convenu : pas de devis initial requis ; suppléments soumis à l'accord du client
  assert.equal((await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "sur_place" })).status, 409);
  assert.equal((await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "en_route" })).status, 200);
  assert.equal((await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "sur_place" })).status, 200);
  assert.equal((await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "en_intervention" })).status, 200);
  const q1 = await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/quotes`, { kind: "initial", lines: [{ kind: "pieces", label: "Démarreur", amount: 40000 }] });
  assert.equal(q1.status, 200, JSON.stringify(q1.body));
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.quotes[0].kind, "supplementaire"); // prix déjà convenu : tout devis est un supplément
  assert.equal(d.request.quoteStatus, "propose");
  assert.equal((await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "terminee" })).body.code, "QUOTE_PENDING");
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${reqId}/quotes/${d.quotes[0].id}/decision`, { accept: true })).status, 404);
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/quotes/${d.quotes[0].id}/decision`, { accept: false })).status, 200);
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.request.amountAgreed, winAmount); // un supplément refusé ne change pas le prix convenu
  const q2 = await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/quotes`, { kind: "supplementaire", lines: [{ kind: "pieces", label: "Courroie", amount: 10000 }] });
  assert.equal(q2.status, 200, JSON.stringify(q2.body));
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/quotes/${d.quotes.find((q: any) => q.status === "propose").id}/decision`, { accept: true })).status, 200);
  assert.equal((await api(winTok, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "terminee" })).status, 200);
  const total = winAmount + 10000;
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.request.amountAgreed, total);
  assert.equal(d.request.paymentStatus, "aucun");
  assert.equal(d.request.mode, "depannage");
  assert.equal(d.allowed.pay, true);
  ok(`Étapes ordonnées sans devis initial ; supplément refusé sans effet, supplément accepté : ${winAmount} + 10000 = ${total} XOF`);

  // 17. Paiement via Jèko avec le prix de l'offre retenue : montant serveur, webhook idempotent, commission 10 %, reversement admin
  const commission = Math.round(total * 0.1), proNet = total - commission;
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${reqId}/pay`, { method: "wave" })).status, 404);
  assert.equal((await api(T.client2, "GET", `/api/assistance/requests/${reqId}/payment`)).status, 404);
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/pay`, { method: "especes" })).status, 400);
  assert.deepEqual((await api(T.client, "GET", "/api/assistance/status")).body.paymentMethods, ["wave", "orange", "mtn", "moov"]);
  assert.equal((await api(T.admin, "GET", "/api/admin/assistance/settings")).body.settings.commission_pct, 10);
  const pay1 = await api(T.client, "POST", `/api/assistance/requests/${reqId}/pay`, { method: "wave", amount: 1 });
  assert.equal(pay1.status, 200, JSON.stringify(pay1.body));
  const ref1 = pay1.body.reference;
  assert.match(ref1, /^dgas-/);
  assert.equal((await pool.query("SELECT amount FROM assistance_payments WHERE reference=$1", [ref1])).rows[0].amount, total); // jamais le montant du client
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/pay`, { method: "wave" })).body.reference, ref1); // idempotent
  assert.equal(await core.handleJekoWebhook(ref1, "success", { amount: { amount: 123 } }), true); // montant faux : ignoré
  assert.equal((await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body.request.paymentStatus, "en_attente");
  assert.equal(await core.handleJekoWebhook("dgas-inconnu", "success", {}), false);
  assert.equal(await core.handleJekoWebhook(ref1, "success", { amount: { amount: total * 100 }, transactionDetails: { id: "jk-" + ref1 } }), true);
  assert.equal(await core.handleJekoWebhook(ref1, "success", { amount: { amount: total * 100 } }), true); // double webhook
  assert.equal(await core.handleJekoWebhook(ref1, "failed", {}), true); // rejeu contradictoire sans effet
  p1 = (await pool.query("SELECT * FROM assistance_payments WHERE reference=$1", [ref1])).rows[0];
  assert.equal(p1.status, "paye");
  assert.equal(p1.commission_amount, commission);
  assert.equal(p1.pro_amount, proNet);
  assert.equal(p1.payout_status, "a_reverser");
  assert.equal(p1.pro_phone, winner);
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM assistance_events WHERE request_id=$1 AND type='paiement_confirme'", [reqId])).rows[0].n, 1);
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.request.paymentStatus, "paye");
  assert.equal(d.allowed.pay, false);
  assert.equal(JSON.stringify(d).includes("commission"), false); // le client ne voit pas la commission
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/pay`, { method: "wave" })).status, 409);
  earn = (await api(winTok, "GET", "/api/assistance/pro/earnings")).body;
  assert.equal(earn.paid, proNet); assert.equal(earn.toReceive, proNet); assert.equal(earn.received, 0); assert.equal(earn.commissionPct, 10);
  assert.equal(earn.payments[0].commissionAmount, commission);
  assert.equal((await api(winTok, "GET", `/api/assistance/pro/missions/${reqId}`)).body.payment.payoutStatus, "a_reverser");
  assert.equal((await api(T.client, "GET", "/api/assistance/pro/earnings")).status, 403);
  dash = (await api(T.admin, "GET", "/api/admin/assistance/dashboard")).body.dashboard.payments;
  assert.equal(dash.collected, total); assert.equal(dash.commission, commission); assert.equal(dash.toReverse, proNet);
  assert.equal((await api(winTok, "POST", `/api/admin/assistance/payments/${ref1}/payout`)).status, 401);
  assert.equal((await api(T.admin, "POST", `/api/admin/assistance/payments/${ref1}/payout`)).status, 200);
  assert.equal((await api(T.admin, "POST", `/api/admin/assistance/payments/${ref1}/payout`)).status, 409);
  earn = (await api(winTok, "GET", "/api/assistance/pro/earnings")).body;
  assert.equal(earn.toReceive, 0); assert.equal(earn.received, proNet);
  assert.equal((await api(T.admin, "GET", "/api/admin/assistance/payments")).body.payments[0].payout_status, "reverse");
  dash = (await api(T.admin, "GET", "/api/admin/assistance/dashboard")).body.dashboard.payments;
  assert.equal(dash.toReverse, 0); assert.equal(dash.reversed, proNet);
  ok(`Paiement Jèko au prix de l'offre retenue (${total}) : webhook idempotent, commission 10 % (${commission}), reversement admin`);

  // 18. Avis une fois ; le partage de position s'arrête quand il n'est plus nécessaire
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/review`, { rating: 5 })).status, 200);
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/review`, { rating: 1 })).status, 409);
  await api(winTok, "POST", "/api/assistance/pro/availability", { available: false });
  assert.equal((await api(winTok, "POST", "/api/assistance/pro/location", { lat: 5.3, lng: -4.0 })).status, 409); // mission finie, indisponible
  ok("Avis unique ; position refusée dès qu'elle n'est plus nécessaire");

  // 19. Annulation : clôt toutes les propositions ouvertes ET les offres de prix
  await api(T.pro1, "POST", "/api/assistance/pro/availability", { available: true, lat: 5.34, lng: -4.03 });
  await api(T.pro2, "POST", "/api/assistance/pro/availability", { available: true, lat: 5.45, lng: -3.9 });
  r = await api(T.client2, "POST", "/api/assistance/requests", { ...base_req, position: { lat: 5.35, lng: -4.01, source: "carte", confirmed: true }, submit: true });
  const id2 = r.body.id;
  assert.equal((await live(T.pro1)).length, 1);
  assert.equal((await live(T.pro2)).length, 1);
  assert.equal((await api(T.pro1, "POST", bidUrl((await live(T.pro1))[0].id), { amount: 12000 })).status, 200);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${id2}/cancel`, { reason: "réparé" })).status, 200);
  assert.equal((await live(T.pro1)).length, 0);
  assert.equal((await live(T.pro2)).length, 0);
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM assistance_offers WHERE request_id=$1 AND status IN ('envoyee','offre_faite')", [id2])).rows[0].n, 0);
  ok("L'annulation clôt les propositions ouvertes et les offres de prix de tous les mécaniciens");

  // 20. Offres reçues mais toutes expirées sans choix => nouvelle vague, puis sans_disponibilite ; jamais de blocage
  r = await api(T.client2, "POST", "/api/assistance/requests", { ...base_req, position: { lat: 5.35, lng: -4.01, source: "carte", confirmed: true }, submit: true });
  const id3 = r.body.id;
  assert.equal((await api(T.pro1, "POST", bidUrl((await live(T.pro1))[0].id), { amount: 18000 })).status, 200);
  await pool.query("UPDATE assistance_offers SET expires_at=1 WHERE request_id=$1 AND status='envoyee'", [id3]); // l'autre mécanicien n'a pas répondu
  await core.dispatchTick();
  d = (await api(T.client2, "GET", `/api/assistance/requests/${id3}`)).body;
  assert.equal(d.request.status, "recherche"); // l'offre valide garde la recherche ouverte
  assert.equal(d.bids.length, 1);
  await pool.query("UPDATE assistance_offers SET bid_expires_at=1 WHERE request_id=$1 AND status='offre_faite'", [id3]);
  await core.dispatchTick();
  d = (await api(T.client2, "GET", `/api/assistance/requests/${id3}`)).body;
  assert.equal(d.request.status, "sans_disponibilite"); // tous déjà contactés
  assert.deepEqual(d.bids, []);
  assert.equal(d.allowed.retry, true);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${id3}/manual`)).status, 200);
  ok("Offres expirées sans choix => plus rien d'ouvert => sans_disponibilite + réessai / prise en charge manuelle");

  // 21. Une proposition expirée ne peut plus recevoir d'offre
  await api(T.client2, "POST", `/api/assistance/requests/${id3}/retry`);
  const o = (await live(T.pro1))[0];
  await pool.query("UPDATE assistance_offers SET expires_at=1 WHERE id=$1", [o.id]);
  r = await api(T.pro1, "POST", bidUrl(o.id), { amount: 15000 });
  assert.equal(r.status, 409); assert.equal(r.body.code, "OFFER_EXPIRED");
  ok("Une proposition expirée est refusée");

  // 22. Pro non abonné : ne peut pas offrir ; abonnement perdu entre l'offre et le choix => 409 clair
  const o2 = (await live(T.pro2))[0];
  subscribed.delete(PRO2);
  const rej = await api(T.pro2, "POST", bidUrl(o2.id), { amount: 15000 });
  assert.equal(rej.status, 403);
  assert.equal(rej.body.code, "SUBSCRIPTION_REQUIRED");
  assert.equal((await pool.query("SELECT bid_amount FROM assistance_offers WHERE id=$1", [o2.id])).rows[0].bid_amount, null);
  subscribed.add(PRO2);
  assert.equal((await api(T.pro2, "POST", bidUrl(o2.id), { amount: 15000 })).status, 200);
  subscribed.delete(PRO2);
  r = await api(T.client2, "POST", `/api/assistance/requests/${id3}/bids/${o2.id}/select`);
  assert.equal(r.status, 409); assert.equal(r.body.code, "SUBSCRIPTION_REQUIRED"); assert.match(r.body.message, /abonnement/i);
  assert.equal((await api(T.client2, "GET", `/api/assistance/requests/${id3}`)).body.request.status, "recherche");
  assert.equal((await pool.query("SELECT status FROM assistance_offers WHERE id=$1", [o2.id])).rows[0].status, "annulee"); // offre retirée
  subscribed.add(PRO2);
  ok("Un mécanicien non abonné ne peut pas offrir ; abonnement perdu avant le choix => 409 SUBSCRIPTION_REQUIRED");

  // 23. Choix du client vs réaffectation admin simultanés => une seule affectation active
  await pool.query("UPDATE assistance_offers SET status='envoyee', expires_at=$2 WHERE id=$1", [o.id, Date.now() + 60000]);
  assert.equal((await api(T.pro1, "POST", bidUrl(o.id), { amount: 16000 })).status, 200);
  const acc = await Promise.all([
    api(T.client2, "POST", `/api/assistance/requests/${id3}/bids/${o.id}/select`),
    api(T.admin, "POST", `/api/admin/assistance/requests/${id3}/assign`, { proPhone: PRO2 }),
  ]);
  assert.ok(acc.some((x) => x.status === 200));
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM assistance_assignments WHERE request_id=$1 AND ended_at IS NULL", [id3])).rows[0].n, 1);
  const ev = (await api(T.admin, "GET", `/api/admin/assistance/requests/${id3}`)).body;
  assert.ok(ev.timeline.length >= 5 && ev.timeline.every((e: any) => e.at && e.actor && e.type));
  assert.ok(ev.timeline.some((e: any) => e.type === "offre_prix"));
  ok("Choix du client et réaffectation admin simultanés => une seule affectation ; chronologie horodatée (offres comprises)");

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
  assert.match(inv.rows[0].body, /demande de dépannage près de vous/);
  assert.match(inv.rows[0].body, /faire une offre de prix/);
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
  assert.equal((await live(T.pro1)).length, 0);
  assert.equal((await live(T.pro2)).length, 1);
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${r.body.request.id}/cancel`, {})).status, 200);
  ok("Immobilisée => dépannage (pas de garage fixe) ; le mode se modifie sur un brouillon");

  // 24. Atelier : offres aux garages (garage + both) sans position du client ; fourchette 50 %..150 % du tarif affiché
  r = await api(T.client, "POST", "/api/assistance/requests", { ...base_req, immobilised: false, position: posAtelier, submit: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const aId = r.body.id;
  assert.equal(r.body.request.mode, "atelier");
  assert.equal(r.body.request.tariff, 15000);
  assert.equal(r.body.request.amountAgreed, 15000);
  const ao1 = await live(T.pro1);
  const ao2 = await live(T.pro2);
  assert.equal(ao1.length, 1); assert.equal(ao2.length, 1);
  assert.equal(ao1[0].mode, "atelier");
  assert.equal(ao1[0].approxPosition, null);
  assert.ok(ao1[0].distanceKm > 0);
  assert.deepEqual(ao1[0].range, { min: 7500, max: 22500 });
  assert.equal(ao1[0].tariff, 15000);
  assert.ok(!/Portail|0700000001|5\.35|-4\.01/.test(JSON.stringify(ao1[0])), JSON.stringify(ao1[0]));
  assert.equal((await api(T.pro1, "POST", bidUrl(ao1[0].id), { amount: 7499 })).body.code, "BID_OUT_OF_RANGE");
  assert.equal((await api(T.pro1, "POST", bidUrl(ao1[0].id), { amount: 22501 })).body.code, "BID_OUT_OF_RANGE");
  // Fourchette min/max explicite (réglage admin) prioritaire sur 50 % / 150 %
  assert.equal((await api(T.admin, "PUT", "/api/admin/assistance/settings", { tariffs: { mecanique: { indicatif: 15000, min: 10000, max: 20000 } } })).status, 200);
  assert.deepEqual((await live(T.pro1))[0].range, { min: 10000, max: 20000 });
  assert.equal((await api(T.pro1, "POST", bidUrl(ao1[0].id), { amount: 9999 })).body.code, "BID_OUT_OF_RANGE");
  assert.equal((await api(T.admin, "PUT", "/api/admin/assistance/settings", { tariffs: { mecanique: { indicatif: 15000 } } })).status, 200);
  ok("Atelier : offre aux garages avec distance, sans position/repère/téléphone ; fourchette 50 %-150 % ou min/max admin");

  // 25. Réglages admin validés
  for (const bad of [{ bid_valid_s: 29 }, { bid_valid_s: 3601 }, { tariffs: { mecanique: { min: 30000, max: 20000 } } }, { tariffs: { mecanique: { max: 1000001 } } }, { tariffs: { mecanique: { min: 600000 } } }, { tariffs: { mecanique: { min: 1.5 } } }]) {
    assert.equal((await api(T.admin, "PUT", "/api/admin/assistance/settings", bad)).status, 400, JSON.stringify(bad));
  }
  let sett = (await api(T.admin, "GET", "/api/admin/assistance/settings")).body.settings;
  assert.equal(sett.bid_valid_s, 300); assert.equal(sett.offer_timeout_s, 120);
  assert.equal((await api(T.admin, "PUT", "/api/admin/assistance/settings", { bid_valid_s: 600, tariffs: { mecanique: { indicatif: 15000, min: 8000, max: 25000 } } })).status, 200);
  sett = (await api(T.admin, "GET", "/api/admin/assistance/settings")).body.settings;
  assert.equal(sett.bid_valid_s, 600); assert.deepEqual(sett.tariffs.mecanique, { indicatif: 15000, min: 8000, max: 25000 });
  r = await api(T.pro1, "POST", bidUrl(ao1[0].id), { amount: 18000 }); // validité 600 s
  assert.equal(r.status, 200);
  assert.ok(Math.abs(r.body.offer.myBid.validUntil - (Date.now() + 600000)) < 5000);
  ok("Réglages admin : bid_valid_s 30..3600, min ≤ max ≤ 1 000 000 validés ; validité de l'offre = bid_valid_s");

  // 26. Atelier : le choix du client vaut confirmation de visite (double accord) ; aucune position exacte côté pro
  assert.equal((await api(T.pro2, "POST", bidUrl(ao2[0].id), { amount: 16000, etaMinutes: 30 })).status, 200);
  cd = (await api(T.client, "GET", `/api/assistance/requests/${aId}`)).body;
  assert.deepEqual(cd.bids.map((b: any) => b.amount), [16000, 18000]);
  const gb = cd.bids.find((b: any) => b.amount === 18000);
  assert.equal(gb.pro.location.lat, 5.34); assert.equal(gb.pro.location.lng, -4.03); // position exacte du garage, pour le client propriétaire
  assert.ok(gb.etaMinutes >= 1 && gb.approximate === true);
  assert.ok(!/0700000011|0700000012/.test(JSON.stringify(cd.bids)));
  assert.equal((await api(T.client2, "GET", `/api/assistance/requests/${aId}`)).status, 404);
  r = await api(T.client, "POST", `/api/assistance/requests/${aId}/bids/${gb.id}/select`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  cd = r.body;
  assert.equal(cd.request.status, "affectee"); assert.equal(cd.request.visitStatus, "confirmee"); assert.equal(cd.request.amountAgreed, 18000);
  assert.equal(cd.allowed.confirmVisit, false); assert.equal(cd.allowed.leaving, true);
  assert.equal(cd.pro.location.lat, 5.34);
  assert.ok(cd.pro.eta.minutes >= 1 && cd.pro.eta.approximate === true);
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${aId}/visit`, { accept: true })).body.code, "NO_VISIT_PROPOSED");
  let pm = (await api(T.pro1, "GET", `/api/assistance/pro/missions/${aId}`)).body;
  assert.equal(pm.mission.visitStatus, "confirmee"); assert.equal(pm.mission.position, null); assert.equal(pm.mission.clientPhone, "0700000001");
  assert.ok(!/Portail|5\.35|-4\.01/.test(JSON.stringify(pm)));
  assert.equal((await notifsOf(PRO2, "offre_non_retenue")).filter((x) => x.request_id === aId).length, 1);
  ok("Atelier : le choix du client vaut confirmation de visite (confirmee d'emblée) ; garage et ETA visibles ; /visit => NO_VISIT_PROPOSED");

  // 27. « Je pars », arrivée, prix de l'offre, paiement réconcilié avec commission configurable (20 %)
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${aId}/status`, { to: "en_route" })).status, 409); // c'est le client qui part
  cd = (await api(T.client, "POST", `/api/assistance/requests/${aId}/leaving`)).body;
  assert.equal(cd.request.status, "en_route");
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${aId}/status`, { to: "sur_place" })).status, 200);
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${aId}/status`, { to: "en_intervention" })).status, 200); // prix convenu : pas de devis obligatoire
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${aId}/status`, { to: "terminee" })).status, 200);
  cd = (await api(T.client, "GET", `/api/assistance/requests/${aId}`)).body;
  assert.equal(cd.request.amountAgreed, 18000); assert.equal(cd.request.tariff, 15000); assert.equal(cd.allowed.pay, true);
  assert.equal((await api(T.admin, "PUT", "/api/admin/assistance/settings", { commission_pct: 20 })).status, 200);
  const pay2 = await api(T.client, "POST", `/api/assistance/requests/${aId}/pay`, { method: "orange", payerPhone: "0700000001" });
  assert.equal(pay2.status, 200);
  jekoStatus = "success";
  d = (await api(T.client, "GET", `/api/assistance/requests/${aId}/payment`)).body; // réconciliation auprès de Jèko
  assert.equal(d.paymentStatus, "paye");
  const p2 = (await pool.query("SELECT * FROM assistance_payments WHERE reference=$1", [pay2.body.reference])).rows[0];
  assert.equal(p2.amount, 18000); assert.equal(p2.commission_amount, 3600); assert.equal(p2.pro_amount, 14400); assert.equal(Number(p2.commission_pct), 20);
  earn = (await api(T.pro1, "GET", "/api/assistance/pro/earnings")).body;
  assert.equal(earn.toReceive, 14400); assert.equal(earn.commissionPct, 20);
  jekoStatus = "pending";
  ok("Atelier : « Je pars », arrivée, prix de l'offre (18000, tarif affiché 15000 pour référence), commission 20 % (3600)");

  // 28. Affectation manuelle (admin) en atelier : amount_due = tarif, visite « proposée » ; refus du client => retour en recherche
  r = await api(T.client2, "POST", "/api/assistance/requests", { ...base_req, immobilised: false, position: posAtelier, submit: true });
  const bId = r.body.id;
  const bo1 = await live(T.pro1);
  assert.equal(bo1.length, 1);
  assert.equal((await api(T.pro1, "POST", bidUrl(bo1[0].id), { amount: 9000 })).status, 200);
  assert.equal((await api(T.admin, "POST", `/api/admin/assistance/requests/${bId}/assign`, { proPhone: PRO1 })).status, 200);
  cd = (await api(T.client2, "GET", `/api/assistance/requests/${bId}`)).body;
  assert.equal(cd.request.visitStatus, "proposee"); assert.equal(cd.request.amountAgreed, 15000); // admin : montant = tarif affiché, pas l'offre
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${bId}/visit`, { accept: false })).status, 200);
  cd = (await api(T.client2, "GET", `/api/assistance/requests/${bId}`)).body;
  assert.equal(cd.request.status, "recherche"); assert.equal(cd.request.visitStatus, "aucune"); assert.equal(cd.pro, null);
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM assistance_assignments WHERE request_id=$1 AND ended_at IS NULL", [bId])).rows[0].n, 0);
  assert.equal((await api(T.pro1, "GET", `/api/assistance/pro/missions/${bId}`)).status, 404);
  assert.equal((await live(T.pro1)).length, 0);
  const bo2 = await live(T.pro2);
  assert.equal(bo2.length, 1);
  assert.equal((await api(T.pro2, "POST", bidUrl(bo2[0].id), { amount: 17000 })).status, 200);
  cd = (await api(T.client2, "GET", `/api/assistance/requests/${bId}`)).body;
  assert.equal(cd.bids.length, 1);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${bId}/bids/${cd.bids[0].id}/select`)).status, 200);
  cd = (await api(T.client2, "GET", `/api/assistance/requests/${bId}`)).body;
  assert.equal(cd.request.visitStatus, "confirmee"); assert.equal(cd.request.amountAgreed, 17000);
  assert.equal(cd.timeline.some((t: any) => /refus/i.test(t.label)), true);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${bId}/cancel`, {})).status, 200);
  ok("Affectation admin (visite à confirmer) puis refus du client : pro libéré et exclu, nouvelle vague, offre, choix = confirmation");


  console.log(`\n${n} scénarios OK`);
  srv.close();
  await pool.end();
}
main().catch((e) => { console.error("ÉCHEC:", e); process.exit(1); });
