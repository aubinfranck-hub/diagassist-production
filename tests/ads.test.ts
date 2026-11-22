import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { Pool } from "pg";
import { registerLocalAds } from "../src/modules/ads/ads.routes";

// 1 pixel PNG valide
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("publicité locale : emplacements, image, vues/clics, paiement Jèko", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const root = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await root.query("DROP SCHEMA IF EXISTS ads_tests CASCADE; CREATE SCHEMA ads_tests");
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: "-c search_path=ads_tests" });
  const app = express();
  app.use(express.json());
  let adminOk = true;
  const ads = registerLocalAds({
    app, pool,
    requireAdminAuth: (_req: any, res: any, next: any) => (adminOk ? next() : res.status(401).json({ success: false })),
    jeko: {
      isConfigured: () => true,
      create: async (p) => ({ id: `jeko-${p.reference}`, redirectUrl: `https://pay.example/${p.reference}` }),
      fetchStatus: async () => "success",
    },
    getOrigin: () => "https://diag.test",
  });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const j = async (path: string, method = "GET", body?: any) => {
    const r = await fetch(base + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
    return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
  };
  try {
    // Aucun accès sans admin, et aucune annonce au départ
    adminOk = false;
    assert.equal((await j("/api/admin/ads")).status, 401);
    adminOk = true;
    assert.equal((await j("/api/pub/ads?slot=blog_haut")).body.ad, null);
    const overview = (await j("/api/admin/ads")).body;
    assert.deepEqual(overview.slots.map((s: any) => s.id).sort(), ["accueil", "blog_bas", "blog_haut"]);

    // Validation
    assert.equal((await j("/api/admin/ads/campaigns", "POST", { slotId: "blog_haut", advertiser: "Pneus Abidjan", linkUrl: "javascript:alert(1)", durationDays: 30 })).status, 400);
    assert.equal((await j("/api/admin/ads/campaigns", "POST", { slotId: "blog_haut", advertiser: "Pneus Abidjan", linkUrl: "http://exemple.ci", durationDays: 30 })).status, 400);
    assert.equal((await j("/api/admin/ads/campaigns", "POST", { slotId: "blog_haut", advertiser: "Pneus Abidjan", linkUrl: "https://exemple.ci", durationDays: 5 })).status, 400);
    assert.equal((await j("/api/admin/ads/slots/blog_haut", "PUT", { price30: -5 })).status, 400);
    assert.equal((await j("/api/admin/ads/slots/blog_haut", "PUT", { price30: 20000 })).status, 200);

    const created = (await j("/api/admin/ads/campaigns", "POST", { slotId: "blog_haut", advertiser: "Pneus Abidjan", phone: "0102030405", linkUrl: "https://exemple.ci/pneus", durationDays: 30 })).body;
    assert.ok(created.id);
    assert.equal((await j("/api/admin/ads")).body.campaigns[0].amount, 20000, "le prix vient de la grille");

    // Pas d'image : impossible d'activer ; image invalide refusée
    assert.equal((await j(`/api/admin/ads/campaigns/${created.id}/activate`, "POST")).status, 400);
    const put = (buf: Buffer, type: string) => fetch(`${base}/api/admin/ads/campaigns/${created.id}/image`, { method: "PUT", headers: { "Content-Type": type }, body: buf });
    assert.equal((await put(Buffer.from("<svg onload=alert(1)>"), "image/svg+xml")).status, 400);
    assert.equal((await put(Buffer.from("pas une image"), "image/png")).status, 400);
    assert.equal((await put(Buffer.alloc(600 * 1024, 1), "image/png")).status >= 400, true);
    assert.equal((await put(PNG, "image/png")).status, 200);

    // Tant que non payée/activée : invisible
    assert.equal((await j("/api/pub/ads?slot=blog_haut")).body.ad, null);
    assert.equal((await fetch(`${base}/api/pub/ads/${created.id}/image`)).status, 404);

    // Activation manuelle (payé hors ligne)
    assert.equal((await j(`/api/admin/ads/campaigns/${created.id}/activate`, "POST")).status, 200);
    const shown = (await j("/api/pub/ads?slot=blog_haut")).body.ad;
    assert.equal(shown.id, created.id);
    assert.equal((await j("/api/pub/ads?slot=accueil")).body.ad, null, "autre emplacement : rien");
    const img = await fetch(base + shown.imageUrl);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);

    // Vues/clics : un rechargement immédiat ne double pas le compteur
    await j("/api/pub/ads?slot=blog_haut");
    const go = await j(shown.goUrl);
    assert.equal(go.status, 302);
    assert.equal(go.headers.get("location"), "https://exemple.ci/pneus");
    await j(shown.goUrl);
    const c1 = (await j("/api/admin/ads")).body.campaigns[0];
    assert.equal(c1.views, 1);
    assert.equal(c1.clicks, 1);
    assert.equal(c1.effectiveStatus, "active");

    // Pause : disparaît ; reprise : revient
    await j(`/api/admin/ads/campaigns/${created.id}/pause`, "POST");
    assert.equal((await j("/api/pub/ads?slot=blog_haut")).body.ad, null);
    assert.equal((await j(shown.goUrl)).headers.get("location"), "/");
    await j(`/api/admin/ads/campaigns/${created.id}/resume`, "POST");
    assert.equal((await j("/api/pub/ads?slot=blog_haut")).body.ad.id, created.id);

    // Emplacement fermé : plus d'affichage
    await j("/api/admin/ads/slots/blog_haut", "PUT", { active: false });
    assert.equal((await j("/api/pub/ads?slot=blog_haut")).body.ad, null);
    await j("/api/admin/ads/slots/blog_haut", "PUT", { active: true });

    // Expiration
    await pool.query("UPDATE ad_campaigns SET ends_at = $2 WHERE id = $1", [created.id, Date.now() - 1000]);
    assert.equal((await j("/api/pub/ads?slot=blog_haut")).body.ad, null);
    assert.equal((await j("/api/admin/ads")).body.campaigns[0].effectiveStatus, "terminee");

    // Paiement Jèko : lien, webhook montant erroné ignoré, bon montant active, rejeu sans effet
    const c2 = (await j("/api/admin/ads/campaigns", "POST", { slotId: "blog_bas", advertiser: "Huiles Moteur CI", linkUrl: "https://huiles.ci", durationDays: 7 })).body;
    await fetch(`${base}/api/admin/ads/campaigns/${c2.id}/image`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: PNG });
    assert.equal((await j(`/api/admin/ads/campaigns/${c2.id}/pay-link`, "POST", { method: "carte" })).status, 400);
    const link = (await j(`/api/admin/ads/campaigns/${c2.id}/pay-link`, "POST", { method: "wave" })).body;
    assert.match(link.redirectUrl, /^https:\/\/pay\.example\/dgad-/);
    const ref = link.redirectUrl.split("/").pop();
    assert.equal(await ads.onExternalWebhook(ref, "success", { amount: { amount: 1 } }), true);
    assert.equal((await j("/api/pub/ads?slot=blog_bas")).body.ad, null, "montant erroné : pas d'activation");
    assert.equal(await ads.onExternalWebhook("dgad-inconnu", "success", {}), false);
    assert.equal(await ads.onExternalWebhook(ref, "success", { amount: { amount: 3000 * 100 }, transactionDetails: { id: `jeko-${ref}` } }), true);
    const live = (await j("/api/pub/ads?slot=blog_bas")).body.ad;
    assert.equal(live.id, c2.id);
    const endsAt = (await j("/api/admin/ads")).body.campaigns.find((c: any) => c.id === c2.id).endsAt;
    await ads.onExternalWebhook(ref, "success", { amount: { amount: 3000 * 100 } });
    assert.equal((await j("/api/admin/ads")).body.campaigns.find((c: any) => c.id === c2.id).endsAt, endsAt, "rejeu : pas de prolongation");
    assert.equal((await j(`/api/admin/ads/campaigns/${c2.id}/pay-link`, "POST", { method: "wave" })).status, 409, "déjà payée");

    // Suppression
    assert.equal((await j(`/api/admin/ads/campaigns/${c2.id}`, "DELETE")).status, 200);
    assert.equal((await j("/api/pub/ads?slot=blog_bas")).body.ad, null);
  } finally {
    server.close();
    await pool.end();
    await root.query("DROP SCHEMA IF EXISTS ads_tests CASCADE");
    await root.end();
  }
});
