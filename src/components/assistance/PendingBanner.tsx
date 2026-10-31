import { Clock, Loader2 } from "lucide-react";
import { PendingRequest } from "./offlineQueue";
import { btnSecondary, Notice } from "./ui";

/** Bandeau « demande en attente » (accueil) + messages du rejeu. */
export default function PendingBanner({
  items, busy, notices, onCancel, onDismiss,
}: {
  items: PendingRequest[]; busy: boolean; notices: string[];
  onCancel: (id: string) => void; onDismiss: () => void;
}) {
  return (
    <>
      {notices.length > 0 && (
        <Notice tone="warn" action={<button className={btnSecondary} onClick={onDismiss}>OK</button>}>
          {notices.map((n, i) => <p key={i}>{n}</p>)}
        </Notice>
      )}
      {items.map((p) => (
        <div key={p.id} className="rounded-2xl border-2 border-amber-500/40 bg-amber-500/10 px-4 py-3 space-y-2">
          <div className="flex items-start gap-2.5">
            {busy ? <Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin text-amber-300" /> : <Clock className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black text-amber-300">
                {busy ? "Envoi de votre demande…" : "Demande enregistrée sur ce téléphone — en attente de transmission."}
              </div>
              <p className="text-xs text-amber-200 mt-1">Aucune prise en charge n'est confirmée. Gardez cette page ouverte au retour du réseau pour permettre l'envoi.</p>
              {typeof p.body.symptoms === "string" && p.body.symptoms && (
                <div className="text-xs text-slate-400 truncate">{p.body.symptoms}</div>
              )}
              {p.mediaDropped > 0 && (
                <div className="text-xs text-amber-200 mt-1">
                  {p.mediaDropped} photo(s) ou vidéo(s) trop lourde(s) pour être gardée(s) : vous pourrez les rajouter après l'envoi.
                </div>
              )}
            </div>
          </div>
          <button className={`${btnSecondary} !min-h-[44px] !py-2 !text-sm`} onClick={() => onCancel(p.id)} disabled={busy}>Annuler cette demande</button>
        </div>
      ))}
    </>
  );
}
