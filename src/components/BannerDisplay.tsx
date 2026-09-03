import React, { useState, useEffect } from "react";
import { X } from "lucide-react";

interface Banner {
  id: string;
  imageUrl: string;
  linkUrl?: string;
  displayType: "banner" | "floating";
  active: boolean;
}

export default function BannerDisplay() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [dismissedFloating, setDismissedFloating] = useState<Set<string>>(new Set());
  const [dismissedBanner, setDismissedBanner] = useState<Set<string>>(new Set());

  useEffect(() => {
    const token = localStorage.getItem("auth_session_token");
    if (!token) return;
    fetch("/api/banners", {
      headers: { "Authorization": `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setBanners(data.banners);
      })
      .catch(() => {});
  }, []);

  const bannerAds = banners.filter((b) => b.displayType === "banner" && !dismissedBanner.has(b.id));
  const floatingAds = banners.filter((b) => b.displayType === "floating" && !dismissedFloating.has(b.id));

  if (bannerAds.length === 0 && floatingAds.length === 0) return null;

  return (
    <>
      {/* Bannières en haut de page */}
      {bannerAds.map((b) => (
        <div key={b.id} className="relative w-full mb-4 rounded-2xl overflow-hidden border border-white/[0.08] animate-fade-in">
          <button
            onClick={() => setDismissedBanner((prev) => new Set(prev).add(b.id))}
            className="absolute top-2 right-2 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          {b.linkUrl ? (
            <a href={b.linkUrl} target="_blank" rel="noopener noreferrer">
              <img src={b.imageUrl} alt="Publicité" className="w-full h-auto object-cover" />
            </a>
          ) : (
            <img src={b.imageUrl} alt="Publicité" className="w-full h-auto object-cover" />
          )}
        </div>
      ))}

      {/* Images flottantes, se ferment au clic */}
      {floatingAds.map((b, i) => (
        <div
          key={b.id}
          className="fixed z-50 shadow-2xl rounded-2xl overflow-hidden border-2 border-white/20 cursor-pointer animate-fade-in"
          style={{ bottom: `${20 + i * 140}px`, right: "20px", maxWidth: "220px" }}
          onClick={() => {
            setDismissedFloating((prev) => new Set(prev).add(b.id));
            if (b.linkUrl) window.open(b.linkUrl, "_blank");
          }}
        >
          <img src={b.imageUrl} alt="Publicité" className="w-full h-auto block" />
          <div className="absolute top-1.5 right-1.5 bg-black/50 text-white rounded-full p-0.5">
            <X className="w-3 h-3" />
          </div>
        </div>
      ))}
    </>
  );
}
