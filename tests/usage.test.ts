import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { UsageStore } from "../src/modules/security/usageStore";

async function checkLimits(store: UsageStore) {
  const results = await Promise.all(Array.from({ length: 20 }, () => store.consume("user", "diagnosis", 100, 1, 3)));
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(await store.used("user", "diagnosis", 100), 3);
  assert.equal(await store.consume("user", "diagnosis", 200, 1, 3), true);
  assert.equal(await store.consume("user", "diagnosis", 100, 1, 3), false, "stale requests cannot reset a newer budget");
  await store.refund("user", "diagnosis", 100, 10);
  assert.equal(await store.used("user", "diagnosis", 200), 1, "old refunds cannot modify a newer period");
  await store.refund("user", "diagnosis", 200, 1);
  assert.equal(await store.used("user", "diagnosis", 200), 0);
}
test("concurrent budgets and refunds in isolated development", async () => checkLimits(new UsageStore()));
test("PostgreSQL atomic quotas survive store recreation", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const root = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await root.query("CREATE SCHEMA IF NOT EXISTS usage_tests");
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: "-c search_path=usage_tests" });
  try {
    await pool.query("DROP TABLE IF EXISTS usage_counters");
    await pool.query("CREATE TABLE usage_counters (phone TEXT,bucket TEXT,period_start BIGINT,used BIGINT,PRIMARY KEY(phone,bucket))");
    const query = (sql: string, params?: any[]) => pool.query(sql, params);
    await checkLimits(new UsageStore(query));
    const first = new UsageStore(query);
    await first.consume("durable", "live_ms", 100, 50, 100);
    assert.equal(await new UsageStore(query).used("durable", "live_ms", 100), 50);
  } finally { await pool.end(); await root.end(); }
});
