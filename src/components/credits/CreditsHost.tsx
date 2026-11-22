import React, { useEffect, useRef, useState } from "react";
import { Ticket, X, Loader2, Check, AlertCircle } from "lucide-react";
import { CreditsInfo, CreditsOpenDetail, creditsChanged, fetchCredits, formatFcfa } from "./creditsBus";

type Method = "orange" | "wave" | "mtn" | "moov";
const METHODS: { id: Method; label: string }[] = [
  { id: "orange", label: "Orange Money" }, { id: "wave", label: "Wave" }, { id: "mtn", label: "MTN MoMo" }, { id: "moov", label: "Moov Money" },
];

/** Fenêtre d'achat des packs. À monter une seule fois (App) : elle écoute `diag-credits-open` et le retour de Jèko (?credits=return). */
export default function CreditsHost() {
  const [open, setOpen] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [info, setInfo] = useState<CreditsInfo | null>(null);
  const [packId, setPackId] = useState("");
  const [method, setMethod] = useState<Method>("orange");
  const [payerPhone, setPayerPhone] = useState("");
  const [state, setState] = useState<"idle" | "creating" | "waiting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const timer = useRef<number | undefined>(undefined);

  const stopPolling = () => { if (timer.current) window.clearInterval(timer.current); timer.current = undefined; };
  useEffect(() => stopPolling, []);

  const poll = (reference: string) => {
    stopPolling();
    setState("waiting"); setMessage("Paiement en cours de vérification…");
    let tries = 0;
    const check = async () => {
      tries++;
      try {
        const res = await fetch(`/api/credits/status/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${localStorage.getItem("auth_session_token") || ""}` } });
        const d = await res.json();
        if (d.success && d.status === "paye") { stopPolling(); setState("success"); setMessage(`${d.credits} diagnostics ajoutés à votre compte.`); creditsChanged(); setInfo(await fetchCredits()); return; }
        if (d.success && d.status === "echoue") { stopPolling(); setState("error"); setMessage("Le paiement a échoué ou a été annulé. Rien n'a été débité."); return; }
      } catch { /* réseau instable : on réessaie */ }
      if (tries >= 60) { stopPolling(); setState("error"); setMessage("Nous n'avons pas encore reçu la confirmation. Si vous avez payé, vos diagnostics arriveront dans quelques minutes."); }
    };
    check();
    timer.current = window.setInterval(check, 5000);
  };

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = ((e as CustomEvent<CreditsOpenDetail>).detail || {}) as CreditsOpenDetail;
      setOpen(true); setExhausted(Boolean(detail.exhausted));
      if (!detail.reference) { setState("idle"); setMessage(""); }
      fetchCredits().then(i => { setInfo(i); if (i?.packs.length) setPackId(p => p || i.packs[0].id); });
      if (detail.reference) poll(detail.reference);
    };
    window.addEventListener("diag-credits-open", onOpen);
    // Retour de l'opérateur de paiement : ?credits=return&reference=dgcr-…
    const q = new URLSearchParams(window.location.search);
    if (q.get("credits") === "return" && q.get("reference")) {
      const ref = q.get("reference")!;
      q.delete("credits"); q.delete("reference");
      window.history.replaceState({}, "", `${window.location.pathname}${q.toString() ? `?${q}` : ""}`);
      onOpen(new CustomEvent("diag-credits-open", { detail: { reference: ref } }));
    }
    return () => window.removeEventListener("diag-credits-open", onOpen);
  }, []);

  const close = () => { stopPolling(); setOpen(false); };
  if (!open) return null;

  const pack = info?.packs.find(p => p.id === packId);
  const pay = async () => {
    if (!pack) return;
    setState("creating"); setMessage("");
    try {
      const res = await fetch("/api/credits/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("auth_session_token") || ""}` },
        body: JSON.stringify({ packId: pack.id, paymentMethod: method, payerPhone: payerPhone || undefined }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.message || "Paiement impossible pour le moment.");
      if (d.redirectUrl) window.location.assign(d.redirectUrl); // retour automatique sur DiagAssist après le paiement
      else poll(d.reference);
    } catch (e: any) { setState("error"); setMessage(e.message || "Erreur réseau."); }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Packs de diagnostics">
      <div className="w-full max-w-md bg-slate-900 text-slate-100 border border-white/10 rounded-2xl p-5 space-y-4 max-h-[92vh] overflow-y-auto" data-testid="credits-modal">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2"><Ticket className="w-5 h-5 text-amber-400" /><h2 className="font-extrabold text-base">Packs de diagnostics IA</h2></div>
          <button onClick={close} aria-label="Fermer" className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
        </div>

        {exhausted && state === "idle" && (
          <div className="flex gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200" data-testid="credits-exhausted">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Vos diagnostics gratuits sont terminés. Choisissez un pack pour continuer. L'urgence et le SOS restent toujours gratuits.</span>
          </div>
        )}

        {state === "success" || state === "waiting" || state === "error" ? (
          <div className="text-center space-y-3 py-4" data-testid="credits-result">
            {state === "waiting" && <Loader2 className="w-8 h-8 mx-auto animate-spin text-amber-400" />}
            {state === "success" && <Check className="w-8 h-8 mx-auto text-emerald-400" />}
            {state === "error" && <AlertCircle className="w-8 h-8 mx-auto text-rose-400" />}
            <p className="text-sm">{message}</p>
            {info && state === "success" && <p className="text-xs text-slate-400">Il vous reste {info.total} diagnostic{info.total > 1 ? "s" : ""}.</p>}
            <button onClick={state === "error" ? () => { setState("idle"); setMessage(""); } : close} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-extrabold">
              {state === "error" ? "Réessayer" : state === "success" ? "Continuer" : "Fermer"}
            </button>
          </div>
        ) : !info ? (
          <div className="py-6 text-center"><Loader2 className="w-6 h-6 mx-auto animate-spin text-slate-400" /></div>
        ) : info.packs.length === 0 || !info.paymentEnabled ? (
          <p className="text-sm text-slate-300 py-4">L'achat de diagnostics n'est pas disponible pour le moment. Réessayez plus tard.</p>
        ) : (
          <>
            <p className="text-xs text-slate-400">Il vous reste <strong className="text-amber-400">{info.total}</strong> diagnostic{info.total > 1 ? "s" : ""}. Un diagnostic = une analyse complète de panne avec l'IA.</p>
            <div className="space-y-2">
              {info.packs.map(p => (
                <button key={p.id} onClick={() => setPackId(p.id)} data-testid={`pack-${p.id}`}
                  className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${packId === p.id ? "border-amber-400 bg-amber-400/10" : "border-white/10 hover:bg-white/5"}`}>
                  <span><strong className="block text-sm">{p.label}</strong><span className="text-xs text-slate-400">{p.credits} diagnostics</span></span>
                  <strong className="text-sm text-amber-300">{formatFcfa(p.priceXof)}</strong>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map(m => (
                <button key={m.id} onClick={() => setMethod(m.id)} className={`py-2 rounded-lg text-xs font-extrabold border ${method === m.id ? "border-amber-400 bg-amber-400/10" : "border-white/10 hover:bg-white/5"}`}>{m.label}</button>
              ))}
            </div>
            <input value={payerPhone} onChange={e => setPayerPhone(e.target.value)} inputMode="tel" placeholder="Numéro qui paie (facultatif)"
              className="w-full rounded-lg bg-slate-950 border border-white/10 px-3 py-2 text-sm placeholder:text-slate-500" />
            <button onClick={pay} disabled={!pack || state === "creating"} data-testid="credits-pay"
              className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 font-extrabold text-sm flex items-center justify-center gap-2">
              {state === "creating" && <Loader2 className="w-4 h-4 animate-spin" />}
              {pack ? `Payer ${formatFcfa(pack.priceXof)}` : "Choisir un pack"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
