import { useCallback, useEffect, useState } from "react";

const labels: Record<string, string> = { queued: "À rappeler", permission_pending: "Autorisation demandée", calling: "Appel en cours", review: "Résultat à vérifier", completed: "Traité", cancelled: "Annulé" };
export default function CallbackAdmin({ auth }: { auth?: { header: string; value: string } }) {
  const [source, setSource] = useState("");
  const [closed, setClosed] = useState(false);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const header = auth?.header || "Authorization";
  const value = auth?.value || `Bearer ${localStorage.getItem("auth_session_token") || ""}`;
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/callbacks?source=${source}&closed=${closed}&offset=${offset}`, { headers: { [header]: value } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Chargement impossible.");
      setData(body);
    } catch (e) { setError((e as Error).message); }
  }, [source, closed, offset, header, value]);
  useEffect(() => { setData(null); setError(""); void load(); const timer = setInterval(load, 15000); return () => clearInterval(timer); }, [load]);
  async function action(id: string, action: string, note = "") {
    if (busy) return;
    const text = action === "call" ? "Lancer un appel vocal WhatsApp vers ce client ? Vérifiez que votre poste SIP est disponible." : action === "permission" ? "Envoyer une demande d’autorisation d’appel dans WhatsApp ?" : "Confirmer la clôture de ce rappel ?";
    if (!window.confirm(text)) return;
    setBusy(id); setError("");
    try {
      const res = await fetch(`/api/admin/callbacks/${id}/action`, { method: "POST", headers: { [header]: value, "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || "Action impossible.");
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  return <section className="space-y-4 text-slate-200">
    <h2 className="text-lg font-bold">Rappels vocaux WhatsApp</h2>
    <div className="flex flex-wrap gap-3 text-sm items-center">
      <select aria-label="Service" value={source} onChange={e => { setSource(e.target.value); setOffset(0); }} className="bg-slate-900 border border-slate-600 rounded-lg p-2"><option value="">Tous les services</option><option value="boutique">Boutique</option><option value="assistance">Dépannage</option></select>
      <label><input type="checkbox" checked={closed} onChange={e => { setClosed(e.target.checked); setOffset(0); }} /> Rappels clôturés</label>
      <button onClick={() => { setError(""); void load(); }} className="underline">Actualiser</button>
    </div>
    {data && !data.callingReady && <p className="text-sm text-amber-300">Appels depuis l’administration non activés. Vous pouvez rappeler manuellement avec WhatsApp, puis enregistrer le résultat ici.</p>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {!data ? <p>Chargement…</p> : data.callbacks.length === 0 ? <p>Aucun rappel dans cette liste.</p> : data.callbacks.map((row: any) => <CallbackRow key={row.id} row={row} ready={data.callingReady} busy={!!busy} action={action} />)}
    <div className="flex gap-4"><button disabled={!offset} onClick={() => setOffset(n => Math.max(0, n-50))} className="disabled:opacity-30">Précédent</button><button disabled={!data?.hasMore} onClick={() => setOffset(n => n+50)} className="disabled:opacity-30">Suivant</button></div>
  </section>;
}
function CallbackRow({ row, ready, busy, action }: { row: any; ready: boolean; busy: boolean; action: (id: string, action: string, note?: string) => Promise<void> }) {
  const [note, setNote] = useState(row.operator_note || "");
  const closed = ["completed", "cancelled"].includes(row.status);
  const button = "rounded-lg border border-slate-600 p-2 text-sm disabled:opacity-40";
  return <article className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-2">
    <div className="flex flex-wrap justify-between gap-2"><strong>{row.name || "Client"} · {row.phone}</strong><span className="text-emerald-300">{labels[row.status]}</span></div>
    <p className="text-xs text-slate-400">{row.source === "boutique" ? "Boutique" : "Dépannage"} · {new Date(row.created_at).toLocaleString("fr-FR")}</p>
    {row.context_label && <p>{row.context_label}</p>}
    {row.request_id && <p className="text-xs">Dossier : {row.request_id}</p>}
    {row.topic && <p className="text-sm whitespace-pre-wrap">{row.topic}</p>}
    {row.call_status && <p className="text-sm">Résultat fournisseur : {row.call_status}. Vérifiez que le client a bien été pris en charge.</p>}
    {row.last_error && <p className="text-amber-300 text-sm">{row.last_error}</p>}
    {!closed && <>
      <textarea aria-label="Compte rendu du rappel" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} placeholder="Compte rendu du rappel…" className="w-full rounded-lg p-2 bg-slate-950 text-sm" />
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy || !ready || row.permission_valid || row.status === "calling"} onClick={() => action(row.id, "permission")}>Demander l’autorisation</button>
        <button className={button} disabled={busy || !ready || !row.permission_valid || !!row.call_sid || row.status === "calling"} onClick={() => action(row.id, "call")}>Appeler sur WhatsApp</button>
        <button className={button} disabled={busy || row.status === "calling"} onClick={() => action(row.id, "complete", note)}>Marquer traité</button>
        <button className={button} disabled={busy || row.status === "calling"} onClick={() => action(row.id, "cancel", note)}>Annuler</button>
      </div>
    </>}
    {closed && row.operator_note && <p className="text-sm">{row.operator_note}</p>}
  </article>;
}
