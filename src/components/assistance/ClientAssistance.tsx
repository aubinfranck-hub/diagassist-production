import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, LifeBuoy, LocateFixed, MapPin, WifiOff, Wrench } from "lucide-react";
import {
  api, AssistanceError, AssistanceStatus, formatDate, formatXOF, isFinalStatus, RequestSummary,
  STATUS_SHORT, useOnline, usePolling, vehicleLabel,
} from "./api";
import ClientWizard, { AssistancePrefill } from "./ClientWizard";
import ClientTracking from "./ClientTracking";
import { LatLng, MapScreen, useAddress } from "./AssistanceMaps";
import { btnPrimary, btnSecondary, errText, Notice, Spinner, StateBox } from "./ui";

export type { AssistancePrefill } from "./ClientWizard";

type View = { name: "home" } | { name: "wizard" } | { name: "track"; id: string };

/** Une demande est « active » tant qu'elle n'est ni terminée ni annulée. */
function isActive(r: RequestSummary): boolean {
  return !isFinalStatus(r.status);
}

export default function ClientAssistance({
  prefill, onPrefillUsed, onOpenMechanicSpace, driverMode,
}: {
  prefill?: AssistancePrefill | null;
  onPrefillUsed?: () => void;
  onOpenMechanicSpace?: () => void;
  /** Mode automobiliste : accueil simplifié avec carte, sans lien vers l'espace mécanicien. */
  driverMode?: boolean;
}) {
  const online = useOnline();
  const [status, setStatus] = useState<AssistanceStatus | null>(null);
  const [requests, setRequests] = useState<RequestSummary[] | null>(null);
  const [unavailable, setUnavailable] = useState<string>("");
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<View>(prefill ? { name: "wizard" } : { name: "home" });
  const [wizardPrefill, setWizardPrefill] = useState<AssistancePrefill | null>(prefill || null);
  const autoOpened = useRef(!!prefill);

  // Position de l'automobiliste (accueil) : géolocalisation, sinon repli sur l'épingle à déplacer.
  const [homePos, setHomePos] = useState<LatLng | null>(null);
  const [homeAcc, setHomeAcc] = useState<number | undefined>();
  const [geoMsg, setGeoMsg] = useState("");
  const locate = useCallback(() => {
    if (!navigator.geolocation) { setGeoMsg("Votre téléphone ne permet pas de vous localiser. Touchez la carte pour placer le point rouge là où vous êtes."); return; }
    setGeoMsg("Recherche de votre position…");
    navigator.geolocation.getCurrentPosition(
      (g) => { setHomePos({ lat: g.coords.latitude, lng: g.coords.longitude }); setHomeAcc(g.coords.accuracy); setGeoMsg(""); },
      (err) => setGeoMsg(err.code === 1
        ? "Localisation refusée. Touchez la carte pour placer le point rouge là où vous êtes."
        : "Position introuvable. Touchez la carte pour placer le point rouge là où vous êtes."),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }, []);
  useEffect(() => { locate(); }, [locate]);
  const homeAddr = useAddress(homePos);

  // Une nouvelle pré-remplissage (depuis un diagnostic) ouvre toujours le parcours.
  useEffect(() => {
    if (prefill) { setWizardPrefill(prefill); setView({ name: "wizard" }); autoOpened.current = true; onPrefillUsed?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const loadAll = useCallback(async () => {
    try {
      const st = await api<AssistanceStatus>("/status");
      setStatus(st);
      if (!st.enabled || !st.dbConfigured) {
        setUnavailable("Le service d'assistance n'est pas encore ouvert. Merci de réessayer plus tard.");
        return;
      }
      setUnavailable("");
      const list = await api<{ requests: RequestSummary[] }>("/requests");
      setRequests(list.requests || []);
      setLoadError("");
      if (!autoOpened.current) {
        autoOpened.current = true;
        // Reprise après rafraîchissement : l'état vient du serveur.
        const active = (list.requests || []).find(isActive);
        if (active) setView({ name: "track", id: active.id });
      }
    } catch (e) {
      if (e instanceof AssistanceError && e.unavailable) setUnavailable(e.message);
      else setLoadError(errText(e));
    }
  }, []);

  usePolling(loadAll, 15000, view.name !== "track", view.name);

  // ----- Indisponible -----
  if (unavailable) {
    return (
      <Wrap>
        <StateBox icon={<AlertTriangle className="w-7 h-7" />} title="Assistance momentanément indisponible" text={unavailable}>
          <button className={btnSecondary} onClick={() => void loadAll()}>Réessayer</button>
        </StateBox>
      </Wrap>
    );
  }

  if (view.name === "wizard" && status) {
    return (
      <Wrap>
        <ClientWizard
          status={status}
          prefill={wizardPrefill}
          initialPos={homePos}
          initialAccuracy={homeAcc}
          onClose={() => { setWizardPrefill(null); setView({ name: "home" }); }}
          onCreated={(id) => { setWizardPrefill(null); void loadAll(); setView({ name: "track", id }); }}
        />
      </Wrap>
    );
  }

  if (view.name === "track") {
    return (
      <Wrap>
        <ClientTracking requestId={view.id} status={status} onBack={() => { setView({ name: "home" }); void loadAll(); }} />
      </Wrap>
    );
  }

  // ----- Accueil : carte plein écran + panneau du bas -----
  const anyAvailable = !!status?.services.some((s) => s.available);
  const active = requests?.find(isActive);
  const past = (requests || []).filter((r) => r !== active);

  return (
    <Wrap>
      <MapScreen
        client={homePos}
        accuracy={homeAcc}
        editable
        onChange={(p) => { setHomePos(p); setHomeAcc(undefined); setGeoMsg(""); }}
        footer={
          active ? (
            <button className={btnPrimary} onClick={() => setView({ name: "track", id: active.id })}>
              Voir ma demande en cours <ChevronRight className="w-5 h-5" />
            </button>
          ) : (
            <button className={`${btnPrimary} !min-h-[60px] !text-lg`} disabled={!status || !anyAvailable || !online} onClick={() => { setWizardPrefill(null); setView({ name: "wizard" }); }}>
              <LifeBuoy className="w-6 h-6" /> Je suis en panne
            </button>
          )
        }
      >
        {!online && <Notice tone="warn"><span className="inline-flex items-center gap-2"><WifiOff className="w-4 h-4" /> Vous êtes hors ligne. Reconnectez-vous pour demander de l'aide.</span></Notice>}
        {loadError && online && <Notice tone="warn" action={<button className={btnSecondary} onClick={() => void loadAll()}>Réessayer</button>}>{loadError}</Notice>}

        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-red-600/15 text-red-500 flex items-center justify-center shrink-0"><MapPin className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Vous êtes ici</div>
            <div className="text-base font-black text-white truncate">
              {homeAddr || (homePos ? "Position sur la carte" : geoMsg.startsWith("Recherche") ? "Recherche de votre position…" : "Position non trouvée")}
            </div>
          </div>
          <button onClick={locate} className="shrink-0 inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-full bg-slate-950/80 border border-white/[0.1] text-sm font-bold text-slate-200 cursor-pointer">
            <LocateFixed className="w-4 h-4 text-red-500" /> Me localiser
          </button>
        </div>
        {(geoMsg || homePos) && (
          <p className="text-xs text-slate-500 -mt-2">{geoMsg || "Ce n'est pas le bon endroit ? Faites glisser le point rouge."}</p>
        )}

        {!status ? <Spinner /> : !anyAvailable ? (
          <Notice tone="warn">Aucun mécanicien n'est disponible dans votre zone pour le moment. Bientôt disponible.</Notice>
        ) : (
          !active && <p className="text-sm text-slate-400">Un mécanicien proche de vous vient jusqu'à votre véhicule.</p>
        )}

        {active && (
          <div className="rounded-2xl border-2 border-red-500/50 px-4 py-3">
            <div className="text-xs font-black uppercase tracking-wider text-red-500">Demande en cours</div>
            <div className="text-base font-black text-white mt-0.5">{STATUS_SHORT[active.status] || active.status}</div>
            <div className="text-sm text-slate-400 truncate">{vehicleLabel(active.vehicle)}{active.symptoms ? ` · ${active.symptoms}` : ""}</div>
          </div>
        )}

        {past.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-bold text-slate-400 min-h-[44px] flex items-center">Mes dernières demandes ({past.length})</summary>
            <div className="space-y-2 pt-1">
              {past.slice(0, 5).map((r) => {
                const proName = (r.proName ?? r.proDisplayName) as string | undefined;
                return (
                  <button key={r.id} onClick={() => setView({ name: "track", id: r.id })} className="w-full text-left rounded-2xl border border-white/[0.08] px-4 py-3 cursor-pointer">
                    <div className="flex justify-between gap-2">
                      <span className="font-black text-white truncate">{r.symptoms || r.serviceLabel || vehicleLabel(r.vehicle)}</span>
                      <span className="text-xs text-slate-500 shrink-0">{formatDate(r.createdAt)}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {STATUS_SHORT[r.status] || r.status}{proName ? ` · ${proName}` : ""}{r.amountAgreed != null ? ` · ${formatXOF(r.amountAgreed)}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          </details>
        )}

        {onOpenMechanicSpace && !driverMode && (
          <button onClick={onOpenMechanicSpace} className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 text-sm font-bold text-slate-400 hover:text-white cursor-pointer">
            <Wrench className="w-4 h-4" /> Vous êtes mécanicien ? Espace dépannage
          </button>
        )}
      </MapScreen>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="max-w-xl mx-auto pb-2">{children}</div>;
}
