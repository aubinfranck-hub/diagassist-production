import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Clock, Loader2, MapPin, ShieldAlert, ShieldCheck, WifiOff, X } from "lucide-react";
import {
  api, AssistanceError, AssistanceStatus, formatDate, formatXOF, PAYMENT_LABEL, STATUS_SHORT, useOnline, usePolling, vehicleLabel,
} from "./api";
import MechanicMission, { normalizeMission, ProMission } from "./MechanicMission";
import MechanicProfile, { ProProfile } from "./MechanicProfile";
import { btnGreen, btnPrimary, btnSecondary, Card, errText, Notice, Spinner, StateBox, useCountdown } from "./ui";

interface Offer {
  id: string;
  requestId: string;
  service: string;
  serviceLabel: string;
  vehicle?: any;
  symptoms?: string;
  approxPosition?: { lat: number; lng: number; radiusM: number };
  distanceKm?: number;
  expiresAt: number;
}

type Tab = "mission" | "profil" | "historique";
const LIVE_STATUSES = ["affectee", "en_route", "sur_place", "en_intervention"];
const LOCATION_EVERY_MS = 20000;

export default function MechanicSpace({ onBack }: { onBack?: () => void }) {
  const online = useOnline();
  const [tab, setTab] = useState<Tab>("mission");
  const [status, setStatus] = useState<AssistanceStatus | null>(null);
  const [me, setMe] = useState<{ profile: ProProfile | null; directoryMatch: boolean } | null>(null);
  const [fatal, setFatal] = useState<AssistanceError | null>(null);
  const [mission, setMission] = useState<ProMission | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [offerMsg, setOfferMsg] = useState("");
  const [geoMsg, setGeoMsg] = useState("");
  const [blocked, setBlocked] = useState(false);

  const profile = me?.profile || null;

  const loadMe = useCallback(async () => {
    try {
      const d = await api<{ profile: ProProfile | null; directoryMatch: boolean }>("/pro/me");
      setMe({ profile: d.profile ?? null, directoryMatch: !!d.directoryMatch });
      setFatal(null);
      if (!d.profile?.available) setBlocked(false);
    } catch (e) {
      if (e instanceof AssistanceError && (e.unavailable || e.status === 401)) setFatal(e);
    }
  }, []);

  useEffect(() => { api<AssistanceStatus>("/status").then(setStatus).catch(() => {}); }, []);
  usePolling(loadMe, 15000, true);

  // Mission active
  const activeId = profile?.activeMissionId || null;
  const loadMission = useCallback(async () => {
    if (!activeId) { setMission(null); return; }
    try {
      const raw = await api(`/pro/missions/${activeId}`);
      setMission(normalizeMission(raw));
    } catch (e) {
      if (e instanceof AssistanceError && e.status === 404) setMission(null);
    }
  }, [activeId]);
  usePolling(loadMission, 6000, !!activeId, activeId);
  useEffect(() => { if (!activeId) setMission(null); }, [activeId]);

  const refreshAll = useCallback(async () => { await loadMe(); await loadMission(); }, [loadMe, loadMission]);

  // Offres entrantes (polling 5 s) : seulement si disponible et sans mission
  const valid = profile?.validationStatus === "valide";
  const wantsOffers = !!profile?.available && valid && !activeId;
  const loadOffers = useCallback(async () => {
    try {
      const d = await api<{ offers: Offer[] }>("/pro/offers");
      setOffers(d.offers || []);
    } catch { /* garde l'état précédent */ }
  }, []);
  usePolling(loadOffers, 5000, wantsOffers);
  useEffect(() => { if (!wantsOffers) setOffers([]); }, [wantsOffers]);

  // ---- Partage de position ----
  const missionLive = !!mission && LIVE_STATUSES.includes(mission.status);
  const sharing = !!profile && !blocked && valid && (profile.available || (!!activeId && (!mission || missionLive)));
  const latest = useRef<GeolocationPosition | null>(null);

  useEffect(() => {
    if (!sharing || !navigator.geolocation) return;
    let stopped = false;
    let lastSent = 0;

    const stop = (reason: string) => {
      if (stopped) return;
      stopped = true;
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(timer);
      setBlocked(true);
      setGeoMsg(reason);
      void loadMe();
    };
    const send = async () => {
      const p = latest.current;
      if (!p || stopped || !navigator.onLine) return;
      lastSent = Date.now();
      try {
        await api("/pro/location", { body: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } });
        setGeoMsg("");
      } catch (e) {
        if (e instanceof AssistanceError && e.status === 409) stop("Le partage de votre position est arrêté : vous n'êtes plus disponible et aucune mission n'est en cours.");
      }
    };
    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        const first = !latest.current;
        latest.current = p;
        if (first || Date.now() - lastSent >= LOCATION_EVERY_MS) void send();
      },
      (err) => setGeoMsg(err.code === 1
        ? "La localisation est refusée : les clients ne peuvent pas vous voir. Autorisez-la dans les réglages du navigateur."
        : "Position introuvable pour le moment. Nous réessayons."),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
    );
    const timer = window.setInterval(() => void send(), LOCATION_EVERY_MS);
    return () => { stopped = true; navigator.geolocation.clearWatch(watchId); window.clearInterval(timer); latest.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharing]);

  const toggleAvailability = async () => {
    if (!profile) return;
    setError(""); setGeoMsg("");
    if (profile.available) {
      setBusy("avail");
      try { await api("/pro/availability", { body: { available: false } }); setBlocked(false); await loadMe(); }
      catch (e) { setError(errText(e)); }
      finally { setBusy(""); }
      return;
    }
    if (!navigator.geolocation) { setError("La localisation n'est pas disponible sur cet appareil : impossible de recevoir des missions."); return; }
    setBusy("avail");
    navigator.geolocation.getCurrentPosition(
      async (g) => {
        try {
          await api("/pro/availability", { body: { available: true, lat: g.coords.latitude, lng: g.coords.longitude } });
          setBlocked(false);
          await loadMe();
        } catch (e) { setError(errText(e)); }
        finally { setBusy(""); }
      },
      (err) => {
        setBusy("");
        setError(err.code === 1
          ? "Autorisez la localisation dans le navigateur pour passer disponible : les clients sont choisis selon votre position."
          : "Votre position n'a pas pu être trouvée. Réessayez à ciel ouvert.");
      },
      { enableHighAccuracy: true, timeout: 20000 }
    );
  };

  const accept = async (o: Offer) => {
    setBusy(`o${o.id}`); setOfferMsg(""); setError("");
    try {
      await api(`/pro/offers/${o.id}/accept`, { body: {} });
      setOffers([]);
      await refreshAll();
    } catch (e) {
      if (e instanceof AssistanceError && (e.code === "ALREADY_TAKEN" || e.status === 409)) setOfferMsg("Déjà pris par un autre professionnel.");
      else setOfferMsg(errText(e));
      await loadOffers();
    } finally { setBusy(""); }
  };
  const decline = async (o: Offer) => {
    setBusy(`o${o.id}`);
    try { await api(`/pro/offers/${o.id}/decline`, { body: {} }); } catch { /* l'offre disparaîtra au prochain rafraîchissement */ }
    setOffers((p) => p.filter((x) => x.id !== o.id));
    setBusy("");
  };

  // ------------------- Rendu -------------------
  if (fatal) {
    return (
      <Wrap onBack={onBack}>
        <StateBox icon={<AlertTriangle className="w-7 h-7" />} title={fatal.unavailable ? "Assistance momentanément indisponible" : "Connexion requise"} text={fatal.message}>
          <button className={btnSecondary} onClick={() => { setFatal(null); void loadMe(); }}>Réessayer</button>
        </StateBox>
      </Wrap>
    );
  }
  if (!me) return <Wrap onBack={onBack}><Spinner text="Chargement de votre espace…" /></Wrap>;

  const vs = profile?.validationStatus;

  return (
    <Wrap onBack={onBack}>
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-red-500">Espace dépannage</div>
        <h1 className="text-2xl font-black text-white mt-1">Mes missions</h1>
      </div>

      {!online && <Notice tone="warn"><span className="inline-flex items-center gap-2"><WifiOff className="w-4 h-4" /> Hors ligne : le partage de position et les offres reprendront au retour du réseau.</span></Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {geoMsg && <Notice tone="warn">{geoMsg}</Notice>}

      {!profile && (
        <Notice tone="info">
          Créez votre profil pour recevoir des missions. {me.directoryMatch && "Nous avons retrouvé votre fiche dans l'annuaire DiagAssist."}
        </Notice>
      )}
      {profile && vs === "en_attente" && <Notice tone="warn"><strong>Votre profil est en attente de validation par DiagAssist.</strong> Vous pourrez passer disponible dès qu'il sera validé.</Notice>}
      {profile && vs === "suspendu" && <Notice tone="error"><strong>Votre profil est suspendu.</strong> {profile.validationNote || "Contactez DiagAssist pour plus d'informations."}</Notice>}
      {profile && vs === "refuse" && <Notice tone="error"><strong>Votre profil a été refusé.</strong> {profile.validationNote || "Contactez DiagAssist pour plus d'informations."}</Notice>}
      {profile && vs === "valide" && profile.blockers && profile.blockers.length > 0 && (
        <Notice tone="warn"><ul className="list-disc pl-5 space-y-0.5">{profile.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></Notice>
      )}

      {/* Disponibilité */}
      {profile && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-lg font-black text-white">
                {vs === "valide" ? <ShieldCheck className="w-5 h-5 text-emerald-500" /> : <ShieldAlert className="w-5 h-5 text-amber-500" />}
                {profile.available ? "Disponible" : "Indisponible"}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {profile.available ? "Votre position est partagée pour recevoir des offres proches." : "Vous ne recevez aucune offre."}
              </p>
            </div>
            <button
              role="switch" aria-checked={profile.available} aria-label="Disponibilité"
              disabled={busy === "avail" || (vs !== "valide" && !profile.available) || (!!activeId && profile.available)}
              onClick={toggleAvailability}
              className={`relative shrink-0 w-20 h-11 rounded-full transition cursor-pointer disabled:opacity-40 ${profile.available ? "bg-emerald-600" : "bg-slate-700"}`}
            >
              <span className={`absolute top-1 w-9 h-9 rounded-full bg-white shadow transition-all ${profile.available ? "left-[42px]" : "left-1"}`}>
                {busy === "avail" && <Loader2 className="w-5 h-5 m-2 animate-spin text-slate-600" />}
              </span>
            </button>
          </div>
          {sharing && <p className="text-xs text-emerald-400 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Partage de position actif (toutes les 20 secondes environ)</p>}
        </Card>
      )}

      {/* Onglets */}
      <div className="grid grid-cols-3 gap-2 bg-slate-950/60 p-1 rounded-2xl border border-white/[0.06]" role="tablist">
        {([["mission", "Missions"], ["profil", "Mon profil"], ["historique", "Historique"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-[44px] rounded-xl text-sm font-black transition cursor-pointer ${tab === k ? "bg-red-600 text-[#ffffff]" : "text-slate-400"}`}>{l}</button>
        ))}
      </div>

      {tab === "profil" && <MechanicProfile key={profile?.phone || "new"} profile={profile} status={status} onSaved={loadMe} />}

      {tab === "historique" && <History />}

      {tab === "mission" && (
        <>
          {activeId && !mission && <Spinner text="Chargement de la mission…" />}
          {mission && <MechanicMission mission={mission} onChanged={refreshAll} />}

          {!activeId && profile && (
            <div className="space-y-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Offres</h3>
              {offerMsg && <Notice tone="warn">{offerMsg}</Notice>}
              {!profile.available && <p className="text-sm text-slate-500 py-3">Passez « Disponible » pour recevoir des offres de clients proches.</p>}
              {profile.available && offers.length === 0 && (
                <p className="text-sm text-slate-500 py-3 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Aucune offre pour le moment. Nous vous prévenons ici dès qu'un client a besoin de vous.</p>
              )}
              {offers.map((o) => (
                <OfferCard key={o.id} offer={o} busy={busy === `o${o.id}`} onAccept={() => accept(o)} onDecline={() => decline(o)}
                  onExpired={() => setOffers((p) => p.filter((x) => x.id !== o.id))} />
              ))}
            </div>
          )}
        </>
      )}
    </Wrap>
  );
}

function OfferCard({
  offer, busy, onAccept, onDecline, onExpired,
}: { offer: Offer; busy: boolean; onAccept: () => void; onDecline: () => void; onExpired: () => void }) {
  const left = useCountdown(offer.expiresAt, onExpired);
  const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, "0");
  const ap = offer.approxPosition;
  return (
    <Card className="space-y-3 !border-2 !border-red-500/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-black text-white">{offer.serviceLabel}</div>
          <div className="text-sm text-slate-300">{vehicleLabel(offer.vehicle)}</div>
          {offer.symptoms && <div className="text-sm text-slate-400">{offer.symptoms}</div>}
        </div>
        <div className={`shrink-0 inline-flex items-center gap-1.5 font-black text-lg ${left <= 10 ? "text-red-500" : "text-amber-400"}`} aria-live="off">
          <Clock className="w-5 h-5" /> {mm}:{ss}
        </div>
      </div>
      <div className="text-sm text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
        {offer.distanceKm != null && <span>À environ {offer.distanceKm.toFixed(1)} km</span>}
        {ap && <a className="underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps?q=${ap.lat},${ap.lng}`}>Voir la zone sur la carte</a>}
      </div>
      <p className="text-xs text-slate-500">Position approximative : l'adresse exacte vous sera donnée si vous acceptez.</p>
      <div className="grid grid-cols-2 gap-3">
        <button className={btnSecondary} disabled={busy} onClick={onDecline}><X className="w-5 h-5" /> Refuser</button>
        <button className={btnGreen} disabled={busy || left === 0} onClick={onAccept}>{busy && <Loader2 className="w-5 h-5 animate-spin" />} Accepter</button>
      </div>
      {left === 0 && <p className="text-xs text-slate-500 text-center">Offre expirée.</p>}
    </Card>
  );
}

function History() {
  const [list, setList] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try {
      const d = await api<{ missions: any[] }>("/pro/missions");
      setList(d.missions || []);
      setErr("");
    } catch (e) { setErr(errText(e)); }
  }, []);
  usePolling(load, 30000, true);

  if (err && !list) return <Notice tone="error" action={<button className={btnSecondary} onClick={() => void load()}>Réessayer</button>}>{err}</Notice>;
  if (!list) return <Spinner />;
  const paid = list.filter((m) => m.paymentStatus && m.paymentStatus !== "aucun");
  const total = list.filter((m) => m.paymentStatus === "paye").reduce((s, m) => s + (Number(m.total ?? m.amount) || 0), 0);

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Missions</h3>
        {list.length === 0 && <p className="text-sm text-slate-500 py-3">Aucune mission pour le moment.</p>}
        {list.map((m) => (
          <Card key={m.id} className="!p-4 space-y-1">
            <div className="flex justify-between gap-2"><span className="font-black text-white truncate">{m.serviceLabel || m.service}</span><span className="text-xs text-slate-500 shrink-0">{formatDate(m.createdAt)}</span></div>
            <div className="text-sm text-slate-400 truncate">{vehicleLabel(m.vehicle)}{m.symptoms ? ` · ${m.symptoms}` : ""}</div>
            <div className="text-xs font-bold text-slate-300">{STATUS_SHORT[m.status] || m.status}</div>
          </Card>
        ))}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Paiements</h3>
        {paid.length === 0 && <p className="text-sm text-slate-500 py-3">Aucun paiement pour le moment.</p>}
        {paid.length > 0 && <div className="text-sm text-slate-300">Encaissé et confirmé : <strong className="text-white">{formatXOF(total)}</strong></div>}
        {paid.map((m) => (
          <Card key={m.id} className="!p-4 flex justify-between items-center gap-3">
            <div className="min-w-0"><div className="font-bold text-slate-200 truncate">{m.serviceLabel || m.service}</div><div className="text-xs text-slate-500">{formatDate(m.createdAt)}</div></div>
            <div className="text-right shrink-0"><div className="font-black text-white">{formatXOF(m.total ?? m.amount)}</div><div className="text-xs text-slate-400">{PAYMENT_LABEL[m.paymentStatus] || m.paymentStatus}</div></div>
          </Card>
        ))}
      </section>
    </div>
  );
}

function Wrap({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  return (
    <div className="max-w-xl mx-auto space-y-4 pb-24 lg:pb-6">
      {onBack && (
        <button onClick={onBack} className="inline-flex items-center gap-2 min-h-[44px] text-sm font-bold text-slate-400 hover:text-white cursor-pointer">
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>
      )}
      {children}
    </div>
  );
}
