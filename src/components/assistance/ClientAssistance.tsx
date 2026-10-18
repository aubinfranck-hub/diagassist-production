import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, LifeBuoy, WifiOff, Wrench } from "lucide-react";
import {
  api, AssistanceError, AssistanceStatus, formatDate, formatXOF, isFinalStatus, PAYMENT_LABEL, RequestSummary,
  STATUS_SHORT, useOnline, usePolling, vehicleLabel,
} from "./api";
import ClientWizard, { AssistancePrefill } from "./ClientWizard";
import ClientTracking from "./ClientTracking";
import { btnPrimary, btnSecondary, Card, errText, Notice, Spinner, StateBox } from "./ui";

export type { AssistancePrefill } from "./ClientWizard";

type View = { name: "home" } | { name: "wizard" } | { name: "track"; id: string };

/** Une demande est « active » tant qu'elle n'est pas terminée/annulée, ou si le paiement reste à régler. */
function isActive(r: RequestSummary): boolean {
  if (r.status === "annulee") return false;
  if (!isFinalStatus(r.status)) return true;
  return r.paymentStatus === "en_attente" || r.paymentStatus === "echoue" || r.paymentStatus === "especes_a_confirmer";
}

export default function ClientAssistance({
  prefill, onPrefillUsed, onOpenMechanicSpace,
}: {
  prefill?: AssistancePrefill | null;
  onPrefillUsed?: () => void;
  onOpenMechanicSpace?: () => void;
}) {
  const online = useOnline();
  const [status, setStatus] = useState<AssistanceStatus | null>(null);
  const [requests, setRequests] = useState<RequestSummary[] | null>(null);
  const [unavailable, setUnavailable] = useState<string>("");
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<View>(prefill ? { name: "wizard" } : { name: "home" });
  const [wizardPrefill, setWizardPrefill] = useState<AssistancePrefill | null>(prefill || null);
  const autoOpened = useRef(!!prefill);

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

  // ----- Accueil -----
  const anyAvailable = !!status?.services.some((s) => s.available);
  const active = requests?.find(isActive);
  const past = (requests || []).filter((r) => r !== active);

  return (
    <Wrap>
      {!online && <Notice tone="warn"><span className="inline-flex items-center gap-2"><WifiOff className="w-4 h-4" /> Vous êtes hors ligne. Reconnectez-vous pour demander de l'aide.</span></Notice>}
      {loadError && online && <Notice tone="warn" action={<button className={btnSecondary} onClick={() => void loadAll()}>Réessayer</button>}>{loadError}</Notice>}

      <Card className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-red-600/15 text-red-500 flex items-center justify-center shrink-0"><LifeBuoy className="w-6 h-6" /></div>
          <div>
            <h2 className="text-2xl font-black text-white leading-tight">En panne ?</h2>
            <p className="text-sm text-slate-400">Un mécanicien proche de vous vient jusqu'à votre véhicule.</p>
          </div>
        </div>
        {!status ? <Spinner /> : !anyAvailable ? (
          <Notice tone="warn">Aucun mécanicien n'est disponible dans votre zone pour le moment. Bientôt disponible.</Notice>
        ) : null}
        <button className={btnPrimary} disabled={!status || !anyAvailable || !online} onClick={() => { setWizardPrefill(null); setView({ name: "wizard" }); }}>
          Je suis en panne
        </button>
      </Card>

      {active && (
        <button onClick={() => setView({ name: "track", id: active.id })} className="w-full text-left cursor-pointer">
          <Card className="!border-2 !border-red-500/50 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-black uppercase tracking-wider text-red-500">Demande en cours</div>
              <div className="text-base font-black text-white mt-0.5">{STATUS_SHORT[active.status] || active.status}</div>
              <div className="text-sm text-slate-400 truncate">{vehicleLabel(active.vehicle)}{active.symptoms ? ` · ${active.symptoms}` : ""}</div>
            </div>
            <ChevronRight className="w-6 h-6 text-slate-400 shrink-0" />
          </Card>
        </button>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Mes demandes</h3>
        {requests === null && !loadError && <Spinner />}
        {requests !== null && past.length === 0 && !active && (
          <p className="text-sm text-slate-500 py-4 text-center">Vous n'avez encore fait aucune demande.</p>
        )}
        {past.map((r) => {
          const proName = (r.proName ?? r.proDisplayName) as string | undefined;
          const amount = r.total ?? r.amount;
          return (
            <button key={r.id} onClick={() => setView({ name: "track", id: r.id })} className="w-full text-left cursor-pointer">
              <Card className="!p-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-black text-white truncate">{vehicleLabel(r.vehicle)}</span>
                  <span className="text-xs font-bold text-slate-400 shrink-0">{formatDate(r.createdAt)}</span>
                </div>
                <div className="text-sm text-slate-400 truncate">{r.symptoms || r.serviceLabel}</div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                  <span className="font-bold text-slate-300">{STATUS_SHORT[r.status] || r.status}</span>
                  {proName && <span>Pro : {proName}</span>}
                  {r.works && <span className="truncate">Travaux : {String(r.works)}</span>}
                  {amount != null && <span>{formatXOF(amount)}</span>}
                  {r.paymentStatus && r.paymentStatus !== "aucun" && <span>{PAYMENT_LABEL[r.paymentStatus]}</span>}
                </div>
                {r.diagnosisText && <div className="text-xs text-slate-500 truncate">Diagnostic : {String(r.diagnosisText)}</div>}
              </Card>
            </button>
          );
        })}
      </div>

      {onOpenMechanicSpace && (
        <button onClick={onOpenMechanicSpace} className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 text-sm font-bold text-slate-400 hover:text-white cursor-pointer">
          <Wrench className="w-4 h-4" /> Vous êtes mécanicien ? Espace dépannage
        </button>
      )}
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="max-w-xl mx-auto space-y-4 pb-24 lg:pb-6">{children}</div>;
}
