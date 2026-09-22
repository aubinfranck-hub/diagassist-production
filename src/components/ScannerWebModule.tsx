import React, { useEffect, useMemo, useRef, useState } from "react";
import { Chrome, MonitorUp, Wifi, WifiOff, Smartphone, ShieldCheck, AlertTriangle, Copy, ExternalLink, RefreshCw } from "lucide-react";

type ConnectionState = "idle" | "connecting" | "connected" | "error";

function makeDeviceId() {
  const existing = localStorage.getItem("diagassist_scanner_web_device");
  if (existing) return existing;
  const id = `web-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
  localStorage.setItem("diagassist_scanner_web_device", id);
  return id;
}

export default function ScannerWebModule() {
  const [sessionId, setSessionId] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [wsUrl, setWsUrl] = useState("");
  const [state, setState] = useState<ConnectionState>("idle");
  const [status, setStatus] = useState("Prêt à connecter la tablette via Chrome.");
  const [frame, setFrame] = useState<string | null>(null);
  const [screenSharing, setScreenSharing] = useState(false);
  const [browserSupport, setBrowserSupport] = useState<Record<string, boolean>>({});
  const [commandLog, setCommandLog] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const captureTimerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const deviceId = useMemo(makeDeviceId, []);

  useEffect(() => {
    setBrowserSupport({
      mediaDevices: Boolean(navigator.mediaDevices),
      getDisplayMedia: Boolean(navigator.mediaDevices?.getDisplayMedia),
      camera: Boolean(navigator.mediaDevices?.getUserMedia),
      bluetooth: Boolean((navigator as any).bluetooth),
      standalone: window.matchMedia("(display-mode: standalone)").matches,
    });
  }, []);

  useEffect(() => () => {
    if (captureTimerRef.current) window.clearInterval(captureTimerRef.current);
    captureStreamRef.current?.getTracks().forEach(t => t.stop());
    wsRef.current?.close();
  }, []);

  const connect = () => {
    if (!sessionId || !pairingCode) {
      setStatus("Saisissez le code session et le code d'appairage.");
      return;
    }
    let target = wsUrl.trim();
    if (!target) {
      target = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/screening/stream";
    }
    if (target.startsWith("http://")) target = "ws://" + target.slice(7);
    if (target.startsWith("https://")) target = "wss://" + target.slice(8);
    if (!target.endsWith("/api/screening/stream")) target = target.replace(/\/$/, "") + "/api/screening/stream";

    wsRef.current?.close();
    setState("connecting");
    setStatus("Connexion de la tablette Chrome…");

    const ws = new WebSocket(target);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "pairing",
        sessionId: sessionId.trim().toUpperCase(),
        pairingCode: pairingCode.trim(),
        deviceId,
        role: "technician"
      }));
    };
    ws.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "pairing") {
          if (message.success) {
            setState("connected");
            setStatus("Tablette Chrome connectée à DiagAssist.");
          } else {
            setState("error");
            setStatus(message.message || "Appairage refusé.");
          }
        }
        if (message.type === "command") {
          const action = message.payload?.action || "commande";
          setCommandLog(prev => [`Commande reçue : ${action}`, ...prev].slice(0, 8));
          handleBrowserCommand(action, message.payload || {});
        }
        if (message.type === "session_ended") {
          setState("idle");
          setStatus("Session terminée par DiagAssist.");
        }
      } catch {
        setStatus("Message serveur invalide.");
      }
    };
    ws.onerror = () => {
      setState("error");
      setStatus("Erreur de connexion WebSocket.");
    };
    ws.onclose = () => {
      setState(prev => prev === "connected" ? "idle" : prev);
    };
  };

  const handleBrowserCommand = (action: string, payload: any) => {
    if (action === "scroll") {
      window.scrollBy({ top: payload.direction === "up" ? -window.innerHeight * 0.7 : window.innerHeight * 0.7, behavior: "smooth" });
      return;
    }
    if (action === "back") {
      window.history.back();
      return;
    }
    if (action === "request_screen") {
      if (!screenSharing) setStatus("Le contrôleur demande une capture : lancez d'abord « Partager l'écran ».");
      return;
    }
    if (action === "input") {
      setStatus("Commande de saisie reçue. Une page Web ne peut pas injecter du texte dans une autre application Android.");
      return;
    }
    if (action === "click") {
      setStatus("Clic reçu. Chrome peut contrôler sa propre page, mais pas une autre application Android.");
    }
  };

  const sendFrame = () => {
    const ws = wsRef.current;
    const video = captureVideoRef.current;
    const canvas = canvasRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !video || !canvas || !video.videoWidth) return;
    const maxWidth = 1280;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.68);
    setFrame(data);
    ws.send(JSON.stringify({
      type: "frame",
      sessionId: sessionId.trim().toUpperCase(),
      payload: { imageData: data }
    }));
  };

  const startScreenShare = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatus("Cette version de Chrome/Android ne fournit pas l'API de partage d'écran.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 5, max: 8 } },
        audio: false
      });
      captureStreamRef.current = stream;
      setScreenSharing(true);
      setStatus("Partage d'écran actif. DiagAssist reçoit les captures.");
      const video = captureVideoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      stream.getVideoTracks()[0]?.addEventListener("ended", () => stopScreenShare());
      if (captureTimerRef.current) window.clearInterval(captureTimerRef.current);
      captureTimerRef.current = window.setInterval(sendFrame, 800);
    } catch (error: any) {
      setStatus(error?.message || "Partage d'écran annulé ou refusé.");
    }
  };

  const stopScreenShare = () => {
    if (captureTimerRef.current) window.clearInterval(captureTimerRef.current);
    captureTimerRef.current = null;
    captureStreamRef.current?.getTracks().forEach(t => t.stop());
    captureStreamRef.current = null;
    setScreenSharing(false);
    setStatus("Partage d'écran arrêté.");
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Copié.");
    } catch {
      setStatus("Copie impossible dans ce navigateur.");
    }
  };

  const stateLabel = state === "connected" ? "Connecté" : state === "connecting" ? "Connexion…" : state === "error" ? "Erreur" : "Prêt";

  return (
    <section className="space-y-5 animate-fade-in">
      <div className="premium-glass-card rounded-3xl border border-white/[0.08] p-5 md:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">DIAGASSIST SCANNER — WEB / CHROME</div>
            <h1 className="text-2xl md:text-3xl font-black text-white mt-1">Mode Scanner dans Chrome</h1>
            <p className="text-sm text-slate-400 mt-2 max-w-3xl">
              Version expérimentale destinée à être testée directement sur la tablette OBD. Elle utilise les capacités Web disponibles dans Chrome sans remplacer l’APK DiagAssist Scanner.
            </p>
          </div>
          <div className="shrink-0 rounded-2xl bg-slate-950 border border-white/10 p-3">
            <Chrome className="w-7 h-7 text-blue-400" />
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-3 mt-5">
          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
            <Smartphone className="w-5 h-5 text-emerald-400 mb-2" />
            <div className="text-xs font-black text-white">1. Ouvrir dans Chrome</div>
            <p className="text-[11px] text-slate-500 mt-1">Sur la tablette qui utilise le scanner.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
            <MonitorUp className="w-5 h-5 text-red-400 mb-2" />
            <div className="text-xs font-black text-white">2. Partager l’écran</div>
            <p className="text-[11px] text-slate-500 mt-1">Si Chrome/Android propose cette fonction.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
            <Wifi className="w-5 h-5 text-sky-400 mb-2" />
            <div className="text-xs font-black text-white">3. Contrôler depuis DiagAssist</div>
            <p className="text-[11px] text-slate-500 mt-1">Les commandes Web sont limitées à Chrome lui-même.</p>
          </div>
        </div>
      </div>

      <div className="premium-glass-card rounded-3xl border border-white/[0.08] p-5 md:p-7 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest font-black text-slate-500">APPairage de test</div>
            <h2 className="text-lg font-black text-white">Connexion à une session DiagAssist</h2>
          </div>
          <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg ${state === "connected" ? "bg-emerald-500/15 text-emerald-400" : state === "error" ? "bg-red-500/15 text-red-400" : "bg-slate-800 text-slate-400"}`}>{stateLabel}</span>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-widest font-black text-slate-500">Code session (6 caractères)</span>
            <input value={sessionId} onChange={e => setSessionId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} className="w-full rounded-xl bg-slate-950 border border-white/10 px-4 py-3 text-white font-mono tracking-[0.25em]" placeholder="DSX68L" />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-widest font-black text-slate-500">Code appairage</span>
            <input value={pairingCode} onChange={e => setPairingCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="w-full rounded-xl bg-slate-950 border border-white/10 px-4 py-3 text-white font-mono tracking-[0.25em]" placeholder="123456" inputMode="numeric" />
          </label>
        </div>

        <label className="space-y-1 block">
          <span className="text-[10px] uppercase tracking-widest font-black text-slate-500">Serveur WebSocket (optionnel)</span>
          <input value={wsUrl} onChange={e => setWsUrl(e.target.value)} className="w-full rounded-xl bg-slate-950 border border-white/10 px-4 py-3 text-white text-xs font-mono" placeholder="Automatique — serveur DiagAssist" />
        </label>

        <div className="flex flex-wrap gap-2">
          <button onClick={connect} disabled={state === "connecting"} className="px-5 py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2">
            <Wifi className="w-4 h-4" /> Connecter Chrome
          </button>
          <button onClick={screenSharing ? stopScreenShare : startScreenShare} disabled={state !== "connected"} className="px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2">
            <MonitorUp className="w-4 h-4" /> {screenSharing ? "Arrêter le partage" : "Partager l’écran"}
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 flex gap-3">
          {state === "connected" ? <Wifi className="w-5 h-5 text-emerald-400 shrink-0" /> : <WifiOff className="w-5 h-5 text-slate-500 shrink-0" />}
          <div>
            <div className="text-sm font-bold text-white">{status}</div>
            <div className="text-[11px] text-slate-500 mt-1">Identifiant navigateur : {deviceId}</div>
          </div>
        </div>

        <video ref={captureVideoRef} muted playsInline className="hidden" />
        <canvas ref={canvasRef} className="hidden" />

        {frame && (
          <div className="rounded-2xl border border-white/10 overflow-hidden bg-black">
            <div className="px-3 py-2 text-[10px] uppercase tracking-widest font-black text-slate-500 border-b border-white/10">Dernière capture envoyée</div>
            <img src={frame} alt="Capture écran tablette Chrome" className="w-full max-h-[60vh] object-contain" />
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="premium-glass-card rounded-3xl border border-white/[0.08] p-5">
          <div className="flex items-center gap-2 mb-4"><ShieldCheck className="w-5 h-5 text-emerald-400" /><h2 className="font-black text-white">Capacités détectées</h2></div>
          <div className="space-y-2 text-xs">
            {Object.entries(browserSupport).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between rounded-xl bg-slate-950/60 border border-white/5 px-3 py-2">
                <span className="text-slate-400">{key}</span><span className={value ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>{value ? "Disponible" : "Non disponible"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="premium-glass-card rounded-3xl border border-amber-500/15 p-5">
          <div className="flex items-center gap-2 mb-3"><AlertTriangle className="w-5 h-5 text-amber-400" /><h2 className="font-black text-white">Limite importante du test</h2></div>
          <p className="text-sm text-slate-300 leading-relaxed">
            Même avec Chrome signé par Google, une page Web ne reçoit pas automatiquement les permissions système d’Android. Elle ne peut pas piloter librement une autre application Android. C’est précisément ce que l’APK DiagAssist Scanner conserve avec MediaProjection et AccessibilityService.
          </p>
          <p className="text-xs text-slate-500 mt-3">
            Si le partage d’écran fonctionne sur ta tablette, on aura déjà validé une partie du concept Web. Si Chrome refuse cette API sur Android, ce résultat sera également utile : l’APK reste le chemin technique pour le contrôle complet.
          </p>
        </div>
      </div>

      {commandLog.length > 0 && (
        <div className="premium-glass-card rounded-3xl border border-white/[0.08] p-5">
          <div className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-2">Commandes reçues</div>
          <div className="space-y-1">{commandLog.map((x,i)=><div key={i} className="text-xs text-slate-400 font-mono">{x}</div>)}</div>
        </div>
      )}

      <div className="text-[10px] text-slate-600 flex flex-wrap items-center gap-2">
        <span>Module expérimental Web/Chrome</span>
        <button onClick={()=>copy(location.href)} className="inline-flex items-center gap-1 underline"><Copy className="w-3 h-3"/> Copier le lien de test</button>
        <a href="https://www.diagassist.app/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline"><ExternalLink className="w-3 h-3"/> Ouvrir le site</a>
        <button onClick={()=>window.location.reload()} className="inline-flex items-center gap-1 underline"><RefreshCw className="w-3 h-3"/> Recharger</button>
      </div>
    </section>
  );
}
