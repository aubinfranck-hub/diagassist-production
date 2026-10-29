import { useCallback, useRef, useState } from "react";
import {
  Phone, MessageCircle, Clock, CheckCircle2, Loader2, Flag, WifiOff, AlertTriangle, Star, Check, X, Navigation, Wallet,
} from "lucide-react";
import {
  api, agreedPriceText, AssistanceError, AssistanceStatus, Bid, bidErrorMessage, faultCodesList, formatDate, formatXOF, LINE_LABEL, LINE_ORDER, mapsDirections, PAY_METHODS, PayMethod,
  MSG_AI_TITLE, mediaUrl, Quote, quoteTotal, RequestDetail, STATUS_LABEL,
  telHref, useOnline, usePolling, vehicleLabel,
} from "./api";
import { MapScreen, PriceMarker } from "./AssistanceMaps";
import BidList from "./BidList";
import WaitingHelp from "./WaitingHelp";
import { positionFreshness } from "./clientSupport";
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
const PHASES_ATELIER = [
  { st: "en_route", label: "Je pars" },
  { st: "sur_place", label: "Arrivé" },
  { st: "en_intervention", label: "Intervention" },
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
  requestId, status, onBack, paymentReturn,
}: { requestId: string; status: AssistanceStatus | null; onBack: () => void; paymentReturn?: boolean }) {
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
  usePolling(load, status0 === "recherche" ? 4000 : 6000, status0 !== "annulee", requestId);
  const [bidBusy, setBidBusy] = useState("");
  const [bidError, setBidError] = useState("");

  // Paiement : on interroge le serveur tant que le règlement n'est pas confirmé (webhook Jèko / réconciliation).
  const payWatchStart = useRef(Date.now());
  const payStatus0 = detail?.request.paymentStatus;
  const payWatching = status0 === "terminee" && payStatus0 !== "paye" && payStatus0 !== "echoue"
    && (!!paymentReturn || payStatus0 === "en_attente") && Date.now() - payWatchStart.current < 180000;
  usePolling(async () => {
    await api(`/requests/${requestId}/payment`);
    await load();
  }, 4000, payWatching, requestId);

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

  const selectBid = async (b: Bid) => {
    setBidBusy(b.id); setBidError(""); setNotice("");
    try {
      await api(`/requests/${requestId}/bids/${encodeURIComponent(b.id)}/select`, { body: {} });
      await load();
    } catch (e) {
      setBidError(bidErrorMessage(e));
      await load();
    } finally {
      setBidBusy("");
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
  const atelier = r.mode === "atelier";
  const visit = r.visitStatus;
  const proposed = atelier && st === "affectee" && visit === "proposee";
  const paid = r.paymentStatus === "paye";
  const phases = atelier ? PHASES_ATELIER : PHASES;
  const assigned = ["affectee", "en_route", "sur_place", "en_intervention", "terminee"].includes(st) && !!pro;
  const live = ["affectee", "en_route", "sur_place", "en_intervention"].includes(st);
  const pendingQuote = quotes.find((q) => (q.status ?? r.quoteStatus) === "propose" && q.status !== "accepte" && q.status !== "refuse");
  const clientPos = r.position ? { lat: r.position.lat, lng: r.position.lng } : null;
  const proPos = pro?.location && ["affectee", "en_route", "sur_place"].includes(st) ? { lat: pro.location.lat, lng: pro.location.lng } : null;
  const amountAgreed = Number(r.amountAgreed) || 0;
  const proDiag = (r.diagnosisText ?? (r as any).proDiagnosis ?? (r as any).diagnosis) as string | undefined;
  const photo = ((pro as any)?.photoUrl || (pro as any)?.photo || (pro as any)?.avatarUrl) as string | undefined;
  const phaseIdx = phases.findIndex((p) => p.st === st);
  const searching = st === "recherche" || st === "brouillon";
  const positionAge = positionFreshness(pro?.location?.updatedAt);
  const arrivalReliable = online && !lastError && !positionAge.stale;
  const etaMin = pro?.eta ? Math.max(1, Math.round(pro.eta.minutes)) : null;

  const cancelBtn = allowed.cancel ? (
    <button
      className="w-full min-h-[44px] text-sm font-bold text-red-400 hover:text-red-300 underline underline-offset-4 cursor-pointer"
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

  const waitingHelp = <WaitingHelp requestId={requestId} requested={r.manualRequested === true}
    canRequest={!!allowed.manual} busy={!!busy} online={online}
    onRequest={() => act("manual", () => api(`/requests/${requestId}/manual`, { body: {} }), "Demande d'aide transmise à l'équipe DiagAssist.")} />;

  // ===================== Recherche en cours : offres des mécaniciens =====================
  if (searching) {
    const bids = detail.bids || [];
    const markers: PriceMarker[] = bids
      .filter((b) => b.pro.location)
      .map((b) => ({ id: b.id, lat: b.pro.location!.lat, lng: b.pro.location!.lng, label: `${Math.round(b.amount).toLocaleString("fr-FR")} F` }));
    return (
      <MapScreen client={clientPos} pulse onBack={onBack} backLabel="Accueil" footer={cancelBtn} markers={markers} tall={bids.length > 0 && st !== "brouillon"}>
        {banners}
        {bids.length > 0 && st !== "brouillon" ? (
          // Des offres sont arrivées : en-tête compact pour laisser la place à la comparaison.
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
            <Loader2 className="w-4 h-4 text-red-500 animate-spin shrink-0" /> D'autres offres peuvent encore arriver.
          </div>
        ) : (
          <div className="text-center space-y-2 py-1">
            <Loader2 className="w-6 h-6 text-red-500 animate-spin mx-auto" />
            <h2 className="text-lg font-black text-white">{atelier ? "Nous contactons les garages près de vous" : "Nous contactons les mécaniciens près de vous"}</h2>
            <div className="flex justify-center gap-1.5" aria-hidden="true">
              {[0, 1, 2].map((i) => <span key={i} className="w-2.5 h-2.5 rounded-full bg-red-500 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />)}
            </div>
            <p className="text-sm text-slate-400">
              Plusieurs mécaniciens vous font une offre de prix, vous comparez et choisissez. Vous pouvez quitter cet écran : nous gardons votre demande.
            </p>
            <p className="text-xs text-slate-500">{r.serviceLabel || "Assistance"} · {vehicleLabel(r.vehicle)}{r.symptoms ? ` · ${r.symptoms}` : ""}</p>
          </div>
        )}
        {r.aiAnalysis && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm">
            <div className="font-bold text-slate-200">{MSG_AI_TITLE}</div>
            <p className="text-slate-400 whitespace-pre-line mt-1">{r.aiAnalysis}</p>
          </div>
        )}
        {st === "brouillon" ? (
          <button className={btnPrimary} disabled={!!busy} onClick={() => act("submit", () => api(`/requests/${requestId}/submit`, { body: {} }))}>Envoyer la demande</button>
        ) : (
          <BidList bids={bids} atelier={atelier} busyId={bidBusy} error={bidError} onSelect={selectBid} onExpire={() => { void load(); }} />
        )}
        {st !== "brouillon" && waitingHelp}
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
            {waitingHelp}
            {cancelBtn}
          </>
        ) : (
          <p className="text-sm text-slate-400">Cette demande a été annulée. Vous pouvez en faire une nouvelle depuis l'accueil.</p>
        )}
      </MapScreen>
    );
  }

  // ===================== Mécanicien trouvé / suivi / fin =====================
  const title = st === "terminee" ? "Intervention terminée"
    : r.statusLabel ? r.statusLabel
    : st === "affectee" ? (atelier ? "Garage choisi" : "Mécanicien choisi") : STATUS_LABEL[st] || st;
  const garagePos = pro?.location ? { lat: pro.location.lat, lng: pro.location.lng } : null;
  const etaLine = pro?.eta ? (
    <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 flex items-center gap-3">
      <Clock className="w-7 h-7 text-emerald-400 shrink-0" />
      <div>
        <div className="text-xl font-black text-white leading-tight">Trajet estimé : ~{Math.max(1, Math.round(pro.eta.minutes))} min</div>
        <div className="text-xs text-slate-400">Environ {pro.eta.distanceKm.toFixed(1)} km jusqu'au garage. Estimation, elle peut varier avec la circulation.</div>
      </div>
    </div>
  ) : null;

  // ----- Atelier : garage proposé, le client confirme -----
  if (proposed && pro) {
    return (
      <MapScreen
        client={clientPos}
        pro={garagePos}
        onBack={onBack}
        backLabel="Accueil"
        footer={allowed.confirmVisit ? (
          <>
            <button className={btnGreen} disabled={!!busy} onClick={() => act("visit", () => api(`/requests/${requestId}/visit`, { body: { accept: true } }))}>
              {busy === "visit" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />} Je confirme, j'y vais
            </button>
            <button className={btnSecondary} disabled={!!busy} onClick={() => act("visitNo", () => api(`/requests/${requestId}/visit`, { body: { accept: false } }), "Nous cherchons un autre mécanicien.")}>
              Autre mécanicien
            </button>
          </>
        ) : undefined}
      >
        {banners}
        <div className="flex items-center gap-3.5">
          <Avatar name={pro.displayName} photo={photo} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-black uppercase tracking-wider text-emerald-400">{r.statusLabel || "Garage proposé"}</div>
            <div className="text-lg font-black text-white truncate">{pro.displayName || "Un mécanicien"}</div>
            {pro.garageName && <div className="text-sm text-slate-400 truncate">{pro.garageName}</div>}
            {pro.rating ? (
              <div className="text-sm text-amber-400 flex items-center gap-1 font-bold"><Star className="w-4 h-4 fill-amber-400" /> {pro.rating.avg.toFixed(1)} <span className="text-slate-500 font-normal">({pro.rating.count} avis)</span></div>
            ) : <div className="text-xs text-slate-500">Pas encore d'avis</div>}
          </div>
        </div>
        <Notice tone="ok">Le garage a été désigné par l'équipe DiagAssist. Confirmez pour y aller.</Notice>
        {etaLine}
        <div className="text-sm text-amber-300 font-bold">{agreedPriceText(r)}</div>
        {!allowed.confirmVisit && <p className="text-sm text-slate-400">Votre confirmation est en cours de prise en compte…</p>}
        {cancelBtn}
      </MapScreen>
    );
  }

  return (
    <MapScreen
      client={clientPos}
      pro={live ? proPos : null}
      onBack={onBack}
      backLabel="Accueil"
      footer={assigned && st !== "terminee" ? (
        <>
          {atelier && allowed.leaving && (
            <button className={`${btnPrimary} !min-h-[58px] !text-lg`} disabled={!!busy} onClick={() => act("leaving", () => api(`/requests/${requestId}/leaving`, { body: {} }))}>
              {busy === "leaving" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Navigation className="w-5 h-5" />} Je pars
            </button>
          )}
          {atelier && garagePos ? (
            // Atelier : trois actions compactes sur une ligne pour laisser la place à l'ETA au-dessus.
            <div className="grid grid-cols-3 gap-2">
              <a href={mapsDirections(garagePos.lat, garagePos.lng)} target="_blank" rel="noopener noreferrer" className={`${btnSecondary} !min-h-[48px] !px-2 !py-2 !text-sm !rounded-xl flex-col !gap-0.5`}>
                <Navigation className="w-4 h-4" /> Itinéraire
              </a>
              {pro?.phone ? <a href={telHref(pro.phone)} className={`${btnGreen} !min-h-[48px] !px-2 !py-2 !text-sm !rounded-xl flex-col !gap-0.5`}><Phone className="w-4 h-4" /> Appeler</a> : <span />}
              {pro?.phone ? (
                <button className={`${btnSecondary} !min-h-[48px] !px-2 !py-2 !text-sm !rounded-xl flex-col !gap-0.5`} onClick={() => setChatOpen((v) => !v)} aria-expanded={chatOpen}>
                  <MessageCircle className="w-4 h-4" /> Message
                </button>
              ) : <span />}
            </div>
          ) : pro?.phone && (
            <div className="grid grid-cols-2 gap-3">
              <a href={telHref(pro.phone)} className={btnGreen}><Phone className="w-5 h-5" /> Appeler</a>
              <button className={btnSecondary} onClick={() => setChatOpen((v) => !v)} aria-expanded={chatOpen}>
                <MessageCircle className="w-5 h-5" /> Message
              </button>
            </div>
          )}
        </>
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

      {assigned && st !== "terminee" && amountAgreed > 0 && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-sm font-bold text-amber-300">Prix convenu</span>
          <span className="text-xl font-black text-white">{formatXOF(amountAgreed)}</span>
        </div>
      )}

      {!atelier && live && pro?.location && <Notice tone={arrivalReliable ? "info" : "warn"}>
        {positionAge.label}.{!arrivalReliable && " La position affichée est la dernière connue, pas une position en direct."}
      </Notice>}
      {/* Temps d'arrivée / trajet */}
      {atelier && ["affectee", "en_route"].includes(st) && etaLine}
      {!atelier && arrivalReliable && etaMin !== null && ["affectee", "en_route"].includes(st) && pro?.eta && (
        <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 flex items-center gap-3">
          <Clock className="w-7 h-7 text-emerald-400 shrink-0" />
          <div>
            <div className="text-xl font-black text-white leading-tight">Arrive dans ~{etaMin} min</div>
            <div className="text-xs text-slate-400">À environ {pro.eta.distanceKm.toFixed(1)} km de vous. Estimation, elle peut varier avec la circulation.</div>
          </div>
        </div>
      )}
      {!atelier && ["affectee", "en_route"].includes(st) && (!pro?.eta || !arrivalReliable) && (
        <p className="text-sm text-slate-400">{pro?.location ? "Le délai d’arrivée doit être actualisé. Vous pouvez contacter le mécanicien." : "Le temps d’arrivée s’affichera dès que la position du mécanicien est connue."}</p>
      )}
      {atelier && st === "affectee" && allowed.leaving && (
        <Notice tone="ok">Visite confirmée. Appuyez sur « Je pars » quand vous quittez l'endroit où vous êtes.</Notice>
      )}
      {st === "sur_place" && <Notice tone="ok">{atelier ? "Vous êtes arrivé au garage. Présentez-vous au mécanicien." : "Votre mécanicien est arrivé. Rejoignez-le ou signalez-vous par téléphone."}</Notice>}

      {/* Étapes */}
      {phaseIdx >= 0 || st === "affectee" ? (
        <ol className="grid grid-cols-4 gap-1.5" aria-label="Avancement">
          {phases.map((p, i) => {
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

      {/* Fin : paiement dans l'appli */}
      {st === "terminee" && (
        <>
          <div className="text-center space-y-2 py-1">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <h2 className="text-xl font-black text-white">{title}</h2>
          </div>
          {amountAgreed > 0 ? (
            <PaymentPanel
              requestId={requestId}
              amount={amountAgreed}
              paymentStatus={r.paymentStatus}
              redirectUrl={detail.payment?.redirectUrl || null}
              methods={status?.paymentMethods}
              notConfigured={!!status && (status.paymentConfigured === false || (Array.isArray(status.paymentMethods) && status.paymentMethods.length === 0))}
              canPay={allowed.pay !== false}
              watching={payWatching}
              returned={!!paymentReturn}
              onCheck={() => act("check", async () => { await api(`/requests/${requestId}/payment`); })}
              checking={busy === "check"}
            />
          ) : (
            <Notice tone="info">Aucun montant à régler pour cette intervention.</Notice>
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
      ) : allowed.review && (amountAgreed <= 0 || paid) ? (
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


function PaymentPanel({
  requestId, amount, paymentStatus, redirectUrl, methods, notConfigured, canPay, watching, returned, onCheck, checking,
}: {
  requestId: string; amount: number; paymentStatus?: string; redirectUrl: string | null;
  methods?: PayMethod[]; notConfigured: boolean; canPay: boolean; watching: boolean; returned: boolean;
  onCheck: () => void; checking: boolean;
}) {
  const [method, setMethod] = useState<PayMethod | "">("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);

  // « Payé » uniquement quand le serveur l'a confirmé (webhook signé ou réconciliation).
  if (paymentStatus === "paye") {
    return (
      <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-4 text-center space-y-1">
        <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
        <div className="text-lg font-black text-white">Paiement reçu</div>
        <div className="text-sm text-slate-300">{formatXOF(amount)} · Merci !</div>
      </div>
    );
  }

  const available = PAY_METHODS.filter((m) => !methods || methods.includes(m.code));
  const pay = async () => {
    if (!method || busy) return;
    setBusy(true); setError("");
    try {
      const d = await api<{ redirectUrl?: string }>(`/requests/${requestId}/pay`, {
        body: { method, payerPhone: phone.trim() || undefined },
      });
      if (d.redirectUrl) { window.location.href = d.redirectUrl; return; }
      setError("Le paiement n'a pas pu démarrer. Réessayez dans un instant.");
    } catch (e) {
      setError(errText(e));
    }
    setBusy(false);
  };

  return (
    <div className="rounded-2xl border-2 border-amber-500/40 px-4 py-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5"><Wallet className="w-4 h-4" /> Montant à payer</div>
          <div className="text-2xl font-black text-white">{formatXOF(amount)}</div>
        </div>
      </div>
      <p className="text-xs text-slate-400">Vous réglez le mécanicien ici, dans l'appli. DiagAssist ne vous facture rien en plus.</p>

      {paymentStatus === "en_attente" && (
        <Notice
          tone="info"
          action={
            <div className="grid grid-cols-1 gap-2">
              {redirectUrl && <button className={btnSecondary} onClick={() => { window.location.href = redirectUrl; }}>Reprendre le paiement</button>}
              <button className={btnSecondary} disabled={checking} onClick={onCheck}>{checking ? "Vérification…" : "Vérifier mon paiement"}</button>
            </div>
          }
        >
          <span className="inline-flex items-center gap-2">
            {watching && <Loader2 className="w-4 h-4 animate-spin" />}
            Paiement en attente de confirmation. {watching ? "Nous vérifions…" : "Si vous avez déjà payé, touchez « Vérifier »."}
          </span>
        </Notice>
      )}
      {paymentStatus !== "en_attente" && returned && paymentStatus !== "echoue" && (
        <Notice tone="info"><span className="inline-flex items-center gap-2">{watching && <Loader2 className="w-4 h-4 animate-spin" />}Nous vérifions votre paiement…</span></Notice>
      )}
      {paymentStatus === "echoue" && <Notice tone="error">Le paiement n'a pas abouti. Vous pouvez réessayer.</Notice>}
      {notConfigured && <Notice tone="warn">Le paiement en ligne n'est pas encore activé.</Notice>}

      {!notConfigured && canPay && paymentStatus === "en_attente" && !changing && (
        <button type="button" className="w-full min-h-[44px] text-sm font-bold text-slate-400 underline underline-offset-4 cursor-pointer" onClick={() => setChanging(true)}>Choisir un autre moyen de paiement</button>
      )}
      {!notConfigured && canPay && (paymentStatus !== "en_attente" || changing) && (
        <>
          <div className="text-sm font-bold text-slate-300">Choisissez comment payer</div>
          <div className="grid grid-cols-2 gap-2.5">
            {available.map((m) => {
              const sel = method === m.code;
              return (
                <button
                  key={m.code} type="button" aria-pressed={sel} onClick={() => setMethod(m.code)}
                  className={`rounded-2xl border-2 min-h-[56px] px-2 flex items-center justify-center gap-2 text-[15px] leading-tight font-black text-white transition cursor-pointer ${sel ? "border-red-500 bg-red-600/15" : "border-white/[0.1] bg-slate-950/60 hover:border-red-500/40"}`}
                >
                  <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: m.color }} aria-hidden="true" />
                  {m.label}
                </button>
              );
            })}
          </div>
          <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Numéro qui paie (facultatif)" aria-label="Numéro qui paie" className={inputCls} />
          {error && <Notice tone="error">{error}</Notice>}
          <button className={`${btnPrimary} !min-h-[56px] !text-lg sticky bottom-1 z-[1]`} disabled={!method || busy} onClick={pay}>
            {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Ouverture du paiement…</> : <>Payer {formatXOF(amount)}</>}
          </button>
        </>
      )}
    </div>
  );
}
