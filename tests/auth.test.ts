import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";

test("account takeover regression, session revocation and API errors", async () => {
  const listener = net.createServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = (listener.address() as any).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const child = spawn(process.execPath, ["dist/server.cjs"], {
    env: { ...process.env, NODE_ENV: "test", PORT: String(port), DATABASE_URL: process.env.TEST_DATABASE_URL || "",
      ADMIN_SEED_PHONE: "+2250000000000", ADMIN_SEED_PASSWORD: "LocalTest_Only_123", ADMIN_SECRET: "local-test-admin-only",
      TWILIO_ACCOUNT_SID: "", TWILIO_AUTH_TOKEN: "", SMTP_USER: "", SMTP_APP_PASSWORD: "", GEMINI_API_KEY: "", ELEVENLABS_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = ""; child.stdout.on("data", data => { logs += data; }); child.stderr.on("data", data => { logs += data; });
  const base = `http://127.0.0.1:${port}`;
  const request = async (path: string, body?: any, token?: string) => {
    const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const register = async (phone: string, password: string) => {
    const captcha = await request("/api/auth/captcha", {});
    const answer = (captcha.body.question.match(/\d+/g) || []).reduce((n: number, v: string) => n + Number(v), 0);
    return request("/api/auth/register", { phoneNumber: phone, password, captchaId: captcha.body.captchaId, captchaAnswer: answer });
  };
  try {
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(logs);
      try { if ((await request("/api/health")).status === 200) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const suffix = String(Date.now()).slice(-8);
    const phone = `07${suffix}`;
    const registrations = await Promise.all([register(phone, "Original_Only_123"), register(phone, "Original_Only_123")]);
    assert.deepEqual(registrations.map(r => r.status).sort(), [200,409], "concurrent registrations cannot overwrite one another");
    const created = registrations.find(r => r.status === 200)!;
    const overwritten = await register(phone, "Changed_Only_123");
    assert.equal(overwritten.status, 409);
    const alias = await register(`+225${phone}`, "Changed_Only_123");
    assert.equal(alias.status, 409, "full international aliases must not bypass duplicate protection");
    assert.equal((await request("/api/auth/login", { phoneNumber: phone, password: "Changed_Only_123" })).status, 401);
    const login = await request("/api/auth/login", { phoneNumber: phone, password: "Original_Only_123" });
    assert.equal(login.status, 200);
    const token = login.body.sessionToken;
    assert.equal((await request("/api/user/status", undefined, token)).status, 200);
    assert.equal((await request("/api/auth/logout", {}, token)).status, 200);
    assert.equal((await request("/api/user/status", undefined, token)).status, 401);
    const second = await request("/api/auth/login", { phoneNumber: phone, password: "Original_Only_123" });
    assert.equal((await request("/api/user/change-password", { currentPassword: "Original_Only_123", newPassword: "Fresh_Only_123" }, second.body.sessionToken)).status, 200);
    assert.equal((await request("/api/user/status", undefined, second.body.sessionToken)).status, 401);
    assert.equal((await request("/api/not-a-route")).status, 404);
    assert.equal((await request("/api/admin/accounts")).status, 401);
    assert.equal((await request("/api/diagnose", {})).status, 401);
    if (process.env.TEST_DATABASE_URL) assert.equal((await request("/api/ready")).status, 200);
    else assert.equal((await request("/api/ready")).status, 503);
  } finally { child.kill("SIGTERM"); await once(child, "exit"); }
});

test("production refuses to start without durable storage", async () => {
  const child = spawn(process.execPath, ["dist/server.cjs"], { env: { ...process.env, NODE_ENV: "production", DATABASE_URL: "" }, stdio: "ignore" });
  const [code] = await once(child, "exit"); assert.equal(code, 1);
});
