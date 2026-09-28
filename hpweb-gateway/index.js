import express from "express";
import rateLimit from "express-rate-limit";
import { chromium } from "playwright";

const app = express();
app.use(express.json({ limit: "64kb" }));

const PORT = Number(process.env.PORT || 10000);
const HP_WEB_URL = process.env.HP_WEB_URL || "https://hp-web.in";
const USERNAME = process.env.HP_WEB_USERNAME || "";
const PASSWORD = process.env.HP_WEB_PASSWORD || "";
const API_KEY = process.env.HP_WEB_GATEWAY_API_KEY || "";
const TIMEOUT = Number(process.env.HP_WEB_TIMEOUT_MS || 12000);
const CACHE_TTL = Number(process.env.HP_WEB_CACHE_TTL_MS || 15 * 60 * 1000);

const cache = new Map();
let browserPromise = null;
let context = null;
let page = null;
let lastLoginAt = 0;

const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
app.use("/vehicle", limiter);

function authorized(req) {
  return !API_KEY || req.get("x-api-key") === API_KEY;
}

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function queryKey(q) {
  return JSON.stringify(Object.entries(q).filter(([,v]) => normalize(v)).sort());
}

function validateQuery(q) {
  return ["vin","make","model","year","engine","q"].some(k => normalize(q?.[k]));
}

async function ensureBrowser() {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true });
  const browser = await browserPromise;
  if (!context) {
    context = await browser.newContext({ locale: "fr-FR" });
    context.setDefaultTimeout(TIMEOUT);
  }
  if (!page || page.isClosed()) page = await context.newPage();
  return page;
}

async function loginIfNeeded() {
  const p = await ensureBrowser();
  if (!USERNAME || !PASSWORD) throw new Error("HP-Web credentials are not configured");

  const current = p.url();
  if (current.startsWith(HP_WEB_URL) && !/login|signin|connexion/i.test(current) && lastLoginAt) return p;

  console.log(`[HP-Web] Opening ${HP_WEB_URL}`);
  await p.goto(HP_WEB_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
  console.log(`[HP-Web] Login page URL=${p.url()} title=${await p.title().catch(() => "")}`);
  await p.waitForTimeout(500);

  const user = p.locator('input[type="email"], input[name*="user" i], input[name*="login" i], input[autocomplete="username"]').first();
  const pass = p.locator('input[type="password"], input[autocomplete="current-password"]').first();

  if (await user.count() && await pass.count()) {
    await user.fill(USERNAME);
    await pass.fill(PASSWORD);
    const submit = p.locator('button[type="submit"], input[type="submit"], button:has-text("Connexion"), button:has-text("Login"), button:has-text("Sign in")').first();
    if (await submit.count()) await submit.click();
    else await pass.press("Enter");
    await p.waitForLoadState("domcontentloaded").catch(() => {});
    await p.waitForTimeout(800);
  }

  console.log(`[HP-Web] After login URL=${p.url()} title=${await p.title().catch(() => "")}`);
  if (/login|signin|connexion/i.test(p.url())) {
    throw new Error("HP-Web login could not be completed; selectors need discovery");
  }
  lastLoginAt = Date.now();
  return p;
}

async function searchByDom(query) {
  const p = await loginIfNeeded();

  // Keep the gateway business-specific. It never exposes arbitrary URLs.
  const searchText = [query.vin, query.make, query.model, query.year, query.engine, query.q]
    .map(normalize).filter(Boolean).join(" ");

  console.log(`[HP-Web] Search page URL=${p.url()} title=${await p.title().catch(() => "")}`);
  const inputs = p.locator('input:not([type="password"]), textarea').filter({ visible: true });
  const count = await inputs.count();
  let searchInput = null;
  for (let i = 0; i < Math.min(count, 30); i++) {
    const el = inputs.nth(i);
    const meta = [
      await el.getAttribute("placeholder"),
      await el.getAttribute("name"),
      await el.getAttribute("aria-label")
    ].filter(Boolean).join(" ");
    if (/vin|vehicle|véhicule|marque|modèle|model|search|recherche|immatric|moteur/i.test(meta)) {
      searchInput = el;
      break;
    }
  }
  if (!searchInput && count) searchInput = inputs.nth(0);
  if (!searchInput) throw new Error("HP-Web search field not discovered");
  console.log(`[HP-Web] Search input discovered for query=${searchText}`);

  await searchInput.fill(searchText);
  await searchInput.press("Enter").catch(() => {});
  await p.waitForTimeout(900);

  const bodyText = (await p.locator("body").innerText()).slice(0, 20000);
  return [{
    source: "hp_web",
    retrievedAt: new Date().toISOString(),
    make: query.make || "",
    model: query.model || "",
    year: query.year || "",
    engine: query.engine || "",
    vin: query.vin || "",
    technicalData: { rawResultPreview: bodyText }
  }];
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "diagassist-hpweb-gateway", configured: Boolean(USERNAME && PASSWORD) });
});

app.post("/vehicle/search", async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ success: false, error: "Unauthorized" });

  const query = {
    vin: normalize(req.body?.vin),
    make: normalize(req.body?.make),
    model: normalize(req.body?.model),
    year: normalize(req.body?.year),
    engine: normalize(req.body?.engine),
    q: normalize(req.body?.q)
  };

  if (!validateQuery(query)) return res.status(400).json({ success: false, error: "At least one vehicle search criterion is required" });

  const key = queryKey(query);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return res.json({ success: true, cached: true, results: hit.results });

  try {
    const results = await searchByDom(query);
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL, results });
    return res.json({ success: true, cached: false, results });
  } catch (error) {
    page = null;
    return res.status(502).json({
      success: false,
      error: "HP-Web search unavailable",
      detail: process.env.NODE_ENV === "production" ? undefined : String(error?.message || error)
    });
  }
});

process.on("SIGTERM", async () => {
  try { await (await browserPromise)?.close(); } catch {}
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`HP-Web gateway listening on ${PORT}`);
});
