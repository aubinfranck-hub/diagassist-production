// Relais entre le Live (WebSocket serveur) et l'extension navigateur « DiagAssist × HP-Web ».
// Le serveur envoie une commande de navigation, l'extension l'exécute dans l'onglet HP-Web
// de l'utilisateur (sa session, sa licence) et renvoie le contenu de la page.

const COMMAND_TIMEOUT_MS = 35000;

export function attachHpWebBridge(ws: WebSocket): () => void {
  const pending = new Map<string, (res: any) => void>();
  const origin = window.location.origin;

  const announceIfReady = () => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "hpwebExtension", ready: true }));
  };

  const onWindowMessage = (event: MessageEvent) => {
    if (event.source !== window || event.data?.source !== "diagassist-ext") return;
    if (event.data.kind === "hpweb-ready") announceIfReady();
    else if (event.data.kind === "hpweb-res") {
      const done = pending.get(String(event.data.id));
      if (done) { pending.delete(String(event.data.id)); done(event.data); }
    }
  };

  const onWsMessage = (event: MessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg?.type !== "hpwebCommand") return;
    const id = String(msg.id);
    const reply = (res: any) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "hpwebResult", id, ok: !!res?.ok, page: res?.page, error: res?.error }));
    };
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reply({ ok: false, error: "Extension HP-Web injoignable" });
    }, COMMAND_TIMEOUT_MS);
    pending.set(id, (res) => { window.clearTimeout(timer); reply(res); });
    window.postMessage({ source: "diagassist", kind: "hpweb-cmd", id, action: msg.action, args: msg.args || {} }, origin);
  };

  window.addEventListener("message", onWindowMessage);
  ws.addEventListener("message", onWsMessage);
  ws.addEventListener("open", () => window.postMessage({ source: "diagassist", kind: "hpweb-ping" }, origin));
  window.postMessage({ source: "diagassist", kind: "hpweb-ping" }, origin);

  return () => {
    window.removeEventListener("message", onWindowMessage);
    ws.removeEventListener("message", onWsMessage);
    pending.clear();
  };
}
