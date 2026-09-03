import React, { useEffect, useState } from "react";
import { ShoppingBag, ExternalLink, ShieldCheck, Tag } from "lucide-react";
import { Ad, Diagnosis, SubscriptionPlan } from "../types";
import { globalAdManager } from "../services/adManager";

interface AdRecommendedProductsComponentProps {
  diagnosis: Diagnosis;
  userPlan?: SubscriptionPlan;
}

export default function AdRecommendedProductsComponent({
  diagnosis,
  userPlan,
}: AdRecommendedProductsComponentProps) {
  const [recommendedAd, setRecommendedAd] = useState<Ad | null>(null);

  useEffect(() => {
    // Look for recommended or sponsored products matching the diagnosis
    let ad = globalAdManager.getContextualAd("completed", "RECOMMENDED_PRODUCT", diagnosis, userPlan);
    if (!ad) {
      ad = globalAdManager.getContextualAd("completed", "SPONSORED_PRODUCT", diagnosis, userPlan);
    }

    if (ad) {
      setRecommendedAd(ad);
      globalAdManager.registerImpression(ad);
    } else {
      setRecommendedAd(null);
    }
  }, [diagnosis, userPlan]);

  if (!recommendedAd) {
    return null;
  }

  const handleClick = () => {
    if (recommendedAd) {
      globalAdManager.registerClick(recommendedAd);
    }
  };

  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-amber-500/30 rounded-2xl p-4 shadow-lg space-y-3 my-4">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-amber-500/10 text-amber-400 rounded-lg">
            <ShoppingBag className="w-4 h-4" />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
            PRODUIT / OUTILLAGE RECOMMANDÉ POUR CETTE RÉPARATION
          </span>
        </div>
        <span className="text-[9px] font-mono uppercase bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">
          SPONSORISÉ
        </span>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4">
        {recommendedAd.imageUrl && (
          <img
            src={recommendedAd.imageUrl}
            alt={recommendedAd.title}
            className="w-full sm:w-28 h-24 rounded-xl object-cover border border-slate-800 shrink-0"
          />
        )}

        <div className="flex-1 space-y-1 text-left">
          <div className="text-[10px] text-slate-400 font-semibold">{recommendedAd.advertiserName}</div>
          <h4 className="text-sm font-bold text-white">{recommendedAd.title}</h4>
          <p className="text-xs text-slate-300 leading-relaxed">{recommendedAd.description}</p>

          {recommendedAd.priceTag && (
            <div className="text-sm font-mono font-bold text-emerald-400 pt-0.5">
              Prix estimé : {recommendedAd.priceTag}
            </div>
          )}
        </div>

        <button
          onClick={handleClick}
          className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs px-4 py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 shrink-0 cursor-pointer shadow-md"
        >
          <span>{recommendedAd.callToAction || "Découvrir"}</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
