import React, { useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  useAdminLoad, useAction, qs, Loading, ErrorBox, Empty, Feedback, Badge, Field, FileButton,
  inputCls, btnGhost, btnPrimary, btnDanger, cardCls, fmtDate, statusLabel, SERVICE_LABELS,
} from "./AdminShared";

const VSTATUS = ["en_attente", "valide", "suspendu", "refuse"];
const isVerified = (s?: string) => ["verifiee", "verifie", "verified"].includes(String(s));

export default function AdminPros() {
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const list = useAdminLoad("/pros" + qs({ status }));
  const zones = useAdminLoad("/zones");
  const bulk = useAction();
  const [confirmAll, setConfirmAll] = useState(false);
  const pros: any[] = list.data?.pros || [];
  const zoneName = (id: any) => (zones.data?.zones || []).find((z: any) => String(z.id) === String(id))?.name || `Zone ${id}`;

  const validateAll = async () => {
    const r = await bulk.run("all", "/pros/validate-directory", "POST", undefined, "Profils de l'annuaire validés.");
    setConfirmAll(false); if (r.ok) list.reload();
  };
  const sync = async () => { const r = await bulk.run("sync", "/sync-directory", "POST", undefined, "Annuaire resynchronisé."); if (r.ok) list.reload(); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <select className={`${inputCls} !w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>{VSTATUS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        <button className={btnGhost} onClick={list.reload}><RefreshCw className="w-3.5 h-3.5 inline mr-1" />Actualiser</button>
        <button className={btnGhost} disabled={bulk.busy === "sync"} onClick={sync}>{bulk.busy === "sync" ? "Synchronisation…" : "Resynchroniser l'annuaire"}</button>
        <button className={btnPrimary} disabled={!!bulk.busy} onClick={() => setConfirmAll(true)}>Valider tous les mécaniciens de l'annuaire</button>
      </div>
      {confirmAll && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-2">
          <p className="text-xs text-amber-200">Tous les profils issus de l'annuaire encore en attente seront validés et pourront recevoir des missions. Confirmer ?</p>
          <div className="flex gap-2"><button className={btnPrimary} disabled={bulk.busy === "all"} onClick={validateAll}>{bulk.busy === "all" ? "…" : "Oui, tout valider"}</button><button className={btnGhost} onClick={() => setConfirmAll(false)}>Non</button></div>
        </div>
      )}
      <Feedback fb={bulk.fb} />
      {list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : pros.length === 0 ? <Empty text="Aucun professionnel pour ce filtre." /> : (
        <div className="space-y-2">
          {pros.map((p) => (
            <div key={p.phone} className="bg-slate-950/60 border border-white/[0.06] rounded-xl">
              <button className="w-full text-left p-3 cursor-pointer" onClick={() => setOpen(open === p.phone ? null : p.phone)}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-white">{p.displayName || p.garageName || p.phone}</span>
                  <span className="font-mono text-[11px] text-slate-400">{p.phone}</span>
                  <Badge status={p.validationStatus} />
                  {p.subscribed === true && <Badge status="valide" label="Abonnement à jour" />}
                  {p.subscribed === false && <Badge status="refuse" label="Abonnement expiré" />}
                  <span className="text-[10px] text-slate-400 border border-white/[0.08] rounded-full px-2 py-0.5">{p.source === "annuaire" || p.fromDirectory ? "Annuaire" : p.source === "inscription" ? "Inscription" : (p.source || "—")}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  {(p.specialties || []).map((s: string) => SERVICE_LABELS[s] || s).join(", ") || "Aucune spécialité"} · {(p.zoneIds || []).map(zoneName).join(", ") || "Aucune zone"}
                </p>
              </button>
              {open === p.phone && <ProDetail pro={p} zones={zones.data?.zones || []} onChanged={list.reload} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProDetail({ pro, zones, onChanged }: { pro: any; zones: any[]; onChanged: () => void }) {
  const base = `/pros/${encodeURIComponent(pro.phone)}`;
  const { busy, fb, run } = useAction();
  const [note, setNote] = useState("");
  const [specs, setSpecs] = useState<string[]>(pro.specialties || []);
  const [zoneIds, setZoneIds] = useState<string[]>((pro.zoneIds || []).map(String));
  const [mobility, setMobility] = useState<string>(pro.mobility || "both");
  const [tTitle, setTTitle] = useState(""); const [tIssuer, setTIssuer] = useState(""); const [tDate, setTDate] = useState(""); const [tVerified, setTVerified] = useState(false);
  const docs: any[] = pro.documents || [];
  const trainings: any[] = pro.trainings || [];
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const decide = async (action: "validate" | "suspend" | "refuse") => {
    const r = await run(action, `${base}/${action}`, "POST", note.trim() ? { note: note.trim() } : {});
    if (r.ok) onChanged();
  };
  const save = async () => { const r = await run("save", base, "PATCH", { specialties: specs, zoneIds: zoneIds.map(Number), mobility }, "Profil mis à jour."); if (r.ok) onChanged(); };
  const verify = async (key: string, path: string) => { const r = await run(key, path, "POST", { status: "verifiee" }, "Marqué comme vérifié."); if (r.ok) onChanged(); };
  const addTraining = async () => {
    const r = await run("train", `${base}/trainings`, "POST", { title: tTitle.trim(), issuer: tIssuer.trim(), completedOn: tDate, status: tVerified ? "verifiee" : "declaree" }, "Formation ajoutée.");
    if (r.ok) { setTTitle(""); setTIssuer(""); setTDate(""); setTVerified(false); onChanged(); }
  };

  return (
    <div className="border-t border-white/[0.06] p-3 space-y-4">
      <Feedback fb={fb} />
      {pro.validationNote && <p className="text-xs text-slate-400">Dernière note : {pro.validationNote}</p>}
      <div className={cardCls}>
        <Field label="Note (optionnelle)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motif ou remarque" /></Field>
        <div className="flex flex-wrap gap-2">
          <button className={btnPrimary} disabled={!!busy} onClick={() => decide("validate")}>Valider</button>
          <button className={btnGhost} disabled={!!busy} onClick={() => decide("suspend")}>Suspendre</button>
          <button className={btnDanger} disabled={!!busy} onClick={() => decide("refuse")}>Refuser</button>
        </div>
      </div>

      <div className={cardCls}>
        <p className="text-[11px] text-slate-300 font-bold uppercase tracking-wider">Spécialités, zones, mobilité</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(SERVICE_LABELS).map(([c, l]) => (
            <label key={c} className="text-xs text-slate-300 flex items-center gap-1 bg-slate-900 border border-white/[0.08] rounded-lg px-2 py-1 cursor-pointer"><input type="checkbox" className="accent-emerald-500" checked={specs.includes(c)} onChange={() => setSpecs(toggle(specs, c))} />{l}</label>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {zones.length === 0 ? <span className="text-xs text-slate-500">Aucune zone configurée.</span> : zones.map((z) => (
            <label key={z.id} className="text-xs text-slate-300 flex items-center gap-1 bg-slate-900 border border-white/[0.08] rounded-lg px-2 py-1 cursor-pointer"><input type="checkbox" className="accent-emerald-500" checked={zoneIds.includes(String(z.id))} onChange={() => setZoneIds(toggle(zoneIds, String(z.id)))} />{z.name}</label>
          ))}
        </div>
        <select className={`${inputCls} !w-auto`} value={mobility} onChange={(e) => setMobility(e.target.value)}>
          <option value="mobile">Mobile (se déplace)</option><option value="garage">Garage</option><option value="both">Mobile et garage</option>
        </select>
        <div><button className={btnPrimary} disabled={!!busy} onClick={save}>{busy === "save" ? "…" : "Enregistrer"}</button></div>
      </div>

      <div className={cardCls}>
        <p className="text-[11px] text-slate-300 font-bold uppercase tracking-wider">Documents</p>
        {docs.length === 0 ? <Empty text="Aucun document déposé." /> : docs.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span className="font-bold text-white">{d.label || d.kind}</span><Badge status={isVerified(d.status) ? "verifiee" : d.status || "non_verifie"} label={isVerified(d.status) ? "Vérifié" : "Non vérifié"} />
            <FileButton url={`/api/admin/assistance${base}/documents/${encodeURIComponent(d.id)}`} />
            {!isVerified(d.status) && <button className={btnGhost} disabled={!!busy} onClick={() => verify(`doc${d.id}`, `${base}/documents/${encodeURIComponent(d.id)}/verify`)}>Marquer vérifié</button>}
          </div>
        ))}
      </div>

      <div className={cardCls}>
        <p className="text-[11px] text-slate-300 font-bold uppercase tracking-wider">Formations et certifications</p>
        {trainings.length === 0 ? <Empty text="Aucune formation déclarée." /> : trainings.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span className="font-bold text-white">{t.title}</span><span className="text-slate-400">{t.issuer}{t.completedOn ? ` · ${t.completedOn}` : ""}</span>
            {isVerified(t.status) ? <Badge status="verifiee" label="Vérifiée" /> : <Badge status="non_verifiee" label="Non vérifiée (déclarative)" />}
            {!isVerified(t.status) && <button className={btnGhost} disabled={!!busy} onClick={() => verify(`tr${t.id}`, `/trainings/${encodeURIComponent(t.id)}/verify`)}>Marquer vérifiée</button>}
          </div>
        ))}
        <div className="grid sm:grid-cols-4 gap-2 pt-2 border-t border-white/[0.05]">
          <input className={inputCls} placeholder="Intitulé" value={tTitle} onChange={(e) => setTTitle(e.target.value)} />
          <input className={inputCls} placeholder="Organisme" value={tIssuer} onChange={(e) => setTIssuer(e.target.value)} />
          <input type="date" className={inputCls} value={tDate} onChange={(e) => setTDate(e.target.value)} />
          <label className="text-xs text-slate-300 flex items-center gap-1.5"><input type="checkbox" className="accent-emerald-500" checked={tVerified} onChange={(e) => setTVerified(e.target.checked)} />Déjà vérifiée</label>
        </div>
        <div><button className={btnPrimary} disabled={!!busy || !tTitle.trim() || !tIssuer.trim()} onClick={addTraining}>{busy === "train" ? "…" : "Ajouter la formation"}</button></div>
      </div>
      {pro.createdAt && <p className="text-[10px] text-slate-500">Profil créé le {fmtDate(pro.createdAt)}</p>}
    </div>
  );
}
