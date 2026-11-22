import React, { useEffect, useState } from "react";

type LocalAdData = { id: string; advertiser: string; imageUrl: string; goUrl: string };

// Publicité locale discrète (commerce partenaire). N'affiche rien s'il n'y a pas d'annonce.
// À réserver aux pages publiques : jamais dans le diagnostic, le live ni les écrans d'urgence.
export default function LocalAd({ slot }: { slot: string }) {
  const [ad, setAd] = useState<LocalAdData | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/pub/ads?slot=${encodeURIComponent(slot)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (alive && d?.ad) setAd(d.ad); })
      .catch(() => {});
    return () => { alive = false; };
  }, [slot]);
  if (!ad) return null;
  return (
    <div className="w-full max-w-3xl mx-auto px-5 py-6">
      <a href={ad.goUrl} target="_blank" rel="sponsored noopener noreferrer" aria-label={`Publicité : ${ad.advertiser}`}
        className="relative block rounded-2xl overflow-hidden border border-white/10 bg-slate-900">
        <span className="absolute top-2 left-2 z-10 text-[10px] uppercase tracking-wider text-slate-300 bg-slate-950/75 px-2 py-0.5 rounded-full">Publicité</span>
        <img src={ad.imageUrl} alt={ad.advertiser} loading="lazy" className="block w-full max-h-40 object-cover" />
      </a>
    </div>
  );
}
