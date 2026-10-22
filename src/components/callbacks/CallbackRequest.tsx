import { useId, useState, type FormEvent } from "react";
import { PhoneCall } from "lucide-react";

export default function CallbackRequest({ source, productSlug, requestId }: {
  source: "boutique" | "assistance"; productSlug?: string; requestId?: string;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const token = localStorage.getItem("auth_session_token");
      const res = await fetch("/api/callbacks", { method: "POST", headers: {
        "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }, body: JSON.stringify({ source, productSlug, requestId, phone: data.get("phone"), name: data.get("name"), topic: data.get("topic"), consent: data.get("consent") === "on" }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || "La demande n’a pas pu être enregistrée.");
      setSuccess(result.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Connexion impossible. Réessayez."); }
    finally { setBusy(false); }
  }
  const field = "w-full mt-1 rounded-lg bg-slate-950 border border-slate-600 p-3 text-white text-sm";
  return <details className="rounded-xl border border-emerald-700 bg-slate-900 p-4 text-slate-200 my-3">
    <summary className="cursor-pointer font-bold text-sm min-h-8"><PhoneCall className="inline w-4 h-4 mr-2 text-emerald-400" />Être rappelé par appel WhatsApp</summary>
    {success ? <p role="status" className="text-sm mt-3 text-emerald-300">{success}</p> : <form onSubmit={submit} className="space-y-3 mt-3">
      <p className="text-xs text-slate-400">Un conseiller vous rappellera selon ses disponibilités. Ce formulaire ne déclenche pas un appel immédiat.</p>
      <label className="block text-sm" htmlFor={`${id}-phone`}>Numéro WhatsApp
        <input id={`${id}-phone`} name="phone" type="tel" autoComplete="tel" required maxLength={25} placeholder="07 00 00 00 00 ou +indicatif…" className={field} />
      </label>
      <label className="block text-sm" htmlFor={`${id}-name`}>Votre nom (facultatif)
        <input id={`${id}-name`} name="name" autoComplete="name" maxLength={100} className={field} />
      </label>
      <label className="block text-sm" htmlFor={`${id}-topic`}>{source === "boutique" ? "Pièce recherchée, véhicule et année" : "Votre besoin de dépannage"} (facultatif)
        <textarea id={`${id}-topic`} name="topic" maxLength={500} rows={2} className={field} />
      </label>
      <label className="flex gap-2 items-start text-xs leading-relaxed"><input name="consent" type="checkbox" required className="mt-1" />
        J’accepte d’être contacté par DiagAssist pour ce rappel vocal WhatsApp. Une autorisation pourra aussi m’être demandée dans WhatsApp.
      </label>
      {error && <p role="alert" className="text-red-300 text-sm">{error}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 p-3 text-white text-sm font-bold">{busy ? "Enregistrement…" : "Demander un rappel vocal"}</button>
    </form>}
  </details>;
}
