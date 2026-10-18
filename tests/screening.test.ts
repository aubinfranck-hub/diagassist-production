import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { once } from "node:events";
import { registerScreening } from "../src/modules/screening/screening.routes";
import { catchAsyncRoutes } from "../src/modules/security/runtime";

test("coaching normalizes session IDs and rejects a non-premium coach before assignment", async () => {
  const app = express(); catchAsyncRoutes(app); app.use(express.json());
  const server = http.createServer(app);
  let plan = "premium";
  registerScreening(app, server, {
    requireAuth: (req: any, _res: any, next: any) => { req.session = { phone: "+2250000000001" }; next(); },
    getEffectivePlan: () => plan,
    sessions: new Map(),
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const created = await fetch(base + "/api/screening/sessions", { method: "POST" });
    const { sessionId } = await created.json(); assert.ok(sessionId);
    const detail = await fetch(base + "/api/screening/sessions/" + sessionId.toUpperCase());
    assert.equal(detail.status, 200, "uppercase codes work without relying on the database fallback");
    plan = "free_trial";
    assert.equal((await fetch(base + `/api/screening/sessions/${sessionId}/join-coach`, { method: "POST" })).status, 403);
    plan = "premium";
    const after = await (await fetch(base + "/api/screening/sessions/" + sessionId)).json();
    assert.equal(after.session.coachPhone, undefined, "rejected join does not reserve a coach slot");
    const attempts = [];
    for (let i = 0; i < 13; i++) attempts.push((await fetch(base + "/api/screening/pair-by-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"pairingCode":"000000"}' })).status);
    assert.ok(attempts.includes(429));
  } finally { server.closeAllConnections(); server.close(); }
});
