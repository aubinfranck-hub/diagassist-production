import React, { useEffect, useState } from "react";
import { X, ExternalLink, Sparkles, ShieldCheck, ChevronRight } from "lucide-react";
import { Ad, AdSessionState, Diagnosis, SubscriptionPlan } from "../types";
import { globalAdManager } from "../services/adManager";

interface AdModalComponentProps {
  sessionState: AdSessionState;
  diagnosis?: Diagnosis | null;
  userPlan?: SubscriptionPlan;
  onContinue: () => void;
}

export default function AdModalComponent({
  sessionState,
  diagnosis,
  userPlan,
  onContinue,
}: AdModalComponentProps) {
  const [currentAd, setCurrentAd] = useState<Ad | null>(null);

  useEffect(() => {
    // Retrieve fullscreen or promo ad
    const ad = globalAdManager.getContextualAd(sessionState, "FULLSCREEN", diagnosis, userPlan);
    if (ad) {
      setCurrentAd(ad);
      globalAdManager.registerImpression(ad);
    } else {
      setCurrentAd(null);
    }
  }, [sessionState, diagnosis, userPlan]);

  if (!currentAd) {
    return null;
  }

  const handleClose = () => {
    if (currentAd) {
      globalAdManager.registerClose(currentAd);
    }
    onContinue();
  };

  const handleCtaClick = () => {
    if (currentAd) {
      globalAdManager.registerClick(currentAd);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 text-slate-100 shadow-2xl relative overflow-hidden">
        
        {/* Top bar with SPONSORED badge and Close Button */}
        <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-3">
          <span className="text-[10px] font-mono font-bold uppercase bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded tracking-wider flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            {currentAd.badgeText || "OFFRE SPONSOIRISÉE"}
          </span>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Banner Image */}
        {currentAd.imageUrl && (
          <div className="rounded-2xl overflow-hidden mb-4 border border-slate-800 max-h-48">
            <img
              src={currentAd.imageUrl}
              alt={currentAd.title}
              className="w-full h-48 object-cover"
            />
          </div>
        )}

        {/* Content */}
        <div className="space-y-2 mb-6">
          <div className="text-xs text-amber-400 font-semibold">{currentAd.advertiserName}</div>
          <h3 className="text-lg font-bold text-white leading-tight">{currentAd.title}</h3>
          <p className="text-xs text-slate-300 leading-relaxed">{currentAd.description}</p>
          {currentAd.priceTag && (
            <div className="text-lg font-mono font-black text-emerald-400 pt-1">
              {currentAd.priceTag}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="space-y-2.5">
          <button
            onClick={handleCtaClick}
            className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs uppercase tracking-wider py-3.5 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-lg"
          >
            <span>{currentAd.callToAction || "Voir l'offre"}</span>
            <ExternalLink className="w-4 h-4" />
          </button>

          <button
            onClick={handleClose}
            className="w-full bg-slate-950 hover:bg-slate-800 text-slate-300 font-bold text-xs py-3 rounded-xl border border-slate-800 transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>Continuer vers le Diagnostic</span>
            <ChevronRight className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <p className="text-[10px] text-slate-500 text-center mt-4">
          DiagAssist · Le diagnostic technique automobile reste prioritaire à 100%.
        </p>
      </div>
    </div>
  );
}
