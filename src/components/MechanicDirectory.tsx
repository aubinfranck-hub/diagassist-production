import React, { useState, useEffect } from "react";
import { MapPin, Phone, MessageCircle, ShieldCheck, Search, Wrench, RefreshCw, Cpu, Package } from "lucide-react";

interface Partner {
  id: string;
  type: "mechanic" | "parts_vendor";
  name: string;
  garageName?: string;
  phone: string;
  city: string;
  area?: string;
  specialties?: string;
  hasScanner: boolean;
  certified: boolean;
}

const toWaMeNumber = (phone: string) => phone.replace(/[^0-9]/g, "");

interface MechanicDirectoryProps {
  // "mechanic" : garages agréés équipés d'une valise — "parts_vendor" : vendeurs de pièces détachées
  partnerType?: "mechanic" | "parts_vendor";
}

export default function MechanicDirectory({ partnerType = "mechanic" }: MechanicDirectoryProps) {
  const isVendor = partnerType === "parts_vendor";

  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("auth_session_token");
      const res = await fetch(`/api/mechanics?type=${partnerType}`, {
        headers: { "Authorization": `Bearer ${token || ""}` },
      });
      const data = await res.json();
      if (data.success) {
        setPartners(data.mechanics);
      } else {
        setError(data.message || "Impossible de charger la liste.");
      }
    } catch {
      setError("Erreur réseau. Vérifiez votre connexion.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [partnerType]);

  const filtered = partners.filter((m) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      m.city.toLowerCase().includes(q) ||
      (m.area || "").toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      (m.garageName || "").toLowerCase().includes(q) ||
      (m.specialties || "").toLowerCase().includes(q)
    );
  });

  const accent = isVendor ? "amber" : "sky";

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="premium-glass-card rounded-3xl p-6 md:p-8">
        <div className="flex items-center gap-3 mb-2">
          <div
            className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
              isVendor ? "bg-amber-500/10 text-amber-400" : "bg-sky-500/10 text-sky-400"
            }`}
          >
            {isVendor ? <Package className="w-5 h-5" /> : <Wrench className="w-5 h-5" />}
          </div>
          <div>
            <h2 className="text-lg md:text-xl font-display font-black text-white uppercase tracking-tight">
              {isVendor ? "Vendeurs de pièces" : "Mécaniciens agréés"}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {isVendor
                ? "Fournisseurs de pièces détachées vérifiés près de chez vous."
                : "Professionnels vérifiés, équipés d'une valise de diagnostic."}
            </p>
          </div>
        </div>

        <div className="relative mt-5">
          <Search className="w-4 h-4 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={
              isVendor
                ? "Rechercher par ville, quartier ou type de pièce..."
                : "Rechercher par ville, quartier ou spécialité..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl pl-11 pr-4 py-3.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none transition ${
              isVendor
                ? "focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10"
                : "focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10"
            }`}
          />
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-4 rounded-2xl flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={load} className="shrink-0 flex items-center gap-1.5 text-rose-300 hover:text-white cursor-pointer font-bold">
            <RefreshCw className="w-3.5 h-3.5" /> Réessayer
          </button>
        </div>
      )}

      {loading && <p className="text-xs text-slate-500 text-center py-8">Chargement...</p>}

      {!loading && filtered.length === 0 && !error && (
        <div className="premium-glass-card rounded-2xl p-8 text-center">
          <p className="text-sm text-slate-300 font-bold">
            {isVendor ? "Aucun vendeur de pièces trouvé" : "Aucun mécanicien trouvé"}
          </p>
          <p className="text-xs text-slate-500 mt-1.5">
            {search.trim()
              ? "Essayez une autre ville ou un autre quartier."
              : "Le réseau de partenaires est en cours de constitution. Revenez bientôt."}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((m) => (
          <div key={m.id} className="premium-glass-card rounded-2xl p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-bold text-sm text-white truncate">{m.garageName || m.name}</h3>
                {m.garageName && <p className="text-[11px] text-slate-400 truncate">{m.name}</p>}
              </div>
              {m.certified && (
                <span className="shrink-0 inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-1">
                  <ShieldCheck className="w-3 h-3" /> {isVendor ? "Vérifié" : "Agréé"}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] text-slate-300 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                {m.area ? `${m.area}, ${m.city}` : m.city}
              </p>
              {!isVendor && m.hasScanner && (
                <p className="text-[11px] text-sky-400 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 shrink-0" /> Équipé d'une valise de diagnostic
                </p>
              )}
              {m.specialties && (
                <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
                  {isVendor ? (
                    <Package className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                  ) : (
                    <Wrench className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <span>{m.specialties}</span>
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <a
                href={`tel:${m.phone}`}
                className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-white/[0.08] text-white text-[11px] font-bold py-2.5 rounded-xl transition cursor-pointer"
              >
                <Phone className="w-3.5 h-3.5" /> Appeler
              </a>
              <a
                href={`https://wa.me/${toWaMeNumber(m.phone)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold py-2.5 rounded-xl transition cursor-pointer"
              >
                <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
