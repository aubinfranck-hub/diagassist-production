// Garde un onglet HP-Web de l'utilisateur et exécute les commandes de l'agent dedans.
const HP_WEB_HOME = "https://fr.hp-web.in/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let hpTabId = null;

async function findTab() {
  if (hpTabId != null) {
    try { const t = await chrome.tabs.get(hpTabId); if (t?.url?.includes("hp-web.in")) return t; } catch {}
    hpTabId = null;
  }
  const [existing] = await chrome.tabs.query({ url: "*://*.hp-web.in/*" });
  if (existing) { hpTabId = existing.id; return existing; }
  return null;
}

async function ensureTab(focus) {
  let tab = await findTab();
  if (!tab) tab = await chrome.tabs.create({ url: HP_WEB_HOME, active: true });
  else if (focus) await chrome.tabs.update(tab.id, { active: true });
  hpTabId = tab.id;
  await waitComplete(tab.id);
  return tab.id;
}

async function waitComplete(tabId, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (t?.status === "complete") return;
    await sleep(250);
  }
}

function sendToContent(tabId, action, args) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { target: "hpweb-content", action, args }, (res) => {
      // Une navigation coupe le canal de réponse : ce n'est pas une erreur.
      resolve(chrome.runtime.lastError ? { ok: true, navigated: true } : res);
    });
  });
}

async function snapshotWithRetry(tabId) {
  for (let i = 0; i < 8; i++) {
    await waitComplete(tabId);
    const res = await sendToContent(tabId, "snapshot", {});
    if (res?.ok && res.page) return res.page;
    await sleep(500); // le script de contenu n'est pas encore chargé sur la nouvelle page
  }
  throw new Error("Page HP-Web illisible (Cloudflare ou chargement en cours ?)");
}

async function run(action, args) {
  const tabId = await ensureTab(action === "open");
  if (action === "open" || action === "snapshot") return { ok: true, page: await snapshotWithRetry(tabId) };
  const res = await sendToContent(tabId, action, args);
  if (res && res.ok === false) return { ok: false, error: res.error };
  await sleep(900);
  return { ok: true, page: await snapshotWithRetry(tabId) };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "hpweb-background") return;
  run(msg.action, msg.args || {}).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true; // réponse asynchrone
});
