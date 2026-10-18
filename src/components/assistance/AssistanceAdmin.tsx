import React, { useState } from "react";
import { LifeBuoy, ChevronDown, ChevronUp } from "lucide-react";
import AdminDashboardView from "./AdminDashboardView";
import AdminRequests from "./AdminRequests";
import AdminPros from "./AdminPros";
import AdminConfig from "./AdminConfig";
import AdminPayments from "./AdminPayments";
import AdminClaims from "./AdminClaims";

const VIEWS = [
  { id: "dashboard", label: "Tableau de bord" },
  { id: "requests", label: "Demandes" },
  { id: "pros", label: "Professionnels" },
  { id: "config", label: "Configuration" },
  { id: "payments", label: "Paiements" },
  { id: "claims", label: "Réclamations" },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

export default function AssistanceAdmin() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ViewId>("dashboard");
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between cursor-pointer">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
          <LifeBuoy className="w-4 h-4 text-orange-400" />
          Assistance automobile
        </h3>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {VIEWS.map((v) => (
              <button key={v.id} onClick={() => setView(v.id)} className={`text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer transition ${view === v.id ? "bg-emerald-600 text-[#ffffff]" : "bg-slate-950/60 text-slate-300 hover:bg-slate-950/80 border border-white/[0.08]"}`}>{v.label}</button>
            ))}
          </div>
          {view === "dashboard" && <AdminDashboardView />}
          {view === "requests" && <AdminRequests />}
          {view === "pros" && <AdminPros />}
          {view === "config" && <AdminConfig />}
          {view === "payments" && <AdminPayments />}
          {view === "claims" && <AdminClaims />}
        </>
      )}
    </div>
  );
}
