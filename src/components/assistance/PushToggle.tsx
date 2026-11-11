import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { authToken } from "./api";

// Bouton d'activation des notifications push (mécanicien : nouvelles demandes ; client : offres
// et changements de statut). Masqué si le navigateur ne les supporte pas ou si le serveur n'a pas
// de clés VAPID. Sur iPhone, les notifications web exigent l'appli installée sur l'écran d'accueil.

type State = "hidden" | "off" | "on" | "denied" | "busy" | "ios-install";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function post(path: string, body: unknown) {
  const token = authToken();
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}

export default function PushToggle({ audience }: { audience: "pro" | "client" }) {
  const [state, setState] = useState<State>("hidden");
  const [key, setKey] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
      try {
        const r = await fetch("/api/push/public-key").then((x) => x.json());
        if (cancelled || !r?.enabled || !r.publicKey) return;
        setKey(r.publicKey);
        if (!supported) { if (ios && !standalone) setState("ios-install"); return; }
        if (Notification.permission === "denied") return setState("denied");
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub && Notification.permission === "granted") {
          await post("/api/push/subscribe", { subscription: sub.toJSON() }); // rattache l'appareil au compte connecté
          if (!cancelled) setState("on");
        } else if (!cancelled) setState("off");
      } catch { /* notifications indisponibles : bouton masqué */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const enable = async () => {
    if (!key) return;
    setState("busy"); setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource }));
      const r = await post("/api/push/subscribe", { subscription: sub.toJSON() });
      if (!r?.success) throw new Error(r?.message || "Abonnement refusé.");
      setState("on");
      setMsg("Notifications activées sur cet appareil.");
    } catch (e: any) {
      setState("off");
      setMsg(e?.message || "Impossible d'activer les notifications.");
    }
  };

  const disable = async () => {
    setState("busy"); setMsg("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await post("/api/push/unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe(); }
    } catch { /* ignoré */ }
    setState("off");
  };

  if (state === "hidden") return null;
  const what = audience === "pro" ? "les nouvelles demandes près de vous" : "les offres et l'avancement de votre demande";
  const box = "flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm";

  if (state === "ios-install") return <div className={box}><span className="text-slate-300">Pour être alerté de {what} sur iPhone, ajoutez DiagAssist à l'écran d'accueil (Partager → Sur l'écran d'accueil).</span></div>;
  if (state === "denied") return <div className={box}><span className="inline-flex items-center gap-2 text-slate-400"><BellOff className="w-4 h-4" /> Notifications bloquées : autorisez-les dans les réglages du navigateur pour être alerté.</span></div>;

  return (
    <div className={box}>
      <span className="inline-flex items-center gap-2 text-slate-200">
        <Bell className="w-4 h-4 text-red-500" />
        {state === "on" ? `Alertes activées pour ${what}.` : `Être alerté de ${what}, même appli fermée.`}
        {msg && <span className="text-xs text-slate-400"> {msg}</span>}
      </span>
      {state === "busy" ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : state === "on"
        ? <button onClick={() => void disable()} className="text-xs text-slate-400 underline cursor-pointer">Désactiver</button>
        : <button onClick={() => void enable()} className="shrink-0 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white cursor-pointer">Activer</button>}
    </div>
  );
}
