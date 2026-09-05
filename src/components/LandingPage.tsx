import React from "react";
import {
  Wrench, Camera, Mic, MessageCircle, ShieldCheck, Smartphone, Clock, Check, MapPin, Phone
} from "lucide-react";

interface LandingPageProps {
  onGetStarted: () => void;
}

const WHATSAPP_NUMBER = "2250141116026";
const waLink = (message: string) => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

// Bande de signalisation façon atelier, utilisée comme seul motif structurel distinctif de la page
function HazardStripe() {
  return (
    <div
      className="h-2.5 w-full"
      style={{
        backgroundImage: "repeating-linear-gradient(45deg, #f2c14e 0 18px, #171310 18px 36px)",
      }}
    />
  );
}

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans overflow-x-hidden relative">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&display=swap');
        .stencil { font-family: "Oswald", sans-serif; letter-spacing: 0.01em; }
      `}</style>

      {/* Contact WhatsApp, toujours accessible */}
      <a
        href={waLink("Bonjour, je voudrais essayer DiagAssist !")}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-5 right-5 z-50 w-14 h-14 bg-emerald-500 hover:bg-emerald-600 rounded-full flex items-center justify-center shadow-2xl shadow-emerald-500/30 transition hover:scale-105"
        title="Nous écrire sur WhatsApp"
      >
        <MessageCircle className="w-7 h-7 text-white fill-white" />
      </a>

      {/* Header */}
      <header className="w-full max-w-6xl mx-auto px-5 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-red-600 to-red-800 rounded-xl flex items-center justify-center text-xl shadow-lg shadow-red-600/20">
            ⚙️
          </div>
          <span className="stencil font-bold text-lg tracking-tight">DiagAssist</span>
        </div>
        <button
          onClick={onGetStarted}
          className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition cursor-pointer"
        >
          Se connecter
        </button>
      </header>

      {/* Hero — asymétrique, photo qui déborde jusqu'au bord */}
      <main className="w-full max-w-6xl mx-auto px-5 pt-4 pb-0">
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-8 items-center">
          <div>
            <h1 className="stencil text-4xl md:text-6xl font-semibold leading-[1.05]">
              Un diagnostic sûr,
              <br />
              avant de changer la pièce
            </h1>
            <p className="text-slate-400 text-sm md:text-base max-w-md mt-5 leading-relaxed">
              Décrivez le symptôme, joignez une photo ou un enregistrement du moteur. DiagAssist vous guide test après test, jusqu'à confirmer la vraie cause — sans deviner.
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-7">
              <button
                onClick={onGetStarted}
                className="bg-[#f2c14e] hover:bg-[#e6b23f] text-slate-950 font-bold text-sm px-7 py-4 rounded-lg transition cursor-pointer"
              >
                Essayer maintenant
              </button>
              <a
                href={waLink("Bonjour, je voudrais essayer DiagAssist !")}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-transparent border border-white/15 hover:border-white/30 text-slate-200 font-bold text-sm px-7 py-4 rounded-lg transition cursor-pointer"
              >
                <MessageCircle className="w-4 h-4 text-emerald-400" /> Nous écrire sur WhatsApp
              </a>
            </div>

            <p className="text-[11px] text-slate-500 mt-5">
              3 diagnostics gratuits pendant 24h, sans carte bancaire.
            </p>
          </div>

          <div className="relative -mx-5 lg:mx-0">
            <img
              src="https://images.pexels.com/photos/12555014/pexels-photo-12555014.jpeg?w=900&auto=compress&cs=tinysrgb"
              alt="Mécaniciens au travail sur un moteur"
              className="w-full h-64 lg:h-[420px] object-cover lg:rounded-2xl"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/40 to-transparent lg:rounded-2xl" />
          </div>
        </div>
      </main>

      <div className="mt-10">
        <HazardStripe />
      </div>

      {/* Fonctionnalités — présentées comme une fiche d'intervention, pas des cartes identiques */}
      <section className="w-full max-w-3xl mx-auto px-5 py-14">
        <h2 className="stencil text-2xl font-semibold mb-1">Ce que DiagAssist fait pour vous</h2>
        <p className="text-slate-500 text-sm mb-8">Comme une fiche d'intervention, du symptôme à la réparation.</p>

        <div className="divide-y divide-white/[0.07]">
          {[
            { icon: Camera, title: "Lit vos photos et vidéos", desc: "Une photo du voyant, du moteur, ou de l'écran de la valise OBD — l'IA les analyse directement." },
            { icon: Mic, title: "Écoute le moteur", desc: "Décrivez ou enregistrez le bruit suspect ; parlez-lui directement en mains libres pendant le travail." },
            { icon: Wrench, title: "Guide le contrôle, pas la conclusion", desc: "Ordre de vérification du plus simple au plus poussé, jusqu'à confirmer la vraie cause par un test." },
            { icon: ShieldCheck, title: "Ne condamne jamais une pièce à l'aveugle", desc: "Une hypothèse ne devient une cause confirmée qu'après une mesure qui le prouve." },
            { icon: Smartphone, title: "Marche même en réseau faible", desc: "Sur téléphone, en atelier, même en 3G/4G dégradée." },
            { icon: Clock, title: "Répond en quelques secondes", desc: "Le rapport de diagnostic arrive immédiatement, pas après une attente." },
          ].map((f, i) => (
            <div key={i} className="flex gap-4 py-5">
              <div className="w-9 h-9 shrink-0 bg-slate-900 border border-white/10 flex items-center justify-center">
                <f.icon className="w-4 h-4 text-[#f2c14e]" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">{f.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed mt-1">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <HazardStripe />

      {/* Comment ça marche — vraie séquence, numérotation justifiée */}
      <section className="w-full max-w-4xl mx-auto px-5 py-14">
        <h2 className="stencil text-2xl font-semibold text-center mb-10">Le déroulé, en trois temps</h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-10">
          {[
            "https://images.pexels.com/photos/12555015/pexels-photo-12555015.jpeg?w=500&auto=compress&cs=tinysrgb",
            "https://images.pexels.com/photos/12555016/pexels-photo-12555016.jpeg?w=500&auto=compress&cs=tinysrgb",
            "https://images.pexels.com/photos/4315570/pexels-photo-4315570.jpeg?w=500&auto=compress&cs=tinysrgb",
            "https://images.pexels.com/photos/8985461/pexels-photo-8985461.jpeg?w=500&auto=compress&cs=tinysrgb",
          ].map((src, i) => (
            <img key={i} src={src} alt="Mécanicien au travail" className="w-full h-24 md:h-32 object-cover" />
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { n: "1", title: "Décrivez le symptôme", desc: "Marque, modèle, année, et ce que vous constatez sur le véhicule." },
            { n: "2", title: "Joignez une preuve", desc: "Photo, vidéo ou son — pour un diagnostic plus précis." },
            { n: "3", title: "Suivez le guide", desc: "Contrôles étape par étape jusqu'à la réparation confirmée." },
          ].map((s, i) => (
            <div key={i} className="text-center space-y-2">
              <div className="stencil text-3xl font-semibold text-[#f2c14e]">{s.n}</div>
              <h3 className="font-bold text-sm text-white">{s.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <HazardStripe />

      {/* Forfaits */}
      <section className="w-full max-w-6xl mx-auto px-5 py-14">
        <h2 className="stencil text-2xl font-semibold text-center mb-2">Ce que ça coûte</h2>
        <p className="text-center text-slate-500 text-xs mb-10">Choisissez la formule qui vous convient.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
          <div className="bg-slate-900/60 border border-white/10 p-6 space-y-3">
            <h3 className="stencil font-semibold text-sm text-slate-300">Forfait Jour</h3>
            <p className="text-3xl font-bold text-white">500F</p>
            <p className="text-[11px] text-slate-500">Accès illimité 24h</p>
            <ul className="text-left space-y-1.5 pt-2">
              {["Diagnostics illimités 24h", "Activation immédiate", "Sans engagement"].map((t, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-400">
                  <Check className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" /> {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-slate-900/60 border border-white/10 p-6 space-y-3">
            <h3 className="stencil font-semibold text-sm text-slate-300">Essai gratuit</h3>
            <p className="text-3xl font-bold text-white">0F</p>
            <p className="text-[11px] text-slate-500">Pendant 24h</p>
            <ul className="text-left space-y-1.5 pt-2">
              {["3 diagnostics offerts", "Sans carte bancaire", "Activation immédiate"].map((t, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-400">
                  <Check className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" /> {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-slate-900/60 border border-white/10 p-6 space-y-3">
            <h3 className="stencil font-semibold text-sm text-slate-300">Lite</h3>
            <p className="text-3xl font-bold text-white">6 000F</p>
            <p className="text-[11px] text-slate-500">Par mois</p>
            <ul className="text-left space-y-1.5 pt-2">
              {["Diagnostics illimités", "Rapport texte détaillé", "Historique conservé"].map((t, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-400">
                  <Check className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" /> {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Le seul accent fort de la section — c'est la formule qu'on veut mettre en avant */}
          <div className="bg-slate-900 border-2 border-[#f2c14e] p-6 space-y-3">
            <h3 className="stencil font-semibold text-sm text-[#f2c14e]">Premium</h3>
            <p className="text-3xl font-bold text-white">15 000F</p>
            <p className="text-[11px] text-slate-500">Par mois</p>
            <ul className="text-left space-y-1.5 pt-2">
              {["Diagnostics illimités", "Explications vocales IA", "Données techniques Haynes Pro"].map((t, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                  <Check className="w-3 h-3 text-[#f2c14e] shrink-0 mt-0.5" /> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="text-center mt-8">
          <a
            href={waLink("Bonjour, je voudrais m'abonner à DiagAssist !")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-7 py-3.5 rounded-lg transition cursor-pointer"
          >
            <MessageCircle className="w-4 h-4" /> Activer un forfait sur WhatsApp
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full max-w-6xl mx-auto px-5 py-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5" /> Abidjan, Côte d'Ivoire — NTIC Strategy
        </div>
        <div className="flex items-center gap-2">
          <Phone className="w-3.5 h-3.5" /> 0141116026
        </div>
        <div>© {new Date().getFullYear()} DiagAssist</div>
      </footer>
    </div>
  );
}
