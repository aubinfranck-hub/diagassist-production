import React from "react";
import { RefreshCw } from "lucide-react";
import { useAdminLoad, Loading, ErrorBox, Empty, btnGhost, fmtXof, statusLabel } from "./AdminShared";

const LABELS: Record<string, string> = {
  received: "Demandes reçues", requestsReceived: "Demandes reçues", requests: "Demandes reçues", total: "Demandes reçues",
  accepted: "Demandes acceptées", requestsAccepted: "Demandes acceptées",
  completed: "Demandes terminées", requestsCompleted: "Demandes terminées", done: "Demandes terminées",
  avgAcceptSeconds: "Délai moyen d'acceptation", avgAcceptanceDelayS: "Délai moyen d'acceptation", avgAcceptMs: "Délai moyen d'acceptation",
  avgArrivalSeconds: "Délai moyen d'arrivée", avgArrivalDelayS: "Délai moyen d'arrivée", avgArrivalMs: "Délai moyen d'arrivée",
  collected: "Montants encaissés", amountCollected: "Montants encaissés", revenue: "Montants encaissés", paidAmount: "Montants encaissés",
  pros: "Professionnels par statut", prosByStatus: "Professionnels par statut", prosParStatut: "Professionnels par statut",
};
const humanize = (k: string) => LABELS[k] || k.replace(/([A-Z])/g, " $1").replace(/[_-]/g, " ").replace(/^./, (c) => c.toUpperCase());

function fmtValue(key: string, v: number): string {
  const k = key.toLowerCase();
  if (/amount|montant|collect|encaiss|revenue|paid/.test(k)) return fmtXof(v);
  let sec: number | null = null;
  if (/ms$/.test(k) && /avg|delai|delay|moyen/.test(k)) sec = v / 1000;
  else if (/(seconds|_s$|s$)/.test(k) && /avg|delai|delay/.test(k) && !/ms$/.test(k)) sec = v;
  else if (/minutes?$/.test(k)) sec = v * 60;
  if (sec !== null) {
    if (sec < 90) return `${Math.round(sec)} s`;
    if (sec < 5400) return `${Math.round(sec / 60)} min`;
    return `${(sec / 3600).toFixed(1)} h`;
  }
  return v.toLocaleString("fr-FR");
}

export default function AdminDashboardView() {
  const { data, loading, error, reload } = useAdminLoad("/dashboard");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const { success: _s, message: _m, ...rest } = data as Record<string, any>;
  let src: Record<string, any> = rest;
  for (const k of ["dashboard", "stats", "indicators", "indicateurs"]) if (rest[k] && typeof rest[k] === "object") src = rest[k];

  const scalars = Object.entries(src).filter(([, v]) => typeof v === "number" || typeof v === "string");
  const groups = Object.entries(src).filter(([, v]) => v && typeof v === "object" && !Array.isArray(v)) as [string, Record<string, any>][];
  const arrays = Object.entries(src).filter(([, v]) => Array.isArray(v)) as [string, any[]][];
  const numericTotal = scalars.reduce((s, [, v]) => s + (typeof v === "number" ? v : 0), 0)
    + groups.reduce((s, [, g]) => s + Object.values(g).reduce((a: number, b: any) => a + (typeof b === "number" ? b : 0), 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={reload} className={btnGhost}><RefreshCw className="w-3.5 h-3.5 inline mr-1" />Actualiser</button></div>
      {scalars.length === 0 && groups.length === 0 && arrays.length === 0 ? (
        <Empty text="Aucun indicateur renvoyé par le serveur." />
      ) : (
        <>
          {numericTotal === 0 && <Empty text="Aucune activité enregistrée pour le moment : tous les indicateurs sont à zéro." />}
          {scalars.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              {scalars.map(([k, v]) => (
                <div key={k} className="bg-slate-950/60 border border-white/[0.06] rounded-xl p-3">
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{humanize(k)}</p>
                  <p className="text-xl font-extrabold text-white mt-1">{typeof v === "number" ? fmtValue(k, v) : String(v)}</p>
                </div>
              ))}
            </div>
          )}
          {groups.map(([k, g]) => (
            <div key={k} className="space-y-2">
              <p className="text-[11px] text-slate-300 font-bold uppercase tracking-wider">{humanize(k)}</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {Object.entries(g).map(([gk, gv]) => (
                  <div key={gk} className="bg-slate-950/60 border border-white/[0.06] rounded-xl p-3">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{statusLabel(gk) !== gk ? statusLabel(gk) : humanize(gk)}</p>
                    <p className="text-xl font-extrabold text-white mt-1">{typeof gv === "number" ? fmtValue(gk, gv) : typeof gv === "object" ? "—" : String(gv)}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {arrays.map(([k, arr]) => (
            <div key={k} className="space-y-2">
              <p className="text-[11px] text-slate-300 font-bold uppercase tracking-wider">{humanize(k)}</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {arr.map((row, i) => {
                  const entries = row && typeof row === "object" ? Object.entries(row) : [];
                  const label = entries.find(([, v]) => typeof v === "string")?.[1] as string | undefined;
                  const num = entries.find(([, v]) => typeof v === "number")?.[1] as number | undefined;
                  return (
                    <div key={i} className="bg-slate-950/60 border border-white/[0.06] rounded-xl p-3">
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label ? (statusLabel(label) !== label ? statusLabel(label) : label) : "—"}</p>
                      <p className="text-xl font-extrabold text-white mt-1">{num !== undefined ? num.toLocaleString("fr-FR") : "—"}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
