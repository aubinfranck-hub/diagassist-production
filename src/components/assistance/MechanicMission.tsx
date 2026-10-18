import { useEffect, useState } from "react";
import { Banknote, Loader2, MapPin, MessageCircle, Navigation, Phone, Plus, Wrench } from "lucide-react";
import {
  api, faultCodesList, formatXOF, LINE_LABEL, LINE_ORDER, mapsDirections, mediaUrl, PAYMENT_LABEL, Quote, QuoteLine,
  quoteTotal, telHref, vehicleLabel, whatsappHref,
} from "./api";
import { TrackMap } from "./AssistanceMaps";
import { btnGreen, btnPrimary, btnSecondary, Card, ChatPanel, errText, inputCls, Notice } from "./ui";

export interface ProMission {
  id: string;
  requestId?: string;
  status: string;
  service?: string;
  serviceLabel?: string;
  vehicle?: any;
  symptoms?: string;
  faultCodes?: string[] | string;
  description?: string;
  clientPhone?: string;
  contactPhone?: string;
  position?: { lat: number; lng: number; address?: string; landmark?: string };
  diagnostic?: { summary?: string; faultCodes?: string[] | string } | string | null;
  diagnosisText?: string;
  quotes: Quote[];
  quoteStatus?: string;
  media: { id: string; mime?: string }[];
  payment?: { status?: string; amount?: number } | null;
  paymentStatus?: string;
  createdAt?: number;
  total?: number | null;
  amount?: number | null;
  [k: string]: unknown;
}

/** Le détail peut arriver à plat ou sous { mission } / { request } : on aplatit sans rien inventer. */
export function normalizeMission(raw: any): ProMission {
  const m = raw?.mission ?? raw ?? {};
  const r = raw?.request ?? m.request ?? {};
  const out = { ...r, ...m } as ProMission;
  out.quotes = raw?.quotes ?? m.quotes ?? [];
  out.media = raw?.media ?? m.media ?? [];
  out.payment = raw?.payment ?? m.payment ?? null;
  out.paymentStatus = (out.payment?.status as string) ?? (m.paymentStatus as string) ?? (r.paymentStatus as string) ?? "aucun";
  out.diagnostic = raw?.diagnostic ?? m.diagnostic ?? r.diagnostic ?? null;
  return out;
}

const PRO_STATUS: Record<string, string> = {
  affectee: "Mission acceptée : rendez-vous chez le client",
  en_route: "Vous êtes en route",
  sur_place: "Vous êtes sur place",
  en_intervention: "Intervention en cours",
  terminee: "Mission terminée",
  annulee: "Mission annulée",
};

export default function MechanicMission({
  mission, onChanged,
}: { mission: ProMission; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [diag, setDiag] = useState(mission.diagnosisText || "");
  const [tariffs, setTariffs] = useState<Record<string, { deplacement?: number; diagnostic?: number }>>({});
  const reqId = (mission.requestId as string) || mission.id;
  const st = mission.status;
  const pending = mission.quotes.some((q) => q.status === "propose") || mission.quoteStatus === "propose";
  const diagnosticFile = mission.diagnostic;

  useEffect(() => {
    api<{ tariffs: typeof tariffs }>("/tariffs").then((d) => setTariffs(d.tariffs || {})).catch(() => {});
  }, []);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key); setError(""); setNotice("");
    try { await fn(); if (ok) setNotice(ok); await onChanged(); }
    catch (e) { setError(errText(e)); }
    finally { setBusy(""); }
  };
  const setStatus = (to: string) => run(to, () => api(`/pro/missions/${mission.id}/status`, { body: { to } }));

  const pos = mission.position;
  const clientPhone = (mission.clientPhone ?? mission.contactPhone) as string | undefined;
  const hasInitial = mission.quotes.some((q) => q.kind === "initial" && q.status !== "refuse");
  const canQuote = (st === "sur_place" || st === "en_intervention") && !pending;
  const canCash = ["sur_place", "en_intervention", "terminee"].includes(st) && ["aucun", "en_attente", "echoue"].includes(mission.paymentStatus || "aucun");
  const live = !["terminee", "annulee"].includes(st);

  return (
    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      <Card className="space-y-3 !border-2 !border-red-500/40">
        <div className="text-xs font-black uppercase tracking-wider text-red-500">Mission en cours</div>
        <h2 className="text-xl font-black text-white leading-tight">{PRO_STATUS[st] || st}</h2>
        <div className="text-sm text-slate-300 space-y-1">
          <div><span className="text-slate-500">Service :</span> {mission.serviceLabel || mission.service}</div>
          <div><span className="text-slate-500">Véhicule :</span> {vehicleLabel(mission.vehicle)}</div>
          <div><span className="text-slate-500">Panne :</span> {mission.symptoms || "—"}</div>
          {mission.description && <div><span className="text-slate-500">Détails :</span> {mission.description}</div>}
          {faultCodesList(mission.faultCodes).length > 0 && <div><span className="text-slate-500">Codes défaut :</span> {faultCodesList(mission.faultCodes).join(", ")}</div>}
        </div>

        {/* Étapes de la mission */}
        <div className="space-y-2 pt-1">
          {st === "affectee" && <button className={btnPrimary} disabled={!!busy} onClick={() => setStatus("en_route")}>{busy === "en_route" && <Loader2 className="w-5 h-5 animate-spin" />} Je pars</button>}
          {st === "en_route" && <button className={btnPrimary} disabled={!!busy} onClick={() => setStatus("sur_place")}>{busy === "sur_place" && <Loader2 className="w-5 h-5 animate-spin" />} Je suis arrivé</button>}
          {st === "sur_place" && <button className={btnPrimary} disabled={!!busy} onClick={() => setStatus("en_intervention")}>{busy === "en_intervention" && <Loader2 className="w-5 h-5 animate-spin" />} Je commence</button>}
          {st === "en_intervention" && (
            <>
              <button className={btnGreen} disabled={!!busy || pending} onClick={() => setStatus("terminee")}>{busy === "terminee" && <Loader2 className="w-5 h-5 animate-spin" />} Terminer la mission</button>
              {pending && <p className="text-xs text-amber-400">Un devis attend l'accord du client : vous pourrez terminer ensuite.</p>}
            </>
          )}
          {["affectee", "en_route", "sur_place"].includes(st) && (
            <button
              className="w-full min-h-[44px] text-sm font-bold text-red-400 underline underline-offset-4 cursor-pointer"
              disabled={!!busy}
              onClick={() => {
                const reason = window.prompt("Pourquoi ne pouvez-vous plus assurer cette mission ?");
                if (reason !== null) void run("release", () => api(`/pro/missions/${mission.id}/release`, { body: { reason: reason.trim() || "Désistement" } }));
              }}
            >
              Je ne peux plus assurer cette mission
            </button>
          )}
        </div>
      </Card>

      {/* Client + itinéraire */}
      {live && (
        <Card className="space-y-3">
          <h3 className="text-base font-black text-white flex items-center gap-2"><MapPin className="w-5 h-5 text-red-500" /> Le client</h3>
          {pos?.address && <div className="text-sm text-slate-200">{pos.address}</div>}
          {pos?.landmark && <div className="text-sm text-slate-400">Repère : {pos.landmark}</div>}
          {pos && <TrackMap client={{ lat: pos.lat, lng: pos.lng }} height="h-52" />}
          {pos && (
            <div className="grid grid-cols-2 gap-3">
              <a href={mapsDirections(pos.lat, pos.lng)} target="_blank" rel="noopener noreferrer" className={btnPrimary}><Navigation className="w-5 h-5" /> Itinéraire</a>
              <a href={`geo:${pos.lat},${pos.lng}?q=${pos.lat},${pos.lng}`} className={btnSecondary}>Appli carte</a>
            </div>
          )}
          {clientPhone && (
            <div className="grid grid-cols-2 gap-3">
              <a href={telHref(clientPhone)} className={btnGreen}><Phone className="w-5 h-5" /> Appeler</a>
              <a href={whatsappHref(clientPhone)} target="_blank" rel="noopener noreferrer" className={btnSecondary}><MessageCircle className="w-5 h-5" /> WhatsApp</a>
            </div>
          )}
        </Card>
      )}

      {/* Dossier IA : seulement si le client a donné son accord */}
      {diagnosticFile && (
        <Card className="space-y-2">
          <h3 className="text-base font-black text-white">Dossier DiagAssist</h3>
          <p className="text-xs text-slate-500">Transmis avec l'accord du client. Ce sont des pistes à vérifier, pas une certitude.</p>
          <div className="text-sm text-slate-300 whitespace-pre-wrap">
            {typeof diagnosticFile === "string" ? diagnosticFile : diagnosticFile.summary}
          </div>
          {typeof diagnosticFile !== "string" && faultCodesList(diagnosticFile.faultCodes).length > 0 && (
            <div className="text-sm text-slate-400">Codes défaut : {faultCodesList(diagnosticFile.faultCodes).join(", ")}</div>
          )}
        </Card>
      )}

      {mission.media.length > 0 && (
        <Card className="space-y-2">
          <h3 className="text-base font-black text-white">Photos et fichiers du client</h3>
          <div className="flex flex-wrap gap-2">
            {mission.media.map((m) => m.mime?.startsWith("image/") ? (
              <a key={m.id} href={mediaUrl(m.id)} target="_blank" rel="noopener noreferrer"><img src={mediaUrl(m.id)} alt="Pièce jointe" loading="lazy" className="w-24 h-24 object-cover rounded-xl border border-white/[0.1]" /></a>
            ) : m.mime?.startsWith("video/") ? (
              <video key={m.id} src={mediaUrl(m.id)} controls preload="none" className="w-48 rounded-xl" />
            ) : (
              <audio key={m.id} src={mediaUrl(m.id)} controls preload="none" className="w-full" />
            ))}
          </div>
        </Card>
      )}

      {/* Constat */}
      {["sur_place", "en_intervention", "terminee"].includes(st) && (
        <Card className="space-y-3">
          <h3 className="text-base font-black text-white flex items-center gap-2"><Wrench className="w-5 h-5 text-red-500" /> Mon diagnostic</h3>
          <textarea value={diag} onChange={(e) => setDiag(e.target.value)} rows={3} maxLength={2000} placeholder="Ce que vous constatez (le client le verra)" className={inputCls} />
          <button className={btnSecondary} disabled={!!busy || diag.trim().length < 3} onClick={() => run("diag", () => api(`/pro/missions/${mission.id}/diagnosis`, { body: { text: diag.trim() } }), "Diagnostic enregistré.")}>Enregistrer le diagnostic</button>
        </Card>
      )}

      {/* Devis déjà émis */}
      {mission.quotes.length > 0 && (
        <Card className="space-y-3">
          <h3 className="text-base font-black text-white">Devis envoyés</h3>
          {mission.quotes.map((q) => (
            <div key={q.id} className="rounded-2xl bg-slate-950/60 border border-white/[0.06] p-3 text-sm space-y-1">
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-200">{q.kind === "supplementaire" ? "Travaux supplémentaires" : "Devis"}</span>
                <span className={`text-xs font-black ${q.status === "accepte" ? "text-emerald-400" : q.status === "refuse" ? "text-slate-400" : "text-amber-400"}`}>
                  {q.status === "accepte" ? "Accepté" : q.status === "refuse" ? "Refusé" : "En attente du client"}
                </span>
              </div>
              {q.lines.map((l, i) => <div key={i} className="flex justify-between text-slate-400"><span>{LINE_LABEL[l.kind]}{l.label && l.label !== LINE_LABEL[l.kind] ? ` · ${l.label}` : ""}</span><span>{formatXOF(l.amount)}</span></div>)}
              <div className="flex justify-between font-black text-white pt-1 border-t border-white/[0.06]"><span>Total</span><span>{formatXOF(quoteTotal(q))}</span></div>
            </div>
          ))}
        </Card>
      )}

      {canQuote && (
        <QuoteBuilder
          kind={hasInitial ? "supplementaire" : "initial"}
          defaults={hasInitial ? {} : tariffs[mission.service || ""] || {}}
          busy={busy === "quote"}
          onSend={(lines, note, kind) => run("quote", () => api(`/pro/missions/${mission.id}/quotes`, { body: { kind, lines, note: note || undefined } }), "Devis envoyé au client.")}
        />
      )}
      {(st === "sur_place" || st === "en_intervention") && pending && <Notice tone="warn">Devis envoyé : en attente de la réponse du client.</Notice>}

      {/* Paiement */}
      {(mission.paymentStatus && mission.paymentStatus !== "aucun") || canCash ? (
        <Card className="space-y-3">
          <h3 className="text-base font-black text-white">Paiement</h3>
          <div className="text-sm text-slate-300">Statut : <strong>{PAYMENT_LABEL[mission.paymentStatus || "aucun"]}</strong></div>
          {canCash && (
            <button className={btnGreen} disabled={!!busy} onClick={() => {
              if (window.confirm("Confirmez-vous avoir reçu les espèces du client ?")) void run("cash", () => api(`/pro/missions/${mission.id}/cash-received`, { body: {} }), "Espèces déclarées. Le client doit aussi confirmer.");
            }}>
              <Banknote className="w-5 h-5" /> Espèces reçues
            </button>
          )}
        </Card>
      ) : null}

      <ChatPanel requestId={reqId} me="pro" disabled={st === "annulee"} />
    </div>
  );
}

function QuoteBuilder({
  kind, defaults, busy, onSend,
}: {
  kind: "initial" | "supplementaire";
  defaults: { deplacement?: number; diagnostic?: number };
  busy: boolean;
  onSend: (lines: QuoteLine[], note: string, kind: "initial" | "supplementaire") => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({
    deplacement: defaults.deplacement ? String(defaults.deplacement) : "",
    diagnostic: defaults.diagnostic ? String(defaults.diagnostic) : "",
    main_oeuvre: "", pieces: "",
  });
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(kind === "initial");

  // Les tarifs de départ arrivent après le premier rendu : on ne remplace que les champs encore vides.
  useEffect(() => {
    setAmounts((a) => ({
      ...a,
      deplacement: a.deplacement || (defaults.deplacement ? String(defaults.deplacement) : ""),
      diagnostic: a.diagnostic || (defaults.diagnostic ? String(defaults.diagnostic) : ""),
    }));
  }, [defaults.deplacement, defaults.diagnostic]);

  const lines: QuoteLine[] = LINE_ORDER
    .map((k) => ({ kind: k, label: labels[k]?.trim() || undefined, amount: Math.round(Number(amounts[k]) || 0) }))
    .filter((l) => l.amount > 0);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const extra = kind === "supplementaire";

  if (!open) {
    return <button className={btnSecondary} onClick={() => setOpen(true)}><Plus className="w-5 h-5" /> Ajouter des travaux supplémentaires</button>;
  }
  return (
    <Card className={`space-y-3 ${extra ? "!border-2 !border-amber-500/50" : ""}`}>
      <h3 className="text-base font-black text-white">{extra ? "Devis pour travaux supplémentaires" : "Mon devis"}</h3>
      {extra && <Notice tone="warn">Ce devis sera présenté au client comme « travaux supplémentaires ». Il doit l'accepter avant que vous fassiez ces travaux.</Notice>}
      {LINE_ORDER.map((k) => (
        <div key={k} className="grid grid-cols-5 gap-2 items-center">
          <div className="col-span-5 text-sm font-bold text-slate-300">{LINE_LABEL[k]}</div>
          <input className={`${inputCls} col-span-3 !py-3`} placeholder="Précision (facultatif)" value={labels[k] || ""} onChange={(e) => setLabels({ ...labels, [k]: e.target.value })} />
          <input className={`${inputCls} col-span-2 !py-3`} inputMode="numeric" placeholder="FCFA" value={amounts[k]} onChange={(e) => setAmounts({ ...amounts, [k]: e.target.value.replace(/\D/g, "") })} />
        </div>
      ))}
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note pour le client (facultatif)" className={inputCls} />
      <div className="flex justify-between items-baseline"><span className="font-black text-white">Total</span><span className="text-xl font-black text-red-500">{formatXOF(total)}</span></div>
      <button className={btnPrimary} disabled={busy || total <= 0} onClick={() => onSend(lines, note.trim(), kind)}>
        {busy && <Loader2 className="w-5 h-5 animate-spin" />} Envoyer le devis au client
      </button>
    </Card>
  );
}
