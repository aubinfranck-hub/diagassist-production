import React, { useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import {
  useAdminLoad, useAction, qs, Loading, ErrorBox, Empty, Feedback, Badge, Field, FileButton,
  inputCls, btnGhost, btnPrimary, btnDanger, cardCls, fmtDate, fmtXof, statusLabel, SERVICE_CODES, SERVICE_LABELS,
} from "./AdminShared";

const STATUSES = ["brouillon", "recherche", "affectee", "en_route", "sur_place", "en_intervention", "terminee", "sans_disponibilite", "annulee"];
const dayStart = (d: string) => (d ? String(new Date(`${d}T00:00:00`).getTime()) : undefined);
const dayEnd = (d: string) => (d ? String(new Date(`${d}T23:59:59.999`).getTime()) : undefined);
const svc = (c?: string) => (c ? SERVICE_LABELS[c] || c : "—");
const veh = (v: any) => (v && typeof v === "object" ? [v.brand, v.model, v.year].filter(Boolean).join(" ") : "") || "—";
const ManualTag = ({ long }: { long?: boolean }) => (
  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30">{long ? "Prise en charge manuelle demandée" : "Prise en charge manuelle"}</span>
);

export default function AdminRequests() {
  const [status, setStatus] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [service, setService] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [manual, setManual] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const zones = useAdminLoad("/zones");
  const path = "/requests" + qs({ status, zoneId, service, from: dayStart(from), to: dayEnd(to), manual: manual ? "1" : undefined });
  const list = useAdminLoad(path);

  if (openId) return <RequestDetail id={openId} onBack={() => { setOpenId(null); list.reload(); }} />;

  const requests: any[] = list.data?.requests || [];
  const zoneName = (r: any) => r.zoneName || (zones.data?.zones || []).find((z: any) => String(z.id) === String(r.zoneId))?.name || (r.zoneId ?? "—");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
        <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous statuts</option>{STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        <select className={inputCls} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
          <option value="">Toutes zones</option>{(zones.data?.zones || []).map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <select className={inputCls} value={service} onChange={(e) => setService(e.target.value)}>
          <option value="">Tous services</option>{SERVICE_CODES.map((s) => <option key={s} value={s}>{SERVICE_LABELS[s]}</option>)}
        </select>
        <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} title="Du" />
        <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} title="Au" />
        <label className="flex items-center gap-1.5 text-xs text-slate-300 font-bold bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2 cursor-pointer">
          <input type="checkbox" className="accent-emerald-500" checked={manual} onChange={(e) => setManual(e.target.checked)} />Prise en charge manuelle
        </label>
      </div>
      <div className="flex justify-end"><button className={btnGhost} onClick={list.reload}><RefreshCw className="w-3.5 h-3.5 inline mr-1" />Actualiser</button></div>
      {list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : requests.length === 0 ? (
        <Empty text="Aucune demande ne correspond à ces filtres." />
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <button key={r.id} onClick={() => setOpenId(String(r.id))} className="w-full text-left bg-slate-950/60 border border-white/[0.06] hover:border-emerald-500/40 rounded-xl p-3 cursor-pointer transition">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-slate-400">#{String(r.id).slice(0, 8)}</span>
                <Badge status={r.status} />
                {r.manualRequested || r.manualRequestedAt ? <ManualTag /> : null}
                <span className="text-xs text-white font-bold">{svc(r.service)}</span>
                <span className="text-[11px] text-slate-400 ml-auto">{fmtDate(r.createdAt)}</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Zone : {String(zoneName(r))} · Véhicule : {veh(r.vehicle)}{r.clientPhone ? ` · Client : ${r.clientPhone}` : ""}{r.proName || r.proPhone ? ` · Pro : ${r.proName || r.proPhone}` : ""}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RequestDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, loading, error, reload } = useAdminLoad(`/requests/${encodeURIComponent(id)}`);
  const { busy, fb, run } = useAction();
  const [assignOpen, setAssignOpen] = useState(false);
  const [proPhone, setProPhone] = useState("");
  const [reason, setReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const pros = useAdminLoad(assignOpen ? "/pros?status=valide" : null);

  if (loading && !data) return <Loading />;
  if (error) return <div className="space-y-3"><button className={btnGhost} onClick={onBack}>Retour</button><ErrorBox message={error} onRetry={reload} /></div>;
  if (!data) return null;
  const r = data.request || {};
  const pro = data.pro || r.pro || null;
  const timeline: any[] = data.timeline || r.timeline || [];
  const offers: any[] = data.offers || r.offers || [];
  const messages: any[] = data.messages || r.messages || [];
  const quotes: any[] = data.quotes || r.quotes || [];
  const media: any[] = data.media || r.media || [];
  const pos = r.position || data.position || null;
  const closed = ["terminee", "annulee"].includes(r.status);
  const canRedispatch = ["recherche", "sans_disponibilite", "affectee"].includes(r.status) || !!r.manualRequested;

  const act = async (key: string, path: string, body?: unknown) => {
    const res = await run(key, path, "POST", body);
    if (res.ok) { setAssignOpen(false); setCancelOpen(false); setReason(""); reload(); }
  };

  return (
    <div className="space-y-4">
      <button className={btnGhost} onClick={onBack}><ArrowLeft className="w-3.5 h-3.5 inline mr-1" />Retour à la liste</button>
      <div className={cardCls}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-slate-300">#{String(r.id)}</span><Badge status={r.status} />
          {r.manualRequested || r.manualRequestedAt ? <ManualTag long /> : null}
        </div>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-300">
          <p>Service : <b className="text-white">{svc(r.service)}</b></p>
          <p>Créée : {fmtDate(r.createdAt)}</p>
          <p>Véhicule : {veh(r.vehicle)}{r.vehicle?.engine ? ` (${r.vehicle.engine})` : ""}</p>
          <p>Client : {r.clientPhone || r.contactPhone || "—"}</p>
          <p className="sm:col-span-2">Symptômes : {r.symptoms || "—"}</p>
          {r.faultCodes && <p className="sm:col-span-2">Codes défaut : {Array.isArray(r.faultCodes) ? r.faultCodes.join(", ") : String(r.faultCodes)}</p>}
          {r.description && <p className="sm:col-span-2">Description : {r.description}</p>}
          <p>Statut devis : {statusLabel(r.quoteStatus)}</p>
          <p>Montant convenu (hors plateforme) : {r.amountAgreed ? fmtXof(r.amountAgreed) : "—"}</p>
          {r.aiAnalysis && <p className="sm:col-span-2">Analyse DiagAssist — pistes à vérifier : <span className="text-slate-400 whitespace-pre-line">{String(r.aiAnalysis)}</span></p>}
        </div>
        {pos && (
          <p className="text-xs text-slate-300">
            Position : {Number(pos.lat).toFixed(5)}, {Number(pos.lng).toFixed(5)}
            {pos.accuracy ? ` (±${Math.round(pos.accuracy)} m)` : ""}{pos.address ? ` · ${pos.address}` : ""}{pos.landmark ? ` · Repère : ${pos.landmark}` : ""}{" "}
            <a className="text-emerald-400 underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps?q=${pos.lat},${pos.lng}`}>Ouvrir la carte</a>
          </p>
        )}
        <p className="text-xs text-slate-300">
          Mécanicien : {pro ? <b className="text-white">{pro.displayName || pro.garageName || pro.phone}{pro.phone ? ` (${pro.phone})` : ""}</b> : (r.proPhone ? <b className="text-white">{r.proPhone}</b> : "non affecté")}
        </p>
      </div>

      <Feedback fb={fb} />
      {!closed && (
        <div className="flex flex-wrap gap-2">
          <button className={btnPrimary} onClick={() => { setAssignOpen((v) => !v); setCancelOpen(false); }}>{pro || r.proPhone ? "Réaffecter" : "Affecter"}</button>
          {canRedispatch && <button className={btnGhost} disabled={busy === "redispatch"} onClick={() => act("redispatch", `/requests/${encodeURIComponent(id)}/redispatch`)}>{busy === "redispatch" ? "…" : "Relancer la recherche"}</button>}
          <button className={btnDanger} onClick={() => { setCancelOpen((v) => !v); setAssignOpen(false); }}>Annuler</button>
        </div>
      )}
      {assignOpen && (
        <div className={cardCls}>
          <Field label="Professionnel validé">
            {pros.loading ? <Loading /> : pros.error ? <ErrorBox message={pros.error} onRetry={pros.reload} /> : (pros.data?.pros || []).filter((p: any) => p.subscribed !== false).length === 0 ? <Empty text="Aucun professionnel validé et à jour de son abonnement." /> : (
              <select className={inputCls} value={proPhone} onChange={(e) => setProPhone(e.target.value)}>
                <option value="">Choisir…</option>
                {(pros.data?.pros || []).filter((p: any) => p.subscribed !== false).map((p: any) => <option key={p.phone} value={p.phone}>{p.displayName || p.garageName || p.phone} — {p.phone}{p.available === false ? " (indisponible)" : ""}</option>)}
              </select>
            )}
          </Field>
          <button className={btnPrimary} disabled={!proPhone || busy === "assign"} onClick={() => act("assign", `/requests/${encodeURIComponent(id)}/assign`, { proPhone })}>{busy === "assign" ? "…" : "Confirmer l'affectation"}</button>
        </div>
      )}
      {cancelOpen && (
        <div className={cardCls}>
          <Field label="Motif de l'annulation (obligatoire)"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. client injoignable" /></Field>
          <button className={btnDanger} disabled={!reason.trim() || busy === "cancel"} onClick={() => act("cancel", `/requests/${encodeURIComponent(id)}/cancel`, { reason: reason.trim() })}>{busy === "cancel" ? "…" : "Annuler la demande"}</button>
        </div>
      )}

      <Section title="Chronologie">
        {timeline.length === 0 ? <Empty text="Aucun événement enregistré." /> : (
          <ol className="space-y-1.5">
            {timeline.map((t, i) => (
              <li key={i} className="text-xs text-slate-300 flex flex-wrap gap-x-2">
                <span className="text-slate-500 font-mono">{fmtDate(t.at)}</span>
                {t.status && <Badge status={t.status} />}
                <span>{t.label || t.event || ""}</span>
                {(t.actor || t.actorRole) && <span className="text-slate-400">· {t.actor || t.actorRole}{t.actorId ? ` (${t.actorId})` : ""}</span>}
                {(t.reason || t.motif) && <span className="text-amber-300">· Motif : {t.reason || t.motif}</span>}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Offres envoyées">
        {offers.length === 0 ? <Empty text="Aucune offre envoyée." /> : (
          <div className="space-y-1">
            {offers.map((o, i) => (
              <p key={o.id ?? i} className="text-xs text-slate-300">
                {o.proName || o.displayName || o.proPhone || o.phone || "—"} · <Badge status={o.status} label={o.status ? (({ pending: "En attente", accepted: "Acceptée", declined: "Refusée", expired: "Expirée" } as Record<string, string>)[o.status] || statusLabel(o.status)) : "—"} />
                {o.distanceKm != null ? ` · ${o.distanceKm} km` : ""} · envoyée {fmtDate(o.createdAt || o.sentAt)}{o.expiresAt ? ` · expire ${fmtDate(o.expiresAt)}` : ""}
              </p>
            ))}
          </div>
        )}
      </Section>

      <Section title="Messages">
        {messages.length === 0 ? <Empty text="Aucun message échangé." /> : (
          <div className="space-y-1">
            {messages.map((m, i) => (
              <p key={m.id ?? i} className="text-xs text-slate-300"><span className="text-slate-500 font-mono">{fmtDate(m.at)}</span> <b className={m.fromRole === "pro" ? "text-sky-300" : "text-emerald-300"}>{m.fromRole === "pro" ? "Mécanicien" : "Client"}</b> : {m.body}</p>
            ))}
          </div>
        )}
      </Section>

      <Section title="Devis">
        {quotes.length === 0 ? <Empty text="Aucun devis." /> : quotes.map((q, i) => (
          <div key={q.id ?? i} className="text-xs text-slate-300 space-y-0.5 border-b border-white/[0.05] pb-2 last:border-0">
            <p><b className="text-white">{q.kind === "supplementaire" ? "Devis supplémentaire" : "Devis initial"}</b> · <Badge status={q.status} /> · {fmtDate(q.createdAt)}{q.total != null ? ` · Total ${fmtXof(q.total)}` : ""}</p>
            {(q.lines || []).map((l: any, j: number) => <p key={j} className="pl-3 text-slate-400">{l.label || l.kind} : {fmtXof(l.amount)}</p>)}
            {q.note && <p className="pl-3 text-slate-400">Note : {q.note}</p>}
            {(q.decidedAt || q.decision) && <p className="pl-3 text-slate-400">Décision : {q.decision || q.status} le {fmtDate(q.decidedAt)}{q.decidedBy ? ` par ${q.decidedBy}` : ""}</p>}
          </div>
        ))}
      </Section>

      <Section title="Médias">
        {media.length === 0 ? <Empty text="Aucun média joint." /> : (
          <div className="flex flex-wrap gap-2">
            {media.map((m) => <FileButton key={m.id} url={`/api/assistance/media/${encodeURIComponent(m.id)}`} label={`${m.kind || m.mime || "Fichier"}${m.size ? ` (${Math.round(m.size / 1024)} Ko)` : ""}`} />)}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className={cardCls}><p className="text-[11px] text-slate-300 font-bold uppercase tracking-wider">{title}</p>{children}</div>;
}
