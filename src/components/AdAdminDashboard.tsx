import React, { useState } from "react";
import {
  Megaphone,
  BarChart2,
  CheckCircle2,
  XCircle,
  Plus,
  Settings,
  Eye,
  MousePointer,
  Percent,
  Power,
  Sliders,
  DollarSign,
  Tag,
  Building,
} from "lucide-react";
import { Ad, AdCampaign, Advertiser } from "../types";
import { globalAdManager } from "../services/adManager";

export default function AdAdminDashboard() {
  const [stats, setStats] = useState(() => globalAdManager.getStats());
  const [config, setConfig] = useState(() => globalAdManager.getConfig());
  const [ads, setAds] = useState<Ad[]>(() => globalAdManager.getAds());
  const [campaigns] = useState<AdCampaign[]>(() => globalAdManager.getCampaigns());
  const [advertisers] = useState<Advertiser[]>(() => globalAdManager.getAdvertisers());

  // Form for creating new ad
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAdTitle, setNewAdTitle] = useState("");
  const [newAdDesc, setNewAdDesc] = useState("");
  const [newAdAdvertiser, setNewAdAdvertiser] = useState("ThinkCar CI");
  const [newAdPrice, setNewAdPrice] = useState("45 000 FCFA");
  const [newAdCta, setNewAdCta] = useState("Voir l'offre");
  const [newAdUrl, setNewAdUrl] = useState("https://wa.me/22500000000");

  const refreshState = () => {
    setStats(globalAdManager.getStats());
    setConfig(globalAdManager.getConfig());
    setAds(globalAdManager.getAds());
  };

  const handleToggleGlobal = () => {
    globalAdManager.updateConfig({ enabled: !config.enabled });
    refreshState();
  };

  const handleToggleBanner = () => {
    globalAdManager.updateConfig({ allowBanner: !config.allowBanner });
    refreshState();
  };

  const handleToggleFullscreen = () => {
    globalAdManager.updateConfig({ allowFullscreen: !config.allowFullscreen });
    refreshState();
  };

  const handleToggleSponsored = () => {
    globalAdManager.updateConfig({
      allowSponsoredContent: !config.allowSponsoredContent,
    });
    refreshState();
  };

  const handleToggleAdActive = (adId: string) => {
    globalAdManager.toggleAdActive(adId);
    refreshState();
  };

  const handleCreateAd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdTitle.trim()) return;

    const newAdObj: Ad = {
      id: `AD-${Date.now().toString().slice(-4)}`,
      campaignId: "CMP-101",
      advertiserId: "ADV-001",
      advertiserName: newAdAdvertiser,
      type: "BANNER",
      title: newAdTitle,
      description: newAdDesc,
      priceTag: newAdPrice,
      callToAction: newAdCta,
      targetUrl: newAdUrl,
      categories: ["scanner", "general", "diagnostic"],
      active: true,
      badgeText: "SPONSORED",
    };

    globalAdManager.addAd(newAdObj);
    setShowAddModal(false);
    setNewAdTitle("");
    setNewAdDesc("");
    refreshState();
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl">
            <Megaphone className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-display font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span>Gestionnaire Pubs & Partenaires (AdManager)</span>
              <span
                className={`text-[9px] font-mono px-2 py-0.5 rounded font-bold uppercase border ${
                  config.enabled
                    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                    : "bg-rose-500/15 border-rose-500/30 text-rose-400"
                }`}
              >
                {config.enabled ? "SST ACTIF" : "SST DÉSACTIVÉ"}
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Supervision des bannières, produits sponsorisés et régie publicitaire sans perturbation du diagnostic.
            </p>
          </div>
        </div>

        <button
          onClick={handleToggleGlobal}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-md ${
            config.enabled
              ? "bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30"
              : "bg-emerald-600 hover:bg-emerald-500 text-white"
          }`}
        >
          <Power className="w-4 h-4" />
          <span>{config.enabled ? "Désactiver la régie" : "Activer la régie"}</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-500 text-[10px] font-mono uppercase">
            <span>Impressions</span>
            <Eye className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-2xl font-mono font-bold text-white mt-1">
            {stats.impressions}
          </div>
          <span className="text-[10px] text-slate-500">Affichages réussis</span>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-500 text-[10px] font-mono uppercase">
            <span>Clics Utilisateurs</span>
            <MousePointer className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-2xl font-mono font-bold text-emerald-400 mt-1">
            {stats.clicks}
          </div>
          <span className="text-[10px] text-slate-500">Redirections partenaires</span>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-500 text-[10px] font-mono uppercase">
            <span>Taux de Clic (CTR)</span>
            <Percent className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="text-2xl font-mono font-bold text-sky-400 mt-1">
            {stats.ctr} %
          </div>
          <span className="text-[10px] text-slate-500">Performance globale</span>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-500 text-[10px] font-mono uppercase">
            <span>Campagnes Actives</span>
            <Tag className="w-3.5 h-3.5 text-red-500" />
          </div>
          <div className="text-2xl font-mono font-bold text-white mt-1">
            {stats.activeCampaignsCount}
          </div>
          <span className="text-[10px] text-slate-500">{stats.activeAdsCount} annonces en rotation</span>
        </div>
      </div>

      {/* Controls & Rules */}
      <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 space-y-3">
        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-amber-400" />
          Règles de Fréquence & Formats Autorisés
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          <button
            onClick={handleToggleBanner}
            className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between transition cursor-pointer ${
              config.allowBanner
                ? "bg-slate-900 border-amber-500/40 text-amber-300"
                : "bg-slate-950/50 border-slate-800 text-slate-500"
            }`}
          >
            <span>Bannières discrètes (Live)</span>
            {config.allowBanner ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-slate-600" />
            )}
          </button>

          <button
            onClick={handleToggleFullscreen}
            className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between transition cursor-pointer ${
              config.allowFullscreen
                ? "bg-slate-900 border-amber-500/40 text-amber-300"
                : "bg-slate-950/50 border-slate-800 text-slate-500"
            }`}
          >
            <span>Plein écran (Pre-session)</span>
            {config.allowFullscreen ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-slate-600" />
            )}
          </button>

          <button
            onClick={handleToggleSponsored}
            className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between transition cursor-pointer ${
              config.allowSponsoredContent
                ? "bg-slate-900 border-amber-500/40 text-amber-300"
                : "bg-slate-950/50 border-slate-800 text-slate-500"
            }`}
          >
            <span>Produits Recommandés (Rapport)</span>
            {config.allowSponsoredContent ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-slate-600" />
            )}
          </button>
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center text-[11px] text-slate-400 pt-2 border-t border-slate-850 gap-2">
          <div>
            Max ads par session : <strong className="text-white">{config.maxAdsPerSession}</strong> · Intervalle minimum : <strong className="text-white">{config.minIntervalBetweenAds / 1000}s</strong>
          </div>
          <div className="text-emerald-400 font-medium">
            ✓ Garantie absolue : 0 impact sur l'analyse Live, le micro ou la caméra.
          </div>
        </div>
      </div>

      {/* Ads Catalog List */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Building className="w-3.5 h-3.5 text-amber-400" />
            <span>Annonces & Offres en Rotation ({ads.length})</span>
          </h4>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] rounded-xl transition flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Ajouter une publicité</span>
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
          <table className="w-full text-left border-collapse text-[11px]">
            <thead>
              <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 font-mono">
                <th className="p-3">Statut</th>
                <th className="p-3">Annonceur</th>
                <th className="p-3">Titre de l'Offre</th>
                <th className="p-3">Type</th>
                <th className="p-3">Prix / CTA</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {ads.map((ad) => (
                <tr key={ad.id} className="hover:bg-slate-900/40">
                  <td className="p-3">
                    <button
                      onClick={() => handleToggleAdActive(ad.id)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold cursor-pointer ${
                        ad.active
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : "bg-slate-800 text-slate-500 border border-slate-700"
                      }`}
                    >
                      {ad.active ? "ACTIF" : "INACTIF"}
                    </button>
                  </td>
                  <td className="p-3 font-semibold text-amber-300">{ad.advertiserName}</td>
                  <td className="p-3 text-white font-medium">{ad.title}</td>
                  <td className="p-3 font-mono text-slate-400">{ad.type}</td>
                  <td className="p-3 text-emerald-400 font-mono">{ad.priceTag || ad.callToAction}</td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => handleToggleAdActive(ad.id)}
                      className="text-slate-400 hover:text-white underline text-[10px] cursor-pointer"
                    >
                      {ad.active ? "Masquer" : "Activer"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal for adding ad */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Créer une nouvelle campagne publicitaire
            </h3>

            <form onSubmit={handleCreateAd} className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">
                  Annonceur / Partenaire
                </label>
                <input
                  type="text"
                  value={newAdAdvertiser}
                  onChange={(e) => setNewAdAdvertiser(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">
                  Titre de l'annonce
                </label>
                <input
                  type="text"
                  placeholder="ex: Valise Diagnostic OBD2"
                  value={newAdTitle}
                  onChange={(e) => setNewAdTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">
                  Description courte
                </label>
                <input
                  type="text"
                  placeholder="ex: Promo sur la gamme scanner pro"
                  value={newAdDesc}
                  onChange={(e) => setNewAdDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">
                    Prix (Optionnel)
                  </label>
                  <input
                    type="text"
                    value={newAdPrice}
                    onChange={(e) => setNewAdPrice(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">
                    Bouton CTA
                  </label>
                  <input
                    type="text"
                    value={newAdCta}
                    onChange={(e) => setNewAdCta(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">
                  URL de redirection (WhatsApp ou Web)
                </label>
                <input
                  type="text"
                  value={newAdUrl}
                  onChange={(e) => setNewAdUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                  required
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs py-2.5 rounded-xl cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs py-2.5 rounded-xl cursor-pointer"
                >
                  Enregistrer l'annonce
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
