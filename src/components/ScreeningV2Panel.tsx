import React, { useState } from "react";
import ScreeningV2 from "./ScreeningV2";

type Role = "technician" | "coach";

export default function ScreeningV2Panel({ isPremium }: { isPremium: boolean }) {
  const [role, setRole] = useState<Role>("technician");
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
      <div className="space-y-5">
        <div className="premium-glass-card rounded-3xl border border-emerald-500/20 bg-emerald-950/10 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Session Technicien</div>
              <div className="text-3xl font-black text-white font-mono tracking-[0.18em] mt-2">{pairingCode}</div>
              <p className="text-xs text-slate-400 mt-2">Code valable pour l’appairage de cette session.</p>
            </div>
            <button onClick={launchTechnician} className="px-5 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider">
              Ouvrir l’agent tablette
            </button>
          </div>
          {status && <p className="text-xs text-emerald-300 mt-4">{status}</p>}
        </div>
        <ScreeningV2 sessionId={sessionId} pairingCode={pairingCode} role="technician" />
      </div>
    );
  }

  if (created && role === "coach") {
    return <ScreeningV2 sessionId={sessionId} pairingCode={pairingCode} role="coach" />;
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
          <div className="grid md:grid-cols-2 gap-4">
            <label className="text-xs font-bold text-slate-400">ID de session
              <input value={sessionId} onChange={e => setSessionId(e.target.value)} className="mt-2 w-full rounded-xl bg-slate-950 border border-white/10 px-4 py-3 text-white" placeholder="scr_..." />
            </label>
            <label className="text-xs font-bold text-slate-400">Code d’appairage
              <input value={pairingCode} onChange={e => setPairingCode(e.target.value.replace(/\D/g, "").slice(0,6))} className="mt-2 w-full rounded-xl bg-slate-950 border border-white/10 px-4 py-3 text-white font-mono tracking-widest" placeholder="000000" />
            </label>
            <button disabled={!sessionId || pairingCode.length !== 6} onClick={() => setCreated(true)} className="md:col-span-2 px-5 py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-black uppercase tracking-wider">
              Se connecter au technicien
            </button>
          </div>
        )}
        {status && <p className="text-xs text-slate-400 mt-4">{status}</p>}
      </div>
    </div>
  );
}
