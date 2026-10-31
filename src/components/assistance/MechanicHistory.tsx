import { useCallback, useState } from "react";
import { api, formatDate, formatXOF, STATUS_SHORT, usePolling, vehicleLabel, quoteTotal } from "./api";
import { normalizeMission, type ProMission } from "./MechanicMission";
import { btnSecondary, Card, errText, inputCls, Notice, Spinner } from "./ui";

const paymentLabel: Record<string, string> = { paye: "Payé", en_attente: "En attente", echoue: "Échoué", annule: "Annulé", non_paye: "Non payé" };

export default function MechanicHistory() {
  const [list, setList] = useState<ProMission[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const load = useCallback(async () => {
    try {
      const data = await api<{ missions: ProMission[] }>("/pro/missions");
      setList(data.missions || []);
      setError("");
    } catch (e) { setError(errText(e)); }
  }, []);
  usePolling(load, 30000, true);
  const query = search.trim().toLocaleLowerCase("fr");
  const visible = (list || []).filter(m =>
    (filter === "all" || (filter === "active" ? !!m.isActive : m.status === filter)) &&
    [m.id, vehicleLabel(m.vehicle), m.symptoms, m.serviceLabel, m.service].join(" ").toLocaleLowerCase("fr").includes(query)
  );
  return <section className="space-y-4">
    <div>
      <h2 className="text-xl font-black text-white">Mes interventions</h2>
      <p className="text-sm text-slate-400">Retrouvez les véhicules pris en charge et vos dépannages. Les 100 interventions les plus récentes sont affichées.</p>
    </div>
    {error && <Notice tone="warn" action={<button className={btnSecondary} onClick={() => void load()}>Réessayer</button>}>{error}{list ? " — La liste peut ne plus être à jour." : ""}</Notice>}
    <label className="block text-sm text-slate-300">Rechercher un véhicule, une panne ou une référence
      <input type="search" className={inputCls} value={search} onChange={e => setSearch(e.target.value)} placeholder="Véhicule, panne, référence…" />
    </label>
    <label className="block text-sm text-slate-300">Afficher
      <select className={inputCls} value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="all">Toutes les interventions</option>
        <option value="active">En cours</option>
        <option value="terminee">Terminées — véhicules dépannés</option>
        <option value="annulee">Annulées</option>
      </select>
    </label>
    {!list && !error && <Spinner />}
    {list && <p className="text-xs text-slate-400" aria-live="polite">{visible.length} intervention(s) affichée(s)</p>}
    {list && visible.length === 0 && <p className="text-sm text-slate-400">{list.length ? "Aucune intervention ne correspond à votre recherche." : "Vos véhicules pris en charge apparaîtront ici dès votre première intervention."}</p>}
    {visible.map(m => <Intervention key={m.id} mission={m} />)}
  </section>;
}

function Intervention({ mission: m }: { mission: ProMission }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ProMission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setBusy(true); setError("");
    try { setDetail(normalizeMission(await api(`/pro/missions/${encodeURIComponent(m.id)}`))); }
    catch (e) { setDetail(null); setError(errText(e)); }
    finally { setBusy(false); }
  };
  return <Card className="!p-4 space-y-3">
    <div className="flex justify-between gap-3">
      <h3 className="font-black text-white break-words">{vehicleLabel(m.vehicle)}</h3>
      <span className="text-xs text-slate-400 shrink-0">{formatDate(m.createdAt)}</span>
    </div>
    <p className="text-xs text-slate-500 break-all">Référence : {m.id}</p>
    <p className="text-sm text-slate-300">{m.serviceLabel || m.service} · {m.mode === "atelier" ? "En atelier" : "Dépannage sur place"}</p>
    <p className="text-sm text-slate-400 whitespace-pre-wrap">{m.symptoms || "Panne non renseignée"}</p>
    <p className="text-sm font-bold text-white">{String(m.statusLabel || STATUS_SHORT[m.status] || m.status)}</p>
    <p className="text-sm text-amber-300">Prix convenu : {m.amountAgreed != null ? formatXOF(m.amountAgreed) : "Non renseigné"}</p>
    <button className={btnSecondary} aria-expanded={open} aria-controls={`intervention-${m.id}`} onClick={() => { setOpen(!open); if (!open) void load(); }}>{open ? "Fermer la fiche" : "Voir la fiche d’intervention"}</button>
    {open && <div id={`intervention-${m.id}`} className="space-y-3 border-t border-white/10 pt-3">
      {busy ? <Spinner /> : error ? <Notice tone="error" action={<button className={btnSecondary} onClick={() => void load()}>Réessayer</button>}>{error}</Notice> : detail && <>
        <div className="text-sm text-slate-300 whitespace-pre-wrap"><strong>Mon diagnostic</strong><p>{typeof detail.proDiagnosis === "string" && detail.proDiagnosis ? detail.proDiagnosis : "Aucun diagnostic enregistré."}</p></div>
        {detail.description && <p className="text-sm text-slate-400 whitespace-pre-wrap">{detail.description}</p>}
        {detail.quotes.length > 0 && <div className="space-y-2"><h4 className="font-bold text-white">Devis et travaux proposés</h4>{detail.quotes.map(q => <div key={q.id} className="rounded-xl bg-slate-950/60 p-3 text-sm text-slate-300">
          <p className="font-bold">{q.status === "accepte" ? "Accepté" : q.status === "refuse" ? "Refusé" : "En attente"} · {formatXOF(quoteTotal(q))}</p>
          {q.lines.map((line, i) => <p key={i}>{line.label || line.kind} : {formatXOF(line.amount)}</p>)}
        </div>)}</div>}
        <div className="text-sm text-slate-300"><h4 className="font-bold text-white">Paiement</h4>
          {detail.payment ? <><p>{paymentLabel[detail.payment.status || ""] || "État non renseigné"} · {formatXOF(detail.payment.amount)}</p>
          {detail.payment.reference && <p className="break-all">Référence : {detail.payment.reference}</p>}
          {detail.payment.status === "paye" && <><p>Net pour vous : {formatXOF(detail.payment.proAmount)}</p><p>Reversement : {detail.payment.payoutStatus === "reverse" ? "Reversé" : "À recevoir"}</p></>}</> : <p>Aucun paiement enregistré.</p>}
        </div>
      </>}
    </div>}
  </Card>;
}
