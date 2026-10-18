import React, { useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  useAdminLoad, useAction, Loading, ErrorBox, Empty, Feedback, Badge, Field,
  inputCls, btnGhost, btnPrimary, cardCls, fmtDate, fmtXof,
} from "./AdminShared";

const METHODS: Record<string, string> = { wave: "Wave", orange: "Orange Money", mtn: "MTN MoMo", moov: "Moov Money", especes: "Espèces" };

export default function AdminPayments() {
  const pays = useAdminLoad("/payments");
  const claims = useAdminLoad("/claims");
  const pa = useAction();
  const ca = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const payments: any[] = pays.data?.payments || [];
  const list: any[] = claims.data?.claims || [];

  const confirmCash = async (ref: string) => {
    if (!window.confirm(`Confirmer la réception des espèces pour la référence ${ref} ?`)) return;
    const r = await pa.run(ref, `/payments/${encodeURIComponent(ref)}/confirm-cash`, "POST", undefined, "Espèces confirmées.");
    if (r.ok) pays.reload();
  };
  const resolve = async (id: string) => {
    const r = await ca.run(id, `/claims/${encodeURIComponent(id)}/resolve`, "POST", { note: (notes[id] || "").trim() }, "Réclamation résolue.");
    if (r.ok) claims.reload();
  };

  return (
    <div className="space-y-5">
      <div className={cardCls}>
        <div className="flex items-center justify-between"><p className="text-[11px] text-slate-300 font-bold uppercase tracking-wider">Paiements</p><button className={btnGhost} onClick={pays.reload}><RefreshCw className="w-3.5 h-3.5 inline mr-1" />Actualiser</button></div>
        <Feedback fb={pa.fb} />
        {pays.loading && !pays.data ? <Loading /> : pays.error ? <ErrorBox message={pays.error} onRetry={pays.reload} /> : payments.length === 0 ? <Empty text="Aucun paiement enregistré." /> : (
          <div className="space-y-1.5">
            {payments.map((p) => (
              <div key={p.reference} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <Badge status={p.status} /><span>{METHODS[p.method] || p.method || "—"}</span><b className="text-white">{fmtXof(p.amount)}</b>
                <span className="font-mono text-slate-400">{p.reference}</span>
                {p.requestId && <span className="text-slate-500">demande #{String(p.requestId).slice(0, 8)}</span>}
                <span className="text-slate-500">{fmtDate(p.createdAt || p.at)}</span>
                {p.status === "especes_a_confirmer" && <button className={`${btnPrimary} ml-auto`} disabled={pa.busy === p.reference} onClick={() => confirmCash(p.reference)}>{pa.busy === p.reference ? "…" : "Confirmer les espèces"}</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={cardCls}>
        <div className="flex items-center justify-between"><p className="text-[11px] text-slate-300 font-bold uppercase tracking-wider">Réclamations</p><button className={btnGhost} onClick={claims.reload}><RefreshCw className="w-3.5 h-3.5 inline mr-1" />Actualiser</button></div>
        <Feedback fb={ca.fb} />
        {claims.loading && !claims.data ? <Loading /> : claims.error ? <ErrorBox message={claims.error} onRetry={claims.reload} /> : list.length === 0 ? <Empty text="Aucune réclamation." /> : (
          <div className="space-y-2">
            {list.map((c) => {
              const resolved = c.status === "resolue" || c.status === "resolved" || !!c.resolvedAt;
              return (
                <div key={c.id} className="bg-slate-900 border border-white/[0.06] rounded-xl p-3 space-y-2 text-xs text-slate-300">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge status={resolved ? "valide" : "en_attente"} label={resolved ? "Résolue" : "Ouverte"} />
                    <b className="text-white">{c.kind || "Réclamation"}</b>
                    {c.requestId && <span className="text-slate-500">demande #{String(c.requestId).slice(0, 8)}</span>}
                    {c.clientPhone && <span className="text-slate-400">{c.clientPhone}</span>}
                    <span className="text-slate-500 ml-auto">{fmtDate(c.createdAt || c.at)}</span>
                  </div>
                  <p>{c.message}</p>
                  {resolved ? (c.note || c.resolutionNote) && <p className="text-slate-400">Résolution : {c.note || c.resolutionNote}</p> : (
                    <div className="flex flex-wrap gap-2 items-end">
                      <div className="flex-1 min-w-[12rem]"><Field label="Note de résolution"><input className={inputCls} value={notes[c.id] || ""} onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))} /></Field></div>
                      <button className={btnPrimary} disabled={!(notes[c.id] || "").trim() || ca.busy === String(c.id)} onClick={() => resolve(String(c.id))}>{ca.busy === String(c.id) ? "…" : "Résoudre"}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
