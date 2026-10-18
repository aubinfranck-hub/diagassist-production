import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { once } from "node:events";
import { Pool } from "pg";
import { registerJekoPayments } from "../src/modules/payments/jeko.routes";
import { catchAsyncRoutes } from "../src/modules/security/runtime";

for (const durable of [false, true]) test(`signed payments: failures, replay and concurrent confirmation (${durable ? "PostgreSQL" : "development"})`,
  { skip: durable && !process.env.TEST_DATABASE_URL }, async () => {
  Object.assign(process.env, { NODE_ENV: "test", JEKO_API_KEY: "test-only", JEKO_API_KEY_ID: "test-only", JEKO_STORE_ID: "test-only", JEKO_WEBHOOK_SECRET: "test-signature-secret" });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).startsWith("https://api.jeko.africa/")) return new Response(JSON.stringify({ id: "provider-test-id", redirectUrl: "https://example.invalid/pay" }), { status: 200 });
    return nativeFetch(input, init);
  }) as typeof fetch;
  let root: Pool | undefined, pool: Pool | undefined;
  if (durable) {
    root = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await root.query("CREATE SCHEMA IF NOT EXISTS payment_tests");
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: "-c search_path=payment_tests" });
    await pool.query("DROP TABLE IF EXISTS jeko_payments; DROP TABLE IF EXISTS plans");
    await pool.query(`CREATE TABLE jeko_payments (reference TEXT PRIMARY KEY,phone TEXT,plan TEXT,amount_cents BIGINT,status TEXT,created_at BIGINT,jeko_id TEXT,kind TEXT,order_ref TEXT,confirmed_at BIGINT);
      CREATE TABLE plans (phone TEXT PRIMARY KEY,plan TEXT,activated_at BIGINT,custom_duration_ms BIGINT)`);
  }
  const app = express(); catchAsyncRoutes(app);
  app.use(express.json({ verify: (req: any, _res, buffer) => { req.rawBody = buffer; } }));
  let fail = true, activations = 0;
  registerJekoPayments(app, {
    requireAuth: (req: any, _res: any, next: any) => { req.session = { phone: "+2250000000001" }; next(); },
    requireAdminAuth: (_req: any, _res: any, next: any) => next(),
    setUserPlan: async () => { if (fail) throw new Error("simulated write failure"); },
    onPlanActivated: () => { activations++; },
    dbQuery: pool ? (sql, params) => pool!.query(sql, params) : undefined,
    dbTransaction: pool ? async work => {
      const client = await pool!.connect();
      try { await client.query("BEGIN"); const result = await work((sql, params) => client.query(sql, params));
        if (fail) throw new Error("simulated failure before commit");
        await client.query("COMMIT"); return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } : undefined,
  });
  app.use((_error: any, _req: any, res: any, _next: any) => res.status(503).json({ success: false }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const send = (path: string, body: string, signature?: string) => nativeFetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(signature ? { "jeko-signature": signature } : {}) }, body });
  try {
    const created = await send("/api/payments/jeko/create", JSON.stringify({ plan: "payg_active", paymentMethod: "wave" }));
    assert.equal(created.status, 200);
    const { reference } = await created.json();
    const payload = JSON.stringify({ reference, status: "success", transactionType: "PaymentRequest", transactionDetails: { id: "provider-test-id" }, amount: { amount: 50000 } });
    const signature = crypto.createHmac("sha256", "test-signature-secret").update(payload).digest("hex");
    assert.equal((await send("/api/payments/jeko/webhook", payload, "invalid")).status, 401);
    assert.equal((await send("/api/payments/jeko/webhook", payload, signature)).status, 503, "a failed durable activation must not be acknowledged");
    assert.equal(activations, 0);
    if (pool) {
      assert.equal((await pool.query("SELECT * FROM plans")).rows.length, 0, "transaction rolled back the activation");
      assert.equal((await pool.query("SELECT status FROM jeko_payments WHERE reference=$1", [reference])).rows[0].status, "pending");
    }
    fail = false;
    const duplicate = await Promise.all(Array.from({ length: 5 }, () => send("/api/payments/jeko/webhook", payload, signature)));
    assert.ok(duplicate.every(response => response.status === 200));
    assert.equal(activations, 1, "concurrent events activate once");
    assert.equal((await send("/api/payments/jeko/webhook", payload, signature)).status, 200);
    assert.equal(activations, 1, "replayed events do not extend the subscription");
    if (pool) assert.equal((await pool.query("SELECT * FROM plans")).rows.length, 1);
  } finally {
    globalThis.fetch = nativeFetch; server.closeAllConnections(); server.close();
    await pool?.end(); await root?.end();
  }
});
