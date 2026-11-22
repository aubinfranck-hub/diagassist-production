import { useEffect, useState } from "react";
import {
  useAdminLoad, useAction, Loading, ErrorBox, Empty, Feedback, Field, Badge, fmtDate, fmtXof,
  inputCls, btnGhost, btnPrimary, btnDanger, cardCls,
} from "./AdminShared";

type PlanForm = { code: string; label: string; days: string; price: string };

/** Réglages de la mise en avant payante des mécaniciens : formules (durée, prix), activation, liste, offrir / retirer. */
export default function AdminBoosts() {
  const { data, loading, error, reload } = useAdminLoad("/boosts");
  const { busy, fb, run } = useAction();
  const [enabled, setEnabled] = useState(false);
  const [offersFirst, setOffersFirst] = useState(true);
  const [plans, setPlans] = useState<PlanForm[]>([]);
  const [giftPhone, setGiftPhone] = useState("");
  const [giftDays, setGiftDays] = useState("7");

  useEffect(() => {
    const c = data?.config;
    if (!c) return;
    setEnabled(!!c.enabled);
    setOffersFirst(c.offersFirst !== false);
    setPlans((c.plans || []).map((p: any) => ({ code: p.code, label: p.label, days: String(p.days), price: String(p.price) })));
  }, [data]);

  const setPlan = (i: number, k: keyof PlanForm, v: string) => setPlans((all) => all.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const save = async () => {
    const body = { enabled, offersFirst, plans: plans.map((p) => ({ code: p.code, label: p.label.trim(), days: Number(p.days), price: Number(p.price) })) };
    const r = await run("cfg", "/boosts/config", "PUT", body, "Réglages enregistrés.");
    if (r.ok) reload();
  };
  const grant = async () => {
    const r = await run("gift", "/boosts/grant", "POST", { phone: giftPhone.trim(), days: Number(giftDays) }, "Mise en avant offerte.");
    if (r.ok) { setGiftPhone(""); reload(); }
  };
  const revoke = async (ref: string) => {
    if (!window.confirm("Retirer cette mise en avant tout de suite ?")) return;
    const r = await run(ref, `/boosts/${encodeURIComponent(ref)}/revoke`, "POST", undefined, "Mise en avant retirée.");
    if (r.ok) reload();
  };
  const boosts: any[] = data?.boosts || [];

  return (
    <div className={cardCls}>
      <p className="text-[11px] text-slate-300 font-bold uppercase tracking-wider">Mise en avant des mécaniciens (payante)</p>
      <p className="text-[10px] text-slate-500">Un mécanicien qui paie apparaît en premier dans l'annuaire et en tête de la liste « Recommandé » des offres, avec un badge « Mis en avant ». Ses prix restent dans votre fourchette et le client peut toujours trier par prix.</p>
      <Feedback fb={fb} />
      {loading && !data ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <>
          {data && !data.paymentConfigured && <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">Paiement Jèko non configuré sur ce serveur : les mécaniciens ne pourront pas payer.</div>}
          <div className="flex flex-wrap gap-4 text-xs text-slate-300">
            <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-emerald-500" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Mise en avant ouverte aux mécaniciens</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-emerald-500" checked={offersFirst} onChange={(e) => setOffersFirst(e.target.checked)} />Mis en avant en tête des offres (tri « Recommandé »)</label>
          </div>
          <div className="space-y-2">
            {plans.map((p, i) => (
              <div key={i} className="grid grid-cols-3 lg:grid-cols-4 gap-2 bg-slate-900 border border-white/[0.06] rounded-xl p-2">
                <Field label="Nom"><input className={inputCls} value={p.label} onChange={(e) => setPlan(i, "label", e.target.value)} placeholder="1 semaine" /></Field>
                <Field label="Durée (jours)"><input className={inputCls} inputMode="numeric" value={p.days} onChange={(e) => setPlan(i, "days", e.target.value)} /></Field>
                <Field label="Prix (F CFA)"><input className={inputCls} inputMode="numeric" value={p.price} onChange={(e) => setPlan(i, "price", e.target.value)} /></Field>
                <div className="flex items-end"><button className={btnDanger} onClick={() => setPlans((all) => all.filter((_, j) => j !== i))}>Supprimer</button></div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button className={btnGhost} disabled={plans.length >= 6} onClick={() => setPlans((all) => [...all, { code: "", label: "", days: "7", price: "" }])}>Ajouter une formule</button>
            <button className={btnPrimary} disabled={busy === "cfg"} onClick={save}>{busy === "cfg" ? "…" : "Enregistrer"}</button>
          </div>

          <p className="text-[11px] text-slate-300 font-bold uppercase tracking-wider pt-2">Offrir une mise en avant</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Téléphone du mécanicien"><input className={inputCls} inputMode="tel" value={giftPhone} onChange={(e) => setGiftPhone(e.target.value)} placeholder="07 00 00 00 00" /></Field>
            <Field label="Jours"><input className={`${inputCls} !w-20`} inputMode="numeric" value={giftDays} onChange={(e) => setGiftDays(e.target.value)} /></Field>
            <button className={btnPrimary} disabled={!giftPhone.trim() || busy === "gift"} onClick={grant}>Offrir</button>
          </div>

          <p className="text-[11px] text-slate-300 font-bold uppercase tracking-wider pt-2">Achats · {data?.runningCount ?? 0} en cours · encaissé {fmtXof(data?.revenue ?? 0)}</p>
          {boosts.length === 0 ? <Empty text="Aucune mise en avant pour le moment." /> : (
            <div className="space-y-1.5">
              {boosts.map((b) => (
                <div key={b.reference} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                  <b className="text-white">{b.name || b.phone}</b>
                  <span className="text-slate-400">{b.planLabel} · {b.provider === "admin" ? "offert" : fmtXof(b.amount)}</span>
                  <Badge status={b.status === "actif" ? "paye" : b.status} label={b.running ? "En cours" : b.status === "actif" ? (b.startsAt > Date.now() ? "À venir" : "Terminée") : undefined} />
                  <span className="text-slate-500">{b.endsAt ? `jusqu'au ${fmtDate(b.endsAt)}` : fmtDate(b.createdAt)}</span>
                  {b.running && <button className={`${btnDanger} ml-auto`} disabled={busy === b.reference} onClick={() => revoke(b.reference)}>Retirer</button>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
