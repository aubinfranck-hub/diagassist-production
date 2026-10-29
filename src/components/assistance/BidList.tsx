import { useMemo, useState } from "react";
import { Star, Clock, MapPin, Loader2, Sparkles, RefreshCw } from "lucide-react";
import { Bid, bestBidId } from "./api";
import { btnPrimary, btnSecondary, useCountdown } from "./ui";

function initials(name?: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "M";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function BidAvatar({ name, photo }: { name?: string; photo?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (photo && !broken) {
    return <img src={photo} alt="" onError={() => setBroken(true)} className="w-12 h-12 rounded-full object-cover border-2 border-white/[0.15] shrink-0" />;
  }
  return (
    <div className="w-12 h-12 rounded-full bg-emerald-600 text-[#ffffff] text-base font-black flex items-center justify-center shrink-0 border-2 border-white/[0.15]" aria-hidden="true">
      {initials(name)}
    </div>
  );
}

function Countdown({ until, onEnd }: { until: number; onEnd: () => void }) {
  const s = useCountdown(until, onEnd);
  const mm = Math.floor(s / 60), ss = String(s % 60).padStart(2, "0");
  return <span className={s <= 30 ? "text-amber-400 font-bold" : ""}>Valable {mm}:{ss}</span>;
}

function BidCard({
  bid, best, atelier, busy, disabled, onChoose, onExpire,
}: {
  bid: Bid; best: boolean; atelier: boolean; busy: boolean; disabled: boolean;
  onChoose: (b: Bid) => void; onExpire: () => void;
}) {
  const p = bid.pro;
  const name = p.displayName || "Un mécanicien";
  return (
    <li className={`rounded-2xl border p-3 space-y-2.5 ${best ? "border-emerald-500/50 bg-emerald-500/[0.06]" : "border-white/[0.1] bg-slate-950/40"}`}>
      <div className="flex items-start gap-3">
        <BidAvatar name={name} photo={p.photoUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-black text-white truncate">{name}</span>
            {best && <span className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full"><Sparkles className="w-3 h-3" /> Bon compromis prix / délai</span>}
            {bid.isRevised && <span className="text-[11px] font-black text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">Offre révisée</span>}
          </div>
          <div className="text-sm text-slate-400 flex items-center gap-x-2 flex-wrap">
            {p.garageName && <span className="truncate max-w-full">{p.garageName}</span>}
            {p.rating ? (
              <span className="text-amber-400 inline-flex items-center gap-1 font-bold"><Star className="w-3.5 h-3.5 fill-amber-400" /> {p.rating.avg.toFixed(1)} <span className="text-slate-500 font-normal">({p.rating.count} avis)</span></span>
            ) : <span className="text-xs text-slate-500">Pas encore d'avis</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-black text-white leading-none">{Math.round(bid.amount).toLocaleString("fr-FR")}</div>
          <div className="text-xs font-bold text-slate-400">F CFA</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
        <span className="inline-flex items-center gap-1.5"><Clock className="w-4 h-4 text-emerald-400" />
          {atelier ? "Trajet ~" : "Arrive dans ~"}{Math.max(1, Math.round(bid.etaMinutes))} min <span className="text-xs text-slate-500">(approx.)</span></span>
        <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4 text-slate-400" />{Number(bid.distanceKm).toFixed(1)} km</span>
      </div>
      {p.trainings && p.trainings.length > 0 && (
        <div className="text-xs text-slate-500 truncate">Formations : {p.trainings.map((t) => t.title).join(", ")}</div>
      )}
      <p className="text-xs text-slate-400">Montant proposé : le détail déplacement, diagnostic, main-d’œuvre et pièces n’est pas renseigné dans cette offre. Faites préciser ce qui est compris avant de confirmer.</p>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500 shrink-0 w-[4.5rem] leading-tight"><Countdown until={bid.validUntil} onEnd={onExpire} /></span>
        <button className={`${btnPrimary} !min-h-[48px] !py-2.5 flex-1`} disabled={disabled} onClick={() => onChoose(bid)}>
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : null} Choisir cette offre
        </button>
      </div>
    </li>
  );
}

/** Liste « Offres reçues » : tri, mise en évidence de la meilleure offre, confirmation avant validation. */
export default function BidList({
  bids, atelier, busyId, error, onSelect, onExpire,
}: {
  bids: Bid[]; atelier: boolean; busyId: string; error?: string;
  onSelect: (b: Bid) => void; onExpire: () => void;
}) {
  const [sort, setSort] = useState<"price" | "eta">("price");
  const [confirm, setConfirm] = useState<Bid | null>(null);
  const best = useMemo(() => bestBidId(bids), [bids]);
  const sorted = useMemo(() => [...bids].sort((a, b) =>
    sort === "price" ? a.amount - b.amount || a.etaMinutes - b.etaMinutes : a.etaMinutes - b.etaMinutes || a.amount - b.amount), [bids, sort]);
  // Si l'offre en cours de confirmation disparaît (expirée, retirée), on ferme la confirmation.
  const conf = confirm ? bids.find((b) => b.id === confirm.id) || null : null;
  const chip = (k: "price" | "eta", label: string) => (
    <button type="button" aria-pressed={sort === k} onClick={() => setSort(k)}
      className={`min-h-[36px] px-3 rounded-full text-xs font-black border cursor-pointer ${sort === k ? "bg-red-600 border-red-500 text-[#ffffff]" : "border-white/[0.15] text-slate-300"}`}>{label}</button>
  );

  return (
    <section className="space-y-3" aria-label="Offres reçues">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-base font-black text-white">Offres reçues{bids.length ? ` (${bids.length})` : ""}</h3>
        {bids.length > 1 && <div className="flex gap-2">{chip("price", "Moins cher")}{chip("eta", "Plus rapide")}</div>}
      </div>
      {error && <div role="alert" className="rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      {bids.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.15] px-4 py-5 text-center text-sm text-slate-400 space-y-1">
          <RefreshCw className="w-5 h-5 mx-auto text-slate-500" />
          <p>Les mécaniciens proches reçoivent votre demande, les offres arrivent ici.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {sorted.map((b) => (
            <BidCard key={b.id} bid={b} best={b.id === best} atelier={atelier} busy={busyId === b.id} disabled={!!busyId}
              onChoose={setConfirm} onExpire={onExpire} />
          ))}
        </ul>
      )}
      {conf && (
        <div role="dialog" aria-modal="true" aria-label="Confirmer le choix" className="fixed inset-0 z-[1000] bg-black/70 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-white/[0.15] p-5 space-y-4">
            <p className="text-lg font-black text-white">
              Choisir {Math.round(conf.amount).toLocaleString("fr-FR")} F CFA, {atelier ? "trajet" : "arrive"} dans ~{Math.max(1, Math.round(conf.etaMinutes))} min ?
            </p>
            <p className="text-sm text-slate-400">
              {conf.pro.displayName || "Ce mécanicien"}{conf.pro.garageName ? ` · ${conf.pro.garageName}` : ""}.{" "}
              {atelier ? "Votre visite sera confirmée avec ce garage." : "Les autres offres seront annulées."}
            </p>
            <p className="text-sm text-amber-300">Vous acceptez le montant affiché. Vérifiez ce qu’il couvre ; les travaux supplémentaires devront faire l’objet d’un devis à valider.</p>
            <div className="grid grid-cols-2 gap-3">
              <button className={`${btnSecondary} !px-3`} disabled={!!busyId} onClick={() => setConfirm(null)}>Retour</button>
              <button className={`${btnPrimary} !px-3`} disabled={!!busyId} onClick={() => { onSelect(conf); setConfirm(null); }}>Oui, choisir</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
