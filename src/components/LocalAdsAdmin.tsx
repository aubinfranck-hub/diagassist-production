import React, { useCallback, useEffect, useState } from "react";
import { Megaphone, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { adminHeaders, Badge, Field, Loading, ErrorBox, Empty, Feedback, inputCls, btnGhost, btnPrimary, btnDanger, cardCls, fmtDate, fmtXof } from "./assistance/AdminShared";

type Slot = { id: string; label: string; description: string; price7: number; price30: number; price90: number; active: boolean };
type Campaign = {
  id: string; slotId: string; slotLabel: string; advertiser: string; phone: string | null; linkUrl: string; hasImage: boolean;
  durationDays: number; amount: number; status: string; effectiveStatus: string; startsAt: number | null; endsAt: number | null;
  paidAt: number | null; views: number; clicks: number; pendingPayment: string | null;
};
type Data = { slots: Slot[]; campaigns: Campaign[]; revenue: number; paymentConfigured: boolean };

const STATUS: Record<string, { label: string; tone: string }> = {
  a_payer: { label: "À payer", tone: "en_attente" },
  active: { label: "En ligne", tone: "valide" },
  pause: { label: "En pause", tone: "brouillon" },
  terminee: { label: "Terminée", tone: "annulee" },
};

async function api(path: string, method = "GET", body?: unknown, raw?: { blob: Blob }) {
  try {
    const headers = adminHeaders(!raw && body !== undefined);
    if (raw) headers["Content-Type"] = raw.blob.type || "application/octet-stream";
    const res = await fetch(`/api/admin/ads${path}`, { method, headers, body: raw ? raw.blob : body !== undefined ? JSON.stringify(body) : undefined });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) return { ok: false, data, message: data?.message || `Erreur serveur (${res.status}).` };
    return { ok: true, data, message: "" };
  } catch { return { ok: false, data: {} as any, message: "Connexion au serveur impossible." }; }
}

export default function LocalAdsAdmin() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fb, setFb] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, { p7: string; p30: string; p90: string }>>({});
  const [form, setForm] = useState({ slotId: "", advertiser: "", phone: "", linkUrl: "", durationDays: "30", amount: "" });
  const [file, setFile] = useState<File | null>(null);
  const [payMethod, setPayMethod] = useState("orange");
  const [payLink, setPayLink] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await api("");
    if (r.ok) {
      setData(r.data);
      setPrices(Object.fromEntries((r.data.slots as Slot[]).map((s) => [s.id, { p7: String(s.price7), p30: String(s.price30), p90: String(s.price90) }])));
      setForm((f) => (f.slotId ? f : { ...f, slotId: r.data.slots[0]?.id || "" }));
    } else setError(r.message);
    setLoading(false);
  }, []);
  useEffect(() => { if (open && !data) load(); }, [open, data, load]);

  const act = async (key: string, fn: () => Promise<{ ok: boolean; message: string }>, ok: string, reload = true) => {
    setBusy(key); setFb(null);
    const r = await fn();
    setFb({ ok: r.ok, message: r.ok ? ok : r.message });
    setBusy(null);
    if (r.ok && reload) load();
    return r;
  };

  const savePrices = (s: Slot, active?: boolean) => act(`s${s.id}`, () => api(`/slots/${s.id}`, "PUT", {
    price7: Number(prices[s.id]?.p7), price30: Number(prices[s.id]?.p30), price90: Number(prices[s.id]?.p90), ...(active === undefined ? {} : { active }),
  }), "Prix enregistrés.");

  const create = () => act("create", async () => {
    const r = await api("/campaigns", "POST", { ...form, durationDays: Number(form.durationDays), amount: form.amount === "" ? undefined : Number(form.amount) });
    if (!r.ok) return r;
    if (file) {
      const up = await api(`/campaigns/${r.data.id}/image`, "PUT", undefined, { blob: file });
      if (!up.ok) return { ok: false, message: `Annonce créée mais image refusée : ${up.message}` };
    }
    setForm((f) => ({ ...f, advertiser: "", phone: "", linkUrl: "", amount: "" })); setFile(null);
    return r;
  }, "Annonce créée. Ajoutez-lui une image si besoin, puis activez-la ou envoyez le lien de paiement.");

  const replaceImage = (c: Campaign, f: File | undefined) => { if (f) act(`i${c.id}`, () => api(`/campaigns/${c.id}/image`, "PUT", undefined, { blob: f }), "Image enregistrée."); };
  const makeLink = (c: Campaign) => act(`p${c.id}`, async () => {
    const r = await api(`/campaigns/${c.id}/pay-link`, "POST", { method: payMethod });
    if (r.ok) setPayLink((m) => ({ ...m, [c.id]: r.data.redirectUrl || "" }));
    return r;
  }, "Lien de paiement créé : copiez-le et envoyez-le au commerçant.");

  const price = (s: Slot | undefined, d: string) => (s ? ({ "7": s.price7, "30": s.price30, "90": s.price90 } as any)[d] : 0);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between cursor-pointer">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2"><Megaphone className="w-4 h-4 text-amber-400" />Publicité locale</h3>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (loading && !data ? <Loading /> : error ? <ErrorBox message={error} onRetry={load} /> : data && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-400">Encaissé à ce jour : <b className="text-white">{fmtXof(data.revenue)}</b>. Les annonces s'affichent sur le blog et la page d'accueil publique, jamais dans le diagnostic ni les urgences.</p>
            <button className={btnGhost} onClick={load}><RefreshCw className="w-3.5 h-3.5 inline mr-1" />Actualiser</button>
          </div>
          <Feedback fb={fb} />

          <div className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Emplacements et prix (FCFA)</h4>
            {data.slots.map((s) => (
              <div key={s.id} className={cardCls}>
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-xs text-white">{s.label}</b><Badge status={s.active ? "valide" : "suspendu"} label={s.active ? "Ouvert" : "Fermé"} />
                  <span className="text-[11px] text-slate-500">{s.description}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {([["p7", "7 jours"], ["p30", "30 jours"], ["p90", "90 jours"]] as const).map(([k, l]) => (
                    <Field key={k} label={l}><input className={inputCls} inputMode="numeric" value={prices[s.id]?.[k] ?? ""} onChange={(e) => setPrices((p) => ({ ...p, [s.id]: { ...p[s.id], [k]: e.target.value.replace(/\D/g, "") } }))} /></Field>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button className={btnPrimary} disabled={!!busy} onClick={() => savePrices(s)}>{busy === `s${s.id}` ? "…" : "Enregistrer les prix"}</button>
                  <button className={btnGhost} disabled={!!busy} onClick={() => savePrices(s, !s.active)}>{s.active ? "Fermer l'emplacement" : "Rouvrir"}</button>
                </div>
              </div>
            ))}
          </div>

          <div className={cardCls}>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Nouvelle annonce</h4>
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label="Emplacement"><select className={inputCls} value={form.slotId} onChange={(e) => setForm({ ...form, slotId: e.target.value })}>{data.slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
              <Field label="Durée"><select className={inputCls} value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: e.target.value })}><option value="7">7 jours</option><option value="30">30 jours</option><option value="90">90 jours</option></select></Field>
              <Field label="Nom du commerce"><input className={inputCls} value={form.advertiser} onChange={(e) => setForm({ ...form, advertiser: e.target.value })} /></Field>
              <Field label="Téléphone (facultatif)"><input className={inputCls} inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="Lien au clic (https://…)"><input className={inputCls} value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} placeholder="https://wa.me/225…" /></Field>
              <Field label="Prix" hint={`Vide = prix de la grille : ${fmtXof(price(data.slots.find((s) => s.id === form.slotId), form.durationDays))}`}><input className={inputCls} inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/\D/g, "") })} /></Field>
            </div>
            <Field label="Image de l'annonce (PNG, JPEG ou WebP, 500 Ko max, format large conseillé)"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="text-xs text-slate-300" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
            <button className={btnPrimary} disabled={!!busy} onClick={create}>{busy === "create" ? "…" : "Créer l'annonce"}</button>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Annonces</h4>
              <label className="text-[11px] text-slate-400 ml-auto">Paiement du commerçant :{" "}
                <select className="bg-slate-950 border border-white/[0.08] rounded-lg px-2 py-1 text-xs" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="orange">Orange</option><option value="wave">Wave</option><option value="mtn">MTN</option><option value="moov">Moov</option>
                </select>
              </label>
            </div>
            {data.campaigns.length === 0 ? <Empty text="Aucune annonce pour le moment." /> : data.campaigns.map((c) => {
              const st = STATUS[c.effectiveStatus] || STATUS.a_payer;
              const link = payLink[c.id] || c.pendingPayment || "";
              return (
                <div key={c.id} className={cardCls}>
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-xs text-white">{c.advertiser}</b><Badge status={st.tone} label={st.label} />
                    <span className="text-[11px] text-slate-400">{c.slotLabel} · {c.durationDays} j · {fmtXof(c.amount)}</span>
                    {c.endsAt && <span className="text-[11px] text-slate-500 ml-auto">jusqu'au {fmtDate(c.endsAt)}</span>}
                  </div>
                  <p className="text-[11px] text-slate-400 break-all">Lien : {c.linkUrl}{c.phone ? ` · Tél : ${c.phone}` : ""}</p>
                  <p className="text-xs text-slate-300">Vues : <b className="text-white">{c.views}</b> · Clics : <b className="text-white">{c.clicks}</b>{c.views > 0 ? ` (${((c.clicks / c.views) * 100).toFixed(1)} %)` : ""}{!c.hasImage && <span className="text-amber-300"> · image manquante</span>}</p>
                  {link && <input readOnly className={inputCls} value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Lien de paiement" />}
                  <div className="flex flex-wrap gap-2 items-center">
                    {!c.paidAt && <button className={btnPrimary} disabled={!!busy || !data.paymentConfigured} title={data.paymentConfigured ? "" : "Jèko non configuré"} onClick={() => makeLink(c)}>{busy === `p${c.id}` ? "…" : "Lien de paiement Jèko"}</button>}
                    {!c.paidAt && c.pendingPayment && <button className={btnGhost} disabled={!!busy} onClick={() => act(`r${c.id}`, async () => { const r = await api(`/campaigns/${c.id}/reconcile`, "POST"); return r.ok && !r.data.paid ? { ok: false, message: "Pas encore payé chez Jèko." } : r; }, "Paiement reçu : annonce en ligne.")}>Vérifier le paiement</button>}
                    {(!c.paidAt || c.effectiveStatus === "terminee") && <button className={btnGhost} disabled={!!busy} onClick={() => window.confirm(`Mettre « ${c.advertiser} » en ligne maintenant pour ${c.durationDays} jours${c.paidAt ? "" : " (payé hors ligne)"} ?`) && act(`a${c.id}`, () => api(`/campaigns/${c.id}/activate`, "POST"), "Annonce mise en ligne.")}>{c.paidAt ? "Relancer" : "Marquer payé et activer"}</button>}
                    {c.effectiveStatus === "active" && <button className={btnGhost} disabled={!!busy} onClick={() => act(`z${c.id}`, () => api(`/campaigns/${c.id}/pause`, "POST"), "Annonce en pause.")}>Pause</button>}
                    {c.effectiveStatus === "pause" && <button className={btnGhost} disabled={!!busy} onClick={() => act(`z${c.id}`, () => api(`/campaigns/${c.id}/resume`, "POST"), "Annonce reprise.")}>Reprendre</button>}
                    <label className={`${btnGhost} inline-block`}>{c.hasImage ? "Changer l'image" : "Ajouter l'image"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { replaceImage(c, e.target.files?.[0]); e.target.value = ""; }} /></label>
                    <button className={btnDanger} disabled={!!busy} onClick={() => window.confirm(`Supprimer l'annonce de « ${c.advertiser} » ? Ses statistiques seront perdues.`) && act(`d${c.id}`, () => api(`/campaigns/${c.id}`, "DELETE"), "Annonce supprimée.")}>Supprimer</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
