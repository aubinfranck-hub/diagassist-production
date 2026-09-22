import React, { useState } from "react";
import ScreeningV2 from "./ScreeningV2";

type Role = "technician" | "coach";

export default function ScreeningV2Panel({ isPremium }: { isPremium: boolean }) {
  const [role, setRole] = useState<Role>("technician");
  const [sessionId, setSessionId] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [created, setCreated] = useState(false);
  const [coachJoined, setCoachJoined] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedSessionId, setCopiedSessionId] = useState(false);

  const token = () => localStorage.getItem("auth_session_token") || "";

  const createSession = async () => {
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/api/screening/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}` }
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Impossible de créer la session.");
      setSessionId(data.sessionId);
      setPairingCode(data.pairingCode);
      setCreated(true);
      setStatus("Session créée. Ouvrez maintenant l’agent Technicien sur la tablette.");
    } catch (e: any) {
      setStatus(e.message || "Erreur de connexion.");
    } finally {
      setBusy(false);
    }
  };

  const launchTechnician = () => {
    const wsBase = `https://${window.location.host}`;
    const deepLink = `diagassist://technician?token=${encodeURIComponent(token())}&sessionId=${encodeURIComponent(sessionId)}&pairingCode=${encodeURIComponent(pairingCode)}&wsUrl=${encodeURIComponent(wsBase)}`;
    window.location.href = deepLink;
  };

  if (!isPremium) {
    return (
      <div className="premium-glass-card rounded-3xl border border-amber-500/20 bg-amber-950/10 p-8 text-center">
        <div className="text-amber-400 text-xs font-black uppercase tracking-widest mb-3">Fonction Premium</div>
        <h2 className="text-xl font-black text-white mb-2">Coaching technicien à distance</h2>
        <p className="text-sm text-slate-400 max-w-lg mx-auto">
          Visualisez l’écran du technicien, guidez ses manipulations et demandez une analyse IA pendant le diagnostic.
        </p>
      </div>
    );
  }

  if (created && role === "technician") {
    return (
      <div className="space-y-3">
        <div className="premium-glass-card rounded-2xl border border-white/10 bg-slate-950/70 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-xs font-black uppercase tracking-widest text-emerald-400">Session active</div>
            <span className="text-[11px] text-slate-500">10 min</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-xl bg-black/30 border border-white/10 px-3 py-3">
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Code session · coach</div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="font-mono text-lg font-black text-white">{sessionId}</span>
                <button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(sessionId);setCopiedSessionId(true);setTimeout(()=>setCopiedSessionId(false),1200)}catch{}}} className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-[10px] font-bold text-white">{copiedSessionId ? "✓" : "Copier"}</button>
              </div>
            </div>
            <div className="rounded-xl bg-black/30 border border-emerald-400/20 px-3 py-3">
              <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-400">Code tablette</div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="font-mono text-lg font-black tracking-widest text-white">{pairingCode}</span>
                <button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(pairingCode);setCopied(true);setTimeout(()=>setCopied(false),1200)}catch{}}} className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-[10px] font-bold text-white">{copied ? "✓" : "Copier"}</button>
              </div>
            </div>
          </div>
          <button onClick={launchTechnician} className="mt-3 w-full px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase">
            Ouvrir l’agent tablette
          </button>
          {status && <p className="text-[11px] text-slate-400 mt-2">{status}</p>}
        </div>
        <ScreeningV2 sessionId={sessionId} pairingCode={pairingCode} role="technician" />
      </div>
    );
  }

  if (created && role === "coach") {
    return (
      <div className="space-y-5">
        {!coachJoined ? (
          <div className="premium-glass-card rounded-3xl border border-white/[0.08] p-6">
            <div className="text-[10px] font-black uppercase tracking-widest text-red-400">Accès aide technicien</div>
            <h2 className="text-xl font-black text-white mt-2">CODE SESSION</h2>
            <p className="text-sm text-slate-400 mt-2">Le coach saisit l’identifiant complet de la session <span className="font-mono text-white">ex. scr_abc123...</span>. Le code à 6 chiffres reste réservé uniquement à l’appairage de la tablette.</p>
            <input value={sessionId} onChange={e=>setSessionId(e.target.value.trim())} className="mt-4 w-full rounded-xl bg-slate-950 border border-white/10 px-4 py-3 text-white font-mono" placeholder="Ex. scr_..." autoCapitalize="none" autoCorrect="off" />
            <button disabled={!sessionId.trim().toLowerCase().startsWith("scr_")} onClick={async()=>{
              try{
                const res=await fetch("/api/screening/sessions/"+encodeURIComponent(sessionId)+"/join-coach",{method:"POST",headers:{Authorization:"Bearer "+token()}});
                const data=await res.json();
                if(!res.ok||!data.success) throw new Error(data.message||"Connexion coach impossible.");
                setCoachJoined(true);
                setStatus("Coach connecté à la session.");
              }catch(e:any){setStatus(e.message||"Erreur.");}
            }} className="mt-4 px-5 py-3 rounded-xl bg-red-600 disabled:opacity-40 text-white text-xs font-black uppercase">Rejoindre la session</button>
            {status&&<p className="text-xs text-slate-400 mt-4">{status}</p>}
          </div>
        ) : <ScreeningV2 sessionId={sessionId} pairingCode="" role="coach" />}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="premium-glass-card rounded-3xl border border-white/[0.08] p-6">
        <div className="flex flex-col sm:flex-row gap-2 mb-6">
          <button onClick={() => setRole("technician")} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase ${role === "technician" ? "bg-red-600 text-white" : "bg-slate-900 text-slate-400"}`}>Je suis technicien</button>
          <button onClick={() => setRole("coach")} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase ${role === "coach" ? "bg-red-600 text-white" : "bg-slate-900 text-slate-400"}`}>Je suis coach</button>
        </div>

        {role === "technician" ? (
          <div>
            <h2 className="text-xl font-black text-white">Démarrer un coaching</h2>
            <p className="text-sm text-slate-400 mt-2">Créez une session puis ouvrez l’agent DiagAssist sur la tablette du technicien.</p>
            <button disabled={busy} onClick={createSession} className="mt-5 px-5 py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider">
              {busy ? "Création…" : "Créer la session"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block text-xs font-bold text-slate-400">CODE SESSION
              <input value={sessionId} onChange={e => setSessionId(e.target.value.trim())} className="mt-2 w-full rounded-xl bg-slate-950 border border-white/10 px-4 py-3 text-white font-mono" placeholder="Ex. scr_..." />
            </label>
            <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4 text-xs text-amber-200">
              Le coach ne saisit aucun code d’appairage. Utilisez l’ID complet <span className="font-mono">scr_...</span>. Le technicien doit d’abord demander le coach humain depuis sa tablette/session.
            </div>
            <button disabled={!sessionId.trim().toLowerCase().startsWith("scr_")} onClick={() => { setStatus(""); setCreated(true); }} className="w-full px-5 py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-black uppercase tracking-wider">
              Continuer avec l’ID de session
            </button>
          </div>
        )}
        {status && <p className="text-xs text-slate-400 mt-4">{status}</p>}
      </div>
    </div>
  );
}
