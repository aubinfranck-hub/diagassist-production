import React from "react";
import { RefreshCw } from "lucide-react";
import {
  useAdminLoad, useAction, Loading, ErrorBox, Empty, Feedback, Badge, btnGhost, btnPrimary, cardCls, fmtDate, fmtXof,
} from "./AdminShared";

export default function AdminPayments() {
  const { data, loading, error, reload } = useAdminLoad("/payments");
  const { busy, fb, run } = useAction();
  const payments: any[] = data?.payments || [];

  const payout = async (p: any) => {
    if (!window.confirm(`Confirmer que ${fmtXof(p.pro_amount)} ont bien été reversés à ${p.pro_name || p.pro_phone || "ce mécanicien"} ? Cette action ne peut pas être annulée.`)) return;
    const r = await run(`po${p.reference}`, `/payments/${encodeURIComponent(p.reference)}/payout`, "POST", {}, "Reversement enregistré.");
    if (r.ok) reload();
  };
  const reconcile = async (p: any) => {
    if (!window.confirm("Interroger Jèko pour vérifier l'état réel de ce paiement ?")) return;
    const r = await run(`rc${p.reference}`, `/payments/${encodeURIComponent(p.reference)}/reconcile`, "POST", {}, "Vérification faite.");
    if (r.ok) reload();
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button className={btnGhost} onClick={reload}><RefreshCw className="w-3.5 h-3.5 inline mr-1" />Actualiser</button></div>
      <Feedback fb={fb} />
      {loading && !data ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : payments.length === 0 ? <Empty text="Aucun paiement pour le moment." /> : (
        <div className="space-y-2">
          {payments.map((p) => (
            <div key={p.reference} className={cardCls}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-slate-400">{p.reference}</span>
                <Badge status={p.status} />
                {p.status === "paye" && <Badge status={p.payout_status} />}
                <span className="text-[11px] text-slate-400 ml-auto">{fmtDate(p.created_at)}</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-300">
                <p>Mécanicien : <b className="text-white">{p.pro_name || p.pro_phone || "—"}</b>{p.pro_name && p.pro_phone ? ` (${p.pro_phone})` : ""}</p>
                <p>Client : {p.payer_phone || "—"} · Moyen : {p.method || "—"}</p>
                <p>Brut payé : <b className="text-white">{fmtXof(p.amount)}</b></p>
                <p>Commission ({p.commission_pct ?? "—"} %) : {fmtXof(p.commission_amount)}</p>
                <p>Net pour le mécanicien : <b className="text-white">{fmtXof(p.pro_amount)}</b></p>
                {p.payout_at && <p>Reversé le {fmtDate(p.payout_at)}{p.payout_by ? ` par ${p.payout_by}` : ""}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {p.status === "paye" && p.payout_status !== "reverse" && (
                  <button className={btnPrimary} disabled={!!busy} onClick={() => payout(p)}>{busy === `po${p.reference}` ? "…" : "Marquer reversé"}</button>
                )}
                {p.status !== "paye" && (
                  <button className={btnGhost} disabled={!!busy} onClick={() => reconcile(p)}>{busy === `rc${p.reference}` ? "…" : "Vérifier auprès de Jèko"}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
