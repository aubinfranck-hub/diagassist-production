// Exécuté dans la page DiagAssist : relaie les commandes de l'agent vocal vers l'extension.
// Seules les actions de navigation HP-Web sont acceptées, uniquement depuis cette même page.
(() => {
  const ACTIONS = new Set(["open", "snapshot", "click", "type", "select", "back"]);
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "diagassist") return;
    const { kind, id, action, args } = event.data;
    if (kind === "hpweb-ping") {
      window.postMessage({ source: "diagassist-ext", kind: "hpweb-ready" }, window.location.origin);
    } else if (kind === "hpweb-cmd" && ACTIONS.has(action)) {
      chrome.runtime.sendMessage({ target: "hpweb-background", action, args }, (res) => {
        const err = chrome.runtime.lastError?.message;
        window.postMessage({ source: "diagassist-ext", kind: "hpweb-res", id, ...(err ? { ok: false, error: err } : res) }, window.location.origin);
      });
    }
  });
  window.postMessage({ source: "diagassist-ext", kind: "hpweb-ready" }, window.location.origin);
})();
