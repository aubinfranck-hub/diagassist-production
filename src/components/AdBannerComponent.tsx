import React, { useEffect, useState } from "react";
import { X, ExternalLink, Tag, Sparkles } from "lucide-react";
import { Ad, AdSessionState, Diagnosis, SubscriptionPlan } from "../types";
import { globalAdManager } from "../services/adManager";

interface AdBannerComponentProps {
  sessionState: AdSessionState;
  diagnosis?: Diagnosis | null;
  userPlan?: SubscriptionPlan;
  className?: string;
}

export default function AdBannerComponent({
  sessionState,
  diagnosis,
  userPlan,
  className = "",
}: AdBannerComponentProps) {
  const [currentAd, setCurrentAd] = useState<Ad | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Try to retrieve a contextual banner ad
    const ad = globalAdManager.getContextualAd(sessionState, "BANNER", diagnosis, userPlan);

    if (ad) {
      setCurrentAd(ad);
      setIsVisible(true);
      globalAdManager.registerImpression(ad);
    } else {
      setIsVisible(false);
    }
  }, [sessionState, diagnosis, userPlan]);

  if (!isVisible || !currentAd) {
    return null;
  }

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsVisible(false);
    if (currentAd) {
      globalAdManager.registerClose(currentAd);
    }
  };

  const handleClick = () => {
    if (currentAd) {
      globalAdManager.registerClick(currentAd);
    }
  };

  return (
    <div
      className={`bg-slate-900/95 border border-amber-500/30 rounded-xl p-3 shadow-xl backdrop-blur text-slate-100 transition-all duration-300 animate-fade-in relative ${className}`}
      style={{ zIndex: 10 }}
    >
      <div className="flex items-center justify-between gap-3">
        {/* Left: Image / Icon */}
        {currentAd.imageUrl ? (
          <img
            src={currentAd.imageUrl}
            alt={currentAd.title}
            className="w-12 h-12 rounded-lg object-cover border border-slate-700 shrink-0"
          />
        ) : (
          <div className="w-11 h-11 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Tag className="w-5 h-5 text-amber-400" />
          </div>
        )}

        {/* Center: Text & Title */}
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[9px] font-mono font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.2 rounded tracking-wider shrink-0">
              {currentAd.badgeText || "SPONSORED"}
            </span>
            <span className="text-[10px] text-slate-400 font-medium truncate">
              {currentAd.advertiserName}
            </span>
          </div>
          <h4 className="text-xs font-bold text-white leading-tight truncate">
            {currentAd.title}
          </h4>
          <p className="text-[10px] text-slate-300 leading-normal line-clamp-1">
            {currentAd.description}
          </p>
        </div>

        {/* Right: CTA Button & Close Button */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleClick}
            className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-[11px] px-2.5 py-1.5 rounded-lg transition duration-150 flex items-center gap-1 shadow cursor-pointer whitespace-nowrap"
          >
            <span>{currentAd.callToAction || "Voir"}</span>
            <ExternalLink className="w-3 h-3" />
          </button>

          <button
            onClick={handleClose}
            title="Fermer la publicité"
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
