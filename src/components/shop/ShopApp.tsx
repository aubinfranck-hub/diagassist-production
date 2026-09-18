import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, CheckCircle2, ChevronRight, Headphones, Menu, Package,
  Phone, Search, ShieldCheck, ShoppingBag, Truck, X, Wrench, Zap,
  Star, MessageCircle, SlidersHorizontal, MapPin, CreditCard, Clock
} from "lucide-react";
import ShopAdmin from "./ShopAdmin";

const DIAG = {
  black: "#07090c",
  dark: "#10141a",
  red: "#ed1c24",
  redDark: "#b90f16",
  light: "#f5f6f7",
  gray: "#73777d",
  border: "#e4e6e8",
};

const WHATSAPP = "2250141116026";

interface CartItem {
  product_id: number;
  name: string;
  price_fcfa: number | null;
  photo: string | null;
  quantity: number;
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

function formatFcfa(n: number | null) {
  return n == null ? "Prix sur demande" : n.toLocaleString("fr-FR") + " FCFA";
}

function useCart() {
  const [items, setItems] = useState<CartItem[]>(() => {
    try { return JSON.parse(localStorage.getItem("shop_cart") || "[]"); } catch { return []; }
  });
  useEffect(() => localStorage.setItem("shop_cart", JSON.stringify(items)), [items]);
  const add = (p: ShopProduct, quantity = 1) => setItems(prev => {
    const found = prev.find(i => i.product_id === p.id);
    return found
      ? prev.map(i => i.product_id === p.id ? { ...i, quantity: i.quantity + quantity } : i)
      : [...prev, { product_id: p.id, name: p.name, price_fcfa: p.price_fcfa, photo: p.photos?.[0] || null, quantity }];
  });
  const remove = (id: number) => setItems(prev => prev.filter(i => i.product_id !== id));
  const setQuantity = (id: number, quantity: number) => setItems(prev => prev.map(i => i.product_id === id ? { ...i, quantity: Math.max(1, quantity) } : i));
  const clear = () => setItems([]);
  const count = items.reduce((s, i) => s + i.quantity, 0);
  const total = items.reduce((s, i) => s + (i.price_fcfa || 0) * i.quantity, 0);
  return { items, add, remove, setQuantity, clear, count, total };
}

function WhatsAppButton({ product }: { product?: ShopProduct | null }) {
  const message = product
    ? `Bonjour DiagAssist, je suis intéressé par le ${product.name}. Pouvez-vous me renseigner ?`
    : "Bonjour DiagAssist, je souhaite être renseigné sur vos produits.";
  return (
    <a
      href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(message)}`}
      target="_blank" rel="noreferrer"
      className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-[#16a34a] px-4 py-3 text-white shadow-xl hover:scale-105 transition-transform"
      aria-label="Contacter DiagAssist sur WhatsApp"
    >
      <MessageCircle className="w-5 h-5" />
      <span className="hidden sm:inline text-xs font-black">WhatsApp</span>
    </a>
  );
}

function ShopCatalog({ onSelectProduct, onGoCart }: { onSelectProduct: (slug: string) => void; onGoCart: () => void }) {
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [categories, setCategories] = useState<ShopCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [maxPrice, setMaxPrice] = useState(3000000);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const brands = ["AUTEL","THINKCAR","LAUNCH","XTOOL","TOPDON","HUMZOR","OBDSTAR","BOSCH","TEXA","MUCAR","GODIAG"];

  useEffect(() => {
    fetch("/api/shop/categories").then(r => r.json()).then(d => d.success && setCategories(d.categories || [])).catch(() => {});
    fetch("/api/shop/products").then(r => r.json()).then(d => d.success && setProducts(d.products || [])).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      const hay = [p.name,p.category_name,p.description,p.specs,p.compatibility].filter(Boolean).join(" ").toLowerCase();
      const categoryOk = !activeCategory || p.category_slug === activeCategory;
      const searchOk = !q || hay.includes(q);
      const brandOk = !brand || p.name.toLowerCase().includes(brand.toLowerCase());
      const priceOk = p.price_fcfa == null || p.price_fcfa <= maxPrice;
      const stockOk = !onlyAvailable || /stock|disponible/i.test(p.availability || "");
      return categoryOk && searchOk && brandOk && priceOk && stockOk;
    });
  }, [products, activeCategory, search, brand, maxPrice, onlyAvailable]);

  const popularCategories = categories.slice(0, 8);
  const featured = products.slice(0, 3);

  return (
    <main>
      <section className="relative overflow-hidden bg-[#10141a] text-white">
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "radial-gradient(circle at 18% 40%, #ed1c24 0, transparent 30%), radial-gradient(circle at 85% 60%, #475569 0, transparent 32%)" }} />
        <div className="relative mx-auto grid max-w-7xl items-center gap-8 px-5 py-14 sm:px-8 lg:grid-cols-[1.05fr_.95fr] lg:py-16">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-[#ed1c24]">DiagAssist • Équipement professionnel</p>
            <h1 className="mt-3 text-4xl font-black uppercase leading-[.9] tracking-[-.04em] sm:text-6xl">LA RÉFÉRENCE<br/><span className="text-[#ed1c24]">DU DIAGNOSTIC</span><br/>AUTOMOBILE</h1>
            <p className="mt-5 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">Scanners, outils de programmation, J2534, accessoires et formation pour les professionnels de l'automobile.</p>
            <button onClick={() => document.getElementById("shop-products")?.scrollIntoView({behavior:"smooth"})} className="mt-6 rounded-xl bg-[#ed1c24] px-6 py-3.5 text-sm font-black shadow-lg">Voir nos produits →</button>
            <div className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {["Diagnostic multimarque","Programmation & Codage","Toutes marques","Formation & Support"].map(x=><div key={x} className="rounded-xl border border-white/10 bg-white/5 p-3 text-[10px] font-black">{x}</div>)}
            </div>
          </div>
          <div className="relative hidden min-h-[320px] items-center justify-center lg:flex">
            {featured[0]?.photos?.[0] ? <img src={featured[0].photos[0]} alt={featured[0].name} className="max-h-[360px] w-full object-contain drop-shadow-2xl"/> : <Wrench className="h-48 w-48 text-[#ed1c24]"/>}
            <div className="absolute bottom-3 right-2 rounded-xl border border-white/10 bg-black/60 px-4 py-3 backdrop-blur"><p className="text-[10px] font-black text-[#ed1c24]">VOTRE PERFORMANCE</p><p className="text-xs font-black">NOTRE PRIORITÉ !</p></div>
          </div>
        </div>
      </section>

      <section className="border-b bg-white"><div className="mx-auto grid max-w-7xl grid-cols-2 divide-x sm:grid-cols-4">{[
        [ShieldCheck,"Produits 100% originaux","Garantie constructeur"],[Truck,"Livraison rapide","Côte d'Ivoire & Afrique"],[CreditCard,"Paiement sécurisé","Mobile Money prochainement"],[Headphones,"Support technique","Experts à votre écoute"]
      ].map(([Icon,title,text])=><div key={title as string} className="flex items-center gap-3 px-4 py-4"><React.createElement(Icon as any,{className:"h-5 w-5 shrink-0 text-[#ed1c24]"})}<div><p className="text-xs font-black">{title as string}</p><p className="hidden text-[10px] text-[#73777d] sm:block">{text as string}</p></div></div>)}</div></section>

      <section className="border-b bg-[#10141a] text-white"><div className="mx-auto flex max-w-7xl overflow-x-auto"><button onClick={()=>setActiveCategory(null)} className="flex shrink-0 items-center gap-2 bg-[#ed1c24] px-5 py-4 text-xs font-black"><Menu className="h-4 w-4"/>Tous les produits</button>{popularCategories.slice(0,7).map(c=><button key={c.id} onClick={()=>setActiveCategory(c.slug)} className="shrink-0 px-4 py-4 text-xs font-bold text-slate-300">{c.name}</button>)}<span className="ml-auto hidden shrink-0 bg-[#ed1c24] px-5 py-4 text-xs font-black lg:block">Nos marques</span></div></section>

      <section className="border-b bg-white"><div className="mx-auto flex max-w-7xl gap-3 overflow-x-auto px-5 py-4 sm:px-8">{brands.map(b=><button key={b} onClick={()=>setBrand(brand===b?"":b)} className={`shrink-0 rounded-lg border px-4 py-2 text-xs font-black tracking-wide ${brand===b?"border-[#ed1c24] bg-[#ed1c24] text-white":"border-[#e4e6e8] text-[#73777d]"}`}>{b}</button>)}</div></section>

      <section className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <div className="flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-[#ed1c24]">Catalogue</p><h2 className="mt-1 text-2xl font-black">Tous les produits</h2><p className="mt-1 text-xs text-[#73777d]">Découvrez notre gamme complète d'outils de diagnostic et d'équipements atelier.</p></div><button onClick={onGoCart} className="hidden items-center gap-2 rounded-xl border px-4 py-2 text-xs font-black sm:flex"><ShoppingBag className="h-4 w-4"/> Panier</button></div>
        <div className="mt-6 grid gap-6 lg:grid-cols-[250px_1fr]">
          <aside className="hidden h-fit rounded-2xl border border-[#e4e6e8] bg-white p-5 lg:block">
            <div className="flex items-center justify-between"><h3 className="text-sm font-black">Filtrer les produits</h3><button onClick={()=>{setActiveCategory(null);setBrand("");setMaxPrice(3000000);setOnlyAvailable(false)}} className="text-[10px] font-bold text-[#ed1c24]">Réinitialiser</button></div>
            <div className="mt-5"><p className="text-[10px] font-black uppercase text-[#73777d]">Catégories</p><div className="mt-3 space-y-2">{popularCategories.map(c=><button key={c.id} onClick={()=>setActiveCategory(activeCategory===c.slug?null:c.slug)} className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs ${activeCategory===c.slug?"bg-red-50 font-black text-[#ed1c24]":"text-[#10141a]"}`}><span>{c.name}</span><ChevronRight className="h-3 w-3"/></button>)}</div></div>
            <div className="mt-6 border-t pt-5"><p className="text-[10px] font-black uppercase text-[#73777d]">Marques</p><div className="mt-3 space-y-2">{brands.slice(0,7).map(b=><label key={b} className="flex cursor-pointer items-center gap-2 text-xs"><input type="radio" name="brand" checked={brand===b} onChange={()=>setBrand(b)} className="accent-[#ed1c24]"/>{b}</label>)}</div></div>
            <div className="mt-6 border-t pt-5"><div className="flex justify-between text-[10px] font-black uppercase text-[#73777d]"><span>Prix</span><span>{maxPrice.toLocaleString("fr-FR")} FCFA</span></div><input type="range" min="0" max="3000000" step="10000" value={maxPrice} onChange={e=>setMaxPrice(Number(e.target.value))} className="mt-3 w-full accent-[#ed1c24]"/><div className="mt-1 flex justify-between text-[9px] text-[#73777d]"><span>0 FCFA</span><span>3 000 000 FCFA</span></div></div>
            <label className="mt-6 flex cursor-pointer items-center gap-2 border-t pt-5 text-xs font-bold"><input type="checkbox" checked={onlyAvailable} onChange={e=>setOnlyAvailable(e.target.checked)} className="accent-[#ed1c24]"/> En stock uniquement</label>
          </aside>

          <div>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#73777d]"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher une marque, un modèle, une référence ou une fonction..." className="w-full rounded-xl border border-[#e4e6e8] py-3 pl-10 pr-4 text-sm outline-none focus:border-[#ed1c24]"/></div><button onClick={onGoCart} className="rounded-xl bg-[#07090c] px-4 py-3 text-xs font-black text-white sm:hidden">Panier</button></div>
            <div className="mb-4 flex items-center justify-between text-xs text-[#73777d]"><span>{filtered.length} produit(s)</span><span>Tri : Pertinence</span></div>
            {loading?<div className="py-24 text-center text-sm text-[#73777d]">Chargement du catalogue...</div>:filtered.length===0?<div className="rounded-2xl border border-dashed py-24 text-center text-sm text-[#73777d]">Aucun produit ne correspond à vos critères.</div>:
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
              {filtered.map(p=><button key={p.id} onClick={()=>onSelectProduct(p.slug)} className="group overflow-hidden rounded-2xl border border-[#e4e6e8] bg-white text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#ed1c24]/40 hover:shadow-xl">
                <div className="relative aspect-square bg-[#f5f6f7] sm:aspect-[4/3]">{p.photos?.[0]?<img src={p.photos[0]} alt={p.name} className="h-full w-full object-contain p-5 transition-transform duration-500 group-hover:scale-105"/>:<Package className="mx-auto mt-20 h-12 w-12 text-[#73777d]"/>}{p.availability&&<span className={`absolute left-3 top-3 rounded-full px-2 py-1 text-[9px] font-black uppercase ${/stock|disponible/i.test(p.availability)?"bg-emerald-500 text-white":"bg-white text-[#07090c]"}`}>{p.availability}</span>}</div>
                <div className="p-4"><p className="text-[9px] font-black uppercase tracking-wider text-[#ed1c24]">{p.category_name||"Diagnostic automobile"}</p><p className="mt-1 min-h-[40px] text-sm font-black leading-5">{p.name}</p>{p.specs&&<p className="mt-2 line-clamp-2 text-[10px] leading-4 text-[#73777d]">{p.specs}</p>}<div className="mt-4 flex items-center justify-between gap-2"><p className="text-sm font-black text-[#ed1c24]">{formatFcfa(p.price_fcfa)}</p><span className="rounded-lg bg-[#ed1c24] p-2 text-white"><ShoppingBag className="h-4 w-4"/></span></div></div>
              </button>)}
            </div>}
          </div>
        </div>
      </section>
    </main>
  );
}

function ShopProductPage({ slug, onBack, cart, onGoToCart }: { slug: string; onBack: () => void; cart: ReturnType<typeof useCart>; onGoToCart: () => void }) {
  const [product,setProduct]=useState<ShopProduct|null>(null); const [loading,setLoading]=useState(true); const [quantity,setQuantity]=useState(1);
  const [activePhoto,setActivePhoto]=useState(0); const [showOrderForm,setShowOrderForm]=useState(false);
  const [phone,setPhone]=useState(""); const [name,setName]=useState(""); const [city,setCity]=useState("");
  const [submitting,setSubmitting]=useState(false); const [orderDone,setOrderDone]=useState(false); const [orderRef,setOrderRef]=useState<string|null>(null); const [error,setError]=useState<string|null>(null);
  useEffect(()=>{setLoading(true);setActivePhoto(0);fetch("/api/shop/products/"+slug).then(r=>r.json()).then(d=>d.success&&setProduct(d.product)).finally(()=>setLoading(false));},[slug]);
  const handleOrder=async(e:React.FormEvent)=>{e.preventDefault();if(!product)return;setSubmitting(true);setError(null);try{const r=await fetch("/api/shop/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone,name,city,product_id:product.id,quantity})});const d=await r.json();if(d.success){setOrderRef(d.order_ref||null);setOrderDone(true)}else setError(d.message||"Échec de la commande.")}catch{setError("Erreur réseau. Vérifiez votre connexion.")}finally{setSubmitting(false)}};
  if(loading)return <div className="py-32 text-center text-sm text-[#73777d]">Chargement du produit...</div>;
  if(!product)return <div className="py-32 text-center text-sm text-[#73777d]">Produit introuvable.</div>;
  if(orderDone)return <div className="mx-auto max-w-md px-5 py-24 text-center"><CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500"/><h2 className="mt-5 text-2xl font-black">Commande enregistrée</h2>{orderRef&&<p className="mt-3 text-sm text-[#73777d]">Référence : <strong className="text-[#ed1c24]">{orderRef}</strong></p>}<p className="mt-3 text-sm text-[#73777d]">Notre équipe vous contactera par téléphone ou WhatsApp.</p><button onClick={onBack} className="mt-7 rounded-xl bg-[#ed1c24] px-6 py-3 text-sm font-black text-white">Retour au catalogue</button></div>;
  const photos=product.photos||[]; const current=photos[activePhoto];
  return <main className="mx-auto max-w-7xl px-5 py-6 sm:px-8">
    <div className="mb-5 flex items-center gap-2 text-[10px] text-[#73777d]"><button onClick={onBack} className="font-bold hover:text-[#ed1c24]">Accueil</button><ChevronRight className="h-3 w-3"/><span>{product.category_name||"Scanners Diagnostic"}</span><ChevronRight className="h-3 w-3"/><strong className="text-[#07090c]">{product.name}</strong></div>
    <div className="grid gap-8 lg:grid-cols-[1.05fr_.95fr_320px]">
      <div><div className="relative overflow-hidden rounded-2xl border border-[#e4e6e8] bg-[#f5f6f7]"><div className="absolute left-4 top-4 z-10 rounded-lg bg-[#ed1c24] px-3 py-1.5 text-[10px] font-black uppercase text-white">Best-seller</div><div className="aspect-square">{current?<img src={current} alt={product.name} className="h-full w-full object-contain p-8 sm:p-12"/>:<Package className="mx-auto mt-40 h-16 w-16 text-[#73777d]"/>}</div></div>
      <div className="mt-3 flex gap-2 overflow-x-auto">{photos.slice(0,6).map((src,i)=><button key={i} onClick={()=>setActivePhoto(i)} className={`h-20 w-20 shrink-0 rounded-xl border-2 bg-white p-1 ${activePhoto===i?"border-[#ed1c24]":"border-[#e4e6e8]"}`}><img src={src} alt="" className="h-full w-full object-contain"/></button>)}{product.videos?.[0]&&<div className="flex h-20 w-24 shrink-0 items-center justify-center rounded-xl bg-[#07090c] text-[10px] font-black text-white">▶ Voir la vidéo</div>}</div></div>
      <div className="lg:pt-2"><p className="text-xs font-black uppercase tracking-widest text-[#ed1c24]">{product.category_name||"AUTOMOTIVE DIAGNOSTIC"}</p><h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">{product.name}</h1><div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><span className="text-[#ed1c24]">★★★★★</span><span className="text-[#73777d]">Équipement professionnel</span></div><div className="mt-5 grid grid-cols-2 gap-2 text-[10px]"><div><span className="text-[#73777d]">Référence</span><p className="font-black">{product.slug}</p></div><div><span className="text-[#73777d]">Marque</span><p className="font-black">{product.name.split(" ")[0]}</p></div><div><span className="text-[#73777d]">Garantie</span><p className="font-black">{product.warranty||"Selon produit"}</p></div><div><span className="text-[#73777d]">Livraison</span><p className="font-black">24 à 72h Abidjan</p></div></div>{product.description&&<p className="mt-6 whitespace-pre-wrap text-sm leading-7 text-[#73777d]">{product.description}</p>}
      <div className="mt-6 rounded-2xl border border-[#e4e6e8] p-4"><h2 className="text-xs font-black uppercase">Informations clés</h2><div className="mt-3 grid gap-2 text-xs">{[["Disponibilité",product.availability||"Sur commande"],["Garantie",product.warranty||"Selon produit"],["Livraison","Côte d'Ivoire & Afrique"],["Support","Conseil technique"]].map(([a,b])=><div key={a} className="flex justify-between gap-4 border-b border-[#f0f0f0] py-2 last:border-0"><span className="text-[#73777d]">{a}</span><strong>{b}</strong></div>)}</div></div></div>
      <aside className="h-fit rounded-2xl border border-[#e4e6e8] bg-white p-5 shadow-sm lg:sticky lg:top-28"><div className="inline-flex rounded-lg bg-red-50 px-3 py-1 text-[10px] font-black text-[#ed1c24]">PRIX DIAGASSIST</div><p className="mt-3 text-3xl font-black text-[#ed1c24]">{formatFcfa(product.price_fcfa)}</p><div className="mt-3 flex items-center gap-2 text-xs text-emerald-600"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500"/>{product.availability||"Disponible"}</div><div className="mt-5 flex items-center justify-between rounded-xl border p-2"><span className="text-xs font-bold">Quantité</span><div className="flex items-center gap-4"><button onClick={()=>setQuantity(Math.max(1,quantity-1))} className="h-9 w-9 rounded-lg bg-[#f5f6f7] font-black">−</button><span className="font-black">{quantity}</span><button onClick={()=>setQuantity(quantity+1)} className="h-9 w-9 rounded-lg bg-[#f5f6f7] font-black">+</button></div></div><button onClick={()=>{cart.add(product,quantity);onGoToCart()}} className="mt-4 w-full rounded-xl bg-[#ed1c24] py-4 text-sm font-black text-white"><ShoppingBag className="mr-2 inline h-4 w-4"/>Ajouter au panier</button><button onClick={()=>setShowOrderForm(true)} className="mt-2 w-full rounded-xl border-2 border-[#ed1c24] py-3.5 text-sm font-black text-[#ed1c24]">Acheter maintenant</button><a href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`Bonjour DiagAssist, je suis intéressé par le ${product.name}.`)}`} target="_blank" rel="noreferrer" className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#16a34a] py-3.5 text-sm font-black text-white"><MessageCircle className="h-4 w-4"/>Commander sur WhatsApp</a>{showOrderForm&&<form onSubmit={handleOrder} className="mt-4 border-t pt-4"><input required type="tel" placeholder="Téléphone" value={phone} onChange={e=>setPhone(e.target.value)} className="mb-2 w-full rounded-xl border px-3 py-3 text-sm"/><input placeholder="Nom" value={name} onChange={e=>setName(e.target.value)} className="mb-2 w-full rounded-xl border px-3 py-3 text-sm"/><input placeholder="Ville" value={city} onChange={e=>setCity(e.target.value)} className="mb-2 w-full rounded-xl border px-3 py-3 text-sm"/>{error&&<p className="mb-2 text-[10px] font-bold text-[#ed1c24]">{error}</p>}<button disabled={submitting} className="w-full rounded-xl bg-[#07090c] py-3 text-xs font-black text-white">{submitting?"Envoi...":"Valider l'achat"}</button></form>}</aside>
    </div>
    <div className="mt-10 grid gap-5 lg:grid-cols-3">{[["Caractéristiques",product.specs],["Compatibilité",product.compatibility],["Contenu de la boîte",product.box_contents]].map(([title,body])=><section key={title as string} className="rounded-2xl border border-[#e4e6e8] bg-white p-5"><h2 className="border-b pb-3 text-sm font-black uppercase">{title as string}</h2><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[#73777d]">{body||"Informations disponibles sur demande."}</p></section>)}</div>
    {product.videos?.[0]&&<div className="mt-5 rounded-2xl border p-5"><h2 className="mb-4 text-sm font-black uppercase">Démonstration produit</h2><div className="aspect-video overflow-hidden rounded-xl bg-black"><video src={product.videos[0]} controls className="h-full w-full"/></div></div>}
  </main>;
}
function ShopCart({cart,onBack,onCheckout}:{cart:ReturnType<typeof useCart>;onBack:()=>void;onCheckout:()=>void}) {
  return <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
    <div className="mb-5 flex items-center gap-2 text-[10px] text-[#73777d]"><button onClick={onBack} className="font-bold hover:text-[#ed1c24]">Accueil</button><ChevronRight className="h-3 w-3"/><span>Panier</span></div>
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-[#ed1c24]">Votre sélection</p><h1 className="mt-1 text-3xl font-black">Mon panier</h1><p className="mt-2 text-sm text-[#73777d]">{cart.count} article(s) sélectionné(s)</p></div><button onClick={onBack} className="text-xs font-black text-[#ed1c24]">← Continuer mes achats</button></div>
    {cart.items.length===0?<div className="mt-8 rounded-2xl border border-dashed p-16 text-center"><ShoppingBag className="mx-auto mb-3 h-12 w-12 text-[#73777d]"/><p className="font-black">Votre panier est vide.</p><p className="mt-2 text-xs text-[#73777d]">Ajoutez un équipement depuis le catalogue pour commencer.</p><button onClick={onBack} className="mt-5 rounded-xl bg-[#ed1c24] px-6 py-3 text-xs font-black text-white">Voir le catalogue</button></div>:<div className="mt-7 grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="space-y-3">{cart.items.map(i=><div key={i.product_id} className="rounded-2xl border border-[#e4e6e8] bg-white p-4"><div className="flex items-center gap-4"><div className="h-24 w-24 shrink-0 rounded-xl bg-[#f5f6f7] p-2">{i.photo?<img src={i.photo} alt="" className="h-full w-full object-contain"/>:<Package className="m-auto mt-7 h-8 w-8 text-[#73777d]"/>}</div><div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase tracking-wider text-[#ed1c24]">Équipement diagnostic</p><p className="mt-1 text-sm font-black sm:text-base">{i.name}</p><p className="mt-1 text-sm font-black text-[#ed1c24]">{formatFcfa(i.price_fcfa)}</p></div><button onClick={()=>cart.remove(i.product_id)} className="self-start p-2 text-[#73777d] hover:text-[#ed1c24]" aria-label={"Supprimer "+i.name}><X className="h-4 w-4"/></button></div><div className="mt-4 flex items-center justify-between border-t border-[#f0f0f0] pt-3"><span className="text-[10px] font-bold text-[#73777d]">Quantité</span><div className="flex items-center rounded-xl border p-1"><button onClick={()=>cart.setQuantity(i.product_id,Math.max(1,i.quantity-1))} className="h-8 w-8 rounded-lg bg-[#f5f6f7] font-black">−</button><span className="w-10 text-center text-sm font-black">{i.quantity}</span><button onClick={()=>cart.setQuantity(i.product_id,i.quantity+1)} className="h-8 w-8 rounded-lg bg-[#f5f6f7] font-black">+</button></div><span className="text-sm font-black">{formatFcfa((i.price_fcfa||0)*i.quantity)}</span></div></div>)}</section>
      <aside className="h-fit rounded-2xl border border-[#e4e6e8] bg-[#07090c] p-6 text-white lg:sticky lg:top-28"><p className="text-xs font-black uppercase tracking-wider text-slate-400">Résumé de la commande</p><div className="mt-5 space-y-3">{cart.items.map(i=><div key={i.product_id} className="flex justify-between gap-3 text-xs"><span className="truncate text-slate-300">{i.quantity}× {i.name}</span><span className="shrink-0 font-bold">{formatFcfa((i.price_fcfa||0)*i.quantity)}</span></div>)}</div><div className="mt-5 border-t border-white/10 pt-4"><div className="flex justify-between text-xs text-slate-400"><span>Sous-total</span><span>{formatFcfa(cart.total)}</span></div><div className="mt-2 flex justify-between text-xs text-slate-400"><span>Livraison</span><span>À confirmer</span></div><div className="mt-4 flex justify-between text-xl font-black"><span>Total</span><span className="text-[#ed1c24]">{formatFcfa(cart.total)}</span></div></div><button onClick={onCheckout} className="mt-5 w-full rounded-xl bg-[#ed1c24] py-4 text-sm font-black">Passer commande <ChevronRight className="ml-1 inline h-4 w-4"/></button><p className="mt-3 text-center text-[10px] text-slate-500">Paiement en ligne disponible prochainement.</p></aside>
    </div>}
  </main>;
}

function ShopCheckout({cart,onBack,onDone}:{cart:ReturnType<typeof useCart>;onBack:()=>void;onDone:(ref:string)=>void}) {
  const [step,setStep]=useState<1|2>(1); const [phone,setPhone]=useState("");const[name,setName]=useState("");const[city,setCity]=useState("");const[address,setAddress]=useState("");const[submitting,setSubmitting]=useState(false);const[error,setError]=useState<string|null>(null);
  const submit=async()=>{setSubmitting(true);setError(null);try{const r=await fetch("/api/shop/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone,name,city,address,items:cart.items.map(i=>({product_id:i.product_id,quantity:i.quantity}))})});const d=await r.json();if(d.success){cart.clear();onDone(d.order_ref)}else setError(d.message||"Échec de la commande.")}catch{setError("Erreur réseau. Vérifiez votre connexion.")}finally{setSubmitting(false)}};
  if(cart.items.length===0)return <main className="mx-auto max-w-xl px-5 py-20 text-center"><ShoppingBag className="mx-auto h-12 w-12 text-[#73777d]"/><h1 className="mt-4 text-2xl font-black">Votre panier est vide</h1><button onClick={onBack} className="mt-6 rounded-xl bg-[#ed1c24] px-6 py-3 text-sm font-black text-white">Retour au panier</button></main>;
  return <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
    <div className="mb-6 flex items-center gap-2 text-[10px] text-[#73777d]"><button onClick={onBack} className="font-bold hover:text-[#ed1c24]">Panier</button><ChevronRight className="h-3 w-3"/><strong className="text-[#07090c]">Commande</strong></div>
    <div className="mb-8 grid grid-cols-4 gap-1 rounded-2xl border border-[#e4e6e8] bg-white p-2 sm:gap-2">{[[1,"Informations"],[2,"Livraison"],[3,"Paiement"],[4,"Confirmation"]].map(([n,label])=><div key={n as number} className={step===n?"rounded-xl bg-[#ed1c24] px-2 py-3 text-center text-[9px] font-black text-white":"rounded-xl bg-[#f5f6f7] px-2 py-3 text-center text-[9px] font-black text-[#73777d]"}><span className="block text-sm">{n as number}</span>{label as string}</div>)}</div>
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]"><section className="rounded-2xl border border-[#e4e6e8] bg-white p-5 sm:p-7">
      {step===1?<form onSubmit={e=>{e.preventDefault();if(phone.trim()&&name.trim()&&city.trim())setStep(2)}}><p className="text-[10px] font-black uppercase tracking-[.2em] text-[#ed1c24]">Étape 1 • Informations</p><h1 className="mt-2 text-3xl font-black">Vos coordonnées</h1><p className="mt-2 text-sm text-[#73777d]">Votre numéro sert à retrouver votre commande et à assurer le suivi commercial.</p><div className="mt-6 grid gap-3"><label className="grid gap-1 text-xs font-bold">Téléphone <input required type="tel" placeholder="+225 07 00 00 00 00" value={phone} onChange={e=>setPhone(e.target.value)} className="rounded-xl border px-4 py-3 text-sm font-normal outline-none focus:border-[#ed1c24]"/></label><label className="grid gap-1 text-xs font-bold">Nom complet <input required placeholder="Votre nom et prénom" value={name} onChange={e=>setName(e.target.value)} className="rounded-xl border px-4 py-3 text-sm font-normal outline-none focus:border-[#ed1c24]"/></label><label className="grid gap-1 text-xs font-bold">Ville / Commune <input required placeholder="Ex. Cocody, Abidjan" value={city} onChange={e=>setCity(e.target.value)} className="rounded-xl border px-4 py-3 text-sm font-normal outline-none focus:border-[#ed1c24]"/></label></div><label className="mt-4 flex items-start gap-2 text-xs text-[#73777d]"><input type="checkbox" className="mt-0.5 accent-[#ed1c24]"/>J'accepte d'être contacté pour le suivi de ma commande et les informations commerciales DiagAssist.</label><button className="mt-6 w-full rounded-xl bg-[#ed1c24] py-4 text-sm font-black text-white">Continuer vers la livraison <ChevronRight className="ml-1 inline h-4 w-4"/></button></form>:
      <div><p className="text-[10px] font-black uppercase tracking-[.2em] text-[#ed1c24]">Étape 2 • Livraison</p><h1 className="mt-2 text-3xl font-black">Adresse de livraison</h1><p className="mt-2 text-sm text-[#73777d]">Indiquez où nous devons vous livrer. Notre équipe confirmera le délai et les frais.</p><label className="mt-6 grid gap-1 text-xs font-bold">Adresse / quartier<textarea required rows={4} placeholder="Quartier, rue, repère, instructions..." value={address} onChange={e=>setAddress(e.target.value)} className="resize-none rounded-xl border px-4 py-3 text-sm font-normal outline-none focus:border-[#ed1c24]"/></label><div className="mt-5 rounded-xl border border-dashed border-[#e4e6e8] bg-[#f5f6f7] p-4"><p className="text-xs font-black">Paiement</p><p className="mt-1 text-xs text-[#73777d]">Le paiement mobile sera activé prochainement. Aucun virement bancaire n'est proposé actuellement.</p></div>{error&&<p className="mt-3 text-xs font-bold text-[#ed1c24]">{error}</p>}<div className="mt-6 grid gap-2 sm:grid-cols-2"><button type="button" onClick={()=>setStep(1)} className="rounded-xl border py-3.5 text-sm font-black">Retour</button><button type="button" onClick={submit} disabled={submitting} className="rounded-xl bg-[#ed1c24] py-3.5 text-sm font-black text-white disabled:opacity-50">{submitting?"Envoi...":"Confirmer la commande"}</button></div></div>}
    </section><aside className="h-fit rounded-2xl bg-[#07090c] p-6 text-white lg:sticky lg:top-28"><p className="text-xs font-black uppercase tracking-wider text-slate-400">Votre commande</p><div className="mt-5 space-y-3">{cart.items.map(i=><div key={i.product_id} className="flex justify-between gap-3 text-xs"><span className="truncate text-slate-300">{i.quantity}× {i.name}</span><span className="shrink-0 font-bold">{formatFcfa((i.price_fcfa||0)*i.quantity)}</span></div>)}</div><div className="mt-5 border-t border-white/10 pt-4"><div className="flex justify-between text-xs text-slate-400"><span>Sous-total</span><span>{formatFcfa(cart.total)}</span></div><div className="mt-2 flex justify-between text-xs text-slate-400"><span>Livraison</span><span>À confirmer</span></div><div className="mt-4 flex justify-between text-xl font-black"><span>Total</span><span className="text-[#ed1c24]">{formatFcfa(cart.total)}</span></div></div></aside></div>
  </main>;
}

function ShopConfirmation({ref,onBack,onTrack}:{ref:string;onBack:()=>void;onTrack:()=>void}) {
  return <main className="mx-auto max-w-md px-5 py-24 text-center"><CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500"/><p className="mt-5 text-[10px] font-black uppercase tracking-[0.2em] text-[#ed1c24]">Merci pour votre confiance</p><h1 className="mt-2 text-3xl font-black">Commande enregistrée</h1><p className="mt-4 text-sm text-[#73777d]">Référence : <strong className="text-[#ed1c24]">{ref}</strong></p><p className="mt-3 text-sm text-[#73777d]">Notre équipe vous contactera bientôt par téléphone ou WhatsApp.</p><div className="mt-7 grid gap-2"><button onClick={onTrack} className="rounded-xl bg-[#ed1c24] py-3.5 text-sm font-black text-white">Suivre ma commande</button><button onClick={onBack} className="rounded-xl bg-[#f5f6f7] py-3.5 text-sm font-black text-[#07090c]">Continuer mes achats</button></div></main>;
}

function ShopTracking({onBack}:{onBack:()=>void}) {
  const[phone,setPhone]=useState("");const[ref,setRef]=useState("");const[orders,setOrders]=useState<any[]|null>(null);const[loading,setLoading]=useState(false);const[error,setError]=useState<string|null>(null);
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setLoading(true);setError(null);try{const p=new URLSearchParams({phone:phone.trim()});if(ref.trim())p.set("ref",ref.trim());const r=await fetch("/api/shop/track?"+p);const d=await r.json();if(d.success)setOrders(d.orders||[]);else setError(d.message||"Aucune commande trouvée.")}catch{setError("Erreur réseau. Vérifiez votre connexion.")}finally{setLoading(false)}};
  const steps=["nouvelle","confirmee","en_traitement","prete","livree"];const labels:Record<string,string>={nouvelle:"Commande reçue",a_contacter:"Commande reçue",contactee:"Commande reçue",confirmee:"Confirmée",en_traitement:"Préparation",prete:"Prête",livree:"Livrée",annulee:"Annulée",client_injoignable:"Client injoignable"};
  return <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
    <div className="mb-5 flex items-center gap-2 text-[10px] text-[#73777d]"><button onClick={onBack} className="font-bold hover:text-[#ed1c24]">Accueil</button><ChevronRight className="h-3 w-3"/><span>Suivi de commande</span></div>
    <div className="rounded-2xl border border-[#e4e6e8] bg-white p-6 sm:p-8"><div className="max-w-2xl"><p className="text-[10px] font-black uppercase tracking-[.2em] text-[#ed1c24]">Service client</p><h1 className="mt-2 text-3xl font-black">Suivre ma commande</h1><p className="mt-2 text-sm leading-6 text-[#73777d]">Retrouvez l'état de votre commande avec le numéro utilisé lors de votre achat.</p></div>
      <form onSubmit={submit} className="mt-7 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><input required type="tel" placeholder="Votre numéro de téléphone" value={phone} onChange={e=>setPhone(e.target.value)} className="rounded-xl border px-4 py-3 text-sm outline-none focus:border-[#ed1c24]"/><input placeholder="Référence de commande (facultatif)" value={ref} onChange={e=>setRef(e.target.value)} className="rounded-xl border px-4 py-3 text-sm outline-none focus:border-[#ed1c24]"/><button disabled={loading} className="rounded-xl bg-[#ed1c24] px-6 py-3 text-sm font-black text-white disabled:opacity-50">{loading?"Recherche...":"Rechercher"}</button></form>
      {error&&<div className="mt-4 rounded-xl bg-red-50 p-3 text-xs font-bold text-[#ed1c24]">{error}</div>}
    </div>
    {orders&&orders.length===0&&<div className="mt-5 rounded-2xl border border-dashed p-10 text-center"><Package className="mx-auto h-10 w-10 text-[#73777d]"/><p className="mt-3 text-sm font-black">Aucune commande trouvée</p><p className="mt-1 text-xs text-[#73777d]">Vérifiez le numéro et la référence saisis.</p></div>}
    {orders?.map((o,idx)=>{const ci=steps.indexOf(o.status);const cancelled=o.status==="annulee"||o.status==="client_injoignable";return <article key={idx} className="mt-5 rounded-2xl border border-[#e4e6e8] bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-wider text-[#73777d]">Référence</p><p className="mt-1 text-lg font-black text-[#ed1c24]">{o.order_ref}</p></div><span className={cancelled?"rounded-full bg-red-50 px-3 py-1.5 text-[10px] font-black text-[#ed1c24]":"rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-black text-emerald-700"}>{labels[o.status]||o.status}</span></div>
      {!cancelled&&<div className="mt-7"><div className="flex items-center">{steps.map((s,i)=><React.Fragment key={s}><div className="flex shrink-0 flex-col items-center"><span className={`h-4 w-4 rounded-full border-2 ${ci>=i?"border-[#ed1c24] bg-[#ed1c24]":"border-[#e4e6e8] bg-white"}`}/><span className="mt-2 hidden text-[9px] font-bold text-[#73777d] sm:block">{labels[s]}</span></div>{i<steps.length-1&&<span className={`h-0.5 flex-1 ${ci>i?"bg-[#ed1c24]":"bg-[#e4e6e8]"}`}/>}</React.Fragment>)}</div></div>}
      <div className="mt-6 border-t border-[#f0f0f0] pt-4"><p className="text-xs font-black">Articles</p><div className="mt-2 space-y-1">{o.items?.map((it:any,i:number)=><p key={i} className="text-xs text-[#73777d]">{it.quantity}× {it.product_name}</p>)}</div></div>
    </article>})}
  </main>;
}

function ShopPartRequest({onBack}:{onBack:()=>void}) {
  const[phone,setPhone]=useState("");const[name,setName]=useState("");const[description,setDescription]=useState("");const[extra,setExtra]=useState("");const[carte,setCarte]=useState<string|null>(null);const[photo,setPhoto]=useState<string|null>(null);const[done,setDone]=useState(false);const[loading,setLoading]=useState(false);const[error,setError]=useState<string|null>(null);
  const read=(f:File,cb:(s:string)=>void)=>{const r=new FileReader();r.onload=()=>cb(r.result as string);r.readAsDataURL(f)};
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setLoading(true);try{const r=await fetch("/api/shop/part-requests",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone,name,part_description:description,extra_info:extra,carte_grise_base64:carte,part_photo_base64:photo})});const d=await r.json();if(d.success)setDone(true);else setError(d.message||"Échec de l'envoi.")}catch{setError("Erreur réseau.")}finally{setLoading(false)}};
  if(done)return <main className="mx-auto max-w-md px-5 py-24 text-center"><CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500"/><h1 className="mt-5 text-2xl font-black">Demande envoyée</h1><p className="mt-3 text-sm text-[#73777d]">Notre équipe va rechercher la pièce et revenir vers vous.</p><button onClick={onBack} className="mt-7 rounded-xl bg-[#07090c] px-6 py-3 text-sm font-black text-white">Retour</button></main>;
  return <main className="mx-auto max-w-xl px-5 py-8 sm:px-8"><button onClick={onBack} className="mb-6 flex items-center gap-2 text-xs font-bold text-[#73777d]"><ArrowLeft className="h-4 w-4"/>Retour</button><div className="rounded-2xl border border-[#e4e6e8] p-6"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#ed1c24]">Service recherche</p><h1 className="mt-2 text-3xl font-black">Une pièce introuvable ?</h1><p className="mt-3 text-sm leading-6 text-[#73777d]">Envoyez les informations du véhicule et la pièce recherchée. DiagAssist vous accompagne.</p><form onSubmit={submit} className="mt-6 grid gap-3"><input required type="tel" placeholder="Numéro de téléphone" value={phone} onChange={e=>setPhone(e.target.value)} className="rounded-xl border px-4 py-3 text-sm"/><input placeholder="Nom" value={name} onChange={e=>setName(e.target.value)} className="rounded-xl border px-4 py-3 text-sm"/><textarea required rows={4} placeholder="Décrivez la pièce recherchée" value={description} onChange={e=>setDescription(e.target.value)} className="resize-none rounded-xl border px-4 py-3 text-sm"/><textarea rows={2} placeholder="Informations complémentaires" value={extra} onChange={e=>setExtra(e.target.value)} className="resize-none rounded-xl border px-4 py-3 text-sm"/><label className="rounded-xl border border-dashed p-4 text-xs font-bold text-[#73777d]">Carte grise (photo)<input type="file" accept="image/*" onChange={e=>e.target.files?.[0]&&read(e.target.files[0],setCarte)} className="mt-2 block w-full text-xs"/></label><label className="rounded-xl border border-dashed p-4 text-xs font-bold text-[#73777d]">Photo de la pièce<input type="file" accept="image/*" onChange={e=>e.target.files?.[0]&&read(e.target.files[0],setPhoto)} className="mt-2 block w-full text-xs"/></label>{error&&<p className="text-xs font-bold text-[#ed1c24]">{error}</p>}<button disabled={loading} className="rounded-xl bg-[#ed1c24] py-3.5 text-sm font-black text-white">{loading?"Envoi...":"Envoyer la demande"}</button></form></div></main>;
}

export default function ShopApp() {
  const parsePath=()=>{const p=window.location.pathname.split("/").filter(Boolean);if(p[1]==="admin")return{screen:"admin" as const,slug:null};if(p[1]==="produit"&&p[2])return{screen:"product" as const,slug:p[2]};if(p[1]==="piece-etranger")return{screen:"part-request" as const,slug:null};if(p[1]==="panier")return{screen:"cart" as const,slug:null};if(p[1]==="commande")return{screen:"checkout" as const,slug:null};if(p[1]==="confirmation")return{screen:"confirmation" as const,slug:null};if(p[1]==="suivi")return{screen:"tracking" as const,slug:null};return{screen:"catalog" as const,slug:null}};
  const[route,setRoute]=useState(parsePath());const[lastOrderRef,setLastOrderRef]=useState<string|null>(null);const[mobileMenu,setMobileMenu]=useState(false);const cart=useCart();
  useEffect(()=>{const f=()=>setRoute(parsePath());window.addEventListener("popstate",f);return()=>window.removeEventListener("popstate",f)},[]);
  const navigate=(path:string)=>{window.history.pushState({}, "", path);setRoute(parsePath());setMobileMenu(false);window.scrollTo(0,0)};
  if(route.screen==="admin")return <ShopAdmin/>;
  return <div className="min-h-screen bg-white text-[#07090c]">
    <div className="hidden bg-[#07090c] text-white md:block">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-2 text-[10px]">
        <span className="font-semibold text-slate-300"><MapPin className="mr-1 inline h-3 w-3 text-[#ed1c24]"/>Abidjan, Côte d'Ivoire <span className="mx-2 text-slate-600">|</span> Livraison partout en Afrique</span>
        <div className="flex items-center gap-5 text-slate-400"><button onClick={()=>navigate("/boutique/suivi")} className="hover:text-white">Suivi de commande</button><button onClick={()=>navigate("/boutique/piece-etranger")} className="hover:text-white">Aide</button><a href={`https://wa.me/${WHATSAPP}`} target="_blank" rel="noreferrer" className="hover:text-white">Contact</a></div>
      </div>
    </div>
    <header className="sticky top-0 z-40 bg-[#07090c] text-white shadow-lg">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-8 lg:py-4">
        <button onClick={()=>navigate("/boutique")} className="flex shrink-0 items-center gap-2.5 text-left">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ed1c24] shadow-lg"><Wrench className="h-5 w-5"/></span>
          <span className="hidden sm:block"><span className="block text-lg font-black uppercase leading-none tracking-tight">DIAG<span className="text-[#ed1c24]">ASSIST</span></span><span className="text-[7px] font-bold tracking-[.18em] text-slate-500">ÉQUIPEZ. DIAGNOSTIQUEZ. AVANCEZ.</span></span>
        </button>
        <div className="relative flex-1 md:max-w-2xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"/>
          <input onFocus={()=>{if(route.screen!=="catalog")navigate("/boutique")}} placeholder="Rechercher un produit, une marque, une référence..." className="w-full rounded-xl bg-white px-10 py-3 text-sm text-[#07090c] outline-none placeholder:text-slate-400"/>
        </div>
        <button onClick={()=>navigate("/boutique/suivi")} className="hidden items-center gap-2 px-2 text-xs font-bold text-slate-300 hover:text-white lg:flex"><Clock className="h-4 w-4"/> Suivi</button>
        <button onClick={()=>navigate("/boutique/panier")} className="relative flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 hover:bg-white/10"><ShoppingBag className="h-5 w-5"/><span className="hidden text-xs font-bold lg:block">Panier</span>{cart.count>0&&<span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ed1c24] px-1 text-[9px] font-black">{cart.count}</span>}</button>
        <button onClick={()=>setMobileMenu(!mobileMenu)} className="rounded-xl p-2 hover:bg-white/10 md:hidden">{mobileMenu?<X className="h-5 w-5"/>:<Menu className="h-5 w-5"/>}</button>
      </div>
      <nav className="hidden border-t border-white/10 md:block">
        <div className="mx-auto flex max-w-7xl overflow-x-auto px-5 sm:px-8">
          <button onClick={()=>navigate("/boutique")} className="shrink-0 bg-[#ed1c24] px-5 py-3 text-xs font-black uppercase">Tous les produits</button>
          <button onClick={()=>navigate("/boutique")} className="shrink-0 px-4 py-3 text-xs font-bold text-slate-300 hover:bg-white/5">Scanners Diagnostic</button>
          <button onClick={()=>navigate("/boutique")} className="shrink-0 px-4 py-3 text-xs font-bold text-slate-300 hover:bg-white/5">Programmation & J2534</button>
          <button onClick={()=>navigate("/boutique")} className="shrink-0 px-4 py-3 text-xs font-bold text-slate-300 hover:bg-white/5">Outils Atelier</button>
          <button onClick={()=>navigate("/boutique")} className="shrink-0 px-4 py-3 text-xs font-bold text-slate-300 hover:bg-white/5">Accessoires</button>
          <button onClick={()=>navigate("/boutique")} className="shrink-0 px-4 py-3 text-xs font-bold text-slate-300 hover:bg-white/5">Logiciels</button>
          <button onClick={()=>navigate("/boutique")} className="shrink-0 px-4 py-3 text-xs font-bold text-slate-300 hover:bg-white/5">Formations</button>
          <button onClick={()=>navigate("/boutique")} className="shrink-0 px-4 py-3 text-xs font-black text-[#ed1c24]">Promotions</button>
        </div>
      </nav>
      {mobileMenu&&<div className="border-t border-white/10 bg-[#10141a] p-4 md:hidden"><div className="grid gap-2"><button onClick={()=>navigate("/boutique")} className="rounded-lg bg-white/5 px-4 py-3 text-left text-xs font-bold">Tous les produits</button><button onClick={()=>navigate("/boutique/suivi")} className="rounded-lg bg-white/5 px-4 py-3 text-left text-xs font-bold">Scanners Diagnostic</button><button onClick={()=>navigate("/boutique/suivi")} className="rounded-lg bg-white/5 px-4 py-3 text-left text-xs font-bold">Suivre ma commande</button><button onClick={()=>navigate("/boutique/piece-etranger")} className="rounded-lg bg-white/5 px-4 py-3 text-left text-xs font-bold">Rechercher une pièce</button></div></div>}
    </header>
    <section className="hidden border-b bg-white md:block"><div className="mx-auto grid max-w-7xl grid-cols-4 divide-x">{[[ShieldCheck,"Produits 100% originaux","Garantie constructeur"],[Truck,"Livraison rapide","Côte d'Ivoire & Afrique"],[CreditCard,"Paiement sécurisé","Mobile Money prochainement"],[Headphones,"Support technique","Experts à votre écoute"]].map(([Icon,title,text])=><div key={title as string} className="flex items-center gap-3 px-5 py-3.5"><React.createElement(Icon as any,{className:"h-5 w-5 shrink-0 text-[#ed1c24]"})}<div><p className="text-xs font-black">{title as string}</p><p className="text-[10px] text-[#73777d]">{text as string}</p></div></div>)}</div></section>
    {route.screen==="catalog"&&<ShopCatalog onSelectProduct={slug=>navigate("/boutique/produit/"+slug)} onGoCart={()=>navigate("/boutique/panier")}/>}
    {route.screen==="product"&&route.slug&&<ShopProductPage slug={route.slug} onBack={()=>navigate("/boutique")} cart={cart} onGoToCart={()=>navigate("/boutique/panier")}/>}
    {route.screen==="part-request"&&<ShopPartRequest onBack={()=>navigate("/boutique")}/>}
    {route.screen==="cart"&&<ShopCart cart={cart} onBack={()=>navigate("/boutique")} onCheckout={()=>navigate("/boutique/commande")}/>}
    {route.screen==="checkout"&&<ShopCheckout cart={cart} onBack={()=>navigate("/boutique/panier")} onDone={ref=>{setLastOrderRef(ref);navigate("/boutique/confirmation")}}/>}
    {route.screen==="confirmation"&&lastOrderRef&&<ShopConfirmation ref={lastOrderRef} onBack={()=>navigate("/boutique")} onTrack={()=>navigate("/boutique/suivi")}/>}
    {route.screen==="tracking"&&<ShopTracking onBack={()=>navigate("/boutique")}/>}
    <footer className="border-t border-[#e4e6e8] bg-[#07090c] px-5 py-12 text-white sm:px-8"><div className="mx-auto grid max-w-7xl gap-8 sm:grid-cols-2 lg:grid-cols-4"><div><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#ed1c24]"><Wrench className="h-5 w-5"/></span><span className="font-black">DiagAssist</span></div><p className="mt-4 max-w-xs text-xs leading-6 text-slate-400">Solutions professionnelles de diagnostic automobile, programmation, accessoires et formation.</p></div><div><p className="text-xs font-black uppercase">Boutique</p><div className="mt-3 grid gap-2 text-xs text-slate-400"><button onClick={()=>navigate("/boutique")} className="text-left hover:text-white">Tous les produits</button><button onClick={()=>navigate("/boutique/piece-etranger")} className="text-left hover:text-white">Recherche de pièces</button></div></div><div><p className="text-xs font-black uppercase">Service</p><div className="mt-3 grid gap-2 text-xs text-slate-400"><button onClick={()=>navigate("/boutique/suivi")} className="text-left hover:text-white">Suivre une commande</button><a href={`https://wa.me/${WHATSAPP}`} target="_blank" rel="noreferrer" className="hover:text-white">WhatsApp</a></div></div><div><p className="text-xs font-black uppercase">Contact</p><p className="mt-3 text-sm font-black">01 41 11 60 26</p><p className="mt-1 text-xs text-slate-400">Abidjan, Côte d'Ivoire</p></div></div><div className="mx-auto mt-10 max-w-7xl border-t border-white/10 pt-5 text-[10px] text-slate-500">© 2026 DiagAssist. Tous droits réservés.</div></footer>
    <WhatsAppButton/>
  </div>;
}
