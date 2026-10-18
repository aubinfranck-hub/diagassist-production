import React, { useEffect, useState } from "react";
import {
  useAdminLoad, useAction, Loading, ErrorBox, Empty, Feedback, Field,
  inputCls, btnGhost, btnPrimary, btnDanger, cardCls, SERVICE_LABELS,
} from "./AdminShared";

export default function AdminConfig() {
  return (
    <div className="space-y-5">
      <ZonesBlock />
      <ServicesBlock />
      <SettingsBlock />
    </div>
  );
}

type ZoneForm = { id?: number | string; name: string; lat: string; lng: string; radiusKm: string; active: boolean };
const emptyZone: ZoneForm = { name: "", lat: "", lng: "", radiusKm: "", active: true };

function ZonesBlock() {
  const { data, loading, error, reload } = useAdminLoad("/zones");
  const { busy, fb, run } = useAction();
  const [form, setForm] = useState<ZoneForm | null>(null);
  const zones: any[] = data?.zones || [];

  const edit = (z: any): void => setForm({
    id: z.id, name: z.name || "", lat: String(z.lat ?? z.centerLat ?? ""), lng: String(z.lng ?? z.centerLng ?? ""),
    radiusKm: String(z.radiusKm ?? z.radius_km ?? ""), active: z.active !== false,
  });
  const valid = form && form.name.trim() && form.lat !== "" && form.lng !== "" && form.radiusKm !== "" && !isNaN(Number(form.lat)) && !isNaN(Number(form.lng)) && Number(form.radiusKm) > 0;
  const save = async () => {
    if (!form || !valid) return;
    const body = { name: form.name.trim(), lat: Number(form.lat), lng: Number(form.lng), radiusKm: Number(form.radiusKm), active: form.active };
    const r = form.id !== undefined ? await run("zone", `/zones/${encodeURIComponent(String(form.id))}`, "PATCH", body, "Zone enregistrée.") : await run("zone", "/zones", "POST", body, "Zone créée.");
    if (r.ok) { setForm(null); reload(); }
  };
  const del = async (z: any) => {
    if (!window.confirm(`Supprimer la zone « ${z.name} » ?`)) return;
    const r = await run(`del${z.id}`, `/zones/${encodeURIComponent(String(z.id))}`, "DELETE", undefined, "Zone supprimée.");
    if (r.ok) reload();
  };
  const set = (k: keyof ZoneForm, v: string | boolean) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between"><p className="text-[11px] text-slate-300 font-bold uppercase tracking-wider">Zones</p><button className={btnPrimary} onClick={() => setForm({ ...emptyZone })}>Nouvelle zone</button></div>
      <Feedback fb={fb} />
      {form && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 bg-slate-900 border border-white/[0.06] rounded-xl p-3">
          <Field label="Nom"><input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Abidjan" /></Field>
          <Field label="Latitude du centre"><input className={inputCls} inputMode="decimal" value={form.lat} onChange={(e) => set("lat", e.target.value)} /></Field>
          <Field label="Longitude du centre"><input className={inputCls} inputMode="decimal" value={form.lng} onChange={(e) => set("lng", e.target.value)} /></Field>
          <Field label="Rayon (km)"><input className={inputCls} inputMode="decimal" value={form.radiusKm} onChange={(e) => set("radiusKm", e.target.value)} /></Field>
          <label className="flex items-end gap-1.5 text-xs text-slate-300 pb-2"><input type="checkbox" className="accent-emerald-500" checked={form.active} onChange={(e) => set("active", e.target.checked)} />Active</label>
          <div className="col-span-2 lg:col-span-5 flex gap-2"><button className={btnPrimary} disabled={!valid || busy === "zone"} onClick={save}>{busy === "zone" ? "…" : "Enregistrer"}</button><button className={btnGhost} onClick={() => setForm(null)}>Annuler</button></div>
        </div>
      )}
      {loading && !data ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : zones.length === 0 ? <Empty text="Aucune zone configurée : aucune demande ne pourra être routée." /> : (
        <div className="space-y-1.5">
          {zones.map((z) => (
            <div key={z.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
              <b className="text-white">{z.name}</b>
              <span className="text-slate-400 font-mono">{z.lat ?? z.centerLat}, {z.lng ?? z.centerLng} · {z.radiusKm ?? z.radius_km} km</span>
              <span className={z.active === false ? "text-rose-400" : "text-emerald-400"}>{z.active === false ? "Inactive" : "Active"}</span>
              <span className="ml-auto flex gap-2"><button className={btnGhost} onClick={() => edit(z)}>Modifier</button><button className={btnDanger} disabled={!!busy} onClick={() => del(z)}>Supprimer</button></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ServicesBlock() {
  const { data, loading, error, reload } = useAdminLoad("/services");
  const { busy, fb, run } = useAction();
  const [labels, setLabels] = useState<Record<string, string>>({});
  const services: any[] = data?.services || [];
  useEffect(() => { setLabels(Object.fromEntries(services.map((s) => [s.code, s.label || ""]))); /* eslint-disable-next-line */ }, [data]);

  const save = async (s: any, enabled: boolean) => {
    const r = await run(s.code, `/services/${encodeURIComponent(s.code)}`, "PATCH", { enabled, label: (labels[s.code] ?? s.label ?? "").trim() }, "Service mis à jour.");
    if (r.ok) reload();
  };
  return (
    <div className={cardCls}>
      <p className="text-[11px] text-slate-300 font-bold uppercase tracking-wider">Services</p>
      <Feedback fb={fb} />
      {loading && !data ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : services.length === 0 ? <Empty text="Aucun service renvoyé par le serveur." /> : (
        <div className="space-y-1.5">
          {services.map((s) => (
            <div key={s.code} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="w-28 text-slate-400">{SERVICE_LABELS[s.code] || s.code}</span>
              <input className={`${inputCls} !w-56`} value={labels[s.code] ?? ""} onChange={(e) => setLabels((l) => ({ ...l, [s.code]: e.target.value }))} placeholder="Libellé" />
              <span className={s.enabled ? "text-emerald-400" : "text-slate-500"}>{s.enabled ? "Activé" : "Désactivé"}</span>
              <button className={btnGhost} disabled={busy === s.code} onClick={() => save(s, !!s.enabled)}>Enregistrer le libellé</button>
              <button className={s.enabled ? btnDanger : btnPrimary} disabled={busy === s.code} onClick={() => save(s, !s.enabled)}>{s.enabled ? "Désactiver" : "Activer"}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type TariffForm = { deplacement: string; diagnostic: string; indicatif: string; min: string; max: string };
const emptyTariff: TariffForm = { deplacement: "", diagnostic: "", indicatif: "", min: "", max: "" };

const NUM_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "offer_timeout_s", label: "Délai pour faire une offre (secondes)", hint: "Temps laissé à un mécanicien pour proposer son prix après avoir reçu la demande (10 à 600, défaut 120)." },
  { key: "bid_valid_s", label: "Validité d'une offre (secondes)", hint: "Durée pendant laquelle l'offre d'un mécanicien reste choisissable par le client (30 à 3600, défaut 300)." },
  { key: "search_radius_km", label: "Rayon de recherche (km)" },
  { key: "broadcast_size", label: "Nombre de mécaniciens contactés en même temps (défaut serveur : 5)" },
  { key: "max_candidates", label: "Nombre max de candidats au total (défaut serveur : 10)" },
  { key: "location_max_age_min", label: "Âge max de la position (min)" },
  { key: "avg_speed_kmh", label: "Vitesse moyenne ETA (km/h)" },
  { key: "commission_pct", label: "Commission DiagAssist (%)" },
];

function SettingsBlock() {
  const { data, loading, error, reload } = useAdminLoad("/settings");
  const { busy, fb, run } = useAction();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [localErr, setLocalErr] = useState("");
  const [tariffs, setTariffs] = useState<Record<string, TariffForm>>({});

  useEffect(() => {
    if (!data) return;
    const s = data.settings || data;
    setVals(Object.fromEntries(NUM_FIELDS.map((f) => [f.key, s[f.key] == null ? (f.key === "commission_pct" ? "10" : "") : String(s[f.key])])));
    const t: Record<string, any> = s.tariffs || {};
    setTariffs(Object.fromEntries(Object.keys(SERVICE_LABELS).map((c) => [c, { deplacement: t[c]?.deplacement == null ? "" : String(t[c].deplacement), diagnostic: t[c]?.diagnostic == null ? "" : String(t[c].diagnostic), indicatif: t[c]?.indicatif == null ? "" : String(t[c].indicatif), min: t[c]?.min == null ? "" : String(t[c].min), max: t[c]?.max == null ? "" : String(t[c].max) }])));
  }, [data]);

  const save = async () => {
    const body: Record<string, any> = {};
    for (const f of NUM_FIELDS) if (vals[f.key] !== "" && !isNaN(Number(vals[f.key]))) body[f.key] = Number(vals[f.key]);
    if (body.commission_pct != null && (body.commission_pct < 0 || body.commission_pct > 100)) {
      setLocalErr("La commission doit être comprise entre 0 et 100 %.");
      return;
    }
    for (const [c, v] of Object.entries(tariffs) as [string, TariffForm][]) {
      if (v.min !== "" && v.max !== "" && Number(v.min) > Number(v.max)) {
        setLocalErr(`${SERVICE_LABELS[c] || c} : le minimum ne peut pas dépasser le maximum.`);
        return;
      }
    }
    setLocalErr("");
    const t: Record<string, Record<string, number>> = {};
    for (const [c, v] of Object.entries(tariffs) as [string, TariffForm][]) {
      const o: Record<string, number> = {};
      if (v.deplacement !== "" && !isNaN(Number(v.deplacement))) o.deplacement = Number(v.deplacement);
      if (v.diagnostic !== "" && !isNaN(Number(v.diagnostic))) o.diagnostic = Number(v.diagnostic);
      if (v.indicatif !== "" && !isNaN(Number(v.indicatif))) o.indicatif = Number(v.indicatif);
      if (v.min !== "" && !isNaN(Number(v.min))) o.min = Number(v.min);
      if (v.max !== "" && !isNaN(Number(v.max))) o.max = Number(v.max);
      if (Object.keys(o).length) t[c] = o;
    }
    body.tariffs = t;
    const r = await run("settings", "/settings", "PUT", body, "Réglages enregistrés.");
    if (r.ok) reload();
  };

  return (
    <div className={cardCls}>
      <p className="text-[11px] text-slate-300 font-bold uppercase tracking-wider">Réglages</p>
      <Feedback fb={fb} />
      {localErr && <Feedback fb={{ ok: false, message: localErr }} />}
      {loading && !data ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {NUM_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}><input className={inputCls} inputMode="decimal" value={vals[f.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} placeholder={f.key === "commission_pct" ? "10" : "Non configuré"} /></Field>
            ))}
          </div>
          <p className="text-[11px] text-slate-300 font-bold uppercase tracking-wider pt-2">Tarifs par service (F CFA)</p>
          <p className="text-[10px] text-slate-500">Le tarif de référence est montré aux clients et aux mécaniciens. Le minimum et le maximum limitent le prix qu'un mécanicien peut proposer. Un champ vide signifie « non configuré » (le serveur prend alors 50 % et 150 % du tarif de référence).</p>
          <div className="space-y-2">
            {Object.entries(SERVICE_LABELS).map(([c, l]) => {
              const t = tariffs[c] || emptyTariff;
              const setT = (k: keyof TariffForm, v: string) => setTariffs((all) => ({ ...all, [c]: { ...(all[c] || emptyTariff), [k]: v } }));
              const bad = t.min !== "" && t.max !== "" && Number(t.min) > Number(t.max);
              return (
                <div key={c} className="bg-slate-900 border border-white/[0.06] rounded-xl p-2 space-y-1.5">
                  <span className="text-xs font-bold text-white">{l}</span>
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
                    <Field label="Tarif de référence"><input className={inputCls} inputMode="numeric" placeholder="Non configuré" value={t.indicatif} onChange={(e) => setT("indicatif", e.target.value)} /></Field>
                    <Field label="Minimum"><input className={inputCls} inputMode="numeric" placeholder="Non configuré" value={t.min} onChange={(e) => setT("min", e.target.value)} /></Field>
                    <Field label="Maximum"><input className={inputCls} inputMode="numeric" placeholder="Non configuré" value={t.max} onChange={(e) => setT("max", e.target.value)} /></Field>
                    <Field label="Déplacement"><input className={inputCls} inputMode="numeric" placeholder="Non configuré" value={t.deplacement} onChange={(e) => setT("deplacement", e.target.value)} /></Field>
                    <Field label="Diagnostic"><input className={inputCls} inputMode="numeric" placeholder="Non configuré" value={t.diagnostic} onChange={(e) => setT("diagnostic", e.target.value)} /></Field>
                  </div>
                  {bad && <p className="text-[11px] text-rose-400">Le minimum doit être inférieur ou égal au maximum.</p>}
                </div>
              );
            })}
          </div>
          <div><button className={btnPrimary} disabled={busy === "settings"} onClick={save}>{busy === "settings" ? "…" : "Enregistrer les réglages"}</button></div>
        </>
      )}
    </div>
  );
}
