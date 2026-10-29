import { callbackLink } from "./clientSupport";
import { btnSecondary, Notice } from "./ui";

export default function WaitingHelp({ requestId, requested, canRequest, busy, online, onRequest }: {
  requestId: string; requested: boolean; canRequest: boolean; busy: boolean;
  online: boolean; onRequest: () => void;
}) {
  return <section aria-label="Aide pour ma demande" className="space-y-2 rounded-2xl border border-white/10 p-3">
    <h3 className="font-bold text-white">Besoin d'aide pendant l'attente ?</h3>
    {requested ? <Notice tone="info">Votre demande d'aide a été transmise à l'équipe DiagAssist. Aucun délai de rappel n'est encore confirmé.</Notice>
      : canRequest && <button className={btnSecondary} disabled={busy || !online} onClick={onRequest}>
        {busy ? "Transmission…" : "Demander l'aide de DiagAssist"}
      </button>}
    <a className={btnSecondary} href={callbackLink(requestId)} target="_blank" rel="noopener noreferrer">Demander un rappel sur WhatsApp</a>
    <p className="text-xs text-slate-400">WhatsApp ouvre un message avec la référence du dossier. Envoyez-le pour demander un rappel ; ouvrir WhatsApp ne transmet pas le message.</p>
  </section>;
}
