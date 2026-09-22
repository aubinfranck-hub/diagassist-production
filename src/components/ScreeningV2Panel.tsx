import React, { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import ScreeningV2 from "./ScreeningV2";

type Role = "controller" | "coach";

export default function ScreeningV2Panel({ isPremium }: { isPremium: boolean }) {
  const [role, setRole] = useState<Role>("controller");
  const [sessionId, setSessionId] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [created, setCreated] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const token = () => localStorage.getItem("auth_session_token") || "";

  const createSession = async () => {
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/api/screening/sessions", {
        method: "POST",
        headers: { Authorization: "Bearer " + token() }
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Impossible de créer la session.");
      setSessionId(data.sessionId);
      setPairingCode(data.pairingCode);
      setCreated(true);
      setStatus("Session prête. Présentez maintenant le QR à la tablette qui utilise le scanner.");
    } catch (e: any) {
      setStatus(e.message || "Erreur de connexion.");
    } finally {
      setBusy(false);
    }
  };

  const qrValue = created
    ? "diagassist://technician?token=" + encodeURIComponent(token()) +
      "&sessionId=" + encodeURIComponent(sessionId) +
      "&pairingCode=" + encodeURIComponent(pairingCode) +
      "&wsUrl=" + encodeURIComponent("https://" + window.location.host)
    : "";

  if (!isPremium) {
    return (
      <div className="premium-glass-card rounded-3xl border border-amber-500/20 bg-amber-950/10 p-8 text-center">
        <div className="text-amber-400 text-xs font-black uppercase tracking-widest mb-3">Fonction Premium</div>
        <h2 className="text-xl font-black text-white mb-2">Assistance à distance DiagAssist</h2>
        <p className="text-sm text-slate-400 max-w-lg mx-auto">
          DiagAssist peut voir l’écran de la tablette du scanner, l’analyser avec son IA et contrôler les manipulations autorisées.
        </p>
      </div>
    );
  }

  if (created && role === "controller") {
    return (
      <div className="space-y-3">
        <div className="premium-glass-card rounded-2xl border border-emerald-400/20 bg-slate-950/80 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-xs font-black uppercase tracking-widest text-emerald-400">Session DiagAssist active</div>
            <span className="text-[11px] text-slate-500">QR valable 10 min</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-center">
            <div>
              <div className="text-sm font-black text-white">1. Ouvrez DiagAssist Technician sur la tablette du scanner</div>
              <div className="text-sm text-slate-400 mt-1">2. Scannez ce QR code avec la caméra de la tablette.</div>
              <div className="text-sm text-slate-400 mt-1">3. Autorisez la capture d’écran puis le contrôle à distance lorsque Android le demande.</div>

              <div className="mt-4 rounded-xl bg-black/30 border border-white/10 p-3">
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Code de secours tablette</div>
                <div className="mt-1 flex items-center gap-3">
                  <span className="font-mono text-2xl font-black tracking-[0.22em] text-white">{pairingCode}</span>
                  <button
                    type="button"
                    onClick={async()=>{try{await navigator.clipboard.writeText(pairingCode);setCopied(true);setTimeout(()=>setCopied(false),1200)}catch{}}}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-[10px] font-bold text-white"
                  >{copied ? "✓" : "Copier"}</button>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">Le code est un secours. Le QR est le parcours normal.</div>
              </div>

              <div className="mt-3 rounded-xl bg-black/30 border border-white/10 px-3 py-2">
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Code session</div>
                <div className="font-mono text-lg font-black text-white">{sessionId}</div>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-4 mx-auto">
              <QRCodeSVG value={qrValue} size={230} level="M" marginSize={4} title="QR d’appairage DiagAssist Technician" />
            </div>
          </div>

          {status && <p className="text-[11px] text-slate-400 mt-3">{status}</p>}
        </div>

        <ScreeningV2 sessionId={sessionId} pairingCode="" role="controller" />
      </div>
    );
  }

  if (role === "coach") {
    return (
      <div className="premium-glass-card rounded-3xl border border-white/[0.08] p-6 space-y-4">
        <div className="rounded-2xl border border-red-500/20 bg-red-950/10 p-4">
          <div className="text-[10px] font-black uppercase tracking-widest text-red-300">👨🏾‍🔧 ASSISTANCE HUMAINE</div>
          <h2 className="text-xl font-black text-white mt-2">Rejoindre une session</h2>
          <p className="text-sm text-slate-400 mt-2">Le technicien vous communique son code session à 6 caractères.</p>
        </div>
        <input value={sessionId} onChange={e => setSessionId(e.target.value.trim().toUpperCase())} className="w-full rounded-xl bg-slate-950 border border-white/10 px-4 py-3 text-white font-mono tracking-widest" placeholder="Ex. DSX68L" maxLength={6} autoCapitalize="characters" autoCorrect="off" />
        <button type="button" onClick={() => setRole("controller")} className="text-xs text-slate-500 underline">Retour à DiagAssist</button>
        <button
          disabled={!/^[A-Z0-9]{6}$/.test(sessionId.trim())}
          onClick={async()=>{
            try{
              const res=await fetch("/api/screening/sessions/"+encodeURIComponent(sessionId)+"/join-coach",{method:"POST",headers:{Authorization:"Bearer "+token()}});
              const data=await res.json();
              if(!res.ok||!data.success) throw new Error(data.message||"Connexion impossible.");
              setCreated(true);
              setStatus("Technicien humain connecté.");
            }catch(e:any){setStatus(e.message||"Erreur.");}
          }}
          className="w-full px-5 py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-black uppercase tracking-wider"
        >Rejoindre la session</button>
        {status&&<p className="text-xs text-slate-400">{status}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="premium-glass-card rounded-3xl border border-white/[0.08] p-6">
        <div className="space-y-5">
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-950/10 p-5">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-400">🤖 DIAGASSIST — COACH PRINCIPAL</div>
            <h2 className="text-xl font-black text-white mt-2">DiagAssist vous guide et contrôle la tablette du scanner</h2>
            <p className="text-sm text-slate-300 mt-2">
              Votre scanner peut être sur un autre téléphone ou une autre tablette. DiagAssist reçoit son écran, l’analyse et vous guide. Après appairage, DiagAssist peut envoyer les manipulations autorisées à cette tablette uniquement.
            </p>
            <button disabled={busy} onClick={createSession} className="mt-5 px-5 py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider">
              {busy ? "Création…" : "Démarrer DiagAssist"}
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
            <div className="text-xs font-black uppercase tracking-widest text-slate-400">👨🏾‍🔧 BESOIN D’UN TECHNICIEN HUMAIN ?</div>
            <p className="text-sm text-slate-400 mt-2">Un autre technicien peut rejoindre la session avec le code session et voir l’écran du scanner.</p>
            <button type="button" onClick={() => setRole("coach")} className="mt-3 px-4 py-2.5 rounded-xl bg-slate-800 text-white text-xs font-black uppercase">
              Assistance humaine
            </button>
          </div>
        </div>
        {status && <p className="text-xs text-slate-400 mt-4">{status}</p>}
      </div>
    </div>
  );
}
