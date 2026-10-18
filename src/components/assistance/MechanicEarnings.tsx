import { useCallback, useState } from "react";
import { api, formatDate, formatXOF, ProEarnings, usePolling } from "./api";
import { btnSecondary, Card, errText, Notice, Spinner } from "./ui";

const PAY_STATUS: Record<string, string> = {
  en_attente: "En attente", paye: "Payé", echoue: "Échoué", annule: "Annulé",
};

export default function MechanicEarnings() {
  const [data, setData] = useState<ProEarnings | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try { setData(await api<ProEarnings>("/pro/earnings")); setErr(""); }
    catch (e) { setErr(errText(e)); }
  }, []);
  usePolling(load, 30000, true);

  if (err && !data) return <Notice tone="error" action={<button className={btnSecondary} onClick={() => void load()}>Réessayer</button>}>{err}</Notice>;
  if (!data) return <Spinner text="Chargement de vos gains…" />;

  const payments = data.payments || [];
  return (
    <div className="space-y-4">
      <Notice tone="info">
        Le client paie via DiagAssist ; vous recevez le montant moins la commission de {data.commissionPct ?? 10} %.
      </Notice>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card className="!p-4 col-span-2 sm:col-span-1"><div className="text-[11px] font-black uppercase tracking-wider text-slate-500">Total payé (net)</div><div className="text-xl font-black text-white mt-1">{formatXOF(data.paid)}</div></Card>
        <Card className="!p-4"><div className="text-[11px] font-black uppercase tracking-wider text-slate-500">À recevoir</div><div className="text-lg font-black text-amber-300 mt-1">{formatXOF(data.toReceive)}</div></Card>
        <Card className="!p-4"><div className="text-[11px] font-black uppercase tracking-wider text-slate-500">Déjà reçu</div><div className="text-lg font-black text-emerald-400 mt-1">{formatXOF(data.received)}</div></Card>
      </div>
      <div className="text-xs text-slate-500">Commission DiagAssist appliquée : {data.commissionPct ?? 10} %</div>
      <section className="space-y-2">
        <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Paiements</h3>
        {payments.length === 0 && <p className="text-sm text-slate-500 py-3">Aucun paiement pour le moment.</p>}
        {payments.map((p) => (
          <Card key={p.reference} className="!p-4 space-y-1">
            <div className="flex justify-between gap-2">
              <span className="font-black text-white truncate">{p.serviceLabel || p.service}</span>
              <span className="text-xs text-slate-500 shrink-0">{formatDate(p.createdAt)}</span>
            </div>
            <div className="text-sm text-slate-300 flex justify-between"><span>Montant payé par le client</span><span>{formatXOF(p.grossAmount ?? p.amount)}</span></div>
            <div className="text-sm text-slate-400 flex justify-between"><span>Commission DiagAssist</span><span>− {formatXOF(p.commissionAmount)}</span></div>
            <div className="text-sm font-black text-white flex justify-between"><span>Net pour vous</span><span>{formatXOF(p.proAmount)}</span></div>
            <div className="text-xs font-bold flex justify-between pt-1">
              <span className="text-slate-400">Paiement : {PAY_STATUS[p.status] || p.status}</span>
              <span className={p.payoutStatus === "reverse" ? "text-emerald-400" : "text-amber-400"}>
                {p.payoutStatus === "reverse" ? `Reversé${p.payoutAt ? ` le ${formatDate(p.payoutAt)}` : ""}` : "À recevoir"}
              </span>
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}
