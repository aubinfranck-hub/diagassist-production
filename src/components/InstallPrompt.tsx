import React, { useState, useEffect } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("install_prompt_dismissed") === "true");
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Ne rien afficher si déjà installée (mode standalone)
    setIsStandalone(window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem("install_prompt_dismissed", "true");
  };

  if (isStandalone || dismissed || !deferredPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 bg-slate-900 border border-white/[0.08] rounded-2xl p-4 shadow-2xl flex items-center gap-3 animate-fade-in">
      <div className="w-11 h-11 bg-white rounded-xl overflow-hidden shrink-0">
        <img src="/icon-192.png" alt="DiagAssist" className="w-full h-full object-cover" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-white">Installer DiagAssist</p>
        <p className="text-[10px] text-slate-400">Accès rapide depuis votre écran d'accueil, comme une vraie application.</p>
      </div>
      <button
        onClick={handleInstall}
        className="shrink-0 bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold px-3 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5"
      >
        <Download className="w-3.5 h-3.5" /> Installer
      </button>
      <button onClick={handleDismiss} className="shrink-0 text-slate-500 hover:text-slate-300 cursor-pointer" title="Fermer">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
