import React, { useEffect, useState } from "react";

// Logiciel de gestion interne (personnel). Accès par code admin, stocké dans ce navigateur.
type Tab = "compta" | "stock" | "boutique" | "ventes" | "clients" | "echeances" | "depenses";
const TABS: { id: Tab; label: string }[] = [
  { id: "compta", label: "Point comptable" },
  { id: "stock", label: "Stock & achats" },
  { id: "boutique", label: "Boutique (vitrine)" },
  { id: "ventes", label: "Ventes" },
  { id: "clients", label: "Comptes clients" },
  { id: "echeances", label: "Échéances" },
  { id: "depenses", label: "Dépenses" },
];
const KINDS: Record<string, string> = { scanner: "Scanner", licence: "Licence", equipement: "Équipement", mise_a_jour: "Mise à jour", service: "Service", piece: "Pièce", autre: "Autre" };

const money = (v: any) => `${Number(v || 0).toLocaleString("fr-FR")} FCFA`;
const dateFr = (v: any) => (v ? new Date(v).toLocaleDateString("fr-FR") : "—");

async function api(code: string, url: string, options: RequestInit = {}) {
  const res = await fetch(`/api/gestion${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", "x-admin-code": code, ...(options.headers || {}) },
  });
  return res.json();
}

// Télécharge un export CSV (le code admin voyage dans l'en-tête, donc on passe par fetch plutôt qu'un simple lien).
async function downloadCsv(code: string, what: string) {
  const res = await fetch(`/api/gestion/export/${what}`, { headers: { "x-admin-code": code } });
  if (!res.ok) return;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a"); a.href = url; a.download = `${what}.csv`; a.click(); URL.revokeObjectURL(url);
}
function ExportButtons({ code, items }: { code: string; items: [string, string][] }) {
  return <div className="flex flex-wrap gap-2 items-center"><span className="text-[11px] text-slate-500">Exporter (Excel) :</span>{items.map(([what, label]) => <button key={what} onClick={() => downloadCsv(code, what)} className={btnGhost}>{label}</button>)}</div>;
}

function Gate({ onOk }: { onOk: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    const d = await api(code, "/products");
    if (d.success) { localStorage.setItem("gestion_admin_code", code); onOk(code); } else setError("Code refusé.");
  };
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h1 className="text-white font-bold">Gestion DiagAssist</h1>
        <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code admin" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button onClick={submit} className="w-full py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold cursor-pointer">Entrer</button>
      </div>
    </div>
  );
}

const input = "bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white w-full";
const card = "bg-slate-900 border border-slate-800 rounded-xl p-4";
const btn = "px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white cursor-pointer disabled:opacity-50";
const btnGhost = "px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white cursor-pointer";

function ComptaTab({ code }: { code: string }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [d, setD] = useState<any>(null);
  useEffect(() => { api(code, `/accounting?month=${month}`).then((r) => r.success && setD(r)); }, [month]);
  if (!d) return <p className="text-sm text-slate-500">Chargement…</p>;
  const rows: [string, any, boolean][] = [
    [d.refunds_fcfa ? `Chiffre d'affaires (après ${money(d.refunds_fcfa)} de retours)` : "Chiffre d'affaires", d.revenue_fcfa, false],
    ["Encaissé", d.encaisse_fcfa, false],
    ["Coût d'achat des ventes", -d.cost_of_goods_fcfa, false],
    ["Marge brute", d.gross_margin_fcfa, true],
    ["Dépenses", -d.expenses_fcfa, false],
    ["Résultat net", d.net_result_fcfa, true],
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-white font-bold">Point comptable</h2>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={input + " w-auto"} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={card}><p className="text-[11px] text-slate-500">Ventes du mois</p><p className="text-white font-bold">{d.sales_count}</p></div>
        <div className={card}><p className="text-[11px] text-slate-500">Achats du mois</p><p className="text-white font-bold">{money(d.purchases_fcfa)}</p></div>
        <div className={card}><p className="text-[11px] text-slate-500">Valeur du stock</p><p className="text-white font-bold">{money(d.stock_value_fcfa)}</p></div>
        <div className={card}><p className="text-[11px] text-slate-500">Unités en stock</p><p className="text-white font-bold">{d.stock_units}</p></div>
      </div>
      <div className={card + " space-y-2"}>
        {rows.map(([label, value, strong]) => (
          <div key={label} className={`flex justify-between text-sm ${strong ? "text-white font-bold" : "text-slate-400"}`}><span>{label}</span><span>{money(value)}</span></div>
        ))}
      </div>
      <div className={card}>
        <p className="text-xs font-semibold text-slate-300 mb-2">Dépenses par catégorie</p>
        {d.expenses_by_category.length === 0 && <p className="text-xs text-slate-500">Aucune dépense ce mois-ci.</p>}
        {d.expenses_by_category.map((e: any) => <div key={e.category} className="flex justify-between text-xs text-slate-400"><span>{e.category}</span><span>{money(e.total)}</span></div>)}
      </div>
      <ExportButtons code={code} items={[["ventes", "Ventes"], ["depenses", "Dépenses"], ["stock", "Stock"], ["clients", "Clients"]]} />
    </div>
  );
}

function StockTab({ code }: { code: string }) {
  const [products, setProducts] = useState<any[]>([]);
  const [showProduct, setShowProduct] = useState(false);
  const [showPurchase, setShowPurchase] = useState(false);
  const [pForm, setPForm] = useState({ kind: "scanner", name: "", brand: "", model: "", sale_price_fcfa: "", duration_months: "", track_serial: true });
  const [buy, setBuy] = useState({ supplier: "", reference: "", product_id: "", qty: "1", unit_cost_fcfa: "", serials: "" });
  const [msg, setMsg] = useState("");
  const [purchases, setPurchases] = useState<any[]>([]);
  const load = () => {
    api(code, "/products").then((r) => r.success && setProducts(r.products));
    api(code, "/purchases").then((r) => r.success && setPurchases(r.purchases));
  };
  useEffect(() => { load(); }, []);

  const saveProduct = async () => {
    const d = await api(code, "/products", { method: "POST", body: JSON.stringify({ ...pForm, sale_price_fcfa: Number(pForm.sale_price_fcfa || 0), duration_months: pForm.duration_months ? Number(pForm.duration_months) : null }) });
    setMsg(d.success ? "Produit créé." : d.message); if (d.success) { setShowProduct(false); load(); }
  };
  const savePurchase = async () => {
    const qty = Number(buy.qty || 0);
    // Une ligne par appareil : numéro de série;identifiant;mot de passe (identifiant et mot de passe facultatifs)
    const rows = buy.serials.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split(";").map((x) => x.trim()));
    const serials = rows.map((r) => r[0]).filter(Boolean);
    const accesses = rows.filter((r) => r[1] || r[2]).map((r) => ({ serial: r[0], login: r[1] || "", password: r[2] || "" }));
    const d = await api(code, "/purchases", { method: "POST", body: JSON.stringify({ supplier: buy.supplier, reference: buy.reference, lines: [{ product_id: Number(buy.product_id), qty, unit_cost_fcfa: Number(buy.unit_cost_fcfa || 0), serials, accesses }] }) });
    setMsg(d.success ? `Achat enregistré : ${money(d.total_fcfa)}.` : d.message); if (d.success) { setShowPurchase(false); load(); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <h2 className="text-white font-bold">Stock & achats <span className="ml-2"><ExportButtons code={code} items={[["stock", "Stock"]]} /></span></h2>
        <div className="flex gap-2"><button onClick={() => setShowProduct(!showProduct)} className={btnGhost}>+ Produit</button><button onClick={() => setShowPurchase(!showPurchase)} className={btn}>+ Achat / entrée en stock</button></div>
      </div>
      {msg && <p className="text-xs text-slate-300">{msg}</p>}
      {showProduct && (
        <div className={card + " grid grid-cols-2 md:grid-cols-4 gap-2"}>
          <select className={input} value={pForm.kind} onChange={(e) => setPForm({ ...pForm, kind: e.target.value })}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input className={input} placeholder="Nom" value={pForm.name} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} />
          <input className={input} placeholder="Marque" value={pForm.brand} onChange={(e) => setPForm({ ...pForm, brand: e.target.value })} />
          <input className={input} placeholder="Modèle" value={pForm.model} onChange={(e) => setPForm({ ...pForm, model: e.target.value })} />
          <input className={input} type="number" placeholder="Prix de vente FCFA" value={pForm.sale_price_fcfa} onChange={(e) => setPForm({ ...pForm, sale_price_fcfa: e.target.value })} />
          <input className={input} type="number" placeholder="Durée (mois, licences)" value={pForm.duration_months} onChange={(e) => setPForm({ ...pForm, duration_months: e.target.value })} />
          <label className="text-xs text-slate-400 flex items-center gap-2"><input type="checkbox" checked={pForm.track_serial} onChange={(e) => setPForm({ ...pForm, track_serial: e.target.checked })} />Numéro de série</label>
          <button onClick={saveProduct} className={btn}>Enregistrer le produit</button>
        </div>
      )}
      {showPurchase && (
        <div className={card + " grid grid-cols-2 md:grid-cols-3 gap-2"}>
          <input className={input} placeholder="Fournisseur" value={buy.supplier} onChange={(e) => setBuy({ ...buy, supplier: e.target.value })} />
          <input className={input} placeholder="Référence facture" value={buy.reference} onChange={(e) => setBuy({ ...buy, reference: e.target.value })} />
          <select className={input} value={buy.product_id} onChange={(e) => setBuy({ ...buy, product_id: e.target.value })}><option value="">Produit…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <input className={input} type="number" placeholder="Quantité" value={buy.qty} onChange={(e) => setBuy({ ...buy, qty: e.target.value })} />
          <input className={input} type="number" placeholder="Coût unitaire payé FCFA" value={buy.unit_cost_fcfa} onChange={(e) => setBuy({ ...buy, unit_cost_fcfa: e.target.value })} />
          <textarea className={input + " md:col-span-3"} rows={2} placeholder="Une ligne par appareil : numéro de série;identifiant;mot de passe (les deux derniers facultatifs)" value={buy.serials} onChange={(e) => setBuy({ ...buy, serials: e.target.value })} />
          <button onClick={savePurchase} className={btn}>Enregistrer l'achat</button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="text-slate-500"><tr><th className="py-2">Produit</th><th>Type</th><th>En stock</th><th>Vendus</th><th>Valeur stock</th><th>Prix de vente</th></tr></thead>
          <tbody className="text-slate-300">
            {products.map((p) => (
              <tr key={p.id} className="border-t border-slate-800"><td className="py-2">{p.name} <span className="text-slate-600">{[p.brand, p.model].filter(Boolean).join(" ")}</span></td><td>{KINDS[p.kind] || p.kind}</td><td className="font-semibold text-white">{p.in_stock}</td><td>{p.sold}</td><td>{money(p.stock_value_fcfa)}</td><td>{money(p.sale_price_fcfa)}</td></tr>
            ))}
          </tbody>
        </table>
        {products.length === 0 && <p className="text-xs text-slate-500 py-6 text-center">Aucun produit. Créez-en un avec « + Produit ».</p>}
      </div>
      <h3 className="text-sm font-semibold text-slate-300 pt-2">Achats passés</h3>
      {purchases.length === 0 && <p className="text-xs text-slate-500">Aucun achat enregistré.</p>}
      {purchases.map((p) => <div key={p.id} className="flex flex-wrap justify-between gap-2 text-xs text-slate-400 border-t border-slate-800 py-2"><span>{dateFr(p.purchased_at)} · {p.supplier || "fournisseur non précisé"}{p.reference ? ` · ${p.reference}` : ""} · {p.lines_label}</span><span className="text-slate-300">{money(p.total_fcfa)}</span></div>)}
    </div>
  );
}

function BoutiqueTab({ code }: { code: string }) {
  const [products, setProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const load = () => {
    api(code, "/products").then((r) => r.success && setProducts(r.products));
    api(code, "/shop-orders").then((r) => r.success && setOrders(r.orders));
  };
  useEffect(load, []);
  const publish = async (id: number) => { const d = await api(code, `/products/${id}/publish`, { method: "POST" }); setMsg(d.success ? "Publié / synchronisé avec la boutique." : d.message); load(); };
  const importOrder = async (id: number) => { const d = await api(code, `/shop-orders/${id}/import`, { method: "POST" }); setMsg(d.success ? `Commande transformée en vente ${d.ref} (${money(d.total_fcfa)}).` : d.message); load(); };
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-white font-bold">Boutique (vitrine)</h2>
        <p className="text-xs text-slate-500">Le stock et les prix affichés sur la boutique viennent du back-office : un article en stock est disponible, sans stock il passe en rupture.</p>
      </div>
      {msg && <p className="text-xs text-slate-300">{msg}</p>}
      <h3 className="text-sm font-semibold text-slate-300">Commandes reçues à traiter</h3>
      {orders.length === 0 && <p className="text-xs text-slate-500">Aucune commande en attente.</p>}
      {orders.map((o) => (
        <div key={o.id} className={card + " flex flex-wrap justify-between gap-2 items-center"}>
          <div><p className="text-white text-sm font-semibold">{o.product_name_snapshot} × {o.quantity}</p>
            <p className="text-[11px] text-slate-500">{o.order_ref} · {o.customer_name || o.customer_phone} · {money(o.unit_price_snapshot * o.quantity)} · stock {o.in_stock ?? 0} dont {o.reserved ?? 0} réservé(s){!o.gestion_product_id && " · produit non lié"}</p></div>
          <button onClick={() => importOrder(o.id)} disabled={!o.gestion_product_id} className={btn}>Transformer en vente</button>
        </div>
      ))}
      <h3 className="text-sm font-semibold text-slate-300">Produits du back-office</h3>
      {products.map((p) => (
        <div key={p.id} className="flex flex-wrap justify-between gap-2 items-center border-t border-slate-800 py-2 text-xs text-slate-400">
          <span>{p.name} · stock {p.in_stock} · {money(p.sale_price_fcfa)} · {p.shop_product_id ? "en boutique" : "non publié"}</span>
          <button onClick={() => publish(p.id)} className={btnGhost}>{p.shop_product_id ? "Resynchroniser" : "Publier en boutique"}</button>
        </div>
      ))}
    </div>
  );
}

function SalesTab({ code }: { code: string }) {
  const [products, setProducts] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [clientId, setClientId] = useState("");
  const [newClient, setNewClient] = useState({ name: "", phone: "", city: "" });
  const [lines, setLines] = useState([{ product_id: "", qty: "1", unit_price_fcfa: "" }]);
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState("espèces");
  const [msg, setMsg] = useState("");
  const load = () => {
    api(code, "/products").then((r) => r.success && setProducts(r.products));
    api(code, "/clients").then((r) => r.success && setClients(r.clients));
    api(code, "/sales").then((r) => r.success && setSales(r.sales));
  };
  useEffect(load, []);

  const total = lines.reduce((a, l) => a + Number(l.qty || 0) * Number(l.unit_price_fcfa || 0), 0);
  const pickProduct = (i: number, id: string) => {
    const p = products.find((x) => String(x.id) === id);
    const next = [...lines]; next[i] = { ...next[i], product_id: id, unit_price_fcfa: p ? String(p.sale_price_fcfa) : "" }; setLines(next);
  };
  const submit = async () => {
    const body: any = {
      client_id: clientId || undefined,
      client_name: clientId ? undefined : newClient.name,
      client_phone: newClient.phone, client_city: newClient.city,
      lines: lines.filter((l) => l.product_id).map((l) => ({ product_id: Number(l.product_id), qty: Number(l.qty), unit_price_fcfa: Number(l.unit_price_fcfa) })),
      paid_fcfa: paid === "" ? undefined : Number(paid), payment_method: method,
    };
    const d = await api(code, "/sales", { method: "POST", body: JSON.stringify(body) });
    setMsg(d.success ? `Vente ${d.ref} enregistrée : ${money(d.total_fcfa)}.` : d.message);
    if (d.success) { setLines([{ product_id: "", qty: "1", unit_price_fcfa: "" }]); setPaid(""); load(); }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-white font-bold">Nouvelle vente</h2>
      {msg && <p className="text-xs text-slate-300">{msg}</p>}
      <div className={card + " space-y-3"}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <select className={input} value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Nouveau client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ""}</option>)}
          </select>
          {!clientId && <><input className={input} placeholder="Nom du client" value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} /><input className={input} placeholder="Téléphone WhatsApp" value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} /></>}
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <select className={input + " col-span-6"} value={l.product_id} onChange={(e) => pickProduct(i, e.target.value)}>
              <option value="">Produit…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} (stock : {p.in_stock})</option>)}
            </select>
            <input className={input + " col-span-2"} type="number" min={1} value={l.qty} onChange={(e) => { const n = [...lines]; n[i] = { ...n[i], qty: e.target.value }; setLines(n); }} />
            <input className={input + " col-span-3"} type="number" placeholder="Prix" value={l.unit_price_fcfa} onChange={(e) => { const n = [...lines]; n[i] = { ...n[i], unit_price_fcfa: e.target.value }; setLines(n); }} />
            <button onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1} className="col-span-1 text-slate-500 text-xs cursor-pointer">✕</button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <button onClick={() => setLines([...lines, { product_id: "", qty: "1", unit_price_fcfa: "" }])} className={btnGhost}>+ Ligne</button>
          <div className="flex gap-2 items-center">
            <input className={input + " w-32"} type="number" placeholder={`Payé (${total})`} value={paid} onChange={(e) => setPaid(e.target.value)} />
            <select className={input + " w-36"} value={method} onChange={(e) => setMethod(e.target.value)}><option>espèces</option><option>Wave</option><option>Orange Money</option><option>MTN Money</option><option>virement</option></select>
          </div>
        </div>
        <div className="flex justify-between items-center"><span className="text-sm text-white font-bold">Total : {money(total)}</span><button onClick={submit} className={btn}>Valider la vente</button></div>
      </div>
      <h3 className="text-sm font-semibold text-slate-300">Dernières ventes</h3>
      <div className="space-y-1">
        {sales.map((s) => <div key={s.id} className="flex justify-between text-xs text-slate-400 border-t border-slate-800 py-2"><span>{s.ref} · {s.client_name} · {dateFr(s.sold_at)}</span><span>{money(s.total_fcfa)} (payé {money(s.paid_fcfa)})</span></div>)}
      </div>
    </div>
  );
}

// Accès client d'un équipement : identifiant et mot de passe (chiffré côté serveur).
function CredentialsForm({ code, unit, onSaved }: { code: string; unit: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [login, setLogin] = useState(unit.login || "");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const save = async () => {
    const body: any = { login };
    if (password) body.password = password;
    const d = await api(code, `/units/${unit.id}`, { method: "PATCH", body: JSON.stringify(body) });
    setNote(d.success ? "Accès enregistrés." : d.message);
    if (d.success) { setPassword(""); setOpen(false); onSaved(); }
  };
  if (!open) return <button onClick={() => setOpen(true)} className="text-slate-300 underline cursor-pointer">{unit.login ? "Modifier l'accès" : "Ajouter l'accès (identifiant / mot de passe)"}</button>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2">
      <input className={input} placeholder="Identifiant" value={login} onChange={(e) => setLogin(e.target.value)} />
      <input className={input} type="password" placeholder={unit.has_secret ? "Nouveau mot de passe (laisser vide = inchangé)" : "Mot de passe"} value={password} onChange={(e) => setPassword(e.target.value)} />
      <div className="flex gap-2"><button onClick={save} className={btn}>Enregistrer</button><button onClick={() => setOpen(false)} className={btnGhost}>Annuler</button></div>
      {note && <p className="md:col-span-3 text-[11px] text-slate-400">{note}</p>}
    </div>
  );
}

// Retour d'un article par le client : remboursement (total par défaut), remise en stock ou non.
function ReturnForm({ code, unit, onDone }: { code: string; unit: any; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [refund, setRefund] = useState("");
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const submit = async () => {
    const d = await api(code, `/units/${unit.id}/return`, { method: "POST", body: JSON.stringify({ refund_fcfa: refund === "" ? undefined : Number(refund), restock, reason }) });
    if (d.success) onDone(); else setNote(d.message);
  };
  if (!open) return <button onClick={() => setOpen(true)} className="text-amber-300 underline cursor-pointer">Enregistrer un retour</button>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-2 pt-2">
      <input className={input} type="number" placeholder="Montant remboursé (vide = tout)" value={refund} onChange={(e) => setRefund(e.target.value)} />
      <input className={input} placeholder="Motif" value={reason} onChange={(e) => setReason(e.target.value)} />
      <label className="text-xs text-slate-400 flex items-center gap-2"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />Remettre en stock</label>
      <div className="flex gap-2"><button onClick={submit} className={btn}>Valider le retour</button><button onClick={() => setOpen(false)} className={btnGhost}>Annuler</button></div>
      {note && <p className="md:col-span-4 text-[11px] text-red-400">{note}</p>}
    </div>
  );
}

function ClientsTab({ code }: { code: string }) {
  const [clients, setClients] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<any>(null);
  const [note, setNote] = useState("");
  const [secret, setSecret] = useState<Record<number, string>>({});
  const load = (q = search) => api(code, `/clients${q ? `?search=${encodeURIComponent(q)}` : ""}`).then((r) => r.success && setClients(r.clients));
  useEffect(() => { load(""); }, []);
  const openClient = (id: number) => api(code, `/clients/${id}`).then((r) => r.success && setOpen(r));
  const addNote = async () => { if (!note.trim()) return; await api(code, `/clients/${open.client.id}/events`, { method: "POST", body: JSON.stringify({ message: note }) }); setNote(""); openClient(open.client.id); };
  const reveal = async (unitId: number) => { const d = await api(code, `/units/${unitId}/secret`); setSecret({ ...secret, [unitId]: d.success ? (d.password ?? "(non configuré)") : d.message }); if (open) openClient(open.client.id); };

  if (open) {
    const c = open.client;
    return (
      <div className="space-y-4">
        <button onClick={() => setOpen(null)} className="text-xs text-slate-400 cursor-pointer">← Retour aux clients</button>
        <div className={card}><p className="text-white font-bold">{c.name}</p><p className="text-xs text-slate-500">{[c.phone, c.city, c.email].filter(Boolean).join(" · ")}</p></div>
        <h3 className="text-sm font-semibold text-slate-300">Équipements et licences</h3>
        <div className="space-y-2">
          {open.units.length === 0 && <p className="text-xs text-slate-500">Aucun équipement.</p>}
          {open.units.map((u: any) => (
            <div key={u.id} className={card + " text-xs text-slate-400 space-y-1"}>
              <p className="text-white font-semibold">{u.product_name}{u.status !== "vendu" && <span className="ml-2 text-[10px] text-amber-300">{u.status === "retourne" ? "Retourné" : u.status}</span>}</p>
              <p>N° de série : {u.serial_number || "—"} · Identifiant : {u.login || "—"} · Vendu le {dateFr(u.sold_at)} · Échéance {dateFr(u.expires_at)}</p>
              {u.has_secret && (secret[u.id] !== undefined ? <p>Mot de passe : <span className="text-white">{secret[u.id]}</span></p> : <p><button onClick={() => reveal(u.id)} className="text-red-400 cursor-pointer">Afficher le mot de passe</button></p>)}
              <CredentialsForm code={code} unit={u} onSaved={() => openClient(c.id)} />
              {u.status === "vendu" && <ReturnForm code={code} unit={u} onDone={() => openClient(c.id)} />}
            </div>
          ))}
        </div>
        <h3 className="text-sm font-semibold text-slate-300">Historique des ventes</h3>
        {open.sales.map((s: any) => <div key={s.id} className="text-xs text-slate-400 border-t border-slate-800 py-2">{s.ref} · {dateFr(s.sold_at)} · {money(s.total_fcfa)} (payé {money(s.paid_fcfa)}) · {s.lines.map((l: any) => `${l.product}${l.serial ? ` [${l.serial}]` : ""}`).join(", ")}</div>)}
        <h3 className="text-sm font-semibold text-slate-300">Journal du compte</h3>
        <div className="flex gap-2"><input className={input} placeholder="Ajouter une note (appel, SAV, réclamation…)" value={note} onChange={(e) => setNote(e.target.value)} /><button onClick={addNote} className={btn}>Ajouter</button></div>
        <div className="space-y-1">{open.events.map((e: any) => <div key={e.id} className="text-xs text-slate-400 border-t border-slate-800 py-1.5"><span className="text-slate-600">{new Date(e.created_at).toLocaleString("fr-FR")} · {e.kind}</span> — {e.message}</div>)}</div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ExportButtons code={code} items={[["clients", "Clients"], ["ventes", "Ventes"]]} />
      <div className="flex gap-2"><input className={input} placeholder="Rechercher (nom ou téléphone)" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} /><button onClick={() => load()} className={btnGhost}>Chercher</button></div>
      {clients.map((c) => (
        <button key={c.id} onClick={() => openClient(c.id)} className={card + " w-full text-left flex justify-between cursor-pointer"}>
          <span><span className="text-white font-semibold text-sm">{c.name}</span><span className="block text-[11px] text-slate-500">{c.phone || "sans téléphone"}</span></span>
          <span className="text-xs text-slate-400">{c.sales_count} vente(s) · {money(c.total_spent_fcfa)}</span>
        </button>
      ))}
      {clients.length === 0 && <p className="text-xs text-slate-500 text-center py-6">Aucun client.</p>}
    </div>
  );
}

function ExpiryTab({ code }: { code: string }) {
  const [days, setDays] = useState("60");
  const [items, setItems] = useState<any[]>([]);
  const [links, setLinks] = useState<Record<number, string>>({});
  const load = () => api(code, `/expiring?days=${days}`).then((r) => r.success && setItems(r.items));
  useEffect(() => { load(); }, [days]);
  const relance = async (id: number) => {
    const d = await api(code, `/units/${id}/relance`, { method: "POST" });
    if (d.success) setLinks({ ...links, [id]: d.link || "" });
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2"><h2 className="text-white font-bold">Échéances à relancer</h2>
        <select className={input + " w-auto"} value={days} onChange={(e) => setDays(e.target.value)}><option value="30">30 jours</option><option value="60">60 jours</option><option value="120">120 jours</option></select></div>
      {items.length === 0 && <p className="text-xs text-slate-500 text-center py-6">Aucune échéance dans cette période.</p>}
      {items.map((it) => (
        <div key={it.id} className={card + " flex flex-wrap justify-between gap-2 items-center"}>
          <div><p className="text-white text-sm font-semibold">{it.product_name} <span className={`text-[10px] ml-2 ${it.expired ? "text-red-400" : "text-amber-300"}`}>{it.expired ? "Expiré" : `Échéance ${dateFr(it.expires_at)}`}</span></p>
            <p className="text-[11px] text-slate-500">{it.client_name} · {it.phone || "sans téléphone"} · {it.serial_number || it.login || ""}</p></div>
          <button onClick={() => relance(it.id)} className={btn}>Relancer (WhatsApp)</button>
          {links[it.id] === "" && <span className="text-[11px] text-slate-500 w-full">Pas de téléphone : relance journalisée uniquement.</span>}
          {links[it.id] && <a href={links[it.id]} target="_blank" rel="noreferrer" className="text-[12px] text-emerald-400 underline w-full">Relance enregistrée : ouvrir WhatsApp avec le message prêt</a>}
        </div>
      ))}
    </div>
  );
}

function ExpensesTab({ code }: { code: string }) {
  const [expenses, setExpenses] = useState<any[]>([]);
  const empty = { label: "", category: "licence", amount_fcfa: "", incurred_at: "", notes: "" };
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const load = () => api(code, "/expenses").then((r) => r.success && setExpenses(r.expenses));
  useEffect(() => { load(); }, []);
  const save = async () => {
    const body = JSON.stringify({ ...form, amount_fcfa: Number(form.amount_fcfa || 0), incurred_at: form.incurred_at || undefined });
    const d = editId ? await api(code, `/expenses/${editId}`, { method: "PATCH", body }) : await api(code, "/expenses", { method: "POST", body });
    setMsg(d.success ? (editId ? "Dépense modifiée." : "Dépense ajoutée.") : d.message);
    if (d.success) { setForm({ ...empty, category: form.category }); setEditId(null); load(); }
  };
  const edit = (e: any) => { setEditId(e.id); setForm({ label: e.label, category: e.category, amount_fcfa: String(e.amount_fcfa), incurred_at: String(e.incurred_at).slice(0, 10), notes: e.notes || "" }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-white font-bold">Dépenses</h2><ExportButtons code={code} items={[["depenses", "Dépenses"]]} /></div>
      {msg && <p className="text-xs text-slate-300">{msg}</p>}
      <div className={card + " grid grid-cols-2 md:grid-cols-5 gap-2"}>
        <input className={input} placeholder="Libellé" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <select className={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option value="licence">Licence</option><option value="loyer">Loyer</option><option value="transport">Transport</option><option value="salaire">Salaire</option><option value="communication">Communication</option><option value="autre">Autre</option></select>
        <input className={input} type="number" placeholder="Montant FCFA" value={form.amount_fcfa} onChange={(e) => setForm({ ...form, amount_fcfa: e.target.value })} />
        <input className={input} type="date" value={form.incurred_at} onChange={(e) => setForm({ ...form, incurred_at: e.target.value })} />
        <div className="flex gap-2"><button onClick={save} className={btn}>{editId ? "Enregistrer" : "Ajouter"}</button>{editId && <button onClick={() => { setEditId(null); setForm(empty); }} className={btnGhost}>Annuler</button>}</div>
      </div>
      {expenses.map((e) => <div key={e.id} className="flex justify-between text-xs text-slate-400 border-t border-slate-800 py-2"><span>{dateFr(e.incurred_at)} · {e.category} · {e.label}</span><span className="flex gap-3">{money(e.amount_fcfa)}<button onClick={() => edit(e)} className="text-slate-400 hover:text-white cursor-pointer">modifier</button><button onClick={async () => { await api(code, `/expenses/${e.id}`, { method: "DELETE" }); load(); }} className="text-slate-600 hover:text-red-400 cursor-pointer">supprimer</button></span></div>)}
    </div>
  );
}

export default function GestionApp() {
  const [code, setCode] = useState<string | null>(localStorage.getItem("gestion_admin_code"));
  const [tab, setTab] = useState<Tab>("compta");
  if (!code) return <Gate onOk={setCode} />;
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 pb-10">
      <header className="border-b border-slate-800 px-4 py-3 flex items-center justify-between sticky top-0 bg-slate-950/95 z-20">
        <span className="font-bold text-white text-sm">Gestion DiagAssist</span>
        <button onClick={() => { localStorage.removeItem("gestion_admin_code"); setCode(null); }} className="text-xs text-slate-500 hover:text-white cursor-pointer">Déconnexion</button>
      </header>
      <div className="max-w-6xl mx-auto px-4 py-5">
        <nav className="flex gap-2 overflow-x-auto pb-4 border-b border-slate-800 mb-5">
          {TABS.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={`shrink-0 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer ${tab === t.id ? "bg-red-600 text-white" : "bg-slate-900 text-slate-400 hover:text-white"}`}>{t.label}</button>)}
        </nav>
        {tab === "compta" && <ComptaTab code={code} />}
        {tab === "stock" && <StockTab code={code} />}
        {tab === "boutique" && <BoutiqueTab code={code} />}
        {tab === "ventes" && <SalesTab code={code} />}
        {tab === "clients" && <ClientsTab code={code} />}
        {tab === "echeances" && <ExpiryTab code={code} />}
        {tab === "depenses" && <ExpensesTab code={code} />}
      </div>
    </div>
  );
}
