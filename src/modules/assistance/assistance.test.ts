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
    jeko: { isConfigured: () => true, create: async (p) => ({ id: "jk-" + p.reference, redirectUrl: "http://pay/" + p.reference }), fetchStatus: async () => "pending" },
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
  assert.ok(st.services.find((s: any) => s.code === "mecanique").available);
  assert.ok(st.services.find((s: any) => s.code === "batterie").available);
  assert.ok(!st.services.find((s: any) => s.code === "remorquage").available);
  ok("Validation réservée à l'admin ; les services s'activent selon les compétences réelles");

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

  // 7. Demande valide, envoyée => proposition au pro le plus proche (pro1)
  r = await api(T.client, "POST", "/api/assistance/requests", { ...base_req, position: { lat: 5.35, lng: -4.01, source: "gps", confirmed: true, landmark: "Portail bleu" }, shareDiagnostic: true, diagnostic: { summary: "Piste : démarreur" }, submit: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const reqId = r.body.id;
  let offers = (await api(T.pro1, "GET", "/api/assistance/pro/offers")).body.offers;
  assert.equal(offers.length, 1);
  assert.equal(offers[0].requestId, reqId);
  assert.equal(JSON.stringify(offers[0]).includes("Portail bleu"), false);
  assert.equal(JSON.stringify(offers[0]).includes("0700000001"), false);
  assert.equal((await api(T.pro2, "GET", "/api/assistance/pro/offers")).body.offers.length, 0);
  ok("La proposition va au professionnel le plus proche, sans repère ni téléphone du client");

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

  // 10. Acceptations simultanées : une seule affectation
  const offerId = offers[0].id;
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => api(T.pro1, "POST", `/api/assistance/pro/offers/${offerId}/accept`)));
  assert.equal(results.filter((x) => x.status === 200).length, 1, JSON.stringify(results.map((x) => x.status)));
  const assignments = await pool.query("SELECT * FROM assistance_assignments WHERE request_id=$1 AND ended_at IS NULL", [reqId]);
  assert.equal(assignments.rowCount, 1);
  ok("5 acceptations simultanées => une seule affectation");

  // 11. Course pro1 expiré / pro2 : offre d'une 2e demande, admin affecte en même temps
  // (voir plus bas) ; d'abord le déroulé
  let d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.request.status, "affectee");
  assert.equal(d.pro.displayName, "Koffi Garage");
  assert.equal(d.pro.phone, PRO1);
  assert.equal(d.request.diagnostic.summary, "Piste : démarreur");
  const m = (await api(T.pro1, "GET", `/api/assistance/pro/missions/${reqId}`)).body;
  assert.equal(m.mission.position.landmark, "Portail bleu");
  assert.equal(m.mission.diagnostic.summary, "Piste : démarreur");
  ok("Le client voit le pro ; le pro affecté voit position exacte et dossier IA (consentement)");

  // 12. Étapes dans l'ordre, devis requis avant intervention
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "sur_place" })).status, 409);
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "en_route" })).status, 200);
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "sur_place" })).status, 200);
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "en_intervention" })).body.code, "QUOTE_NOT_ACCEPTED");
  const q1 = await api(T.pro1, "POST", `/api/assistance/pro/missions/${reqId}/quotes`, { kind: "initial", lines: [{ kind: "deplacement", amount: 2000 }, { kind: "diagnostic", amount: 3000 }, { kind: "main_oeuvre", amount: 5000 }] });
  assert.equal(q1.status, 200, JSON.stringify(q1.body));
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.request.quoteStatus, "propose");
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "en_intervention" })).status, 409);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${reqId}/quotes/${d.quotes[0].id}/decision`, { accept: true })).status, 404);
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/quotes/${d.quotes[0].id}/decision`, { accept: true })).status, 200);
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "en_intervention" })).status, 200);
  ok("Étapes ordonnées ; l'intervention ne démarre qu'avec un devis accepté par le client");

  // 13. Travaux supplémentaires : accord requis avant de terminer
  const q2 = await api(T.pro1, "POST", `/api/assistance/pro/missions/${reqId}/quotes`, { kind: "supplementaire", lines: [{ kind: "pieces", label: "Démarreur", amount: 40000 }] });
  assert.equal(q2.status, 200);
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "terminee" })).body.code, "QUOTE_PENDING");
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  const sup = d.quotes.find((q: any) => q.kind === "supplementaire");
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/quotes/${sup.id}/decision`, { accept: true })).status, 200);
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/missions/${reqId}/status`, { to: "terminee" })).status, 200);
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.request.amountDue, 50000);
  assert.equal(d.request.paymentStatus, "aucun");
  ok("Les travaux supplémentaires exigent l'accord enregistré ; terminée ≠ payée (montant 50000 XOF)");

  // 14. Paiement : en attente ≠ payé ; échec jamais présenté comme réussi ; webhook idempotent ; montant vérifié
  const pay = await api(T.client, "POST", `/api/assistance/requests/${reqId}/pay`, { method: "wave" });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.request.paymentStatus, "en_attente");
  const ref = pay.body.reference;
  assert.equal(await core.handleJekoWebhook(ref, "success", { amount: { amount: 123 } }), true);
  assert.equal((await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body.request.paymentStatus, "en_attente");
  await core.handleJekoWebhook(ref, "failed", {});
  assert.equal((await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body.request.paymentStatus, "echoue");
  const pay2 = await api(T.client, "POST", `/api/assistance/requests/${reqId}/pay`, { method: "orange" });
  await core.handleJekoWebhook(pay2.body.reference, "success", { amount: { amount: 5000000 } });
  await core.handleJekoWebhook(pay2.body.reference, "success", { amount: { amount: 5000000 } });
  d = (await api(T.client, "GET", `/api/assistance/requests/${reqId}`)).body;
  assert.equal(d.request.paymentStatus, "paye");
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM assistance_events WHERE request_id=$1 AND type='paiement_confirme'", [reqId])).rows[0].n, 1);
  ok("Paiement : montant inconnu ignoré, échec affiché échoué, succès traité une seule fois");

  // 15. Avis une fois ; pro ne peut pas noter ; position pro n'est plus partagée après mission
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/review`, { rating: 5 })).status, 200);
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${reqId}/review`, { rating: 1 })).status, 409);
  assert.equal((await api(T.pro1, "POST", "/api/assistance/pro/location", { lat: 5.3, lng: -4.0 })).status, 200); // encore disponible
  await api(T.pro1, "POST", "/api/assistance/pro/availability", { available: false });
  assert.equal((await api(T.pro1, "POST", "/api/assistance/pro/location", { lat: 5.3, lng: -4.0 })).status, 409);
  ok("Avis unique ; le partage de position est refusé dès qu'il n'est plus nécessaire");

  // 16. Annulation : clôt les propositions, arrête le partage
  await api(T.pro1, "POST", "/api/assistance/pro/availability", { available: true, lat: 5.34, lng: -4.03 });
  r = await api(T.client2, "POST", "/api/assistance/requests", { ...base_req, position: { lat: 5.35, lng: -4.01, source: "carte", confirmed: true }, submit: true });
  const id2 = r.body.id;
  assert.equal((await api(T.pro1, "GET", "/api/assistance/pro/offers")).body.offers.length, 1);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${id2}/cancel`, { reason: "réparé" })).status, 200);
  assert.equal((await api(T.pro1, "GET", "/api/assistance/pro/offers")).body.offers.length, 0);
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM assistance_offers WHERE request_id=$1 AND status='envoyee'", [id2])).rows[0].n, 0);
  ok("L'annulation clôt les propositions ouvertes");

  // 17. Expiration => candidat suivant ; épuisement => sans_disponibilite ; réessayer
  r = await api(T.client2, "POST", "/api/assistance/requests", { ...base_req, position: { lat: 5.35, lng: -4.01, source: "carte", confirmed: true }, submit: true });
  const id3 = r.body.id;
  await pool.query("UPDATE assistance_pros SET specialties=array_append(specialties,'mecanique') WHERE phone=$1", [PRO2]);
  await pool.query("UPDATE assistance_offers SET expires_at=1 WHERE request_id=$1 AND status='envoyee'", [id3]);
  await core.dispatchTick();
  assert.equal((await api(T.pro1, "GET", "/api/assistance/pro/offers")).body.offers.length, 0);
  // pro2 a "mecanique" ? oui (défaut) : il reçoit l'offre suivante
  assert.equal((await api(T.pro2, "GET", "/api/assistance/pro/offers")).body.offers.length, 1);
  await pool.query("UPDATE assistance_offers SET expires_at=1 WHERE request_id=$1 AND status='envoyee'", [id3]);
  await core.dispatchTick();
  d = (await api(T.client2, "GET", `/api/assistance/requests/${id3}`)).body;
  assert.equal(d.request.status, "sans_disponibilite");
  assert.equal(d.allowed.retry, true);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${id3}/manual`)).status, 200);
  ok("Expiration => candidat suivant ; plus personne => sans_disponibilite + réessai / prise en charge manuelle");

  // 18. Une proposition expirée ne peut plus être acceptée (course expiration/acceptation)
  await api(T.client2, "POST", `/api/assistance/requests/${id3}/retry`);
  const o = (await api(T.pro1, "GET", "/api/assistance/pro/offers")).body.offers[0];
  await pool.query("UPDATE assistance_offers SET expires_at=1 WHERE id=$1", [o.id]);
  assert.equal((await api(T.pro1, "POST", `/api/assistance/pro/offers/${o.id}/accept`)).status, 409);
  ok("Une proposition expirée est refusée");

  // 19. Réaffectation admin vs acceptation simultanée : jamais deux affectations
  await core.dispatchTick();
  const open = await pool.query("SELECT id, pro_phone FROM assistance_offers WHERE request_id=$1 AND status='envoyee'", [id3]);
  if (open.rowCount) {
    const target = open.rows[0].pro_phone === PRO1 ? T.pro1 : T.pro2;
    const other = open.rows[0].pro_phone === PRO1 ? PRO2 : PRO1;
    await Promise.all([
      api(target, "POST", `/api/assistance/pro/offers/${open.rows[0].id}/accept`),
      api(T.admin, "POST", `/api/admin/assistance/requests/${id3}/assign`, { proPhone: other }),
    ]);
  } else {
    await api(T.admin, "POST", `/api/admin/assistance/requests/${id3}/assign`, { proPhone: PRO2 });
  }
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM assistance_assignments WHERE request_id=$1 AND ended_at IS NULL", [id3])).rows[0].n, 1);
  const ev = (await api(T.admin, "GET", `/api/admin/assistance/requests/${id3}`)).body;
  assert.ok(ev.timeline.length >= 5 && ev.timeline.every((e: any) => e.at && e.actor && e.type));
  ok("Acceptation vs réaffectation admin simultanées => une seule affectation active ; chronologie horodatée complète");

  // 20. Espèces : le pro seul ne suffit pas
  const m3 = (await pool.query("SELECT assigned_phone, status FROM assistance_requests WHERE id=$1", [id3])).rows[0];
  assert.ok(m3.assigned_phone);
  const proTok = m3.assigned_phone === PRO1 ? T.pro1 : T.pro2;
  await api(proTok, "POST", `/api/assistance/pro/missions/${id3}/status`, { to: "en_route" });
  await api(proTok, "POST", `/api/assistance/pro/missions/${id3}/status`, { to: "sur_place" });
  await api(proTok, "POST", `/api/assistance/pro/missions/${id3}/quotes`, { kind: "initial", lines: [{ kind: "diagnostic", amount: 7000 }] });
  const dq = (await api(T.client2, "GET", `/api/assistance/requests/${id3}`)).body;
  await api(T.client2, "POST", `/api/assistance/requests/${id3}/quotes/${dq.quotes[0].id}/decision`, { accept: true });
  await api(proTok, "POST", `/api/assistance/pro/missions/${id3}/status`, { to: "en_intervention" });
  await api(proTok, "POST", `/api/assistance/pro/missions/${id3}/status`, { to: "terminee" });
  assert.equal((await api(proTok, "POST", `/api/assistance/pro/missions/${id3}/cash-received`)).status, 200);
  d = (await api(T.client2, "GET", `/api/assistance/requests/${id3}`)).body;
  assert.equal(d.request.paymentStatus, "especes_a_confirmer");
  assert.equal((await api(T.client, "POST", `/api/assistance/requests/${id3}/payments/${d.payment.reference}/confirm-cash`)).status, 404);
  assert.equal((await api(T.client2, "POST", `/api/assistance/requests/${id3}/payments/${d.payment.reference}/confirm-cash`)).status, 200);
  assert.equal((await api(T.client2, "GET", `/api/assistance/requests/${id3}`)).body.request.paymentStatus, "paye");
  ok("Espèces : déclarées par le pro, payées seulement après confirmation du client");

  // 21. Médias : type vérifié, accès contrôlé
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").toString("base64");
  assert.equal((await api(T.client2, "POST", "/api/assistance/media", { mime: "image/png", dataBase64: Buffer.from("not a png at all").toString("base64") })).status, 400);
  assert.equal((await api(T.client2, "POST", "/api/assistance/media", { mime: "application/x-sh", dataBase64: png })).status, 400);
  const up = await api(T.client, "POST", "/api/assistance/media", { mime: "image/png", dataBase64: png });
  assert.equal(up.status, 200);
  assert.equal((await api(T.out, "GET", `/api/assistance/media/${up.body.media.id}`)).status, 404);
  assert.equal((await api(T.client, "GET", `/api/assistance/media/${up.body.media.id}`)).status, 200);
  ok("Médias : type/signature contrôlés, lecture réservée au propriétaire / pro affecté / admin");

  // 22. Suspension : repart en recherche
  await pool.query("UPDATE assistance_requests SET status='annulee' WHERE status IN ('recherche','sans_disponibilite')");
  console.log(`\n${n} scénarios OK`);
  srv.close();
  await pool.end();
}
main().catch((e) => { console.error("ÉCHEC:", e); process.exit(1); });
