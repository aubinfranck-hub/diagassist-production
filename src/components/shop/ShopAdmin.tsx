import React, { useState, useEffect } from "react";
import {
  LayoutDashboard, Package, ShoppingCart, Wrench, Users, Plus, X, Lock,
  Trash2, Loader2, ChevronRight, Phone,
} from "lucide-react";

type Tab = "dashboard" | "products" | "orders" | "parts" | "customers";

const ORDER_STATUSES = ["nouvelle", "a_contacter", "contactee", "confirmee", "en_traitement", "prete", "livree", "annulee", "client_injoignable"];
const PART_STATUSES = ["nouvelle", "recherche", "devis_envoye", "devis_accepte", "commandee", "en_transit", "recue", "livree", "annulee"];

async function shopFetch(auth: { header: string; value: string }, url: string, options: RequestInit = {}) {
  const res = await fetch(url, { ...options, headers: { ...options.headers, [auth.header]: auth.value, "Content-Type": "application/json" } });
  return res.json();
}

// Renvoie automatiquement le header d'authentification à utiliser : la session admin déjà
// ouverte dans l'app principale DiagAssist (auth_session_token) si elle existe et est
// reconnue admin, sinon un code admin saisi manuellement (x-admin-code / ADMIN_SECRET).
function useShopAuth() {
  const [auth, setAuth] = useState<{ header: string; value: string } | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const existingToken = localStorage.getItem("auth_session_token");
    const manualCode = localStorage.getItem("shop_admin_code");
    (async () => {
      if (existingToken) {
        const candidate = { header: "Authorization", value: `Bearer ${existingToken}` };
        const test = await fetch("/api/admin/shop/dashboard", { headers: { Authorization: candidate.value } }).then((r) => r.json()).catch(() => ({ success: false }));
        if (test.success) { setAuth(candidate); setChecking(false); return; }
      }
      if (manualCode) {
        const candidate = { header: "x-admin-code", value: manualCode };
        const test = await fetch("/api/admin/shop/dashboard", { headers: { "x-admin-code": manualCode } }).then((r) => r.json()).catch(() => ({ success: false }));
        if (test.success) { setAuth(candidate); setChecking(false); return; }
        localStorage.removeItem("shop_admin_code");
      }
      setChecking(false);
    })();
  }, []);

  const saveCode = (code: string) => { localStorage.setItem("shop_admin_code", code); setAuth({ header: "x-admin-code", value: code }); };
  const clear = () => { localStorage.removeItem("shop_admin_code"); setAuth(null); };
  return { auth, checking, saveCode, clear };
}

function AdminGate({ onValidated }: { onValidated: (code: string) => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setError(null);
    const data = await shopFetch({ header: "x-admin-code", value: input }, "/api/admin/shop/dashboard");
    setChecking(false);
    if (data.success) onValidated(input);
    else setError("Code incorrect.");
  };

  return (
    <div className="max-w-sm mx-auto px-4 py-24 text-center">
      <Lock className="w-10 h-10 text-slate-600 mx-auto mb-4" />
      <h1 className="text-lg font-bold text-white mb-4">Admin Boutique</h1>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="password" autoFocus placeholder="Code admin" value={input} onChange={(e) => setInput(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white text-center"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button type="submit" disabled={checking} className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-bold py-2.5 rounded-xl cursor-pointer">
          {checking ? "Vérification..." : "Entrer"}
        </button>
      </form>
    </div>
  );
}

function Dashboard({ auth }: { auth: any }) {
  const [stats, setStats] = useState<any>(null);
  useEffect(() => { shopFetch(auth, "/api/admin/shop/dashboard").then((d) => d.success && setStats(d.stats)); }, [auth]);
  if (!stats) return <Loader2 className="w-5 h-5 animate-spin text-slate-500 mx-auto mt-10" />;
  const ordersByStatus = stats.ordersByStatus || [];
  const partRequestsByStatus = stats.partRequestsByStatus || [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-2xl font-bold text-white">{stats.totalCustomers || 0}</p>
          <p className="text-xs text-slate-500">Clients</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-2xl font-bold text-amber-500">{stats.followupsDueSoon || 0}</p>
          <p className="text-xs text-slate-500">Relances sous 7j</p>
        </div>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-xs uppercase text-slate-500 font-semibold mb-2">Commandes par statut</p>
        {ordersByStatus.length === 0 ? <p className="text-xs text-slate-600">Aucune commande.</p> :
          ordersByStatus.map((s: any) => (
            <div key={s.status} className="flex justify-between text-sm py-1"><span className="text-slate-300">{s.status}</span><span className="text-white font-bold">{s.count}</span></div>
          ))}
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-xs uppercase text-slate-500 font-semibold mb-2">Demandes de pièces par statut</p>
        {partRequestsByStatus.length === 0 ? <p className="text-xs text-slate-600">Aucune demande.</p> :
          partRequestsByStatus.map((s: any) => (
            <div key={s.status} className="flex justify-between text-sm py-1"><span className="text-slate-300">{s.status}</span><span className="text-white font-bold">{s.count}</span></div>
          ))}
      </div>
    </div>
  );
}

function ProductForm({ auth, categories, onDone, onCancel }: { auth: any; categories: any[]; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [specs, setSpecs] = useState("");
  const [compatibility, setCompatibility] = useState("");
  const [boxContents, setBoxContents] = useState("");
  const [warranty, setWarranty] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [videos, setVideos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const addFile = (file: File, setter: (fn: (arr: string[]) => string[]) => void) => {
    const reader = new FileReader();
    reader.onload = () => setter((arr) => [...arr, reader.result as string]);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await shopFetch(auth, "/api/admin/shop/products", {
      method: "POST",
      body: JSON.stringify({
        name, category_id: categoryId || null, price_fcfa: price ? Number(price) : null,
        description, specs, compatibility, box_contents: boxContents, warranty, photos, videos,
      }),
    });
    setSaving(false);
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2.5">
      <div className="flex justify-between items-center mb-1">
        <p className="text-sm font-bold text-white">Nouveau produit</p>
        <button type="button" onClick={onCancel} className="text-slate-500 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      <input required placeholder="Nom du produit" value={name} onChange={(e) => setName(e.target.value)}
        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
      <div className="flex gap-2">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
          <option value="">Catégorie...</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="number" placeholder="Prix FCFA" value={price} onChange={(e) => setPrice(e.target.value)}
          className="w-32 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
      </div>
      <textarea placeholder="Description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white resize-none" />
      <textarea placeholder="Caractéristiques" rows={2} value={specs} onChange={(e) => setSpecs(e.target.value)}
        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white resize-none" />
      <textarea placeholder="Compatibilité" rows={2} value={compatibility} onChange={(e) => setCompatibility(e.target.value)}
        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white resize-none" />
      <input placeholder="Contenu de la boîte" value={boxContents} onChange={(e) => setBoxContents(e.target.value)}
        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
      <input placeholder="Garantie" value={warranty} onChange={(e) => setWarranty(e.target.value)}
        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />

      <div>
        <label className="text-xs text-slate-400">Photos ({photos.length})</label>
        <input type="file" accept="image/*" multiple onChange={(e) => (Array.from(e.target.files || []) as File[]).forEach((f) => addFile(f, setPhotos))}
          className="block w-full text-xs text-slate-400 mt-1" />
      </div>
      <div>
        <label className="text-xs text-slate-400">Vidéos ({videos.length})</label>
        <input type="file" accept="video/*" multiple onChange={(e) => (Array.from(e.target.files || []) as File[]).forEach((f) => addFile(f, setVideos))}
          className="block w-full text-xs text-slate-400 mt-1" />
      </div>

      <button type="submit" disabled={saving} className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-bold py-2.5 rounded-lg cursor-pointer">
        {saving ? "Enregistrement..." : "Créer le produit"}
      </button>
    </form>
  );
}

function ProductsTab({ auth }: { auth: any }) {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    shopFetch(auth, "/api/admin/shop/products").then((d) => d.success && setProducts(d.products));
    shopFetch(auth, "/api/admin/shop/categories").then((d) => d.success && setCategories(d.categories));
  };
  useEffect(load, [auth]);

  const [newCatName, setNewCatName] = useState("");
  const addCategory = async () => {
    if (!newCatName.trim()) return;
    await shopFetch(auth, "/api/admin/shop/categories", { method: "POST", body: JSON.stringify({ name: newCatName }) });
    setNewCatName("");
    load();
  };

  const deleteProduct = async (id: number) => {
    if (!confirm("Désactiver ce produit ?")) return;
    await shopFetch(auth, `/api/admin/shop/products/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input placeholder="Nouvelle catégorie" value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
          className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white" />
        <button onClick={addCategory} className="bg-slate-800 text-white text-xs font-semibold px-3 rounded-lg cursor-pointer">Ajouter</button>
      </div>

      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="w-full flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold py-2.5 rounded-xl cursor-pointer">
          <Plus className="w-4 h-4" /> Nouveau produit
        </button>
      ) : (
        <ProductForm auth={auth} categories={categories} onDone={() => { setShowForm(false); load(); }} onCancel={() => setShowForm(false)} />
      )}

      {products.map((p) => (
        <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-slate-800 overflow-hidden shrink-0">
            {p.photos?.[0] && <img src={p.photos[0]} className="w-full h-full object-cover" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{p.name}</p>
            <p className="text-xs text-slate-500">{p.category_name || "—"} · {p.price_fcfa ? p.price_fcfa.toLocaleString("fr-FR") + " FCFA" : "Prix sur demande"}</p>
          </div>
          <button onClick={() => deleteProduct(p.id)} className="text-slate-500 hover:text-red-400 cursor-pointer p-1"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
    </div>
  );
}

function OrdersTab({ auth }: { auth: any }) {
  const [orders, setOrders] = useState<any[]>([]);
  useEffect(() => { shopFetch(auth, "/api/admin/shop/orders").then((d) => d.success && setOrders(d.orders)); }, [auth]);

  const updateStatus = async (id: number, status: string) => {
    await shopFetch(auth, `/api/admin/shop/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
  };

  if (orders.length === 0) return <p className="text-sm text-slate-500 text-center py-10">Aucune commande.</p>;

  return (
    <div className="space-y-2.5">
      {orders.map((o) => (
        <div key={o.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="flex justify-between items-start mb-1.5">
            <div>
              <p className="text-sm font-semibold text-white">{o.product_name_snapshot}</p>
              <p className="text-xs text-slate-500 flex items-center gap-1"><Phone className="w-3 h-3" /> {o.customer_phone} {o.customer_name && `· ${o.customer_name}`}</p>
            </div>
            <span className="text-xs text-slate-500">Qté {o.quantity}</span>
          </div>
          <select value={o.status} onChange={(e) => updateStatus(o.id, e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white">
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

function PartsTab({ auth }: { auth: any }) {
  const [requests, setRequests] = useState<any[]>([]);
  useEffect(() => { shopFetch(auth, "/api/admin/shop/part-requests").then((d) => d.success && setRequests(d.requests)); }, [auth]);

  const update = async (id: number, fields: any) => {
    await shopFetch(auth, `/api/admin/shop/part-requests/${id}`, { method: "PATCH", body: JSON.stringify(fields) });
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)));
  };

  if (requests.length === 0) return <p className="text-sm text-slate-500 text-center py-10">Aucune demande.</p>;

  return (
    <div className="space-y-2.5">
      {requests.map((r) => (
        <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
          <p className="text-sm font-semibold text-white">{r.part_description}</p>
          <p className="text-xs text-slate-500 flex items-center gap-1"><Phone className="w-3 h-3" /> {r.customer_phone} {r.customer_name && `· ${r.customer_name}`}</p>
          {r.carte_grise_base64 && <a href={r.carte_grise_base64} target="_blank" className="text-xs text-sky-400 underline">Voir carte grise</a>}
          <select value={r.status} onChange={(e) => update(r.id, { status: e.target.value })}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white">
            {PART_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="number" placeholder="Cotation FCFA" defaultValue={r.quote_fcfa || ""} onBlur={(e) => update(r.id, { quote_fcfa: e.target.value ? Number(e.target.value) : null })}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white" />
        </div>
      ))}
    </div>
  );
}

function CustomersTab({ auth }: { auth: any }) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);

  const load = (q?: string) => shopFetch(auth, `/api/admin/shop/customers${q ? `?search=${encodeURIComponent(q)}` : ""}`).then((d) => d.success && setCustomers(d.customers));
  useEffect(() => { load(); }, [auth]);

  const openCustomer = async (phone: string) => {
    const data = await shopFetch(auth, `/api/admin/shop/customers/${encodeURIComponent(phone)}`);
    if (data.success) setSelected(data);
  };

  if (selected) {
    return (
      <div className="space-y-3">
        <button onClick={() => setSelected(null)} className="text-xs text-slate-400 cursor-pointer">← Retour</button>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-sm font-bold text-white">{selected.customer.name || selected.customer.phone}</p>
          <p className="text-xs text-slate-500">{selected.customer.phone} {selected.customer.city && `· ${selected.customer.city}`}</p>
        </div>
        <p className="text-xs uppercase text-slate-500 font-semibold">Commandes ({selected.orders.length})</p>
        {selected.orders.map((o: any) => <div key={o.id} className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-300">{o.product_name_snapshot} — {o.status}</div>)}
        <p className="text-xs uppercase text-slate-500 font-semibold">Demandes de pièces ({selected.partRequests.length})</p>
        {selected.partRequests.map((r: any) => <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-300">{r.part_description} — {r.status}</div>)}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <input placeholder="Rechercher (téléphone ou nom)" value={search}
        onChange={(e) => { setSearch(e.target.value); load(e.target.value); }}
        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white" />
      {customers.map((c) => (
        <button key={c.phone} onClick={() => openCustomer(c.phone)} className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between cursor-pointer text-left">
          <div>
            <p className="text-sm font-semibold text-white">{c.name || c.phone}</p>
            <p className="text-xs text-slate-500">{c.phone}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-600" />
        </button>
      ))}
    </div>
  );
}

export default function ShopAdmin() {
  const { auth, checking, saveCode, clear } = useShopAuth();
  const [tab, setTab] = useState<Tab>("dashboard");

  if (checking) return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 text-slate-500 animate-spin" /></div>;
  if (!auth) return <AdminGate onValidated={saveCode} />;

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "dashboard", label: "Accueil", icon: LayoutDashboard },
    { id: "products", label: "Produits", icon: Package },
    { id: "orders", label: "Commandes", icon: ShoppingCart },
    { id: "parts", label: "Pièces", icon: Wrench },
    { id: "customers", label: "Clients", icon: Users },
  ];

  return (
    <div className="min-h-screen bg-slate-950 pb-20">
      <header className="border-b border-slate-800 px-4 py-3 flex items-center justify-between sticky top-0 bg-slate-950/95 backdrop-blur z-10">
        <span className="font-bold text-white text-sm">Admin Boutique</span>
        <button onClick={clear} className="text-xs text-slate-500 cursor-pointer">Déconnexion</button>
      </header>

      <div className="max-w-xl mx-auto px-4 py-4">
        {tab === "dashboard" && <Dashboard auth={auth} />}
        {tab === "products" && <ProductsTab auth={auth} />}
        {tab === "orders" && <OrdersTab auth={auth} />}
        {tab === "parts" && <PartsTab auth={auth} />}
        {tab === "customers" && <CustomersTab auth={auth} />}
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 flex">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 cursor-pointer ${tab === t.id ? "text-red-500" : "text-slate-500"}`}>
            <t.icon className="w-4.5 h-4.5" />
            <span className="text-[10px]">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
