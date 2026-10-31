import { Bell, ChevronRight } from "lucide-react";
import { clientAlerts } from "./clientAlerts";
import type { RequestDetail } from "./api";

export default function ClientAlerts({ detail, online }: { detail: RequestDetail; online: boolean }) {
  const alerts = online ? clientAlerts(detail) : [];
  return <section aria-label="Alertes de votre demande" aria-live="polite" aria-atomic="true" className="space-y-2">
    {alerts.map(alert => <div key={alert.id} className="rounded-2xl border border-red-500/40 bg-red-600/10 p-3 flex items-center gap-3">
      <Bell className="h-5 w-5 shrink-0 text-red-400" aria-hidden="true" />
      <div className="flex-1 text-sm font-bold text-white">{alert.text}</div>
      {alert.target && <button type="button" className="min-h-[44px] min-w-[44px] rounded-xl px-3 text-sm font-bold text-red-300 hover:bg-red-500/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"
        aria-label={alert.id === "offers" ? "Voir les offres" : "Voir les devis"}
        onClick={() => { const el = document.getElementById(alert.target!); el?.scrollIntoView({ behavior: "smooth", block: "start" }); el?.focus({ preventScroll: true }); }}>
        Voir <ChevronRight className="inline h-4 w-4" aria-hidden="true" />
      </button>}
    </div>)}
  </section>;
}
