import { useCallback, useState } from "react";
import { Loader2, Megaphone } from "lucide-react";
import { api, formatDate, formatXOF, PAY_METHODS, PayMethod, usePolling } from "./api";
import { btnPrimary, Card, errText, inputCls, Notice, Spinner } from "./ui";

interface BoostView {
  enabled: boolean;
  plans: { code: string; label: string; days: number; price: number }[];
  active: { planLabel: string; startsAt: number; endsAt: number } | null;
  paymentConfigured: boolean;
  pending: { reference: string; planLabel: string; amount: number; redirectUrl?: string | null } | null;
  history: { planLabel: string; amount: number; free: boolean; status: string; endsAt: number | null; createdAt: number }[];
}

/** Onglet « Mise en avant » du mécanicien : apparaître en premier dans l'annuaire et les offres, payé via Jèko. */
export default function MechanicBoost() {
  const [data, setData] = useState<BoostView | null>(null);
  const [err, setErr] = useState("");
  const [plan, setPlan] = useState("");
  const [method, setMethod] = useState<PayMethod | "">("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api<BoostView>("/pro/boost")); setErr(""); }
    catch (e) { setErr(errText(e)); }
  }, []);
  usePolling(load, 15000, true);

  if (!data) return err ? <Notice tone="error">{err}</Notice> : <Spinner text="Chargement…" />;

  const chosen = data.plans.find((p) => p.code === plan) || null;
  const pay = async () => {
    if (!chosen || !method || busy) return;
    setBusy(true); setErr("");
    try {
      const d = await api<{ redirectUrl?: string }>("/pro/boost/pay", { body: { plan: chosen.code, method, payerPhone: phone.trim() || undefined } });
      if (d.redirectUrl) { window.location.href = d.redirectUrl; return; }
      setErr("Le paiement n'a pas pu démarrer. Réessayez dans un instant.");
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <div className="flex items-center gap-2 text-lg font-black text-white"><Megaphone className="w-5 h-5 text-sky-400" /> Être mis en avant</div>
        <p className="text-sm text-slate-300">Apparaissez en premier dans l'annuaire des mécaniciens et en tête des offres, avec le badge « Mis en avant ». Votre prix reste soumis à la même fourchette que tout le monde.</p>
      </Card>

      {data.active && (
        <Notice tone="info"><strong>Mise en avant active</strong> ({data.active.planLabel}) jusqu'au {formatDate(data.active.endsAt)}. Un nouvel achat prolonge la période.</Notice>
      )}
      {data.pending && (
        <Notice tone="warn">
          Paiement en attente ({data.pending.planLabel}, {formatXOF(data.pending.amount)}). Il sera pris en compte dès confirmation par votre opérateur.
          {data.pending.redirectUrl && <> <a className="underline font-bold" href={data.pending.redirectUrl}>Reprendre le paiement</a></>}
        </Notice>
      )}
      {err && <Notice tone="error">{err}</Notice>}

      {!data.enabled ? (
        <p className="text-sm text-slate-500 py-3">La mise en avant n'est pas encore ouverte. Elle sera bientôt disponible.</p>
      ) : (
        <Card className="space-y-3">
          <div className="text-xs font-black uppercase tracking-wider text-slate-500">Choisissez une durée</div>
          <div className="grid gap-2">
            {data.plans.map((p) => (
              <button key={p.code} type="button" aria-pressed={plan === p.code} onClick={() => setPlan(p.code)}
                className={`min-h-[52px] rounded-2xl border px-4 py-3 text-left flex items-center justify-between cursor-pointer ${plan === p.code ? "border-sky-400 bg-sky-500/10" : "border-white/[0.1]"}`}>
                <span className="font-black text-white">{p.label} <span className="text-xs font-normal text-slate-400">({p.days} jours)</span></span>
                <span className="font-black text-white">{formatXOF(p.price)}</span>
              </button>
            ))}
          </div>
          {!data.paymentConfigured ? (
            <Notice tone="warn">Le paiement en ligne n'est pas encore activé.</Notice>
          ) : (
            <>
              <div className="text-xs font-black uppercase tracking-wider text-slate-500 pt-1">Payer avec</div>
              <div className="grid grid-cols-2 gap-2">
                {PAY_METHODS.map((m) => (
                  <button key={m.code} type="button" aria-pressed={method === m.code} onClick={() => setMethod(m.code)}
                    className={`min-h-[48px] rounded-2xl border px-3 font-black text-sm cursor-pointer ${method === m.code ? "border-sky-400 bg-sky-500/10 text-white" : "border-white/[0.1] text-slate-300"}`}>{m.label}</button>
                ))}
              </div>
              <input className={inputCls} inputMode="tel" placeholder="Numéro qui paie (facultatif)" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <button className={btnPrimary} disabled={!chosen || !method || busy} onClick={pay}>
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : null} {chosen ? `Payer ${formatXOF(chosen.price)}` : "Choisissez une durée"}
              </button>
            </>
          )}
        </Card>
      )}

      {data.history.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Historique</h3>
          {data.history.map((h, i) => (
            <Card key={i} className="!p-3 flex items-center justify-between gap-2 text-sm">
              <span className="text-white font-bold">{h.planLabel}</span>
              <span className="text-slate-400 text-xs">{h.status === "actif" ? `${h.free ? "Offert · " : ""}jusqu'au ${formatDate(h.endsAt || undefined)}` : "Paiement échoué"}</span>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
