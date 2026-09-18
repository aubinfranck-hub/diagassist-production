import React, { useState, useEffect } from "react";
import { ShoppingBag, Phone, ArrowLeft, Loader2, CheckCircle2, Package, Wrench, Video as VideoIcon, Search, ShieldCheck, Truck, Headphones, X } from "lucide-react";
import ShopAdmin from "./ShopAdmin";

// Charte graphique DiagAssist (noir / rouge / blanc)
const DIAG = {
  black: "#07090c",
  dark: "#10141a",
  red: "#ed1c24",
  redDark: "#b90f16",
  light: "#f5f6f7",
  gray: "#73777d",
  border: "#e4e6e8",
};

interface CartItem {
  product_id: number;
  name: string;
  price_fcfa: number | null;
  photo: string | null;
  quantity: number;
}

// Panier persistant (localStorage) — partagé entre toutes les pages de la boutique sans
// backend dédié tant que la commande n'est pas validée.
function useCart() {
  const [items, setItems] = useState<CartItem[]>(() => {
    try { return JSON.parse(localStorage.getItem("shop_cart") || "[]"); } catch { return []; }
  });

  useEffect(() => { localStorage.setItem("shop_cart", JSON.stringify(items)); }, [items]);

  const add = (p: ShopProduct, quantity = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.product_id === p.id);
      if (existing) return prev.map((i) => (i.product_id === p.id ? { ...i, quantity: i.quantity + quantity } : i));
      return [...prev, { product_id: p.id, name: p.name, price_fcfa: p.price_fcfa, photo: p.photos?.[0] || null, quantity }];
    });
  };
  const remove = (productId: number) => setItems((prev) => prev.filter((i) => i.product_id !== productId));
  const setQuantity = (productId: number, quantity: number) =>
    setItems((prev) => prev.map((i) => (i.product_id === productId ? { ...i, quantity: Math.max(1, quantity) } : i)));
  const clear = () => setItems([]);
  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  const total = items.reduce((sum, i) => sum + (i.price_fcfa || 0) * i.quantity, 0);

  return { items, add, remove, setQuantity, clear, count, total };
}

interface ShopProduct {
  id: number;
  name: string;
  slug: string;
  price_fcfa: number | null;
  description: string | null;
  specs: string | null;
  compatibility: string | null;
  box_contents: string | null;
  warranty: string | null;
  availability: string;
  photos: string[];
  videos: string[];
  category_name: string | null;
  category_slug: string | null;
}

interface ShopCategory {
  id: number;
  name: string;
  slug: string;
  type: string;
}

function formatFcfa(n: number | null): string {
  if (n == null) return "Prix sur demande";
  return n.toLocaleString("fr-FR") + " FCFA";
}

// --- Écran catalogue ---
function ShopCatalog({ onSelectProduct }: { onSelectProduct: (slug: string) => void }) {
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [categories, setCategories] = useState<ShopCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/shop/categories").then((r) => r.json()).then((d) => d.success && setCategories(d.categories));
  }, []);

  useEffect(() => {
    setLoading(true);
    const url = activeCategory ? `/api/shop/products?category=${activeCategory}` : "/api/shop/products";
    fetch(url).then((r) => r.json()).then((d) => {
      if (d.success) setProducts(d.products);
      setLoading(false);
    });
  }, [activeCategory]);

  return (
    <div>
      {/* Hero */}
      <div style={{ background: `linear-gradient(135deg, ${DIAG.black}, ${DIAG.dark})` }} className="px-5 py-10 sm:py-14">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl sm:text-4xl font-black text-white uppercase leading-tight">
            La référence du <span style={{ color: DIAG.red }}>diagnostic automobile</span>
          </h1>
          <p className="text-sm text-gray-300 mt-3 max-w-md">Scanners, outils de programmation, accessoires et formation.</p>
          <button
            onClick={() => document.getElementById("shop-products")?.scrollIntoView({ behavior: "smooth" })}
            style={{ background: DIAG.red }}
            className="mt-5 text-white text-sm font-bold px-5 py-2.5 rounded-lg cursor-pointer hover:opacity-90"
          >
            Voir nos produits
          </button>
        </div>
      </div>

      {/* Bandeau de confiance */}
      <div style={{ borderColor: DIAG.border }} className="border-b bg-white">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap gap-4 justify-center sm:justify-between text-xs font-semibold" style={{ color: DIAG.gray }}>
          <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" style={{ color: DIAG.red }} /> Paiement sécurisé</span>
          <span className="flex items-center gap-1.5"><Truck className="w-3.5 h-3.5" style={{ color: DIAG.red }} /> Livraison Côte d'Ivoire & Afrique</span>
          <span className="flex items-center gap-1.5"><Headphones className="w-3.5 h-3.5" style={{ color: DIAG.red }} /> Support technique</span>
        </div>
      </div>

      <div id="shop-products" className="max-w-5xl mx-auto px-4 py-8">
        <h2 className="text-lg font-extrabold uppercase mb-4" style={{ color: DIAG.black }}>Produits</h2>

        {categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-5">
            <button
              onClick={() => setActiveCategory(null)}
              style={!activeCategory ? { background: DIAG.red, color: "white" } : { background: DIAG.light, color: DIAG.gray }}
              className="shrink-0 text-xs font-bold px-3.5 py-2 rounded-full cursor-pointer"
            >
              Tous les produits
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategory(c.slug)}
                style={activeCategory === c.slug ? { background: DIAG.red, color: "white" } : { background: DIAG.light, color: DIAG.gray }}
                className="shrink-0 text-xs font-bold px-3.5 py-2 rounded-full cursor-pointer"
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" style={{ color: DIAG.gray }} /></div>
        ) : products.length === 0 ? (
          <div className="text-center py-20 text-sm" style={{ color: DIAG.gray }}>Aucun produit disponible pour le moment.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {products.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelectProduct(p.slug)}
                style={{ borderColor: DIAG.border }}
                className="bg-white border rounded-2xl overflow-hidden text-left cursor-pointer hover:shadow-lg transition-shadow"
              >
                <div style={{ background: DIAG.light }} className="aspect-square flex items-center justify-center overflow-hidden">
                  {p.photos?.[0] ? (
                    <img src={p.photos[0]} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <Package className="w-10 h-10" style={{ color: DIAG.gray }} />
                  )}
                </div>
                <div className="p-3">
                  <p className="text-[11px] uppercase font-bold mb-0.5" style={{ color: DIAG.gray }}>{p.category_name || "Produit"}</p>
                  <p className="text-sm font-bold leading-tight line-clamp-2" style={{ color: DIAG.black }}>{p.name}</p>
                  <p className="text-sm font-black mt-1.5" style={{ color: DIAG.red }}>{formatFcfa(p.price_fcfa)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Écran fiche produit + commande ---
function ShopProductPage({ slug, onBack, cart, onGoToCart }: { slug: string; onBack: () => void; cart: ReturnType<typeof useCart>; onGoToCart: () => void }) {
  const [product, setProduct] = useState<ShopProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [orderDone, setOrderDone] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/shop/products/${slug}`).then((r) => r.json()).then((d) => {
      if (d.success) setProduct(d.product);
      setLoading(false);
    });
  }, [slug]);

  const handleOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;
    setSubmitting(true);
    setOrderError(null);
    try {
      const res = await fetch("/api/shop/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name, city, product_id: product.id, quantity }),
      });
      const data = await res.json();
      if (data.success) setOrderDone(true);
      else setOrderError(data.message || "Échec de la commande.");
    } catch {
      setOrderError("Erreur réseau. Vérifiez votre connexion et réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-[#73777d] animate-spin" /></div>;
  if (!product) return <div className="text-center py-20 text-[#73777d] text-sm">Produit introuvable.</div>;

  if (orderDone) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-[#07090c] mb-2">Commande enregistrée</h2>
        <p className="text-sm text-[#73777d] mb-6">Notre équipe vous contactera bientôt par téléphone ou WhatsApp pour confirmer votre commande.</p>
        <button onClick={onBack} className="bg-[#f5f6f7] hover:bg-[#e4e6e8] text-[#07090c] text-sm font-semibold px-5 py-2.5 rounded-xl cursor-pointer">
          Retour au catalogue
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[#73777d] mb-4 cursor-pointer">
        <ArrowLeft className="w-4 h-4" /> Retour
      </button>

      {product.photos?.length > 0 && (
        <div className="aspect-video bg-slate-900 rounded-2xl overflow-hidden mb-4">
          <img src={product.photos[0]} alt={product.name} className="w-full h-full object-cover" />
        </div>
      )}

      <p className="text-xs text-[#ed1c24] font-semibold uppercase tracking-wide mb-1">{product.category_name}</p>
      <h1 className="text-xl font-bold text-[#07090c] mb-1">{product.name}</h1>
      <p className="text-lg font-bold text-[#ed1c24] mb-4">{formatFcfa(product.price_fcfa)}</p>

      {product.description && <p className="text-sm text-[#10141a] mb-4 whitespace-pre-wrap">{product.description}</p>}

      {product.videos?.length > 0 && (
        <div className="mb-5">
          <p className="text-xs uppercase tracking-wide text-[#73777d] font-semibold mb-2 flex items-center gap-1.5">
            <VideoIcon className="w-3.5 h-3.5" /> Vidéo de démonstration
          </p>
          <div className="aspect-video bg-black rounded-xl overflow-hidden">
            <video src={product.videos[0]} controls className="w-full h-full" />
          </div>
        </div>
      )}

      {product.specs && (
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wide text-[#73777d] font-semibold mb-1.5">Caractéristiques</p>
          <p className="text-sm text-[#10141a] whitespace-pre-wrap">{product.specs}</p>
        </div>
      )}
      {product.compatibility && (
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wide text-[#73777d] font-semibold mb-1.5">Compatibilité</p>
          <p className="text-sm text-[#10141a] whitespace-pre-wrap">{product.compatibility}</p>
        </div>
      )}
      {product.box_contents && (
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wide text-[#73777d] font-semibold mb-1.5">Contenu de la boîte</p>
          <p className="text-sm text-[#10141a] whitespace-pre-wrap">{product.box_contents}</p>
        </div>
      )}
      {product.warranty && (
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wide text-[#73777d] font-semibold mb-1.5">Garantie</p>
          <p className="text-sm text-[#10141a]">{product.warranty}</p>
        </div>
      )}

      {!showOrderForm ? (
        <div className="space-y-2.5">
          <button
            onClick={() => { cart.add(product); onGoToCart(); }}
            className="w-full bg-[#07090c] hover:opacity-90 text-white text-sm font-bold py-3.5 rounded-xl cursor-pointer flex items-center justify-center gap-2"
          >
            <ShoppingBag className="w-4 h-4" /> Ajouter au panier
          </button>
          <button
            onClick={() => setShowOrderForm(true)}
            className="w-full bg-[#ed1c24] hover:bg-[#b90f16] text-white text-sm font-bold py-3.5 rounded-xl cursor-pointer flex items-center justify-center gap-2"
          >
            Commander directement
          </button>
        </div>
      ) : (
        <form onSubmit={handleOrder} className="bg-white border rounded-2xl p-4 space-y-3">
          <p className="text-sm font-semibold text-[#07090c] flex items-center gap-1.5">
            <Phone className="w-4 h-4" /> Vos coordonnées
          </p>
          <input
            type="tel" required placeholder="Numéro de téléphone" value={phone} onChange={(e) => setPhone(e.target.value)}
            className="w-full bg-[#f5f6f7] border border-[#e4e6e8] rounded-xl px-3 py-2.5 text-sm text-[#07090c] placeholder-[#73777d]"
          />
          <input
            type="text" placeholder="Nom (optionnel)" value={name} onChange={(e) => setName(e.target.value)}
            className="w-full bg-[#f5f6f7] border border-[#e4e6e8] rounded-xl px-3 py-2.5 text-sm text-[#07090c] placeholder-[#73777d]"
          />
          <input
            type="text" placeholder="Ville (optionnel)" value={city} onChange={(e) => setCity(e.target.value)}
            className="w-full bg-[#f5f6f7] border border-[#e4e6e8] rounded-xl px-3 py-2.5 text-sm text-[#07090c] placeholder-[#73777d]"
          />
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#73777d]">Quantité</span>
            <input
              type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-20 bg-[#f5f6f7] border border-[#e4e6e8] rounded-xl px-3 py-2 text-sm text-[#07090c]"
            />
          </div>
          {orderError && <p className="text-xs text-[#ed1c24]">{orderError}</p>}
          <button type="submit" disabled={submitting}
            className="w-full bg-[#ed1c24] hover:bg-[#b90f16] disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl cursor-pointer">
            {submitting ? "Envoi..." : "Valider la commande"}
          </button>
          <p className="text-[10px] text-[#73777d] text-center">
            Aucun paiement en ligne — notre équipe vous contacte pour confirmer prix, disponibilité et livraison.
          </p>
        </form>
      )}
    </div>
  );
}

// --- Écran demande de pièce à l'étranger ---
// --- Écran panier ---
function ShopCart({ cart, onBack, onCheckout }: { cart: ReturnType<typeof useCart>; onBack: () => void; onCheckout: () => void }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm mb-4 cursor-pointer" style={{ color: DIAG.gray }}>
        <ArrowLeft className="w-4 h-4" /> Continuer mes achats
      </button>
      <h1 className="text-xl font-bold mb-4" style={{ color: DIAG.black }}>Mon panier</h1>

      {cart.items.length === 0 ? (
        <div className="text-center py-16 text-sm" style={{ color: DIAG.gray }}>Votre panier est vide.</div>
      ) : (
        <>
          <div className="space-y-2.5 mb-5">
            {cart.items.map((item) => (
              <div key={item.product_id} style={{ borderColor: DIAG.border }} className="bg-white border rounded-xl p-3 flex items-center gap-3">
                <div style={{ background: DIAG.light }} className="w-14 h-14 rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
                  {item.photo ? <img src={item.photo} className="w-full h-full object-cover" /> : <Package className="w-6 h-6" style={{ color: DIAG.gray }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: DIAG.black }}>{item.name}</p>
                  <p className="text-xs font-bold" style={{ color: DIAG.red }}>{formatFcfa(item.price_fcfa)}</p>
                </div>
                <input
                  type="number" min={1} value={item.quantity}
                  onChange={(e) => cart.setQuantity(item.product_id, Number(e.target.value))}
                  className="w-14 border rounded-lg px-2 py-1.5 text-sm text-center"
                  style={{ borderColor: DIAG.border, color: DIAG.black }}
                />
                <button onClick={() => cart.remove(item.product_id)} className="p-1.5 cursor-pointer" style={{ color: DIAG.gray }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div style={{ borderColor: DIAG.border }} className="border-t pt-4 flex items-center justify-between mb-4">
            <span className="text-sm font-semibold" style={{ color: DIAG.black }}>Total</span>
            <span className="text-lg font-black" style={{ color: DIAG.red }}>{formatFcfa(cart.total)}</span>
          </div>

          <button
            onClick={onCheckout}
            className="w-full text-white text-sm font-bold py-3.5 rounded-xl cursor-pointer"
            style={{ background: DIAG.red }}
          >
            Passer commande
          </button>
        </>
      )}
    </div>
  );
}

// --- Écran checkout (informations client + livraison) ---
function ShopCheckout({ cart, onBack, onDone }: { cart: ReturnType<typeof useCart>; onBack: () => void; onDone: (ref: string) => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/shop/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone, name, city, address,
          items: cart.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
        }),
      });
      const data = await res.json();
      if (data.success) { cart.clear(); onDone(data.order_ref); }
      else setError(data.message || "Échec de la commande.");
    } catch {
      setError("Erreur réseau. Vérifiez votre connexion et réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm mb-4 cursor-pointer" style={{ color: DIAG.gray }}>
        <ArrowLeft className="w-4 h-4" /> Retour au panier
      </button>
      <h1 className="text-xl font-bold mb-1" style={{ color: DIAG.black }}>Finaliser la commande</h1>
      <p className="text-sm mb-5" style={{ color: DIAG.gray }}>{cart.count} article(s) · {formatFcfa(cart.total)}</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <input required type="tel" placeholder="Numéro de téléphone" value={phone} onChange={(e) => setPhone(e.target.value)}
          style={{ borderColor: DIAG.border, color: DIAG.black }} className="w-full border rounded-xl px-3 py-2.5 text-sm" />
        <input placeholder="Nom" value={name} onChange={(e) => setName(e.target.value)}
          style={{ borderColor: DIAG.border, color: DIAG.black }} className="w-full border rounded-xl px-3 py-2.5 text-sm" />
        <input placeholder="Ville" value={city} onChange={(e) => setCity(e.target.value)}
          style={{ borderColor: DIAG.border, color: DIAG.black }} className="w-full border rounded-xl px-3 py-2.5 text-sm" />
        <textarea rows={2} placeholder="Adresse / instructions de livraison (optionnel)" value={address} onChange={(e) => setAddress(e.target.value)}
          style={{ borderColor: DIAG.border, color: DIAG.black }} className="w-full border rounded-xl px-3 py-2.5 text-sm resize-none" />

        {error && <p className="text-xs" style={{ color: DIAG.red }}>{error}</p>}
        <button type="submit" disabled={submitting}
          className="w-full text-white text-sm font-bold py-3.5 rounded-xl cursor-pointer disabled:opacity-50"
          style={{ background: DIAG.red }}>
          {submitting ? "Envoi..." : "Confirmer la commande"}
        </button>
        <p className="text-[10px] text-center" style={{ color: DIAG.gray }}>
          Aucun paiement en ligne — notre équipe vous contacte pour confirmer prix, disponibilité et livraison.
        </p>
      </form>
    </div>
  );
}

// --- Écran confirmation de commande ---
function ShopOrderConfirmation({ orderRef, onBackToCatalog, onTrack }: { orderRef: string; onBackToCatalog: () => void; onTrack: () => void }) {
  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <CheckCircle2 className="w-14 h-14 mx-auto mb-4" style={{ color: "#16a34a" }} />
      <h2 className="text-xl font-bold mb-2" style={{ color: DIAG.black }}>Commande enregistrée</h2>
      <p className="text-sm mb-1" style={{ color: DIAG.gray }}>Référence :</p>
      <p className="text-lg font-black mb-6" style={{ color: DIAG.red }}>{orderRef}</p>
      <p className="text-sm mb-6" style={{ color: DIAG.gray }}>Notre équipe vous contactera bientôt par téléphone ou WhatsApp pour confirmer votre commande.</p>
      <div className="flex flex-col gap-2">
        <button onClick={onTrack} style={{ background: DIAG.red }} className="text-white text-sm font-bold px-5 py-2.5 rounded-xl cursor-pointer">
          Suivre ma commande
        </button>
        <button onClick={onBackToCatalog} style={{ background: DIAG.light, color: DIAG.black }} className="text-sm font-semibold px-5 py-2.5 rounded-xl cursor-pointer">
          Retour au catalogue
        </button>
      </div>
    </div>
  );
}

// --- Écran suivi de commande public ---
function ShopTracking({ onBack }: { onBack: () => void }) {
  const [phone, setPhone] = useState("");
  const [ref, setRef] = useState("");
  const [orders, setOrders] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setOrders(null);
    try {
      const params = new URLSearchParams({ phone });
      if (ref) params.set("ref", ref);
      const res = await fetch(`/api/shop/track?${params}`);
      const data = await res.json();
      if (data.success) setOrders(data.orders);
      else setError(data.message || "Aucune commande trouvée.");
    } catch {
      setError("Erreur réseau. Vérifiez votre connexion et réessayez.");
    } finally {
      setLoading(false);
    }
  };

  const STEPS = ["nouvelle", "confirmee", "en_traitement", "prete", "livree"];
  const stepLabel: Record<string, string> = {
    nouvelle: "Commande reçue", a_contacter: "Commande reçue", contactee: "Commande reçue",
    confirmee: "Confirmée", en_traitement: "Préparation", prete: "Prête", livree: "Livrée",
    annulee: "Annulée", client_injoignable: "Client injoignable",
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm mb-4 cursor-pointer" style={{ color: DIAG.gray }}>
        <ArrowLeft className="w-4 h-4" /> Retour
      </button>
      <h1 className="text-xl font-bold mb-4" style={{ color: DIAG.black }}>Suivi de commande</h1>

      <form onSubmit={handleSearch} className="space-y-3 mb-6">
        <input required type="tel" placeholder="Votre numéro de téléphone" value={phone} onChange={(e) => setPhone(e.target.value)}
          style={{ borderColor: DIAG.border, color: DIAG.black }} className="w-full border rounded-xl px-3 py-2.5 text-sm" />
        <input placeholder="Référence de commande (optionnel, ex: DA-2026-000001)" value={ref} onChange={(e) => setRef(e.target.value)}
          style={{ borderColor: DIAG.border, color: DIAG.black }} className="w-full border rounded-xl px-3 py-2.5 text-sm" />
        <button type="submit" disabled={loading} style={{ background: DIAG.red }} className="w-full text-white text-sm font-bold py-3 rounded-xl cursor-pointer disabled:opacity-50">
          {loading ? "Recherche..." : "Rechercher"}
        </button>
      </form>

      {error && <p className="text-sm text-center" style={{ color: DIAG.red }}>{error}</p>}

      {orders && orders.map((o, idx) => (
        <div key={idx} style={{ borderColor: DIAG.border }} className="bg-white border rounded-xl p-4 mb-3">
          {o.order_ref && <p className="text-xs font-bold mb-2" style={{ color: DIAG.gray }}>Réf. {o.order_ref}</p>}
          <div className="flex items-center gap-1 mb-3">
            {STEPS.map((s, i) => {
              const currentIdx = STEPS.indexOf(o.status);
              const reached = currentIdx >= 0 && i <= currentIdx;
              return (
                <React.Fragment key={s}>
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: reached ? DIAG.red : DIAG.border }} />
                  {i < STEPS.length - 1 && <div className="flex-1 h-0.5" style={{ background: reached ? DIAG.red : DIAG.border }} />}
                </React.Fragment>
              );
            })}
          </div>
          <p className="text-sm font-bold mb-2" style={{ color: DIAG.black }}>{stepLabel[o.status] || o.status}</p>
          {o.items.map((it: any, i: number) => (
            <p key={i} className="text-xs" style={{ color: DIAG.gray }}>{it.quantity}× {it.product_name}</p>
          ))}
        </div>
      ))}
    </div>
  );
}

function ShopPartRequest({ onBack }: { onBack: () => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [extraInfo, setExtraInfo] = useState("");
  const [carteGrise, setCarteGrise] = useState<string | null>(null);
  const [partPhoto, setPartPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readAsBase64 = (file: File, cb: (b64: string) => void) => {
    const reader = new FileReader();
    reader.onload = () => cb(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/shop/part-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name, part_description: description, extra_info: extraInfo, carte_grise_base64: carteGrise, part_photo_base64: partPhoto }),
      });
      const data = await res.json();
      if (data.success) setDone(true);
      else setError(data.message || "Échec de l'envoi.");
    } catch {
      setError("Erreur réseau. Vérifiez votre connexion et réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-[#07090c] mb-2">Demande envoyée</h2>
        <p className="text-sm text-[#73777d] mb-6">Nous recherchons votre pièce et vous enverrons une cotation sous environ 15 jours.</p>
        <button onClick={onBack} className="bg-[#f5f6f7] hover:bg-[#e4e6e8] text-[#07090c] text-sm font-semibold px-5 py-2.5 rounded-xl cursor-pointer">
          Retour au catalogue
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[#73777d] mb-4 cursor-pointer">
        <ArrowLeft className="w-4 h-4" /> Retour
      </button>
      <h1 className="text-xl font-bold text-[#07090c] mb-1">Commander une pièce depuis l'étranger</h1>
      <p className="text-sm text-[#73777d] mb-5">Pièce introuvable localement ? Décrivez-la, nous la recherchons pour vous.</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <input type="tel" required placeholder="Numéro de téléphone" value={phone} onChange={(e) => setPhone(e.target.value)}
          className="w-full bg-white border rounded-xl px-3 py-2.5 text-sm text-[#07090c] placeholder-[#73777d]" />
        <input type="text" placeholder="Nom (optionnel)" value={name} onChange={(e) => setName(e.target.value)}
          className="w-full bg-white border rounded-xl px-3 py-2.5 text-sm text-[#07090c] placeholder-[#73777d]" />
        <textarea required rows={3} placeholder="Décrivez la pièce recherchée" value={description} onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-white border rounded-xl px-3 py-2.5 text-sm text-[#07090c] placeholder-[#73777d] resize-none" />

        <div>
          <label className="text-xs text-[#73777d] mb-1 block">Carte grise du véhicule (photo)</label>
          <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && readAsBase64(e.target.files[0], setCarteGrise)}
            className="w-full text-xs text-[#73777d] file:bg-slate-800 file:text-[#07090c] file:border-0 file:rounded-lg file:px-3 file:py-1.5 file:mr-2 file:text-xs" />
        </div>
        <div>
          <label className="text-xs text-[#73777d] mb-1 block">Photo de la pièce (optionnel)</label>
          <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && readAsBase64(e.target.files[0], setPartPhoto)}
            className="w-full text-xs text-[#73777d] file:bg-slate-800 file:text-[#07090c] file:border-0 file:rounded-lg file:px-3 file:py-1.5 file:mr-2 file:text-xs" />
        </div>

        <textarea rows={2} placeholder="Informations complémentaires (optionnel)" value={extraInfo} onChange={(e) => setExtraInfo(e.target.value)}
          className="w-full bg-white border rounded-xl px-3 py-2.5 text-sm text-[#07090c] placeholder-[#73777d] resize-none" />

        {error && <p className="text-xs text-[#ed1c24]">{error}</p>}
        <button type="submit" disabled={submitting}
          className="w-full bg-[#ed1c24] hover:bg-[#b90f16] disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl cursor-pointer">
          {submitting ? "Envoi..." : "Envoyer la demande"}
        </button>
      </form>
    </div>
  );
}

// --- Routeur boutique (basé sur le chemin d'URL, sans dépendance externe) ---
export default function ShopApp() {
  const parsePath = () => {
    const parts = window.location.pathname.split("/").filter(Boolean); // ["boutique", "produit", "slug"] ou ["boutique", "piece-etranger"]
    if (parts[1] === "admin") return { screen: "admin" as const, slug: null };
    if (parts[1] === "produit" && parts[2]) return { screen: "product" as const, slug: parts[2] };
    if (parts[1] === "piece-etranger") return { screen: "part-request" as const, slug: null };
    if (parts[1] === "panier") return { screen: "cart" as const, slug: null };
    if (parts[1] === "commande") return { screen: "checkout" as const, slug: null };
    if (parts[1] === "confirmation") return { screen: "confirmation" as const, slug: null };
    if (parts[1] === "suivi") return { screen: "tracking" as const, slug: null };
    return { screen: "catalog" as const, slug: null };
  };

  const [route, setRoute] = useState(parsePath());
  const [lastOrderRef, setLastOrderRef] = useState<string | null>(null);
  const cart = useCart();

  useEffect(() => {
    const onPop = () => setRoute(parsePath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, "", path);
    setRoute(parsePath());
    window.scrollTo(0, 0);
  };

  if (route.screen === "admin") return <ShopAdmin />;

  return (
    <div className="min-h-screen bg-white">
      <header style={{ background: DIAG.black }} className="px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate("/boutique")} className="flex items-center gap-2 cursor-pointer shrink-0">
          <div style={{ background: DIAG.red }} className="w-8 h-8 rounded-lg flex items-center justify-center">
            <Wrench className="w-4.5 h-4.5 text-white" />
          </div>
          <span className="font-black text-white text-sm hidden sm:inline uppercase">DiagAssist</span>
        </button>
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: DIAG.gray }} />
          <input
            placeholder="Rechercher un produit..."
            className="w-full bg-white rounded-lg pl-9 pr-3 py-2 text-sm"
            style={{ color: DIAG.black }}
            disabled
          />
        </div>
        <button onClick={() => navigate("/boutique/suivi")} className="text-xs font-semibold text-white px-2 py-2 rounded-lg cursor-pointer hover:opacity-80 hidden sm:block">
          Suivre ma commande
        </button>
        <button onClick={() => navigate("/boutique/panier")} className="relative p-2 cursor-pointer shrink-0">
          <ShoppingBag className="w-5 h-5 text-white" />
          {cart.count > 0 && (
            <span style={{ background: DIAG.red }} className="absolute -top-0.5 -right-0.5 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
              {cart.count}
            </span>
          )}
        </button>
      </header>

      {route.screen === "catalog" && <ShopCatalog onSelectProduct={(slug) => navigate(`/boutique/produit/${slug}`)} />}
      {route.screen === "product" && route.slug && (
        <ShopProductPage slug={route.slug} onBack={() => navigate("/boutique")} cart={cart} onGoToCart={() => navigate("/boutique/panier")} />
      )}
      {route.screen === "part-request" && <ShopPartRequest onBack={() => navigate("/boutique")} />}
      {route.screen === "cart" && <ShopCart cart={cart} onBack={() => navigate("/boutique")} onCheckout={() => navigate("/boutique/commande")} />}
      {route.screen === "checkout" && (
        <ShopCheckout
          cart={cart}
          onBack={() => navigate("/boutique/panier")}
          onDone={(ref) => { setLastOrderRef(ref); navigate("/boutique/confirmation"); }}
        />
      )}
      {route.screen === "confirmation" && lastOrderRef && (
        <ShopOrderConfirmation orderRef={lastOrderRef} onBackToCatalog={() => navigate("/boutique")} onTrack={() => navigate("/boutique/suivi")} />
      )}
      {route.screen === "tracking" && <ShopTracking onBack={() => navigate("/boutique")} />}
    </div>
  );
}
