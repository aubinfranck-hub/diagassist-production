import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { CreditStore, sanitizeCreditSettings, DEFAULT_CREDIT_SETTINGS } from "../src/modules/credits/core";
import { registerCredits, isCreditPlan } from "../src/modules/credits/routes";
import { catchAsyncRoutes } from "../src/modules/security/runtime";

test("free diagnostics first, then purchased ones, never below zero (even concurrently)", async () => {
  const store = new CreditStore();
  await store.addPaid("u", 2);
  const results = await Promise.all(Array.from({ length: 20 }, () => store.consume("u", 3)));
  assert.equal(results.filter(r => r === "free").length, 3);
  assert.equal(results.filter(r => r === "paid").length, 2);
  assert.equal(results.filter(r => r === null).length, 15);
  assert.equal((await store.balance("u", 3)).total, 0);
});

test("refund gives the diagnostic back to the right pool", async () => {
  const store = new CreditStore();
  assert.equal(await store.consume("u", 1), "free");
  await store.refund("u", "free");
  assert.equal((await store.balance("u", 1)).freeRemaining, 1);
  await store.addPaid("u", 1);
  await store.consume("u", 0);
  await store.refund("u", "paid");
  assert.equal((await store.balance("u", 0)).paidBalance, 1);
});

test("settings are validated", () => {
  assert.deepEqual(sanitizeCreditSettings(DEFAULT_CREDIT_SETTINGS).packs.length, 3);
  assert.throws(() => sanitizeCreditSettings({ freeCount: -1, packs: [] }));
  assert.throws(() => sanitizeCreditSettings({ freeCount: 3, packs: [{ label: "x", credits: 0, priceXof: 1000 }] }));
  assert.throws(() => sanitizeCreditSettings({ freeCount: 3, packs: [{ label: "x", credits: 5, priceXof: 5 }] }));
  assert.ok(isCreditPlan("free_trial") && isCreditPlan("free_expired") && !isCreditPlan("lite") && !isCreditPlan("premium"));
});

test("purchase flow: server-side price, webhook credits once, replay and wrong amount ignored", async () => {
  const app = express(); catchAsyncRoutes(app); app.use(express.json());
  let created: any = null;
  const credits = await registerCredits(app, {
    requireAuth: (req: any, _res: any, next: any) => { req.session = { phone: "0700000001", plan: "free_trial" }; next(); },
    requireAdminAuth: (_req: any, _res: any, next: any) => next(),
    accountExists: (p: string) => p === "0700000001",
    getOrigin: () => "https://example.test",
    jeko: { isConfigured: () => true, create: async p => { created = p; return { id: "jeko-1", redirectUrl: "https://pay.test/x" }; }, fetchStatus: async () => "pending" },
  });
  const server = app.listen(0); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (path: string, method = "GET", body?: any) => (await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json() as Promise<any>;
  try {
    // le prix envoyé par l'application est ignoré
    const buy = await call("/api/credits/buy", "POST", { packId: "pack-5", paymentMethod: "wave", priceXof: 1 });
    assert.equal(created.amountXof, 1000);
    assert.ok(buy.reference.startsWith("dgcr-"));
    assert.equal((await call("/api/credits/buy", "POST", { packId: "inconnu", paymentMethod: "wave" })).success, false);

    assert.equal(await credits.webhook(buy.reference, "success", { amount: { amount: 5 } }), true); // mauvais montant
    assert.equal((await call("/api/credits")).paidBalance, 0);
    const ok = { amount: { amount: 100000 }, transactionDetails: { id: "jeko-1" } };
    await Promise.all([credits.webhook(buy.reference, "success", ok), credits.webhook(buy.reference, "success", ok)]);
    await credits.webhook(buy.reference, "success", ok);
    const after = await call("/api/credits");
    assert.equal(after.paidBalance, 5);
    assert.equal(after.freeRemaining, 3);
    assert.equal((await call(`/api/credits/status/${buy.reference}`)).status, "paye");
    assert.equal(await credits.webhook("dgcr-inconnu", "success", {}), false);

    // décompte : 3 gratuits + 5 achetés, puis refus
    for (let i = 0; i < 8; i++) assert.equal((await credits.charge("0700000001", "free_trial")).allowed, true);
    assert.equal((await credits.charge("0700000001", "free_trial")).allowed, false);
    assert.equal((await credits.charge("0700000001", "premium")).allowed, true); // abonné : non décompté ici
    assert.equal(await credits.canFollowUp("0700000001", "free_trial"), true); // vient d'en lancer un
    // l'admin change les réglages
    assert.equal((await call("/api/admin/credits/settings", "PUT", { freeCount: 0, packs: [] })).settings.freeCount, 0);
    assert.equal((await call("/api/admin/credits/grant", "POST", { phone: "0700000001", credits: 2 })).balance.paidBalance, 2);
    assert.equal((await call("/api/admin/credits/grant", "POST", { phone: "inconnu", credits: 2 })).success, false);
  } finally { server.close(); }
});
