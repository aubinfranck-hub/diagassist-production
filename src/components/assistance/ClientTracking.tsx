import { useCallback, useState } from "react";
import {
  Phone, MessageCircle, Clock, CheckCircle2, Loader2, Flag, WifiOff, AlertTriangle, Star, Check, X,
} from "lucide-react";
import {
  api, AssistanceError, AssistanceStatus, faultCodesList, formatDate, formatXOF, LINE_LABEL, LINE_ORDER,
  MSG_AI_TITLE, mediaUrl, Quote, quoteTotal, RequestDetail, STATUS_LABEL,
  telHref, useOnline, usePolling, vehicleLabel,
} from "./api";
import { MapScreen } from "./AssistanceMaps";
import {
  btnGreen, btnPrimary, btnSecondary, Card, ChatPanel, errText, inputCls, Notice, Spinner, StateBox, Stars,
} from "./ui";

/** Étapes affichées au client une fois le mécanicien trouvé. */
const PHASES = [
  { st: "en_route", label: "En route" },
  { st: "sur_place", label: "Arrivé" },
  { st: "en_intervention", label: "En intervention" },
  { st: "terminee", label: "Terminé" },
] as const;

function initials(name?: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "M";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function Avatar({ name, photo }: { name?: string; photo?: string }) {
  const [broken, setBroken] = useState(false);
  if (photo && !broken) {
    return <img src={photo} alt="" onError={() => setBroken(true)} className="w-16 h-16 rounded-full object-cover border-2 border-white/[0.15] shrink-0" />;
  }
  return (
    <div className="w-16 h-16 rounded-full bg-emerald-600 text-[#ffffff] text-xl font-black flex items-center justify-center shrink-0 border-2 border-white/[0.15]" aria-hidden="true">
      {initials(name)}
    </div>
  );
}

export default function ClientTracking({
  requestId, status, onBack,
}: { requestId: string; status: AssistanceStatus | null; onBack: () => void }) {
  const online = useOnline();
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [fatal, setFatal] = useState<AssistanceError | null>(null);
  const [lastError, setLastError] = useState("");
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [chatOpen, setChatOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<RequestDetail>(`/requests/${requestId}`);
      setDetail(d);
      setFatal(null);
      setLastError("");
    } catch (e) {
      if (e instanceof AssistanceError && (e.unavailable || e.status === 404 || e.status === 401)) setFatal(e);
      else setLastError(errText(e));
    }
  }, [requestId]);

  const status0 = detail?.request.status;
  usePolling(load, 6000, status0 !== "annulee", requestId);

  const act = async (key: string, fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(key); setActionError(""); setNotice("");
    try {
      await fn();
      if (okMsg) setNotice(okMsg);
      await load();
    } catch (e) {
      setActionError(errText(e));
    } finally {
      setBusy("");
    }
  };

  if (fatal) {
    return (
      <div className="space-y-3">
        <StateBox
          icon={<AlertTriangle className="w-7 h-7" />}
          title={fatal.unavailable ? "Assistance momentanément indisponible" : fatal.status === 404 ? "Demande introuvable" : "Connexion requise"}
          text={fatal.message}
        >
          <button className={btnSecondary} onClick={() => { setFatal(null); void load(); }}>Réessayer</button>
          <button className={btnSecondary} onClick={onBack}>Retour à l'accueil</button>
        </StateBox>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="space-y-3">
        {!online && <Notice tone="warn">Vous êtes hors ligne.</Notice>}
        <Spinner text="Chargement de votre demande…" />
        <button className={btnSecondary} onClick={onBack}>Retour</button>
      </div>
    );
  }

  const { request: r, pro, quotes, timeline, media, review, allowed } = detail;
  const st = r.status;
  const assigned = ["affectee", "en_route", "sur_place", "en_intervention", "terminee"].includes(st) && !!pro;
  const live = ["affectee", "en_route", "sur_place", "en_intervention"].includes(st);
  const pendingQuote = quotes.find((q) => (q.status ?? r.quoteStatus) === "propose" && q.status !== "accepte" && q.status !== "refuse");
  const clientPos = r.position ? { lat: r.position.lat, lng: r.position.lng } : null;
  const proPos = pro?.location && ["affectee", "en_route", "sur_place"].includes(st) ? { lat: pro.location.lat, lng: pro.location.lng } : null;
  const amountAgreed = Number(r.amountAgreed) || 0;
  const proDiag = (r.diagnosisText ?? (r as any).proDiagnosis ?? (r as any).diagnosis) as string | undefined;
  const photo = ((pro as any)?.photoUrl || (pro as any)?.photo || (pro as any)?.avatarUrl) as string | undefined;
  const phaseIdx = PHASES.findIndex((p) => p.st === st);
  const searching = st === "recherche" || st === "brouillon";
  const etaMin = pro?.eta ? Math.max(1, Math.round(pro.eta.minutes)) : null;

  const cancelBtn = allowed.cancel ? (
    <button
      className="w-full min-h-[48px] text-sm font-bold text-red-400 hover:text-red-300 underline underline-offset-4 cursor-pointer"
      disabled={!!busy}
      onClick={() => {
        if (window.confirm("Voulez-vous vraiment annuler cette demande ?")) {
          void act("cancel", () => api(`/requests/${requestId}/cancel`, { body: { reason: "Annulée par le client" } }));
        }
      }}
    >
      Annuler ma demande
    </button>
  ) : null;

  const banners = (
    <>
      {!online && <Notice tone="warn"><span className="inline-flex items-center gap-2"><WifiOff className="w-4 h-4" /> Hors ligne : les informations peuvent ne pas être à jour.</span></Notice>}
      {online && lastError && <Notice tone="warn">{lastError}</Notice>}
      {actionError && <Notice tone="error">{actionError}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}
    </>
  );

  // ===================== Recherche en cours =====================
  if (searching) {
    return (
      <MapScreen client={clientPos} pulse onBack={onBack} backLabel="Accueil" footer={cancelBtn}>
        {banners}
        <div className="text-center space-y-2 py-2">
          <Loader2 className="w-7 h-7 text-red-500 animate-spin mx-auto" />
          <h2 className="text-xl font-black text-white">Nous contactons les mécaniciens près de vous</h2>
          <p className="text-sm text-slate-400">
            Le premier qui accepte prend votre demande. Cela peut prendre quelques minutes, vous pouvez quitter cet écran : nous gardons votre demande.
          </p>
          <p className="text-xs text-slate-500">{r.serviceLabel || "Assistance"} · {vehicleLabel(r.vehicle)}{r.symptoms ? ` · ${r.symptoms}` : ""}</p>
        </div>
        {st === "brouillon" && (
          <button className={btnPrimary} disabled={!!busy} onClick={() => act("submit", () => api(`/requests/${requestId}/submit`, { body: {} }))}>Envoyer la demande</button>
        )}
      </MapScreen>
    );
  }

  // ===================== Sans disponibilité / annulée =====================
  if (st === "sans_disponibilite" || st === "annulee") {
    return (
      <MapScreen client={clientPos} onBack={onBack} backLabel="Accueil" footer={<button className={btnSecondary} onClick={onBack}>Retour à l'accueil</button>}>
        {banners}
        <h2 className="text-xl font-black text-white">{STATUS_LABEL[st]}</h2>
        {st === "sans_disponibilite" ? (
          <>
            <Notice tone="warn">
              Aucun mécanicien n'est disponible près de vous pour le moment. Vous pouvez relancer la recherche, ou demander à l'équipe DiagAssist de trouver quelqu'un manuellement.
            </Notice>
            {allowed.retry && <button className={btnPrimary} disabled={!!busy} onClick={() => act("retry", () => api(`/requests/${requestId}/retry`, { body: {} }), "Nous relançons la recherche.")}>Relancer la recherche</button>}
            {allowed.manual && <button className={btnSecondary} disabled={!!busy} onClick={() => act("manual", () => api(`/requests/${requestId}/manual`, { body: {} }), "Demande transmise à l'équipe DiagAssist, elle vous rappellera.")}>Demander une prise en charge manuelle</button>}
            {cancelBtn}
          </>
        ) : (
          <p className="text-sm text-slate-400">Cette demande a été annulée. Vous pouvez en faire une nouvelle depuis l'accueil.</p>
        )}
      </MapScreen>
    );
  }

  // ===================== Mécanicien trouvé / suivi / fin =====================
  const title = st === "terminee" ? "Intervention terminée" : st === "affectee" ? "Mécanicien trouvé" : STATUS_LABEL[st] || st;

  return (
    <MapScreen
      client={clientPos}
      pro={live ? proPos : null}
      onBack={onBack}
      backLabel="Accueil"
      footer={assigned && pro?.phone && st !== "terminee" ? (
        <div className="grid grid-cols-2 gap-3">
          <a href={telHref(pro.phone)} className={btnGreen}><Phone className="w-5 h-5" /> Appeler</a>
          <button className={btnSecondary} onClick={() => setChatOpen((v) => !v)} aria-expanded={chatOpen}>
            <MessageCircle className="w-5 h-5" /> Message
          </button>
        </div>
      ) : undefined}
    >
      {banners}

      {/* Fiche mécanicien */}
      {assigned && pro && (
        <div className="flex items-center gap-3.5">
          <Avatar name={pro.displayName} photo={photo} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-black uppercase tracking-wider text-emerald-400">{title}</div>
            <div className="text-lg font-black text-white truncate">{pro.displayName || "Votre mécanicien"}</div>
            {pro.garageName && <div className="text-sm text-slate-400 truncate">{pro.garageName}</div>}
            {pro.rating ? (
              <div className="text-sm text-amber-400 flex items-center gap-1 font-bold"><Star className="w-4 h-4 fill-amber-400" /> {pro.rating.avg.toFixed(1)} <span className="text-slate-500 font-normal">({pro.rating.count} avis)</span></div>
            ) : <div className="text-xs text-slate-500">Pas encore d'avis</div>}
          </div>
        </div>
      )}

      {/* Temps d'arrivée */}
      {etaMin !== null && ["affectee", "en_route"].includes(st) && pro?.eta && (
        <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 flex items-center gap-3">
          <Clock className="w-7 h-7 text-emerald-400 shrink-0" />
          <div>
            <div className="text-2xl font-black text-white leading-tight">Arrive dans ~{etaMin} min</div>
            <div className="text-xs text-slate-400">À environ {pro.eta.distanceKm.toFixed(1)} km de vous. Estimation, elle peut varier avec la circulation.</div>
          </div>
        </div>
      )}
      {["affectee", "en_route"].includes(st) && !pro?.eta && (
        <p className="text-sm text-slate-400">{pro?.location ? "Votre mécanicien arrive." : "Le temps d'arrivée s'affichera dès que la position du mécanicien est connue."}</p>
      )}
      {st === "sur_place" && <Notice tone="ok">Votre mécanicien est arrivé. Rejoignez-le ou signalez-vous par téléphone.</Notice>}

      {/* Étapes */}
      {phaseIdx >= 0 || st === "affectee" ? (
        <ol className="grid grid-cols-4 gap-1.5" aria-label="Avancement">
          {PHASES.map((p, i) => {
            const done = phaseIdx >= 0 && i < phaseIdx || st === "terminee";
            const cur = i === phaseIdx && st !== "terminee";
            return (
              <li key={p.st} className="text-center">
                <div className={`mx-auto w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${done ? "bg-emerald-600 text-[#ffffff]" : cur ? "bg-red-600 text-[#ffffff] ring-4 ring-red-600/25" : "bg-slate-800 text-slate-500"}`}>
                  {done ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                <div className={`mt-1 text-[11px] leading-tight font-bold ${done || cur ? "text-white" : "text-slate-500"}`}>{p.label}</div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {/* Chat */}
      {assigned && chatOpen && (
        <div>
          <div className="flex justify-end"><button className="text-xs font-bold text-slate-400 min-h-[36px] px-2 inline-flex items-center gap-1 cursor-pointer" onClick={() => setChatOpen(false)}><X className="w-3.5 h-3.5" /> Fermer</button></div>
          <ChatPanel requestId={requestId} me="client" disabled={st === "terminee"} />
        </div>
      )}

      {/* Fin : montant à régler directement + avis */}
      {st === "terminee" && (
        <>
          <div className="text-center space-y-2 py-1">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <h2 className="text-xl font-black text-white">{title}</h2>
          </div>
          {amountAgreed > 0 ? (
            <Notice tone="ok">Montant convenu : <strong>{formatXOF(amountAgreed)}</strong>. À régler directement avec le mécanicien. Aucun paiement via DiagAssist.</Notice>
          ) : (
            <Notice tone="info">Le montant convenu se règle directement avec le mécanicien. Aucun paiement via DiagAssist.</Notice>
          )}
        </>
      )}

      {proDiag && (
        <div><h3 className="text-sm font-black text-white">Constat du mécanicien</h3><p className="text-sm text-slate-300 whitespace-pre-wrap">{proDiag}</p></div>
      )}

      {/* Devis */}
      {quotes.length > 0 && (
        <div className="space-y-3">
          {quotes.map((q, i) => (
            <QuoteCard
              key={q.id} quote={q} index={i}
              canDecide={!!allowed.decideQuote && (q.status ?? "propose") === "propose"}
              busy={busy.startsWith("q")}
              onDecide={(accept) => act(`q${q.id}`, () => api(`/requests/${requestId}/quotes/${q.id}/decision`, { body: { accept } }), accept ? "Devis accepté." : "Devis refusé.")}
            />
          ))}
          {pendingQuote && allowed.decideQuote && <Notice tone="warn">Le mécanicien attend votre réponse pour continuer.</Notice>}
        </div>
      )}

      {/* Avis */}
      {review ? (
        <div className="space-y-1">
          <h3 className="text-sm font-black text-white">Votre avis</h3>
          <Stars value={review.rating} size={26} />
          {review.comment && <p className="text-sm text-slate-400">{review.comment}</p>}
        </div>
      ) : allowed.review ? (
        <ReviewForm onSend={(rating, comment) => act("review", () => api(`/requests/${requestId}/review`, { body: { rating, comment: comment || undefined } }), "Merci pour votre avis.")} busy={busy === "review"} />
      ) : null}
      {allowed.claim && <ClaimForm onSend={(kind, message) => act("claim", () => api(`/requests/${requestId}/claims`, { body: { kind, message } }), "Réclamation envoyée. L'équipe DiagAssist revient vers vous.")} busy={busy === "claim"} />}

      {cancelBtn}

      {/* Détails */}
      <details className="text-sm">
        <summary className="cursor-pointer font-bold text-slate-300 min-h-[44px] flex items-center">Détails de la demande</summary>
        <div className="space-y-2 pt-1">
          <KV k="Date" v={formatDate(r.createdAt)} />
          <KV k="Véhicule" v={vehicleLabel(r.vehicle)} />
          <KV k="Panne" v={r.symptoms || "—"} />
          {faultCodesList(r.faultCodes).length > 0 && <KV k="Codes défaut" v={faultCodesList(r.faultCodes).join(", ")} />}
          {r.position?.address && <KV k="Adresse" v={r.position.address} />}
          {r.position?.landmark && <KV k="Repère" v={r.position.landmark} />}
          {pro?.specialties && pro.specialties.length > 0 && <KV k="Spécialités" v={pro.specialties.join(", ")} />}
          {r.aiAnalysis && <div className="pt-1"><div className="font-bold text-slate-300">{MSG_AI_TITLE}</div><p className="text-slate-400 whitespace-pre-line">{r.aiAnalysis}</p></div>}
          {media.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {media.map((m) => m.mime?.startsWith("image/") ? (
                <img key={m.id} src={mediaUrl(m.id)} alt="Pièce jointe" loading="lazy" className="w-20 h-20 object-cover rounded-xl border border-white/[0.1]" />
              ) : m.mime?.startsWith("video/") ? (
                <video key={m.id} src={mediaUrl(m.id)} controls preload="none" className="w-40 rounded-xl" />
              ) : (
                <audio key={m.id} src={mediaUrl(m.id)} controls preload="none" className="w-full" />
              ))}
            </div>
          )}
          {timeline.length > 0 && (
            <ul className="pt-1 space-y-1.5">
              {timeline.map((t, i) => (
                <li key={i} className="flex justify-between gap-3 text-slate-400"><span>{t.label}</span><span className="text-slate-500 shrink-0">{formatDate(t.at)}</span></li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </MapScreen>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-4"><span className="text-slate-500 shrink-0">{k}</span><span className="text-slate-200 font-semibold text-right break-words min-w-0">{v}</span></div>;
}

function QuoteCard({
  quote, index, canDecide, busy, onDecide,
}: { quote: Quote; index: number; canDecide: boolean; busy: boolean; onDecide: (accept: boolean) => void }) {
  const extra = quote.kind === "supplementaire";
  const byKind = (k: string) => (quote.lines || []).filter((l) => l.kind === k);
  const total = quoteTotal(quote);
  const st = quote.status;
  return (
    <Card className={`space-y-3 ${extra ? "border-2 !border-amber-500/50" : ""}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-base font-black text-white">{extra ? "Travaux supplémentaires" : index === 0 ? "Devis" : "Nouveau devis"}</h3>
        {st === "accepte" && <span className="text-xs font-black text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full">Accepté</span>}
        {st === "refuse" && <span className="text-xs font-black text-slate-400 bg-slate-500/10 px-2.5 py-1 rounded-full">Refusé</span>}
        {(!st || st === "propose") && <span className="text-xs font-black text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full">À valider</span>}
      </div>
      {extra && <Notice tone="warn">Ce sont des travaux en plus du premier devis. Rien ne sera fait sans votre accord.</Notice>}
      <div className="divide-y divide-white/[0.06]">
        {LINE_ORDER.map((k) => {
          const ls = byKind(k);
          const sum = ls.reduce((s, l) => s + (Number(l.amount) || 0), 0);
          return (
            <div key={k} className="py-2.5 flex justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="text-slate-200 font-semibold">{LINE_LABEL[k]}</div>
                {ls.some((l) => l.label && l.label !== LINE_LABEL[k]) && <div className="text-xs text-slate-500 break-words">{ls.map((l) => l.label).filter(Boolean).join(", ")}</div>}
              </div>
              <div className="text-slate-200 font-bold shrink-0">{ls.length ? formatXOF(sum) : "—"}</div>
            </div>
          );
        })}
        <div className="pt-3 flex justify-between items-baseline">
          <span className="text-base font-black text-white">Total</span>
          <span className="text-xl font-black text-red-500">{formatXOF(total)}</span>
        </div>
      </div>
      {quote.note && <p className="text-sm text-slate-400">{quote.note}</p>}
      {canDecide && (
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button className={btnSecondary} disabled={busy} onClick={() => onDecide(false)}>Je refuse</button>
          <button className={btnGreen} disabled={busy} onClick={() => onDecide(true)}>J'accepte</button>
        </div>
      )}
    </Card>
  );
}

function ReviewForm({ onSend, busy }: { onSend: (rating: number, comment: string) => void; busy: boolean }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  return (
    <Card className="space-y-3">
      <h3 className="text-base font-black text-white">Comment s'est passée l'intervention ?</h3>
      <Stars value={rating} onChange={setRating} />
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={500} placeholder="Un commentaire (facultatif)" className={inputCls} />
      <button className={btnPrimary} disabled={!rating || busy} onClick={() => onSend(rating, comment.trim())}>Envoyer mon avis</button>
    </Card>
  );
}

function ClaimForm({ onSend, busy }: { onSend: (kind: string, message: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("prix");
  const [message, setMessage] = useState("");
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 text-sm font-bold text-slate-400 hover:text-white cursor-pointer">
        <Flag className="w-4 h-4" /> Un problème ? Faire une réclamation
      </button>
    );
  }
  return (
    <Card className="space-y-3">
      <h3 className="text-base font-black text-white">Faire une réclamation</h3>
      <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
        <option value="prix">Le prix demandé</option>
        <option value="travail">La qualité du travail</option>
        <option value="retard">Un retard ou une absence</option>
        <option value="comportement">Le comportement du professionnel</option>
        <option value="paiement">Un désaccord sur le montant convenu</option>
        <option value="autre">Autre chose</option>
      </select>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={1000} placeholder="Expliquez ce qui s'est passé" className={inputCls} />
      <div className="grid grid-cols-2 gap-3">
        <button className={btnSecondary} onClick={() => setOpen(false)}>Annuler</button>
        <button className={btnPrimary} disabled={busy || message.trim().length < 5} onClick={() => onSend(kind, message.trim())}>Envoyer</button>
      </div>
    </Card>
  );
}
