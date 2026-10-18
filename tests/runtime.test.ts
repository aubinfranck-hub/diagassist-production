import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { normalizePhone, sessionIsValid, SESSION_MAX_AGE_MS, catchAsyncRoutes } from "../src/modules/security/runtime";
import { XMLParser } from "fast-xml-parser";

test("phone aliases have one identity and malformed values are rejected", () => {
  assert.equal(normalizePhone("07 00-00.00(01)"), "+2250700000001");
  assert.equal(normalizePhone("+2250700000001"), "+2250700000001");
  assert.throws(() => normalizePhone({ phone: "0700000001" }));
  assert.throws(() => normalizePhone("0700000001", "+225evil"));
});
test("session expiry is enforced while the process remains running", () => {
  assert.equal(sessionIsValid({ createdAt: 100 }, 100 + SESSION_MAX_AGE_MS - 1), true);
  assert.equal(sessionIsValid({ createdAt: 100 }, 100 + SESSION_MAX_AGE_MS), false);
  assert.equal(sessionIsValid(undefined), false);
});
test("Express rejected async handlers return a controlled response", async () => {
  const app = express(); catchAsyncRoutes(app);
  app.get("/failure", async () => { throw new Error("simulated database failure"); });
  app.use((_error: any, _req: any, res: any, _next: any) => res.status(503).json({ success: false }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    const port = (server.address() as any).port;
    assert.equal((await fetch(`http://127.0.0.1:${port}/failure`)).status, 503);
  } finally { server.closeAllConnections(); server.close(); }
});
test("updated XML parser preserves vehicle feed arrays", () => {
  const parser = new XMLParser({ ignoreAttributes: true, isArray: name => ["brand", "model", "generation", "modification"].includes(name) });
  const result = parser.parse("<brands><brand><name>Toyota</name><models><model><name>Corolla</name></model></models></brand></brands>");
  assert.equal(result.brands.brand[0].models.model[0].name, "Corolla");
});
