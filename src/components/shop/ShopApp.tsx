import React, { useState, useEffect } from "react";
import { ShoppingBag, Phone, ArrowLeft, Loader2, CheckCircle2, Package, Wrench, Video as VideoIcon } from "lucide-react";

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
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Boutique DiagAssist</h1>
        <p className="text-sm text-slate-400">Scanners, mises à jour, pièces automobiles</p>
      </div>

      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-5 -mx-4 px-4">
          <button
            onClick={() => setActiveCategory(null)}
            className={`shrink-0 text-xs font-semibold px-3.5 py-2 rounded-full cursor-pointer ${
              !activeCategory ? "bg-red-600 text-white" : "bg-slate-800 text-slate-300"
            }`}
          >
            Tout
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.slug)}
              className={`shrink-0 text-xs font-semibold px-3.5 py-2 rounded-full cursor-pointer ${
                activeCategory === c.slug ? "bg-red-600 text-white" : "bg-slate-800 text-slate-300"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-slate-500 animate-spin" /></div>
      ) : products.length === 0 ? (
        <div className="text-center py-20 text-slate-500 text-sm">Aucun produit disponible pour le moment.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {products.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelectProduct(p.slug)}
              className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden text-left cursor-pointer hover:border-red-600/50"
            >
              <div className="aspect-square bg-slate-800 flex items-center justify-center overflow-hidden">
                {p.photos?.[0] ? (
                  <img src={p.photos[0]} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <Package className="w-10 h-10 text-slate-600" />
                )}
              </div>
              <div className="p-3">
                <p className="text-xs text-slate-500 mb-0.5">{p.category_name || "Produit"}</p>
                <p className="text-sm font-semibold text-white leading-tight line-clamp-2">{p.name}</p>
                <p className="text-sm font-bold text-red-500 mt-1.5">{formatFcfa(p.price_fcfa)}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Écran fiche produit + commande ---
function ShopProductPage({ slug, onBack }: { slug: string; onBack: () => void }) {
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

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-slate-500 animate-spin" /></div>;
  if (!product) return <div className="text-center py-20 text-slate-500 text-sm">Produit introuvable.</div>;

  if (orderDone) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Commande enregistrée</h2>
        <p className="text-sm text-slate-400 mb-6">Notre équipe vous contactera bientôt par téléphone ou WhatsApp pour confirmer votre commande.</p>
        <button onClick={onBack} className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl cursor-pointer">
          Retour au catalogue
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-400 mb-4 cursor-pointer">
        <ArrowLeft className="w-4 h-4" /> Retour
      </button>

      {product.photos?.length > 0 && (
        <div className="aspect-video bg-slate-900 rounded-2xl overflow-hidden mb-4">
          <img src={product.photos[0]} alt={product.name} className="w-full h-full object-cover" />
        </div>
      )}

      <p className="text-xs text-red-500 font-semibold uppercase tracking-wide mb-1">{product.category_name}</p>
      <h1 className="text-xl font-bold text-white mb-1">{product.name}</h1>
      <p className="text-lg font-bold text-red-500 mb-4">{formatFcfa(product.price_fcfa)}</p>

      {product.description && <p className="text-sm text-slate-300 mb-4 whitespace-pre-wrap">{product.description}</p>}

      {product.videos?.length > 0 && (
        <div className="mb-5">
          <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2 flex items-center gap-1.5">
            <VideoIcon className="w-3.5 h-3.5" /> Vidéo de démonstration
          </p>
          <div className="aspect-video bg-black rounded-xl overflow-hidden">
            <video src={product.videos[0]} controls className="w-full h-full" />
          </div>
        </div>
      )}

      {product.specs && (
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Caractéristiques</p>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">{product.specs}</p>
        </div>
      )}
      {product.compatibility && (
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Compatibilité</p>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">{product.compatibility}</p>
        </div>
      )}
      {product.box_contents && (
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Contenu de la boîte</p>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">{product.box_contents}</p>
        </div>
      )}
      {product.warranty && (
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Garantie</p>
          <p className="text-sm text-slate-300">{product.warranty}</p>
        </div>
      )}

      {!showOrderForm ? (
        <button
          onClick={() => setShowOrderForm(true)}
          className="w-full bg-red-600 hover:bg-red-700 text-white text-sm font-bold py-3.5 rounded-xl cursor-pointer flex items-center justify-center gap-2"
        >
          <ShoppingBag className="w-4 h-4" /> Commander
        </button>
      ) : (
        <form onSubmit={handleOrder} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-semibold text-white flex items-center gap-1.5">
            <Phone className="w-4 h-4" /> Vos coordonnées
          </p>
          <input
            type="tel" required placeholder="Numéro de téléphone" value={phone} onChange={(e) => setPhone(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500"
          />
          <input
            type="text" placeholder="Nom (optionnel)" value={name} onChange={(e) => setName(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500"
          />
          <input
            type="text" placeholder="Ville (optionnel)" value={city} onChange={(e) => setCity(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500"
          />
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">Quantité</span>
            <input
              type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-20 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white"
            />
          </div>
          {orderError && <p className="text-xs text-red-400">{orderError}</p>}
          <button type="submit" disabled={submitting}
            className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl cursor-pointer">
            {submitting ? "Envoi..." : "Valider la commande"}
          </button>
          <p className="text-[10px] text-slate-500 text-center">
            Aucun paiement en ligne — notre équipe vous contacte pour confirmer prix, disponibilité et livraison.
          </p>
        </form>
      )}
    </div>
  );
}

// --- Écran demande de pièce à l'étranger ---
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
        <h2 className="text-xl font-bold text-white mb-2">Demande envoyée</h2>
        <p className="text-sm text-slate-400 mb-6">Nous recherchons votre pièce et vous enverrons une cotation sous environ 15 jours.</p>
        <button onClick={onBack} className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl cursor-pointer">
          Retour au catalogue
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-400 mb-4 cursor-pointer">
        <ArrowLeft className="w-4 h-4" /> Retour
      </button>
      <h1 className="text-xl font-bold text-white mb-1">Commander une pièce depuis l'étranger</h1>
      <p className="text-sm text-slate-400 mb-5">Pièce introuvable localement ? Décrivez-la, nous la recherchons pour vous.</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <input type="tel" required placeholder="Numéro de téléphone" value={phone} onChange={(e) => setPhone(e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500" />
        <input type="text" placeholder="Nom (optionnel)" value={name} onChange={(e) => setName(e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500" />
        <textarea required rows={3} placeholder="Décrivez la pièce recherchée" value={description} onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 resize-none" />

        <div>
          <label className="text-xs text-slate-400 mb-1 block">Carte grise du véhicule (photo)</label>
          <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && readAsBase64(e.target.files[0], setCarteGrise)}
            className="w-full text-xs text-slate-400 file:bg-slate-800 file:text-white file:border-0 file:rounded-lg file:px-3 file:py-1.5 file:mr-2 file:text-xs" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Photo de la pièce (optionnel)</label>
          <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && readAsBase64(e.target.files[0], setPartPhoto)}
            className="w-full text-xs text-slate-400 file:bg-slate-800 file:text-white file:border-0 file:rounded-lg file:px-3 file:py-1.5 file:mr-2 file:text-xs" />
        </div>

        <textarea rows={2} placeholder="Informations complémentaires (optionnel)" value={extraInfo} onChange={(e) => setExtraInfo(e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 resize-none" />

        {error && <p className="text-xs text-red-400">{error}</p>}
        <button type="submit" disabled={submitting}
          className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl cursor-pointer">
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
    if (parts[1] === "produit" && parts[2]) return { screen: "product" as const, slug: parts[2] };
    if (parts[1] === "piece-etranger") return { screen: "part-request" as const, slug: null };
    return { screen: "catalog" as const, slug: null };
  };

  const [route, setRoute] = useState(parsePath());

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

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 px-4 py-3 flex items-center justify-between sticky top-0 bg-slate-950/95 backdrop-blur z-10">
        <button onClick={() => navigate("/boutique")} className="flex items-center gap-2 cursor-pointer">
          <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center">
            <Wrench className="w-4.5 h-4.5 text-white" />
          </div>
          <span className="font-bold text-white text-sm">DiagAssist Boutique</span>
        </button>
        <button
          onClick={() => navigate("/boutique/piece-etranger")}
          className="text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-lg cursor-pointer"
        >
          Pièce introuvable ?
        </button>
      </header>

      {route.screen === "catalog" && <ShopCatalog onSelectProduct={(slug) => navigate(`/boutique/produit/${slug}`)} />}
      {route.screen === "product" && route.slug && <ShopProductPage slug={route.slug} onBack={() => navigate("/boutique")} />}
      {route.screen === "part-request" && <ShopPartRequest onBack={() => navigate("/boutique")} />}
    </div>
  );
}
