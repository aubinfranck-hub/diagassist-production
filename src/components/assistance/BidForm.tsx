import { useState } from "react";
import { Loader2 } from "lucide-react";
import { formatXOF } from "./api";
import { btnGreen, btnSecondary, inputCls } from "./ui";

export interface BidRange { min: number; max: number }

/** Formulaire « Votre prix » : validation locale, tarif de référence en un toucher, délai d'arrivée facultatif. */
export default function BidForm({
  range, tariff, initialAmount, initialEta, busy, submitLabel, onSubmit, onCancel,
}: {
  range?: BidRange | null;
  tariff?: number | null;
  initialAmount?: number | null;
  initialEta?: number | null;
  busy: boolean;
  submitLabel: string;
  onSubmit: (amount: number, etaMinutes?: number) => void;
  onCancel?: () => void;
}) {
  const [amount, setAmount] = useState(initialAmount ? String(initialAmount) : "");
  const [eta, setEta] = useState(initialEta ? String(initialEta) : "");
  const n = Math.round(Number(amount) || 0);
  const e = eta === "" ? undefined : Math.round(Number(eta));

  let problem = "";
  if (amount !== "" && n <= 0) problem = "Entrez un prix supérieur à 0.";
  else if (range && n > 0 && (n < range.min || n > range.max)) problem = `Votre prix doit être compris entre ${formatXOF(range.min)} et ${formatXOF(range.max)}.`;
  else if (e !== undefined && (!Number.isFinite(e) || e < 1 || e > 240)) problem = "Le délai d'arrivée doit être compris entre 1 et 240 minutes.";
  const ok = n > 0 && !problem;

  return (
    <div className="space-y-3 rounded-2xl bg-slate-950/60 border border-white/[0.06] p-3">
      <label className="block space-y-1">
        <span className="text-sm font-black text-white">Votre prix (F CFA)</span>
        <input className={inputCls} inputMode="numeric" placeholder="Ex. 15000" value={amount} onChange={(ev) => setAmount(ev.target.value.replace(/\D/g, ""))} aria-invalid={!!problem} />
      </label>
      {range && <p className="text-xs text-slate-400">Fourchette acceptée : {formatXOF(range.min)} à {formatXOF(range.max)}</p>}
      {tariff ? (
        <button type="button" className={btnSecondary} onClick={() => setAmount(String(tariff))}>Tarif de référence {formatXOF(tariff)}</button>
      ) : null}
      <label className="block space-y-1">
        <span className="text-sm font-bold text-slate-300">Délai d'arrivée en minutes (facultatif)</span>
        <input className={inputCls} inputMode="numeric" placeholder="Sinon, nous l'estimons" value={eta} onChange={(ev) => setEta(ev.target.value.replace(/\D/g, ""))} />
      </label>
      {problem && <p className="text-sm text-red-400" role="alert">{problem}</p>}
      <div className={onCancel ? "grid grid-cols-2 gap-3" : ""}>
        {onCancel && <button type="button" className={btnSecondary} disabled={busy} onClick={onCancel}>Annuler</button>}
        <button type="button" className={btnGreen} disabled={busy || !ok} onClick={() => onSubmit(n, e)}>
          {busy && <Loader2 className="w-5 h-5 animate-spin" />} {submitLabel}
        </button>
      </div>
    </div>
  );
}
