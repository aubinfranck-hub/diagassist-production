import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, Award, BookOpen, Calendar, CheckCircle2, ChevronDown,
  ChevronRight, Clock, CreditCard, ExternalLink, Filter, GraduationCap,
  Grid, List, MapPin, Menu, MessageCircle, Minus, Package, Phone,
  Plus, RotateCcw, Search, ShieldCheck, ShoppingBag, ShoppingCart,
  SlidersHorizontal, Smartphone, Star, Tag, Trash2, Truck, Users,
  Wrench, X, Zap, Cpu, Settings, Code2, Car
} from "lucide-react";
import ShopAdmin from "./ShopAdmin";

// ─── Design tokens ───────────────────────────────────────────────────────────
const C = {
  black: "#07090c",
  dark: "#10141a",
  dark2: "#141a22",
  border: "#202731",
  red: "#ed1c24",
  redDark: "#b90f16",
  gray: "#73777d",
  light: "#f5f6f7",
};
const WA = "2250707312797";
const BASE = "";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ShopProduct {
  id: number; name: string; slug: string; brand: string | null;
  model: string | null; price_fcfa: number | null; description: string | null;
  specs: string | null; compatibility: string | null; box_contents: string | null;
  warranty: string | null; availability: string; photos: string[];
  videos: string[]; category_name: string | null; category_slug: string | null;
}
interface ShopCategory { id: number; name: string; slug: string; type: string; }
interface CartItem { product_id: number; name: string; price_fcfa: number | null; photo: string | null; quantity: number; }
type Page = "home" | "catalog" | "product" | "checkout" | "tracking" | "formations";

// ─── Utils ────────────────────────────────────────────────────────────────────
function fcfa(n: number | null) {
  return n == null ? "Prix sur demande" : n.toLocaleString("fr-FR") + " FCFA";
}
function waLink(msg: string) {
  return `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`;
}

// ─── Cart hook ────────────────────────────────────────────────────────────────
function useCart() {
  const [items, setItems] = useState<CartItem[]>(() => {
    try { return JSON.parse(localStorage.getItem("shop_cart") || "[]"); } catch { return []; }
  });
  useEffect(() => localStorage.setItem("shop_cart", JSON.stringify(items)), [items]);
  const add = (p: ShopProduct, qty = 1) => setItems(prev => {
    const found = prev.find(i => i.product_id === p.id);
    return found
      ? prev.map(i => i.product_id === p.id ? { ...i, quantity: i.quantity + qty } : i)
      : [...prev, { product_id: p.id, name: p.name, price_fcfa: p.price_fcfa, photo: p.photos?.[0] || null, quantity: qty }];
  });
  const remove = (id: number) => setItems(prev => prev.filter(i => i.product_id !== id));
  const setQty = (id: number, qty: number) => setItems(prev => prev.map(i => i.product_id === id ? { ...i, quantity: Math.max(1, qty) } : i));
  const clear = () => setItems([]);
  const count = items.reduce((s, i) => s + i.quantity, 0);
  const total = items.reduce((s, i) => s + (i.price_fcfa || 0) * i.quantity, 0);
  return { items, add, remove, setQty, clear, count, total };
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function fetchJSON(path: string) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// ─── HEADER ──────────────────────────────────────────────────────────────────
function ShopHeader({
  page, setPage, cartCount, onCartOpen, onSearch, categories
}: {
  page: Page; setPage: (p: Page) => void;
  cartCount: number; onCartOpen: () => void;
  onSearch: (q: string) => void; categories: ShopCategory[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setCatOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(q);
    setPage("catalog");
  };

  return (
    <header style={{ background: C.dark, borderBottom: `1px solid ${C.border}` }} className="sticky top-0 z-40 w-full">
      {/* Top bar */}
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2.5 flex items-center gap-3">
        {/* Logo */}
        <button onClick={() => setPage("home")} className="flex items-center gap-2 mr-1 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: C.red }}>
            <Wrench className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-black text-sm tracking-tight hidden sm:block">DiagAssist</span>
          <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(237,28,36,0.2)", color: C.red }}>Shop</span>
        </button>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex-1 max-w-xl flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.07)", border: `1px solid ${C.border}` }}>
          <Search className="w-4 h-4 text-neutral-400 flex-shrink-0" />
          <input
            type="search" value={q} onChange={e => setQ(e.target.value)}
            placeholder="Rechercher un scanner, outil..."
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder-neutral-500 min-w-0"
          />
        </form>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <a href={waLink("Bonjour DiagAssist, je souhaite de l'aide.")} target="_blank" rel="noreferrer"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white"
            style={{ background: "#16a34a" }}>
            <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
          </a>
          <button onClick={onCartOpen} className="relative p-2 rounded-lg text-white hover:bg-white/10 transition-colors">
            <ShoppingCart className="w-5 h-5" />
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4.5 h-4.5 rounded-full text-[10px] font-black flex items-center justify-center text-white"
                style={{ background: C.red, minWidth: "18px", minHeight: "18px" }}>{cartCount}</span>
            )}
          </button>
          <button onClick={() => setMenuOpen(!menuOpen)} className="sm:hidden p-2 text-white">
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Nav bar */}
      <nav className="hidden sm:block w-full border-t" style={{ borderColor: C.border, background: C.dark2 }}>
        <div className="max-w-7xl mx-auto px-4 flex items-center gap-1 h-10" ref={ref}>
          <div className="relative">
            <button onClick={() => setCatOpen(!catOpen)}
              className="flex items-center gap-1.5 px-4 py-1.5 text-white text-xs font-extrabold h-10 transition-colors"
              style={{ background: catOpen ? C.redDark : C.red }}>
              <Menu className="w-3.5 h-3.5" /> Tous les produits <ChevronDown className={`w-3 h-3 transition-transform ${catOpen ? "rotate-180" : ""}`} />
            </button>
            {catOpen && (
              <div className="absolute left-0 top-full mt-0 w-64 bg-white rounded-b-xl shadow-2xl z-50 py-2"
                onMouseLeave={() => setCatOpen(false)}>
                <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-100">
                  Rayons DiagAssist
                </div>
                {categories.map(cat => (
                  <button key={cat.id} onClick={() => { setPage("catalog"); setCatOpen(false); }}
                    className="w-full text-left px-3.5 py-2 hover:bg-red-50 hover:text-red-600 text-xs font-semibold text-neutral-700 flex items-center gap-2 transition-colors">
                    <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" /> {cat.name}
                  </button>
                ))}
                {categories.length === 0 && (
                  <button onClick={() => { setPage("catalog"); setCatOpen(false); }}
                    className="w-full text-left px-3.5 py-2 hover:bg-red-50 hover:text-red-600 text-xs font-semibold text-neutral-700 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" /> Voir le catalogue
                  </button>
                )}
              </div>
            )}
          </div>
          {[
            { label: "Scanners", p: "catalog" as Page },
            { label: "Formations", p: "formations" as Page },
            { label: "Suivi commande", p: "tracking" as Page },
          ].map(({ label, p }) => (
            <button key={label} onClick={() => setPage(p)}
              className={`px-4 h-10 text-xs font-bold transition-colors ${page === p ? "text-red-400 border-b-2 border-red-400" : "text-neutral-400 hover:text-white"}`}>
              {label}
            </button>
          ))}
        </div>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="sm:hidden border-t" style={{ borderColor: C.border, background: C.dark2 }}>
          {[
            { label: "Accueil", p: "home" as Page },
            { label: "Catalogue", p: "catalog" as Page },
            { label: "Formations", p: "formations" as Page },
            { label: "Suivi commande", p: "tracking" as Page },
          ].map(({ label, p }) => (
            <button key={label} onClick={() => { setPage(p); setMenuOpen(false); }}
              className="w-full text-left px-4 py-3 text-sm font-bold text-white border-b border-white/5 hover:bg-white/5">
              {label}
            </button>
          ))}
          <a href={waLink("Bonjour DiagAssist")} target="_blank" rel="noreferrer"
            className="flex items-center gap-2 px-4 py-3 text-sm font-bold text-white" style={{ background: "#16a34a" }}>
            <MessageCircle className="w-4 h-4" /> WhatsApp Support
          </a>
        </div>
      )}
    </header>
  );
}

// ─── HOME ─────────────────────────────────────────────────────────────────────
function ShopHome({
  products, setPage, cart, onAdd
}: {
  products: ShopProduct[]; setPage: (p: Page) => void;
  cart: ReturnType<typeof useCart>; onAdd: (p: ShopProduct) => void;
}) {
  const featured = products.slice(0, 8);
  return (
    <div style={{ background: C.black }} className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden border-b" style={{ borderColor: C.border }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 80% 60% at 70% 50%, rgba(237,28,36,0.15), transparent 70%)" }} />
        <div className="absolute inset-0 opacity-5 pointer-events-none"
          style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-16 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-5">
              <div>
                <h1 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight leading-tight text-white">
                  LA RÉFÉRENCE<br />
                  <span style={{ color: C.red }} className="drop-shadow-[0_2px_12px_rgba(237,28,36,0.4)]">DU DIAGNOSTIC AUTO</span>
                </h1>
                <p className="text-base text-neutral-300 mt-2">Scanners, outils de programmation, accessoires et formation.</p>
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold text-neutral-200"
                style={{ background: C.dark, border: `1px solid ${C.border}` }}>
                <span className="w-2 h-2 rounded-full animate-ping" style={{ background: C.red }} />
                Qualité &nbsp;|&nbsp; Support &nbsp;|&nbsp; Performance
              </div>
              <div className="flex flex-wrap gap-3 pt-1">
                <button onClick={() => setPage("catalog")}
                  className="flex items-center gap-2 px-7 py-3.5 rounded-lg text-base font-extrabold text-white shadow-lg transition-all hover:translate-x-0.5 group"
                  style={{ background: C.red, boxShadow: "0 4px 20px rgba(237,28,36,0.3)" }}>
                  Voir nos produits <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <button onClick={() => setPage("formations")}
                  className="px-5 py-3.5 rounded-lg text-sm font-bold text-white border border-neutral-700 hover:bg-white/10 transition-all">
                  Découvrir les formations
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                {[
                  { Icon: Settings, label: "Diagnostic multimarque" },
                  { Icon: Code2, label: "Programmation & Codage" },
                  { Icon: Car, label: "Auto & Moto" },
                  { Icon: GraduationCap, label: "Formations pratiques" },
                ].map(({ Icon, label }) => (
                  <div key={label} className="flex items-center gap-2 rounded-lg p-2 border transition-colors hover:border-red-600"
                    style={{ background: "rgba(16,20,26,0.9)", borderColor: C.border }}>
                    <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ background: "#1f2733", color: C.red }}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] font-bold text-neutral-200 leading-tight">{label}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Visual placeholder */}
            <div className="lg:col-span-5 flex items-center justify-center">
              <div className="w-full max-w-xs aspect-square rounded-2xl border flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #10141a 0%, #1a222e 100%)", borderColor: C.border }}>
                <div className="text-center space-y-2">
                  <div className="w-20 h-20 mx-auto rounded-2xl flex items-center justify-center" style={{ background: C.red }}>
                    <Cpu className="w-10 h-10 text-white" />
                  </div>
                  <p className="text-white font-black text-lg">DiagAssist Scanner</p>
                  <p className="text-neutral-400 text-xs">Disponible en boutique</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust badges */}
      <div className="border-b" style={{ borderColor: C.border, background: C.dark2 }}>
        <div className="max-w-7xl mx-auto px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { Icon: Truck, label: "Livraison Abidjan & CI" },
            { Icon: ShieldCheck, label: "Garantie & SAV" },
            { Icon: MessageCircle, label: "Support WhatsApp 7j/7" },
            { Icon: Award, label: "Produits certifiés" },
          ].map(({ Icon, label }) => (
            <div key={label} className="flex items-center gap-2 text-xs text-neutral-300 font-semibold">
              <Icon className="w-4 h-4 flex-shrink-0" style={{ color: C.red }} /> {label}
            </div>
          ))}
        </div>
      </div>

      {/* Featured products */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl sm:text-2xl font-black text-white">Produits phares</h2>
          <button onClick={() => setPage("catalog")}
            className="flex items-center gap-1 text-xs font-bold hover:underline" style={{ color: C.red }}>
            Voir tout <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
        {featured.length === 0 ? (
          <div className="text-center py-16 text-neutral-500">
            <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Le catalogue sera bientôt disponible.</p>
            <p className="text-xs mt-1">Contactez-nous sur WhatsApp pour commander.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {featured.map(p => <ProductCard key={p.id} product={p} cart={cart} onAdd={onAdd} onClick={() => {}} />)}
          </div>
        )}
      </div>

      {/* WhatsApp CTA */}
      <div className="max-w-7xl mx-auto px-4 pb-12">
        <div className="rounded-2xl p-6 sm:p-8 text-white text-center space-y-4 relative overflow-hidden border"
          style={{ background: C.dark, borderColor: C.border }}>
          <div className="absolute inset-0 pointer-events-none opacity-10"
            style={{ backgroundImage: "radial-gradient(#fff 1px,transparent 1px)", backgroundSize: "20px 20px" }} />
          <h3 className="relative text-lg sm:text-xl font-black">Besoin d'un conseil avant d'acheter ?</h3>
          <p className="relative text-sm text-neutral-300">Nos experts répondent en quelques minutes sur WhatsApp.</p>
          <a href={waLink("Bonjour DiagAssist, je voudrais un conseil pour choisir mon scanner.")} target="_blank" rel="noreferrer"
            className="relative inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-white text-sm"
            style={{ background: "#16a34a" }}>
            <MessageCircle className="w-4 h-4" /> Contacter un expert
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── PRODUCT CARD ─────────────────────────────────────────────────────────────
function ProductCard({
  product, cart, onAdd, onClick
}: {
  product: ShopProduct; cart: ReturnType<typeof useCart>;
  onAdd: (p: ShopProduct) => void; onClick: (slug: string) => void;
}) {
  const inCart = cart.items.some(i => i.product_id === product.id);
  const photo = product.photos?.[0];
  const available = product.availability === "in_stock" || product.availability === "available";

  return (
    <div className="group rounded-xl border overflow-hidden flex flex-col transition-all hover:-translate-y-0.5 hover:shadow-xl"
      style={{ background: C.dark, borderColor: C.border, boxShadow: "0 2px 8px rgba(0,0,0,0.4)" }}>
      <div className="relative aspect-square overflow-hidden cursor-pointer" onClick={() => onClick(product.slug)}
        style={{ background: "#0d1117" }}>
        {photo ? (
          <img src={photo} alt={product.name} className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Cpu className="w-12 h-12 opacity-20 text-neutral-400" />
          </div>
        )}
        {!available && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-xs font-bold text-white px-2 py-1 rounded" style={{ background: C.red }}>Sur commande</span>
          </div>
        )}
      </div>
      <div className="p-3 flex-1 flex flex-col gap-2">
        {product.brand && <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: C.red }}>{product.brand}</span>}
        <h3 className="text-sm font-bold text-white leading-tight line-clamp-2 cursor-pointer hover:text-red-400 transition-colors"
          onClick={() => onClick(product.slug)}>{product.name}</h3>
        <div className="mt-auto space-y-2">
          <p className="text-base font-black text-white">{fcfa(product.price_fcfa)}</p>
          <button
            onClick={() => onAdd(product)}
            disabled={!available}
            className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all ${inCart ? "border" : ""}`}
            style={inCart
              ? { background: "transparent", borderColor: C.red, color: C.red }
              : { background: available ? C.red : "#374151", color: "white" }}>
            {inCart ? <><CheckCircle2 className="w-3.5 h-3.5" /> Ajouté</> : <><ShoppingCart className="w-3.5 h-3.5" /> Ajouter</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CATALOG ──────────────────────────────────────────────────────────────────
function ShopCatalog({
  products, categories, cart, onAdd, initialSearch, onProductClick
}: {
  products: ShopProduct[]; categories: ShopCategory[];
  cart: ReturnType<typeof useCart>; onAdd: (p: ShopProduct) => void;
  initialSearch: string; onProductClick: (slug: string) => void;
}) {
  const [search, setSearch] = useState(initialSearch);
  const [catSlug, setCatSlug] = useState<string | null>(null);
  const [brand, setBrand] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sort, setSort] = useState<"default" | "price-asc" | "price-desc">("default");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [filterOpen, setFilterOpen] = useState(false);

  const brands = useMemo(() => [...new Set(products.map(p => p.brand).filter(Boolean) as string[])].sort(), [products]);

  const filtered = useMemo(() => {
    let res = products.filter(p => {
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !(p.brand || "").toLowerCase().includes(q) &&
          !(p.description || "").toLowerCase().includes(q)) return false;
      }
      if (catSlug && p.category_slug !== catSlug) return false;
      if (brand && p.brand !== brand) return false;
      if (inStockOnly && p.availability !== "in_stock" && p.availability !== "available") return false;
      return true;
    });
    if (sort === "price-asc") res = [...res].sort((a, b) => (a.price_fcfa || 0) - (b.price_fcfa || 0));
    if (sort === "price-desc") res = [...res].sort((a, b) => (b.price_fcfa || 0) - (a.price_fcfa || 0));
    return res;
  }, [products, search, catSlug, brand, inStockOnly, sort]);

  const reset = () => { setSearch(""); setCatSlug(null); setBrand(""); setInStockOnly(false); setSort("default"); };

  return (
    <div style={{ background: C.black }} className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: C.dark, border: `1px solid ${C.border}` }}>
            <Search className="w-4 h-4 text-neutral-500 flex-shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher dans le catalogue..."
              className="bg-transparent text-white text-sm outline-none flex-1 min-w-0 placeholder-neutral-500" />
            {search && <button onClick={() => setSearch("")}><X className="w-4 h-4 text-neutral-500" /></button>}
          </div>
          <select value={sort} onChange={e => setSort(e.target.value as any)}
            className="px-3 py-2 rounded-lg text-sm text-white outline-none cursor-pointer"
            style={{ background: C.dark, border: `1px solid ${C.border}` }}>
            <option value="default">Tri : défaut</option>
            <option value="price-asc">Prix croissant</option>
            <option value="price-desc">Prix décroissant</option>
          </select>
          <div className="flex items-center rounded-lg overflow-hidden border" style={{ borderColor: C.border }}>
            <button onClick={() => setView("grid")} className={`p-2 transition-colors ${view === "grid" ? "text-white" : "text-neutral-500 hover:text-white"}`}
              style={{ background: view === "grid" ? C.red : C.dark }}><Grid className="w-4 h-4" /></button>
            <button onClick={() => setView("list")} className={`p-2 transition-colors ${view === "list" ? "text-white" : "text-neutral-500 hover:text-white"}`}
              style={{ background: view === "list" ? C.red : C.dark }}><List className="w-4 h-4" /></button>
          </div>
          <button onClick={() => setFilterOpen(!filterOpen)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white sm:hidden"
            style={{ background: C.dark, border: `1px solid ${C.border}` }}>
            <Filter className="w-4 h-4" /> Filtres
          </button>
        </div>

        <div className="flex gap-6">
          {/* Sidebar */}
          <aside className={`flex-shrink-0 w-52 space-y-5 ${filterOpen ? "block" : "hidden sm:block"}`}>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-black uppercase tracking-wider text-neutral-400">Catégories</span>
                <button onClick={reset} className="text-[10px] text-neutral-500 hover:text-white flex items-center gap-1">
                  <RotateCcw className="w-3 h-3" /> Reset
                </button>
              </div>
              <button onClick={() => setCatSlug(null)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-1 transition-colors ${catSlug === null ? "text-white" : "text-neutral-400 hover:text-white"}`}
                style={{ background: catSlug === null ? C.red : "transparent" }}>
                Tous ({products.length})
              </button>
              {categories.map(cat => {
                const cnt = products.filter(p => p.category_slug === cat.slug).length;
                return (
                  <button key={cat.id} onClick={() => setCatSlug(cat.slug)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-1 transition-colors ${catSlug === cat.slug ? "text-white" : "text-neutral-400 hover:text-white"}`}
                    style={{ background: catSlug === cat.slug ? C.red : "transparent" }}>
                    {cat.name} ({cnt})
                  </button>
                );
              })}
            </div>

            {brands.length > 0 && (
              <div>
                <span className="text-xs font-black uppercase tracking-wider text-neutral-400 block mb-2">Marques</span>
                <button onClick={() => setBrand("")}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-1 transition-colors ${!brand ? "text-white" : "text-neutral-400 hover:text-white"}`}
                  style={{ background: !brand ? C.dark2 : "transparent" }}>Toutes</button>
                {brands.map(b => (
                  <button key={b} onClick={() => setBrand(brand === b ? "" : b)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-1 transition-colors ${brand === b ? "text-white" : "text-neutral-400 hover:text-white"}`}
                    style={{ background: brand === b ? C.dark2 : "transparent" }}>
                    {b}
                  </button>
                ))}
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={inStockOnly} onChange={e => setInStockOnly(e.target.checked)} className="w-3.5 h-3.5 accent-red-600" />
              <span className="text-xs font-semibold text-neutral-400">En stock seulement</span>
            </label>
          </aside>

          {/* Grid / List */}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-neutral-500 mb-4">{filtered.length} produit{filtered.length !== 1 ? "s" : ""}</p>
            {filtered.length === 0 ? (
              <div className="text-center py-16">
                <Package className="w-10 h-10 mx-auto mb-3 text-neutral-700" />
                <p className="text-neutral-400 text-sm">Aucun produit ne correspond à vos filtres.</p>
                <button onClick={reset} className="mt-3 text-xs font-bold" style={{ color: C.red }}>Réinitialiser les filtres</button>
              </div>
            ) : view === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {filtered.map(p => <ProductCard key={p.id} product={p} cart={cart} onAdd={onAdd} onClick={onProductClick} />)}
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map(p => (
                  <div key={p.id} className="flex gap-4 rounded-xl border p-3 transition-colors hover:border-red-800"
                    style={{ background: C.dark, borderColor: C.border }}>
                    <div className="w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden" style={{ background: "#0d1117" }}>
                      {p.photos?.[0]
                        ? <img src={p.photos[0]} alt={p.name} className="w-full h-full object-contain p-1" />
                        : <div className="w-full h-full flex items-center justify-center"><Cpu className="w-6 h-6 text-neutral-700" /></div>}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                      {p.brand && <span className="text-[10px] font-black uppercase" style={{ color: C.red }}>{p.brand}</span>}
                      <h3 className="text-sm font-bold text-white line-clamp-1 cursor-pointer hover:text-red-400"
                        onClick={() => onProductClick(p.slug)}>{p.name}</h3>
                      {p.description && <p className="text-xs text-neutral-400 line-clamp-2">{p.description}</p>}
                      <div className="flex items-center gap-3 mt-auto">
                        <span className="text-base font-black text-white">{fcfa(p.price_fcfa)}</span>
                        <button onClick={() => onAdd(p)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white"
                          style={{ background: C.red }}>
                          <ShoppingCart className="w-3 h-3" /> Ajouter
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PRODUCT DETAIL MODAL ────────────────────────────────────────────────────
function ProductDetailModal({
  slug, products, cart, onAdd, onClose
}: {
  slug: string; products: ShopProduct[];
  cart: ReturnType<typeof useCart>; onAdd: (p: ShopProduct) => void; onClose: () => void;
}) {
  const product = products.find(p => p.slug === slug);
  const [imgIdx, setImgIdx] = useState(0);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  if (!product) return null;
  const photos = product.photos || [];
  const inCart = cart.items.some(i => i.product_id === product.id);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-3xl max-h-[95vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        style={{ background: C.dark, border: `1px solid ${C.border}` }}>
        <div className="sticky top-0 flex items-center justify-between p-4 border-b z-10"
          style={{ background: C.dark, borderColor: C.border }}>
          <span className="text-xs font-bold text-neutral-400">{product.category_name || "Produit"}</span>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
        <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Photos */}
          <div className="space-y-2">
            <div className="aspect-square rounded-xl overflow-hidden" style={{ background: "#0d1117" }}>
              {photos.length > 0
                ? <img src={photos[imgIdx]} alt={product.name} className="w-full h-full object-contain p-4" />
                : <div className="w-full h-full flex items-center justify-center"><Cpu className="w-16 h-16 text-neutral-700" /></div>}
            </div>
            {photos.length > 1 && (
              <div className="flex gap-2">
                {photos.slice(0, 4).map((ph, i) => (
                  <button key={i} onClick={() => setImgIdx(i)}
                    className="w-14 h-14 rounded-lg overflow-hidden border-2 transition-colors"
                    style={{ borderColor: i === imgIdx ? C.red : C.border, background: "#0d1117" }}>
                    <img src={ph} alt="" className="w-full h-full object-contain p-1" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="space-y-4">
            {product.brand && <span className="text-xs font-black uppercase tracking-wider" style={{ color: C.red }}>{product.brand}</span>}
            <h2 className="text-xl font-black text-white leading-tight">{product.name}</h2>
            <p className="text-2xl font-black text-white">{fcfa(product.price_fcfa)}</p>

            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold px-2 py-1 rounded-full ${product.availability === "in_stock" || product.availability === "available" ? "text-green-400 bg-green-900/30" : "text-yellow-400 bg-yellow-900/30"}`}>
                {product.availability === "in_stock" || product.availability === "available" ? "En stock" : "Sur commande"}
              </span>
              {product.warranty && <span className="text-xs text-neutral-400">{product.warranty}</span>}
            </div>

            <button onClick={() => { onAdd(product); }}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-extrabold transition-all ${inCart ? "border" : ""}`}
              style={inCart ? { background: "transparent", borderColor: C.red, color: C.red } : { background: C.red, color: "white" }}>
              {inCart ? <><CheckCircle2 className="w-4 h-4" /> Ajouté au panier</> : <><ShoppingCart className="w-4 h-4" /> Ajouter au panier</>}
            </button>

            <a href={waLink(`Bonjour DiagAssist, je suis intéressé par le ${product.name}. Pouvez-vous me renseigner ?`)}
              target="_blank" rel="noreferrer"
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white border border-neutral-700 hover:bg-white/5 transition-colors">
              <MessageCircle className="w-4 h-4" /> Demander par WhatsApp
            </a>

            {product.description && (
              <div>
                <p className="text-xs font-bold uppercase text-neutral-400 mb-1">Description</p>
                <p className="text-sm text-neutral-300 leading-relaxed">{product.description}</p>
              </div>
            )}
            {product.compatibility && (
              <div>
                <p className="text-xs font-bold uppercase text-neutral-400 mb-1">Compatibilité</p>
                <p className="text-sm text-neutral-300">{product.compatibility}</p>
              </div>
            )}
            {product.box_contents && (
              <div>
                <p className="text-xs font-bold uppercase text-neutral-400 mb-1">Contenu de la boîte</p>
                <p className="text-sm text-neutral-300">{product.box_contents}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CART DRAWER ──────────────────────────────────────────────────────────────
function CartDrawer({
  cart, open, onClose, onCheckout
}: {
  cart: ReturnType<typeof useCart>; open: boolean; onClose: () => void; onCheckout: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 w-full max-w-md flex flex-col"
        style={{ background: "white", boxShadow: "-4px 0 40px rgba(0,0,0,0.5)" }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b text-white" style={{ background: C.dark, borderColor: C.border }}>
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5" style={{ color: C.red }} />
            <span className="font-bold text-sm">Mon Panier ({cart.count})</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.items.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingBag className="w-10 h-10 mx-auto mb-3 text-neutral-300" />
              <p className="text-neutral-500 text-sm font-semibold">Votre panier est vide</p>
            </div>
          ) : cart.items.map(item => (
            <div key={item.product_id} className="flex gap-3 p-3 rounded-xl border bg-neutral-50">
              <div className="w-16 h-16 rounded-lg bg-neutral-100 flex-shrink-0 overflow-hidden">
                {item.photo ? <img src={item.photo} alt={item.name} className="w-full h-full object-contain p-1" />
                  : <div className="w-full h-full flex items-center justify-center"><Cpu className="w-6 h-6 text-neutral-300" /></div>}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-xs font-bold text-neutral-900 line-clamp-2">{item.name}</p>
                <p className="text-sm font-black" style={{ color: C.red }}>{fcfa(item.price_fcfa)}</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => cart.setQty(item.product_id, item.quantity - 1)}
                    className="w-6 h-6 rounded-md border flex items-center justify-center hover:bg-neutral-100">
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="text-xs font-bold w-5 text-center">{item.quantity}</span>
                  <button onClick={() => cart.setQty(item.product_id, item.quantity + 1)}
                    className="w-6 h-6 rounded-md border flex items-center justify-center hover:bg-neutral-100">
                    <Plus className="w-3 h-3" />
                  </button>
                  <button onClick={() => cart.remove(item.product_id)} className="ml-auto text-neutral-400 hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        {cart.items.length > 0 && (
          <div className="p-4 border-t space-y-3">
            <div className="flex justify-between text-sm font-bold">
              <span>Total</span>
              <span style={{ color: C.red }}>{fcfa(cart.total)}</span>
            </div>
            <button onClick={() => { onClose(); onCheckout(); }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-extrabold text-white"
              style={{ background: C.red }}>
              Commander <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CHECKOUT ─────────────────────────────────────────────────────────────────
function ShopCheckout({ cart, onDone }: { cart: ReturnType<typeof useCart>; onDone: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState({
    first_name: "", last_name: "", phone: "", email: "", address: "",
    city: "Abidjan", shipping_method: "abidjan", payment_method: "wave", notes: ""
  });
  const [loading, setLoading] = useState(false);
  const [orderRef, setOrderRef] = useState("");
  const [err, setErr] = useState("");

  const shipping = form.shipping_method === "showroom" ? 0 : form.shipping_method === "abidjan" ? 3000 : form.shipping_method === "interieur" ? 5000 : 15000;
  const total = cart.total + shipping;

  const ch = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async () => {
    if (!form.first_name || !form.last_name || !form.phone) { setErr("Nom et téléphone obligatoires."); return; }
    setLoading(true); setErr("");
    try {
      const r = await fetch("/api/shop/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: `${form.first_name} ${form.last_name}`,
          customer_phone: form.phone,
          customer_email: form.email || undefined,
          shipping_address: `${form.address}, ${form.city}`,
          shipping_method: form.shipping_method,
          payment_method: form.payment_method,
          notes: form.notes || undefined,
          items: cart.items.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
        }),
      });
      const data = await r.json();
      if (data.success) {
        setOrderRef(data.order_ref || data.id || "");
        cart.clear();
        setStep(3);
      } else {
        setErr(data.error || "Erreur lors de la commande.");
      }
    } catch {
      setErr("Erreur réseau. Réessayez ou commandez via WhatsApp.");
    } finally { setLoading(false); }
  };

  if (step === 3) return (
    <div style={{ background: C.black }} className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6 p-8 rounded-2xl border" style={{ background: C.dark, borderColor: C.border }}>
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto" style={{ background: "rgba(34,197,94,0.2)" }}>
          <CheckCircle2 className="w-8 h-8 text-green-400" />
        </div>
        <div>
          <h2 className="text-xl font-black text-white">Commande enregistrée !</h2>
          <p className="text-sm text-neutral-400 mt-1">Référence : <span className="font-bold text-white">{orderRef}</span></p>
        </div>
        <p className="text-sm text-neutral-300">Notre équipe vous contacte dans les plus brefs délais pour confirmer la commande et le paiement.</p>
        <div className="flex flex-col gap-3">
          <a href={waLink(`Bonjour DiagAssist, j'ai passé commande (réf. ${orderRef}). Pouvez-vous confirmer ?`)} target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-white text-sm" style={{ background: "#16a34a" }}>
            <MessageCircle className="w-4 h-4" /> Confirmer sur WhatsApp
          </a>
          <button onClick={onDone} className="py-2.5 rounded-xl text-sm font-bold text-neutral-400 border border-neutral-700 hover:text-white">
            Retour à la boutique
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ background: C.black }} className="min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-black text-white">Commander</h1>

        {/* Steps */}
        <div className="flex items-center gap-2 text-xs font-bold">
          {[["1", "Informations"], ["2", "Récapitulatif"]].map(([n, label], i) => (
            <React.Fragment key={n}>
              <div className={`flex items-center gap-1.5 ${step > Number(n) ? "text-green-400" : step === Number(n) ? "text-white" : "text-neutral-600"}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center font-black text-[11px] ${step > Number(n) ? "bg-green-600 text-white" : step === Number(n) ? "text-white" : "text-neutral-600 border border-neutral-700"}`}
                  style={step === Number(n) ? { background: C.red } : {}}>
                  {step > Number(n) ? "✓" : n}
                </span> {label}
              </div>
              {i < 1 && <ChevronRight className="w-3.5 h-3.5 text-neutral-700" />}
            </React.Fragment>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-2xl border p-5 space-y-4" style={{ background: C.dark, borderColor: C.border }}>
              <h3 className="text-sm font-black text-white">Vos coordonnées</h3>
              <div className="grid grid-cols-2 gap-3">
                {[["first_name", "Prénom *"], ["last_name", "Nom *"]].map(([name, label]) => (
                  <div key={name}>
                    <label className="text-xs font-bold text-neutral-400 block mb-1">{label}</label>
                    <input name={name} value={(form as any)[name]} onChange={ch} className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none" style={{ background: "#0d1117", border: `1px solid ${C.border}` }} />
                  </div>
                ))}
              </div>
              {[["phone", "Téléphone *", "tel"], ["email", "Email (optionnel)", "email"], ["address", "Adresse de livraison", "text"]].map(([name, label, type]) => (
                <div key={name}>
                  <label className="text-xs font-bold text-neutral-400 block mb-1">{label}</label>
                  <input name={name} type={type} value={(form as any)[name]} onChange={ch} className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none" style={{ background: "#0d1117", border: `1px solid ${C.border}` }} />
                </div>
              ))}
            </div>

            <div className="rounded-2xl border p-5 space-y-3" style={{ background: C.dark, borderColor: C.border }}>
              <h3 className="text-sm font-black text-white">Livraison</h3>
              {[
                ["showroom", "Retrait au showroom Abidjan", "Gratuit"],
                ["abidjan", "Livraison Abidjan", "3 000 FCFA"],
                ["interieur", "Livraison intérieur CI", "5 000 FCFA"],
                ["afrique", "Livraison Afrique de l'Ouest", "15 000 FCFA"],
              ].map(([val, label, price]) => (
                <label key={val} className="flex items-center justify-between cursor-pointer p-2.5 rounded-lg border transition-colors"
                  style={{ borderColor: form.shipping_method === val ? C.red : C.border }}>
                  <div className="flex items-center gap-2">
                    <input type="radio" name="shipping_method" value={val} checked={form.shipping_method === val} onChange={ch} className="accent-red-600" />
                    <span className="text-sm text-white font-semibold">{label}</span>
                  </div>
                  <span className="text-xs font-bold" style={{ color: val === "showroom" ? "#4ade80" : "white" }}>{price}</span>
                </label>
              ))}
            </div>

            <div className="rounded-2xl border p-5 space-y-3" style={{ background: C.dark, borderColor: C.border }}>
              <h3 className="text-sm font-black text-white">Paiement</h3>
              {[
                ["wave", "Wave", Smartphone],
                ["orange", "Orange Money", Smartphone],
                ["mtn", "MTN MoMo", Smartphone],
                ["cash", "Espèces au showroom", CreditCard],
              ].map(([val, label, Icon]) => (
                <label key={val} className="flex items-center gap-2 cursor-pointer p-2.5 rounded-lg border transition-colors"
                  style={{ borderColor: form.payment_method === val ? C.red : C.border }}>
                  <input type="radio" name="payment_method" value={val} checked={form.payment_method === val} onChange={ch} className="accent-red-600" />
                  <Icon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                  <span className="text-sm text-white font-semibold">{label}</span>
                </label>
              ))}
            </div>

            <div>
              <label className="text-xs font-bold text-neutral-400 block mb-1">Notes (optionnel)</label>
              <textarea name="notes" value={form.notes} onChange={ch} rows={2}
                className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none resize-none"
                style={{ background: C.dark, border: `1px solid ${C.border}` }} />
            </div>

            <button onClick={() => { if (!form.first_name || !form.last_name || !form.phone) { setErr("Nom et téléphone obligatoires."); return; } setErr(""); setStep(2); }}
              className="w-full py-3 rounded-xl font-extrabold text-white text-sm" style={{ background: C.red }}>
              Continuer <ArrowRight className="inline w-4 h-4 ml-1" />
            </button>
            {err && <p className="text-xs text-red-400 text-center">{err}</p>}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-2xl border p-5 space-y-3" style={{ background: C.dark, borderColor: C.border }}>
              <h3 className="text-sm font-black text-white">Récapitulatif de la commande</h3>
              {cart.items.map(item => (
                <div key={item.product_id} className="flex justify-between text-sm">
                  <span className="text-neutral-300">{item.name} × {item.quantity}</span>
                  <span className="font-bold text-white">{fcfa((item.price_fcfa || 0) * item.quantity)}</span>
                </div>
              ))}
              <div className="border-t pt-3 space-y-1" style={{ borderColor: C.border }}>
                <div className="flex justify-between text-xs text-neutral-400">
                  <span>Livraison</span><span>{fcfa(shipping)}</span>
                </div>
                <div className="flex justify-between text-base font-black text-white">
                  <span>Total</span><span style={{ color: C.red }}>{fcfa(total)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border p-4 text-sm text-neutral-300 space-y-1" style={{ background: C.dark, borderColor: C.border }}>
              <p><span className="font-bold text-white">Client :</span> {form.first_name} {form.last_name} · {form.phone}</p>
              <p><span className="font-bold text-white">Livraison :</span> {form.shipping_method} · {form.address || "—"}</p>
              <p><span className="font-bold text-white">Paiement :</span> {form.payment_method}</p>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 py-3 rounded-xl text-sm font-bold text-neutral-400 border border-neutral-700 hover:text-white">
                <ArrowLeft className="inline w-4 h-4 mr-1" /> Retour
              </button>
              <button onClick={handleSubmit} disabled={loading}
                className="flex-2 flex-1 py-3 rounded-xl text-sm font-extrabold text-white disabled:opacity-60"
                style={{ background: C.red }}>
                {loading ? "Envoi..." : "Confirmer la commande"}
              </button>
            </div>
            {err && <p className="text-xs text-red-400 text-center">{err}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TRACKING ─────────────────────────────────────────────────────────────────
function ShopTracking() {
  const [ref, setRef] = useState("");
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ref.trim()) return;
    setLoading(true); setErr(""); setOrder(null);
    try {
      const data = await fetchJSON(`/api/shop/track?ref=${encodeURIComponent(ref.trim())}`);
      if (data.order) setOrder(data.order);
      else setErr("Aucune commande trouvée pour cette référence.");
    } catch { setErr("Erreur réseau. Réessayez."); }
    finally { setLoading(false); }
  };

  const STATUS_LABELS: Record<string, string> = {
    pending: "En attente", confirmed: "Confirmée", processing: "En préparation",
    shipped: "Expédiée", delivered: "Livrée", cancelled: "Annulée",
  };

  return (
    <div style={{ background: C.black }} className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
        <div className="text-center space-y-2">
          <span className="text-xs font-black uppercase tracking-widest" style={{ color: C.red }}>Logistique DiagAssist</span>
          <h1 className="text-2xl sm:text-3xl font-black text-white">Suivi de commande</h1>
          <p className="text-sm text-neutral-400">Entrez votre référence de commande (ex : DA-2026-000001) ou votre numéro de téléphone.</p>
        </div>
        <form onSubmit={handleSearch} className="flex rounded-xl overflow-hidden border" style={{ borderColor: C.border }}>
          <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Référence ou numéro de téléphone"
            className="flex-1 px-4 py-3 text-sm text-white outline-none placeholder-neutral-500"
            style={{ background: C.dark }} />
          <button type="submit" disabled={loading}
            className="px-5 py-3 text-white font-bold text-sm flex items-center gap-2 disabled:opacity-60"
            style={{ background: C.red }}>
            <Search className="w-4 h-4" /> {loading ? "..." : "Chercher"}
          </button>
        </form>

        {err && <p className="text-sm text-red-400 text-center">{err}</p>}

        {order && (
          <div className="rounded-2xl border p-5 space-y-4" style={{ background: C.dark, borderColor: C.border }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-neutral-400">Référence</p>
                <p className="text-base font-black text-white">{order.order_ref || order.id}</p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-bold text-white" style={{ background: order.status === "delivered" ? "#16a34a" : order.status === "cancelled" ? C.red : "#2563eb" }}>
                {STATUS_LABELS[order.status] || order.status}
              </span>
            </div>
            <div className="text-sm text-neutral-300 space-y-1">
              <p><span className="font-bold text-white">Client :</span> {order.customer_name}</p>
              <p><span className="font-bold text-white">Livraison :</span> {order.shipping_address}</p>
              {order.items && <p><span className="font-bold text-white">Articles :</span> {order.items.length}</p>}
            </div>
            <a href={waLink(`Bonjour DiagAssist, suivi commande ${order.order_ref || order.id}. Quel est le statut de ma livraison ?`)}
              target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: "#16a34a" }}>
              <MessageCircle className="w-4 h-4" /> Contacter le suivi
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FORMATIONS ───────────────────────────────────────────────────────────────
const FORMATIONS_FALLBACK = [
  { title: "Diagnostic Électronique Automobile — Niveau 1", duration: "3 jours (21h)", level: "Débutant", price_fcfa: 150000, description: "Bases du diagnostic OBD2, lecture de codes défauts, utilisation d'une valise multimarque sur véhicules réels.", next_date: "Prochainement" },
  { title: "Diagnostic Avancé — Oscilloscope & Multimètre", duration: "2 jours (14h)", level: "Intermédiaire", price_fcfa: 120000, description: "Analyse de signaux électriques, diagnostic de capteurs, test de circuits sur véhicules.", next_date: "Prochainement" },
  { title: "Programmation & Codage ECU", duration: "2 jours (14h)", level: "Avancé", price_fcfa: 180000, description: "Reprogrammation d'unités de contrôle, codage de clés, calibration ADAS avec outil J2534.", next_date: "Prochainement" },
];

function ShopFormations() {
  const [formations, setFormations] = React.useState<any[]>(FORMATIONS_FALLBACK);
  React.useEffect(() => {
    fetch("/api/shop/formations")
      .then(r => r.json())
      .then(d => { if (d.success && Array.isArray(d.formations) && d.formations.length > 0) setFormations(d.formations); })
      .catch(() => {});
  }, []);

  return (
    <div style={{ background: C.black }} className="min-h-screen">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Hero */}
        <div className="rounded-3xl p-8 sm:p-12 text-white relative overflow-hidden border" style={{ background: "#0a0d12", borderColor: C.border }}>
          <div className="absolute -right-10 -bottom-10 w-96 h-96 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(237,28,36,0.08)" }} />
          <div className="relative z-10 max-w-2xl space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold text-neutral-200 border border-white/20" style={{ background: "rgba(255,255,255,0.05)" }}>
              <GraduationCap className="w-4 h-4" style={{ color: C.red }} /> DiagAssist Academy · Abidjan
            </div>
            <h1 className="text-3xl sm:text-4xl font-black leading-tight">
              Formations Pratiques <span style={{ color: C.red }}>Diagnostic & Programmation</span>
            </h1>
            <p className="text-sm text-neutral-300 leading-relaxed">Sessions intensives en atelier à Abidjan avec 70% de pratique sur véhicules réels et valises officielles.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs font-bold">
              {["70% Pratique réelle", "Attestation certifiée", "Groupes restreints", "Support WhatsApp VIP"].map(t => (
                <div key={t} className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: C.red }} /> {t}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {formations.map((f, i) => (
            <div key={i} className="rounded-2xl border flex flex-col" style={{ background: C.dark, borderColor: C.border }}>
              <div className="p-5 flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4" style={{ color: C.red }} />
                  <span className="text-[10px] font-black uppercase text-neutral-500">{f.level}</span>
                </div>
                <h3 className="text-sm font-black text-white leading-snug">{f.title}</h3>
                <p className="text-xs text-neutral-400 leading-relaxed">{f.description}</p>
                <div className="flex flex-wrap gap-2 text-[10px] font-bold text-neutral-400">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {f.duration}</span>
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {f.next_date}</span>
                </div>
                <p className="text-base font-black text-white">{fcfa(f.price_fcfa)}</p>
              </div>
              <div className="p-4 border-t" style={{ borderColor: C.border }}>
                <a href={waLink(`Bonjour DiagAssist, je souhaite m'inscrire à la formation "${f.title}". Pouvez-vous me donner les détails ?`)}
                  target="_blank" rel="noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold text-white"
                  style={{ background: "#16a34a" }}>
                  <MessageCircle className="w-3.5 h-3.5" /> S'inscrire via WhatsApp
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── FLOATING WA BUTTON ───────────────────────────────────────────────────────
function FloatingWA() {
  return (
    <a href={waLink("Bonjour DiagAssist, je souhaite être renseigné.")} target="_blank" rel="noreferrer"
      className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-white shadow-2xl hover:scale-105 transition-transform"
      style={{ background: "#16a34a" }}>
      <MessageCircle className="w-5 h-5" />
      <span className="hidden sm:inline text-xs font-black">WhatsApp</span>
    </a>
  );
}

// ─── MAIN ShopApp ─────────────────────────────────────────────────────────────
export default function ShopApp({ adminAuth }: { adminAuth?: { phone: string; name?: string } | null }) {
  const [page, setPage] = useState<Page>("home");
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [categories, setCategories] = useState<ShopCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const cart = useCart();

  useEffect(() => {
    Promise.all([fetchJSON("/api/shop/products"), fetchJSON("/api/shop/categories")])
      .then(([pd, cd]) => {
        setProducts(pd.products || []);
        setCategories(cd.categories || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (adminAuth) return <ShopAdmin auth={adminAuth} />;

  const handleAdd = (p: ShopProduct) => {
    cart.add(p);
    setCartOpen(true);
  };

  const handleProductClick = (slug: string) => { setSelectedSlug(slug); };

  const handleSearch = (q: string) => { setSearchQ(q); setPage("catalog"); };

  return (
    <div style={{ background: C.black }} className="min-h-screen">
      <ShopHeader page={page} setPage={setPage} cartCount={cart.count}
        onCartOpen={() => setCartOpen(true)} onSearch={handleSearch} categories={categories} />

      {loading ? (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-neutral-400">Chargement du catalogue...</p>
          </div>
        </div>
      ) : (
        <>
          {page === "home" && <ShopHome products={products} setPage={setPage} cart={cart} onAdd={handleAdd} />}
          {page === "catalog" && <ShopCatalog products={products} categories={categories} cart={cart} onAdd={handleAdd} initialSearch={searchQ} onProductClick={handleProductClick} />}
          {page === "checkout" && <ShopCheckout cart={cart} onDone={() => setPage("home")} />}
          {page === "tracking" && <ShopTracking />}
          {page === "formations" && <ShopFormations />}
        </>
      )}

      {selectedSlug && (
        <ProductDetailModal slug={selectedSlug} products={products} cart={cart}
          onAdd={handleAdd} onClose={() => setSelectedSlug(null)} />
      )}

      <CartDrawer cart={cart} open={cartOpen} onClose={() => setCartOpen(false)} onCheckout={() => setPage("checkout")} />

      <FloatingWA />
    </div>
  );
}
