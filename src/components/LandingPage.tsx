import React from "react";
import {
  Wrench, Camera, Mic, MessageCircle, ShieldCheck, Zap, Check,
  Smartphone, Clock, Sparkles, ArrowRight, MapPin, Phone
} from "lucide-react";

interface LandingPageProps {
  onGetStarted: () => void;
}

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans overflow-x-hidden">
      {/* Header */}
      <header className="w-full max-w-6xl mx-auto px-5 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-red-600 to-red-800 rounded-xl flex items-center justify-center text-xl shadow-lg shadow-red-600/20">
            ⚙️
          </div>
          <span className="font-display font-black text-lg uppercase tracking-tight">DiagAssist</span>
        </div>
        <button
          onClick={onGetStarted}
          className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider px-5 py-2.5 rounded-xl transition cursor-pointer"
        >
          Se connecter
        </button>
      </header>

      {/* Hero */}
      <main className="w-full max-w-6xl mx-auto px-5 pt-10 pb-20 text-center relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-red-600/[0.06] rounded-full blur-3xl pointer-events-none" />

        <span className="inline-block bg-red-600/10 border border-red-500/20 text-red-400 text-[11px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-full mb-6">
          Assistant IA pour mécaniciens en Côte d'Ivoire
        </span>

        <h1 className="text-3xl md:text-5xl font-display font-black leading-tight max-w-3xl mx-auto">
          Le diagnostic auto <span className="text-red-500">assisté par IA</span>, pensé pour l'atelier
        </h1>

        <p className="text-slate-400 text-sm md:text-base max-w-xl mx-auto mt-5 leading-relaxed">
          Décrivez la panne, joignez une photo ou un son du moteur, et obtenez un diagnostic guidé étape par étape — jusqu'à la confirmation de la réparation.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
          <button
            onClick={onGetStarted}
            className="flex items-center gap-2 bg-gradient-to-r from-red-600 to-red-750 hover:from-red-700 hover:to-red-800 text-white font-black text-sm uppercase tracking-wider px-7 py-4 rounded-2xl transition cursor-pointer shadow-lg shadow-red-600/20"
          >
            Commencer maintenant <ArrowRight className="w-4 h-4" />
          </button>
          <a
            href="https://wa.me/2250141116026"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-white/[0.08] text-slate-200 font-bold text-sm px-7 py-4 rounded-2xl transition cursor-pointer"
          >
            <MessageCircle className="w-4 h-4 text-emerald-400" /> Nous contacter sur WhatsApp
          </a>
        </div>
      </main>

      {/* Fonctionnalités */}
      <section className="w-full max-w-6xl mx-auto px-5 py-16 border-t border-white/[0.05]">
        <h2 className="text-xl md:text-2xl font-display font-black text-center mb-10 uppercase tracking-tight">
          Tout ce qu'il faut pour diagnostiquer vite et bien
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            { icon: Camera, title: "Photos & vidéos", desc: "Envoyez une photo du voyant, du moteur, ou de l'écran de la valise OBD — l'IA les analyse directement." },
            { icon: Mic, title: "Assistant vocal live", desc: "Décrivez le bruit du moteur, ou parlez directement à l'IA en mains libres pendant que vous travaillez." },
            { icon: Wrench, title: "Diagnostic guidé", desc: "Contrôles étape par étape, du plus simple au plus poussé, jusqu'à confirmer la vraie cause de la panne." },
            { icon: ShieldCheck, title: "Protocole rigoureux", desc: "Jamais de remplacement de pièce à l'aveugle — chaque hypothèse est vérifiée par un test avant conclusion." },
            { icon: Smartphone, title: "Fonctionne partout", desc: "Sur téléphone, en atelier, même en connexion 3G/4G dégradée." },
            { icon: Clock, title: "Réponse immédiate", desc: "Plus besoin d'attendre — le rapport de diagnostic arrive en quelques secondes." },
          ].map((f, i) => (
            <div key={i} className="bg-slate-900/60 border border-white/[0.06] rounded-2xl p-6 space-y-3">
              <div className="w-11 h-11 bg-red-600/10 text-red-500 rounded-xl flex items-center justify-center">
                <f.icon className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-white">{f.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Comment ça marche */}
      <section className="w-full max-w-4xl mx-auto px-5 py-16 border-t border-white/[0.05]">
        <h2 className="text-xl md:text-2xl font-display font-black text-center mb-10 uppercase tracking-tight">
          Comment ça marche
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { n: "01", title: "Décrivez le symptôme", desc: "Marque, modèle, année, et ce que vous constatez sur le véhicule." },
            { n: "02", title: "Joignez une preuve", desc: "Photo, vidéo ou son — pour un diagnostic plus précis." },
            { n: "03", title: "Suivez le guide", desc: "Contrôles étape par étape jusqu'à la réparation confirmée." },
          ].map((s, i) => (
            <div key={i} className="text-center space-y-2">
              <div className="text-3xl font-black text-red-600/40 font-mono">{s.n}</div>
              <h3 className="font-bold text-sm text-white">{s.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Forfaits */}
      <section className="w-full max-w-6xl mx-auto px-5 py-16 border-t border-white/[0.05]">
        <h2 className="text-xl md:text-2xl font-display font-black text-center mb-10 uppercase tracking-tight">
          Des forfaits simples
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-4xl mx-auto">
          <div className="bg-slate-900/60 border border-white/[0.06] rounded-2xl p-6 space-y-2 text-center">
            <h3 className="font-bold text-sm text-sky-400 uppercase tracking-wide">Essai gratuit</h3>
            <p className="text-2xl font-black text-white">0F</p>
            <p className="text-xs text-slate-400">3 diagnostics offerts pendant 24h</p>
          </div>
          <div className="bg-slate-900/60 border border-sky-500/20 rounded-2xl p-6 space-y-2 text-center">
            <h3 className="font-bold text-sm text-sky-400 uppercase tracking-wide">Lite</h3>
            <p className="text-2xl font-black text-white">6 000F<span className="text-xs text-slate-500">/mois</span></p>
            <p className="text-xs text-slate-400">Diagnostics illimités, texte</p>
          </div>
          <div className="bg-slate-900/60 border border-red-500/20 rounded-2xl p-6 space-y-2 text-center relative overflow-hidden">
            <span className="absolute top-2 right-2 text-[9px] bg-red-600 text-white font-bold px-2 py-0.5 rounded-full uppercase">Populaire</span>
            <h3 className="font-bold text-sm text-red-400 uppercase tracking-wide">Premium</h3>
            <p className="text-2xl font-black text-white">15 000F<span className="text-xs text-slate-500">/mois</span></p>
            <p className="text-xs text-slate-400">Illimité + voix + données techniques</p>
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="w-full max-w-4xl mx-auto px-5 py-16 border-t border-white/[0.05] text-center">
        <h2 className="text-xl md:text-2xl font-display font-black mb-4 uppercase tracking-tight">
          Prêt à diagnostiquer plus vite ?
        </h2>
        <p className="text-slate-400 text-sm mb-6">Rejoignez les mécaniciens qui utilisent déjà DiagAssist au quotidien.</p>
        <button
          onClick={onGetStarted}
          className="inline-flex items-center gap-2 bg-gradient-to-r from-red-600 to-red-750 hover:from-red-700 hover:to-red-800 text-white font-black text-sm uppercase tracking-wider px-8 py-4 rounded-2xl transition cursor-pointer shadow-lg shadow-red-600/20"
        >
          <Sparkles className="w-4 h-4" /> Commencer maintenant
        </button>
      </section>

      {/* Footer */}
      <footer className="w-full max-w-6xl mx-auto px-5 py-8 border-t border-white/[0.05] flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5" /> Abidjan, Côte d'Ivoire — NTIC Strategy
        </div>
        <div className="flex items-center gap-2">
          <Phone className="w-3.5 h-3.5" /> 0141116026
        </div>
        <div>© {new Date().getFullYear()} DiagAssist. Tous droits réservés.</div>
      </footer>
    </div>
  );
}
