import React, { useEffect, useState } from "react";
import { Ticket, Plus, Trash2 } from "lucide-react";

type Pack = { id: string; label: string; credits: number; priceXof: number; active: boolean };
type Stats = { paidCount: number; revenueXof: number; creditsSold: number; freeUsed: number; users: number };

const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("auth_session_token") || ""}` });
const input = "bg-slate-950 border border-white/[0.08] text-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-amber-500 w-full";

/** Réglages admin des diagnostics IA : nombre de gratuits, packs (nom, taille, prix), offrir des diagnostics. */
export default function CreditsAdmin() {
  const [freeCount, setFreeCount] = useState(3);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [grantPhone, setGrantPhone] = useState("");
  const [grantCredits, setGrantCredits] = useState(5);

  const load = async () => {
    try {
      const d = await (await fetch("/api/admin/credits", { headers: headers() })).json();
      if (d.success) { setFreeCount(d.settings.freeCount); setPacks(d.settings.packs); setStats(d.stats); }
    } catch { setMsg({ ok: false, text: "Impossible de charger les réglages." }); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/credits/settings", { method: "PUT", headers: headers(), body: JSON.stringify({ freeCount, packs }) });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      setPacks(d.settings.packs); setMsg({ ok: true, text: "Réglages enregistrés. Ils s'appliquent tout de suite." });
    } catch (e: any) { setMsg({ ok: false, text: e.message || "Échec de l'enregistrement." }); }
    setBusy(false);
  };

  const grant = async () => {
    setMsg(null);
    try {
      const res = await fetch("/api/admin/credits/grant", { method: "POST", headers: headers(), body: JSON.stringify({ phone: grantPhone.trim(), credits: grantCredits }) });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      setMsg({ ok: true, text: `${grantCredits} diagnostics offerts à ${grantPhone.trim()}. Il en a maintenant ${d.balance.total}.` });
    } catch (e: any) { setMsg({ ok: false, text: e.message || "Échec." }); }
  };

  const edit = (i: number, patch: Partial<Pack>) => setPacks(ps => ps.map((p, j) => j === i ? { ...p, ...patch } : p));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4" data-testid="credits-admin">
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
        <Ticket className="w-4 h-4 text-amber-400" /> Diagnostics IA : gratuits et packs payants
      </h3>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Chaque compte gratuit reçoit un nombre de diagnostics offerts, puis achète des packs par Orange Money, Wave, MTN ou Moov (via Jèko). Les abonnés Lite/Premium et le SOS ne sont pas concernés.
      </p>
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          {[["Packs vendus", stats.paidCount], ["Argent encaissé", `${new Intl.NumberFormat("fr-FR").format(stats.revenueXof)} F`], ["Diagnostics vendus", stats.creditsSold], ["Gratuits utilisés", stats.freeUsed]].map(([l, v]) => (
            <div key={String(l)} className="bg-slate-950 rounded-xl p-3"><strong className="block text-amber-300 text-sm">{v}</strong><span className="text-[10px] text-slate-500">{l}</span></div>
          ))}
        </div>
      )}
      <label className="block text-xs text-slate-300 font-bold space-y-1">
        <span>Diagnostics gratuits par utilisateur</span>
        <input type="number" min={0} max={100} value={freeCount} onChange={e => setFreeCount(Number(e.target.value))} className={`${input} max-w-[140px]`} data-testid="credits-free-count" />
      </label>
      <div className="space-y-2">
        <span className="block text-xs text-slate-300 font-bold">Packs</span>
        {packs.map((p, i) => (
          <div key={p.id} className="grid grid-cols-12 gap-2 items-center" data-testid="credits-pack-row">
            <input aria-label="Nom du pack" value={p.label} onChange={e => edit(i, { label: e.target.value })} className={`${input} col-span-12 sm:col-span-4`} />
            <input aria-label="Nombre de diagnostics" type="number" min={1} value={p.credits} onChange={e => edit(i, { credits: Number(e.target.value) })} className={`${input} col-span-4 sm:col-span-2`} />
            <input aria-label="Prix en F CFA" type="number" min={100} step={100} value={p.priceXof} onChange={e => edit(i, { priceXof: Number(e.target.value) })} className={`${input} col-span-4 sm:col-span-3`} />
            <label className="col-span-3 sm:col-span-2 text-[11px] text-slate-400 flex items-center gap-1"><input type="checkbox" checked={p.active} onChange={e => edit(i, { active: e.target.checked })} /> En vente</label>
            <button onClick={() => setPacks(ps => ps.filter((_, j) => j !== i))} aria-label="Supprimer le pack" className="col-span-1 text-rose-400 hover:text-rose-300"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <div className="text-[10px] text-slate-500">Colonnes : nom · nombre de diagnostics · prix en F CFA · en vente</div>
        {packs.length < 8 && (
          <button onClick={() => setPacks(ps => [...ps, { id: `new-${Date.now()}`, label: "Nouveau pack", credits: 10, priceXof: 2000, active: true }])}
            className="text-xs font-bold text-amber-300 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Ajouter un pack</button>
        )}
      </div>
      <button onClick={save} disabled={busy} data-testid="credits-save" className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold disabled:opacity-50">Enregistrer</button>

      <div className="border-t border-white/[0.06] pt-4 space-y-2">
        <span className="block text-xs text-slate-300 font-bold">Offrir des diagnostics à un client</span>
        <div className="flex flex-wrap gap-2">
          <input value={grantPhone} onChange={e => setGrantPhone(e.target.value)} placeholder="Numéro du compte (comme à la connexion)" className={`${input} flex-1 min-w-[200px]`} data-testid="credits-grant-phone" />
          <input type="number" min={1} max={1000} value={grantCredits} onChange={e => setGrantCredits(Number(e.target.value))} style={{ width: 96 }} className={input} />
          <button onClick={grant} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-extrabold text-slate-100" data-testid="credits-grant">Offrir</button>
        </div>
      </div>
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-400" : "text-rose-400"}`} role="status">{msg.text}</p>}
    </div>
  );
}
