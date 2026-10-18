import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

// Même mécanisme d'authentification que AdminClientDashboard (session admin en Bearer).
export const adminHeaders = (json = true): Record<string, string> => {
  let token = "";
  try { token = localStorage.getItem("auth_session_token") || ""; } catch { /* stockage indisponible */ }
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
};

export type ApiResult<T = any> = { ok: boolean; data: T; message: string };

export async function adminApi<T = any>(path: string, method = "GET", body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/admin/assistance${path}`, {
      method,
      headers: adminHeaders(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data: any = await res.json().catch(() => ({}));
    if (res.status === 503 && data?.code === "ASSISTANCE_DB_MISSING") {
      return { ok: false, data, message: "Base de données Postgres non configurée : le module Assistance est inactif." };
    }
    if (!res.ok || data?.success === false) {
      return { ok: false, data, message: data?.message || `Erreur serveur (${res.status}).` };
    }
    return { ok: true, data, message: data?.message || "" };
  } catch {
    return { ok: false, data: {} as T, message: "Connexion au serveur impossible." };
  }
}

export const qs = (params: Record<string, string | undefined>) => {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return p.length ? "?" + p.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join("&") : "";
};

// Chargement d'une ressource avec états chargement / erreur explicites.
export function useAdminLoad<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (path === null) return;
    setLoading(true); setError(null);
    const r = await adminApi<T>(path);
    if (r.ok) setData(r.data); else { setError(r.message); setData(null); }
    setLoading(false);
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

export const fmtDate = (ts?: number | null) => (ts ? new Date(ts).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");
export const fmtXof = (n?: number | null) => (typeof n === "number" ? `${n.toLocaleString("fr-FR")} FCFA` : "—");

export const STATUS_LABELS: Record<string, string> = {
  brouillon: "Brouillon", recherche: "Recherche", affectee: "Affectée", en_route: "En route", sur_place: "Sur place",
  en_intervention: "En intervention", terminee: "Terminée", sans_disponibilite: "Sans disponibilité", annulee: "Annulée",
  aucun: "Aucun", propose: "Proposé", accepte: "Accepté", refuse: "Refusé",
  en_attente: "En attente", especes_a_confirmer: "Espèces à confirmer", paye: "Payé", echoue: "Échoué",
  valide: "Validé", suspendu: "Suspendu", verifiee: "Vérifiée", verifie: "Vérifié", non_verifie: "Non vérifié", non_verifiee: "Non vérifiée",
};
export const SERVICE_LABELS: Record<string, string> = {
  mecanique: "Mécanique", electricite: "Électricité", diagnostic: "Diagnostic", batterie: "Batterie",
  pneumatiques: "Pneumatiques", remorquage: "Remorquage", vidange: "Vidange",
};
export const SERVICE_CODES = Object.keys(SERVICE_LABELS);
export const statusLabel = (s?: string) => (s ? STATUS_LABELS[s] || s : "—");

const TONES: Record<string, string> = {
  green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  red: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  blue: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  gray: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};
export function toneOf(status?: string): keyof typeof TONES {
  if (!status) return "gray";
  if (["terminee", "valide", "paye", "verifiee", "verifie", "accepte"].includes(status)) return "green";
  if (["annulee", "refuse", "suspendu", "echoue", "sans_disponibilite", "non_verifiee", "non_verifie"].includes(status)) return "red";
  if (["recherche", "en_attente", "especes_a_confirmer", "propose", "brouillon"].includes(status)) return "amber";
  if (["affectee", "en_route", "sur_place", "en_intervention"].includes(status)) return "blue";
  return "gray";
}
export function Badge({ status, label }: { status?: string; label?: string }) {
  return <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${TONES[toneOf(status)]}`}>{label || statusLabel(status)}</span>;
}

export const inputCls = "w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500";
export const btnCls = "text-xs font-bold px-3 py-2 rounded-xl transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
export const btnPrimary = `${btnCls} bg-emerald-600 hover:bg-emerald-700 text-white`;
export const btnGhost = `${btnCls} bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/[0.08]`;
export const btnDanger = `${btnCls} bg-rose-600/80 hover:bg-rose-600 text-white`;
export const cardCls = "bg-slate-950/60 border border-white/[0.06] rounded-xl p-4 space-y-3";

export function Field({ label, children, hint }: { key?: React.Key; label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
}

export function Loading({ text = "Chargement…" }: { text?: string }) {
  return <div className="flex items-center gap-2 text-xs text-slate-400 py-4"><Loader2 className="w-4 h-4 animate-spin" />{text}</div>;
}
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-xl flex items-start gap-2">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="flex-1">{message}</span>
      {onRetry && <button onClick={onRetry} className="underline font-bold cursor-pointer">Réessayer</button>}
    </div>
  );
}
export function Empty({ text }: { text: string }) {
  return <p className="text-xs text-slate-500 text-center py-6 border border-dashed border-white/[0.08] rounded-xl">{text}</p>;
}
export function Feedback({ fb }: { fb: { ok: boolean; message: string } | null }) {
  if (!fb || !fb.message) return null;
  return <div className={`text-xs p-2.5 rounded-xl border ${fb.ok ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-rose-500/10 border-rose-500/20 text-rose-400"}`}>{fb.message}</div>;
}

// Petit hook : exécute une action admin et mémorise le retour pour l'afficher.
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [fb, setFb] = useState<{ ok: boolean; message: string } | null>(null);
  const run = async (key: string, path: string, method: string, body?: unknown, okMessage = "Fait.") => {
    setBusy(key); setFb(null);
    const r = await adminApi(path, method, body);
    setFb({ ok: r.ok, message: r.ok ? (r.message || okMessage) : r.message });
    setBusy(null);
    return r;
  };
  return { busy, fb, setFb, run };
}

// Ouvre un fichier protégé : fetch avec en-têtes admin puis blob (pas de jeton dans l'URL).
export async function openProtectedFile(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: adminHeaders(false) });
    if (!res.ok) return `Fichier indisponible (${res.status}).`;
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const w = window.open(obj, "_blank");
    if (!w) { const a = document.createElement("a"); a.href = obj; a.download = "fichier"; a.click(); }
    setTimeout(() => URL.revokeObjectURL(obj), 60_000);
    return null;
  } catch { return "Connexion au serveur impossible."; }
}

export function FileButton({ url, label = "Consulter" }: { key?: React.Key; url: string; label?: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <button disabled={busy} className={btnGhost} onClick={async () => { setBusy(true); setErr(await openProtectedFile(url)); setBusy(false); }}>{busy ? "…" : label}</button>
      {err && <span className="text-[10px] text-rose-400">{err}</span>}
    </span>
  );
}
