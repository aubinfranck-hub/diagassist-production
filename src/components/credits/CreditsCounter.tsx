import React, { useEffect, useState } from "react";
import { Ticket } from "lucide-react";
import { CreditsInfo, fetchCredits, openCredits } from "./creditsBus";

/** Compteur « diagnostics restants » + bouton d'achat. N'apparaît pas pour les abonnés (leur forfait s'applique). */
export default function CreditsCounter({ compact = false }: { compact?: boolean }) {
  const [info, setInfo] = useState<CreditsInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetchCredits().then(i => { if (alive) setInfo(i); });
    load();
    window.addEventListener("diag-credits-changed", load);
    return () => { alive = false; window.removeEventListener("diag-credits-changed", load); };
  }, []);
  if (!info || info.unlimited) return null;

  const empty = info.total <= 0;
  return (
    <div data-testid="credits-counter" className={`rounded-xl border p-3 text-xs space-y-2 ${empty ? "bg-rose-950/40 border-rose-500/30" : "bg-slate-950/80 border-white/[0.05]"}`}>
      <div className="flex items-center gap-2">
        <Ticket className={`w-4 h-4 shrink-0 ${empty ? "text-rose-400" : "text-amber-400"}`} />
        <div className="min-w-0">
          <span className="block text-[9px] uppercase tracking-wider font-extrabold font-mono text-slate-500">Diagnostics IA restants</span>
          <strong className={`block text-sm ${empty ? "text-rose-400" : "text-amber-400"}`}>{info.total}</strong>
        </div>
      </div>
      {!compact && (
        <p className="text-[11px] text-slate-400 leading-snug">
          {[info.freeTotal > 0 ? `${info.freeRemaining} gratuit${info.freeRemaining > 1 ? "s" : ""} sur ${info.freeTotal}` : "", info.paidBalance > 0 ? `${info.paidBalance} acheté${info.paidBalance > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ")}
          {info.freeTotal > 0 || info.paidBalance > 0 ? ". " : ""}L'urgence et le SOS restent gratuits.
        </p>
      )}
      {info.packs.length > 0 && (
        <button onClick={() => openCredits({ exhausted: empty })}
          className={`w-full py-2 rounded-lg font-extrabold text-[11px] transition ${empty ? "bg-red-600 hover:bg-red-500 text-white" : "bg-white/10 hover:bg-white/15 text-slate-100"}`}>
          {empty ? "Acheter des diagnostics" : "Ajouter des diagnostics"}
        </button>
      )}
    </div>
  );
}
