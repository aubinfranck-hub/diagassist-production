import express from "express";
import rateLimit from "express-rate-limit";
import { chromium } from "playwright";

const app = express();
app.set("trust proxy", 1);
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

function isLoginUrl(url) {
  try { return /login|signin|connexion/i.test(new URL(url).pathname); } catch { return false; }
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
  if (current.startsWith(HP_WEB_URL) && !isLoginUrl(current) && lastLoginAt) return p;

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
  await logDiscovery(p, "after-login");
  if (isLoginUrl(p.url())) {
    throw new Error("HP-Web login could not be completed; selectors need discovery");
  }
  lastLoginAt = Date.now();
  return p;
}


// Découverte de l'UI HP-Web : journalise la structure visible (jamais de valeurs saisies)
// pour pouvoir écrire des sélecteurs fiables sans capture d'écran.
async function logDiscovery(p, label) {
  try {
    const info = await p.evaluate(() => {
      const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const attrs = (el) => ({
        id: el.id || "", name: el.getAttribute("name") || "", type: el.getAttribute("type") || "",
        placeholder: el.getAttribute("placeholder") || "", aria: el.getAttribute("aria-label") || ""
      });
      return {
        inputs: [...document.querySelectorAll("input:not([type=password]):not([type=hidden]), textarea")].filter(vis).slice(0, 25).map(attrs),
        selects: [...document.querySelectorAll("select")].filter(vis).slice(0, 15).map((el) => ({
          ...attrs(el), options: [...el.options].length, sample: [...el.options].slice(0, 8).map((o) => o.text.trim())
        })),
        buttons: [...document.querySelectorAll("button, [role=button], input[type=submit]")].filter(vis).slice(0, 25).map((el) => (el.innerText || el.value || "").trim().slice(0, 40)),
        links: [...document.querySelectorAll("a")].filter(vis).slice(0, 30).map((el) => (el.innerText || "").trim().slice(0, 40)).filter(Boolean)
      };
    });
    console.log(`[HP-Web][discovery:${label}] url=${p.url()} ${JSON.stringify(info)}`);
  } catch (e) {
    console.log(`[HP-Web][discovery:${label}] failed: ${e?.message || e}`);
  }
}

// Si HP-Web utilise des listes déroulantes (marque > modèle > année > moteur), les remplit
// par libellé. Retourne le nombre de listes renseignées.
async function fillSelects(p, query) {
  const wanted = [
    ["make", query.make, /marque|make|brand|constructeur/i],
    ["model", query.model, /mod[eè]le|model/i],
    ["year", query.year, /ann[ée]e|year/i],
    ["engine", query.engine, /moteur|engine|motor/i]
  ];
  let filled = 0;
  for (const [field, value, re] of wanted) {
    if (!value) continue;
    const selects = p.locator("select").filter({ visible: true });
    const n = await selects.count();
    for (let i = 0; i < n; i++) {
      const el = selects.nth(i);
      const meta = [await el.getAttribute("id"), await el.getAttribute("name"), await el.getAttribute("aria-label")].filter(Boolean).join(" ");
      if (!re.test(meta)) continue;
      const labels = await el.locator("option").allInnerTexts();
      const target = labels.find((l) => l.trim().toLowerCase() === String(value).trim().toLowerCase())
        || labels.find((l) => l.toLowerCase().includes(String(value).trim().toLowerCase()));
      if (target) {
        await el.selectOption({ label: target });
        await p.waitForTimeout(600); // la liste suivante se charge souvent après le choix
        filled++;
        console.log(`[HP-Web] select ${field} -> ${target.trim()}`);
      } else {
        console.log(`[HP-Web] select ${field}: aucune option pour "${value}"`);
      }
      break;
    }
  }
  return filled;
}

async function searchByDom(query) {
  const p = await loginIfNeeded();

  // Keep the gateway business-specific. It never exposes arbitrary URLs.
  const searchText = [query.vin, query.make, query.model, query.year, query.engine, query.q]
    .map(normalize).filter(Boolean).join(" ");

  console.log(`[HP-Web] Search page URL=${p.url()} title=${await p.title().catch(() => "")}`);
  await logDiscovery(p, "search-page");

  // 1) Listes déroulantes marque/modèle/année/moteur si le site en propose.
  const filledSelects = await fillSelects(p, query);

  // 2) Sinon (ou en complément pour le VIN / recherche libre), champ texte.
  const textQuery = filledSelects ? [query.vin, query.q].map(normalize).filter(Boolean).join(" ") : searchText;
  if (textQuery) {
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
    if (!searchInput && !filledSelects) throw new Error("HP-Web search field not discovered");
    if (searchInput) {
      await searchInput.fill(textQuery);
      await searchInput.press("Enter").catch(() => {});
    }
  } else {
    const go = p.locator('button[type="submit"], input[type="submit"], button:has-text("Rechercher"), button:has-text("Search")').first();
    if (await go.count()) await go.click().catch(() => {});
  }
  console.log(`[HP-Web] Search submitted query="${searchText}" selects=${filledSelects}`);
  await p.waitForLoadState("domcontentloaded").catch(() => {});
  await p.waitForTimeout(900);
  await logDiscovery(p, "results-page");

  const bodyText = (await p.locator("body").innerText()).slice(0, 20000);
  return [{
    source: "hp_web",
    retrievedAt: new Date().toISOString(),
    make: query.make || "",
    model: query.model || "",
    year: query.year || "",
    engine: query.engine || "",
    vin: query.vin || "",
    confirmed: false, // extraction structurée à venir : les champs ci-dessus reprennent la requête
    technicalData: { rawResultPreview: bodyText }
  }];
}


// ───────────── Navigation pilotée par l'agent (copilote vocal HP-Web) ─────────────
// L'agent ne reçoit jamais d'URL arbitraire : il ne peut que lire la page courante et agir
// sur ses éléments interactifs, numérotés à chaque instantané (ref).
app.use("/nav", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

async function snapshot(p) {
  await p.waitForLoadState("domcontentloaded").catch(() => {});
  const data = await p.evaluate(() => {
    document.querySelectorAll("[data-dx]").forEach((el) => el.removeAttribute("data-dx"));
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
    };
    const label = (el) => (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || el.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const els = [...document.querySelectorAll("a[href], button, [role=button], [role=tab], [role=menuitem], input:not([type=hidden]):not([type=password]), select, textarea, summary")]
      .filter(vis).slice(0, 120);
    const elements = els.map((el, i) => {
      el.setAttribute("data-dx", String(i));
      const tag = el.tagName.toLowerCase();
      const kind = tag === "select" ? "select" : (tag === "input" || tag === "textarea") ? "champ" : tag === "a" ? "lien" : "bouton";
      const out = { ref: i, kind, label: label(el) };
      if (tag === "select") out.options = [...el.options].slice(0, 40).map((o) => o.text.trim());
      return out;
    });
    return { url: location.href, title: document.title, text: (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 6000), elements };
  });
  return data;
}

async function withPage(req, res, fn) {
  if (!authorized(req)) return res.status(401).json({ success: false, error: "Unauthorized" });
  try {
    const p = await loginIfNeeded();
    const out = await fn(p);
    return res.json({ success: true, ...out });
  } catch (error) {
    console.error("[HP-Web][nav] échec:", error?.stack || error?.message || error);
    return res.status(502).json({ success: false, error: "HP-Web navigation unavailable", detail: String(error?.message || error).slice(0, 300) });
  }
}

const target = (p, ref) => p.locator(`[data-dx="${Number(ref)}"]`).first();

app.post("/nav/open", (req, res) => withPage(req, res, async (p) => ({ page: await snapshot(p) })));
app.post("/nav/snapshot", (req, res) => withPage(req, res, async (p) => ({ page: await snapshot(p) })));

app.post("/nav/click", (req, res) => withPage(req, res, async (p) => {
  const el = target(p, req.body?.ref);
  if (!(await el.count())) throw new Error("Élément introuvable : refaire un instantané");
  console.log(`[HP-Web][nav] click ref=${req.body.ref}`);
  await el.click();
  await p.waitForTimeout(900);
  return { page: await snapshot(p) };
}));

app.post("/nav/type", (req, res) => withPage(req, res, async (p) => {
  const el = target(p, req.body?.ref);
  if (!(await el.count())) throw new Error("Champ introuvable : refaire un instantané");
  console.log(`[HP-Web][nav] type ref=${req.body.ref} submit=${!!req.body.submit}`);
  await el.fill(normalize(req.body?.text).slice(0, 200));
  if (req.body?.submit) await el.press("Enter");
  await p.waitForTimeout(900);
  return { page: await snapshot(p) };
}));

app.post("/nav/select", (req, res) => withPage(req, res, async (p) => {
  const el = target(p, req.body?.ref);
  if (!(await el.count())) throw new Error("Liste introuvable : refaire un instantané");
  const wanted = normalize(req.body?.label).toLowerCase();
  const labels = await el.locator("option").allInnerTexts();
  const hit = labels.find((l) => l.trim().toLowerCase() === wanted) || labels.find((l) => l.toLowerCase().includes(wanted));
  if (!hit) throw new Error(`Option introuvable : ${wanted}`);
  console.log(`[HP-Web][nav] select ref=${req.body.ref} -> ${hit.trim()}`);
  await el.selectOption({ label: hit });
  await p.waitForTimeout(900);
  return { page: await snapshot(p) };
}));

app.post("/nav/back", (req, res) => withPage(req, res, async (p) => {
  await p.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
  await p.waitForTimeout(600);
  return { page: await snapshot(p) };
}));

// Capture de la vraie page HP-Web, pour l'afficher à l'utilisateur.
app.get("/nav/screenshot", (req, res) => withPage(req, res, async (p) => {
  const buf = await p.screenshot({ type: "jpeg", quality: 60 });
  return { mime: "image/jpeg", url: p.url(), image: buf.toString("base64") };
}));

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
    console.error("[HP-Web] Recherche échouée:", error?.stack || error?.message || error);
    // Repart de zéro au prochain appel (un lancement de navigateur raté ne doit pas rester en cache).
    page = null;
    context = null;
    try { (await browserPromise)?.close(); } catch {}
    browserPromise = null;
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
