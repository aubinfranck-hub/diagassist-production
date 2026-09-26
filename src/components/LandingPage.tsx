import React from "react";
import {
  Wrench, Camera, Mic, MessageCircle, ShieldCheck, Smartphone, Clock, ArrowRight, MapPin, Phone, Search, ListChecks, FlaskConical, Stethoscope, CheckCircle2
} from "lucide-react";

interface LandingPageProps {
  onGetStarted: () => void;
}

const WHATSAPP_NUMBER = "2250707312797";
const waLink = (message: string) => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

const METHOD_STEPS = [
  { icon: Search, title: "Historique & symptôme", desc: "DiagAssist vérifie d'abord si la panne s'est déjà produite sur ce véhicule et confirme le symptôme exact." },
  { icon: ListChecks, title: "Inspection visuelle", desc: "Avant tout outil : fils, connecteurs, durites, niveaux — les causes évidentes d'abord." },
  { icon: Stethoscope, title: "Codes & données figées", desc: "Le code défaut est interprété avec les données figées au moment de la panne, pas seul." },
  { icon: FlaskConical, title: "Test guidé", desc: "Protocole de vérification précis : quel outil, quel emplacement, quelle valeur de référence attendre." },
  { icon: Wrench, title: "Réparation", desc: "Une fois la cause confirmée par le test — pas avant — le geste de réparation à effectuer." },
  { icon: CheckCircle2, title: "Vérification post-réparation", desc: "Contrôle final pour confirmer que la panne est bien résolue avant de rendre le véhicule." },
];

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans overflow-x-hidden relative">
      {/* Header */}
      <header className="w-full max-w-6xl mx-auto px-5 py-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-lg shadow-red-600/20 overflow-hidden">
            <img src="/icon-logo-192.png" alt="DiagAssist" className="w-full h-full object-cover" />
          </div>
          <span className="font-display font-black text-lg uppercase tracking-tight block leading-none">DiagAssist</span>
        </div>
        <nav className="hidden lg:flex items-center gap-6 text-xs font-bold uppercase tracking-wide text-[#94a3b8] whitespace-nowrap">
          <a href="#comment-ca-marche" className="hover:text-[#f8fafc] transition">Comment ça marche</a>
          <a href="#fonctionnalites" className="hover:text-[#f8fafc] transition">Fonctionnalités</a>
          <a href="#tarifs" className="hover:text-[#f8fafc] transition">Tarifs</a>
          <a href="/blog/" className="hover:text-[#f8fafc] transition">Blog</a>
          <a href={waLink("Bonjour, je voudrais des informations sur DiagAssist !")} target="_blank" rel="noopener noreferrer" className="hover:text-[#f8fafc] transition">Contact</a>
        </nav>
        <button
          onClick={onGetStarted}
          className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider px-5 py-2.5 rounded-xl transition cursor-pointer shrink-0"
        >
          Se connecter
        </button>
      </header>

      {/* Hero — démonstration concrète du produit : un code DTC entre, un protocole sort */}
      <main className="w-full max-w-6xl mx-auto px-5 pt-8 pb-16 relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-red-600/[0.08] rounded-full blur-3xl pointer-events-none" />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center relative">
          <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-white/[0.06] rounded-3xl p-6 md:p-8">
            <h1 className="text-[#f8fafc] text-3xl md:text-5xl font-display font-black leading-tight">
              VOTRE VALISE VOUS DONNE UN CODE. <span className="text-red-500">DIAGASSIST VOUS AIDE À TROUVER LA PANNE.</span>
            </h1>
            <p className="text-[#cbd5e1] text-sm md:text-base max-w-xl mt-4 leading-relaxed">
              Un code défaut seul ne dit pas quoi tester ni dans quel ordre. Saisissez le code de votre valise
              (ou décrivez le symptôme) et recevez un protocole de test étape par étape, recoupé avec des sources
              ouvertes réelles — bases de codes DTC, bulletins constructeur, forums techniques reconnus.
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-8">
              <button
                onClick={onGetStarted}
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-black text-sm uppercase tracking-wider px-7 py-4 rounded-2xl transition cursor-pointer shadow-lg shadow-red-600/20"
              >
                Essayer DiagAssist <ArrowRight className="w-4 h-4" />
              </button>
              <a
                href="#comment-ca-marche"
                className="flex items-center justify-center gap-2 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.12] hover:border-white/[0.2] text-[#f8fafc] font-bold text-sm px-7 py-4 rounded-2xl transition cursor-pointer"
              >
                Voir comment ça fonctionne
              </a>
            </div>

            <a
              href={waLink("Bonjour, je voudrais des informations sur DiagAssist !")}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[#94a3b8] hover:text-emerald-400 text-xs font-medium mt-5 transition"
            >
              <MessageCircle className="w-3.5 h-3.5" /> Ou contactez-nous sur WhatsApp
            </a>
          </div>

          {/* Mockup : démo littérale du mécanisme réel (code → protocole), en cadre type navigateur */}
          <div className="relative">
            <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-white/[0.06] rounded-3xl shadow-2xl overflow-hidden">
              <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/[0.06] bg-black/20">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
              </div>
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <button
                    onClick={onGetStarted}
                    className="flex-1 text-left bg-slate-950 hover:bg-slate-900 border border-white/[0.08] rounded-xl px-4 py-3 font-mono text-sm text-slate-300 transition cursor-pointer"
                  >
                    P0301
                  </button>
                  <button
                    onClick={onGetStarted}
                    className="bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase px-4 py-3 rounded-xl transition cursor-pointer"
                  >
                    Analyser
                  </button>
                </div>
                <div className="bg-slate-950/60 border border-white/[0.06] rounded-2xl p-4 space-y-3">
                  <p className="text-xs font-bold text-red-400 uppercase tracking-wide">Raté d'allumage — cylindre 1</p>
                  {[
                    "Vérifier l'historique du véhicule sur ce cylindre",
                    "Inspecter visuellement la bobine et le connecteur",
                    "Tester la résistance de la bobine (valeur de référence)",
                    "Permuter la bobine avec un cylindre sain",
                    "Remplacer la pièce confirmée défectueuse",
                    "Effacer le code et vérifier en conduite",
                  ].map((step, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-xs text-slate-300">
                      <span className="w-4 h-4 rounded-full bg-red-600/15 border border-red-500/30 text-red-400 text-[9px] font-black flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                      {step}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Accent téléphone avec une vraie capture, visible seulement quand il y a la place (pas sur mobile/tablette) */}
            <div className="hidden xl:block absolute -bottom-8 -right-8 w-32 rounded-[1.25rem] border-4 border-slate-800 bg-slate-950 shadow-2xl overflow-hidden rotate-3">
              <img src="/preview/preview-live.png" alt="" className="w-full h-44 object-cover object-top" />
            </div>
          </div>
        </div>
      </main>

      {/* Le problème du mécanicien */}
      <section className="w-full max-w-4xl mx-auto px-5 py-14 border-t border-white/[0.05] text-center">
        <h2 className="text-xl md:text-2xl font-display font-black uppercase tracking-tight mb-4">
          Le code, ce n'est jamais le problème
        </h2>
        <p className="text-sm text-slate-400 leading-relaxed max-w-2xl mx-auto">
          P0301, P0171, P0420... la valise donne le code en une seconde. Le vrai travail commence après :
          quel test faire, dans quel ordre, avec quel outil, pour ne pas changer une pièce à l'aveugle.
          C'est exactement ce que DiagAssist fait avec vous — pas à la place de votre expertise, mais pour
          structurer la démarche et éviter les allers-retours inutiles.
        </p>
      </section>

      {/* Méthodologie réelle */}
      <section id="comment-ca-marche" className="w-full max-w-6xl mx-auto px-5 py-16 border-t border-white/[0.05]">
        <h2 className="text-xl md:text-2xl font-display font-black text-center mb-2 uppercase tracking-tight">
          Comment DiagAssist vous accompagne
        </h2>
        <p className="text-center text-slate-500 text-xs mb-10">La même méthodologie que suit le moteur de diagnostic, à chaque code traité</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {METHOD_STEPS.map((s, i) => (
            <div key={i} className="bg-slate-900/60 border border-white/[0.06] rounded-2xl p-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-red-600/10 text-red-500 rounded-xl flex items-center justify-center shrink-0">
                  <s.icon className="w-4 h-4" />
                </div>
                <span className="text-[10px] font-black text-slate-600 font-mono">0{i + 1}</span>
              </div>
              <h3 className="font-bold text-sm text-white">{s.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Captures d'écran réelles */}
      <section className="w-full max-w-6xl mx-auto px-5 py-16 border-t border-white/[0.05]">
        <h2 className="text-xl md:text-2xl font-display font-black text-center mb-10 uppercase tracking-tight">
          Voyez DiagAssist en action
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-slate-900/60 border border-white/[0.06] rounded-2xl overflow-hidden">
            <img src="/preview/preview-report.png" alt="Rapport de diagnostic DiagAssist" className="w-full h-48 object-cover object-top" />
            <div className="p-4">
              <h3 className="font-bold text-sm text-white">Rapport de diagnostic</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">Causes probables classées, protocole de test, guide de réparation et chiffrage.</p>
            </div>
          </div>
          <div className="bg-slate-900/60 border border-white/[0.06] rounded-2xl overflow-hidden">
            <img src="/preview/preview-chat.png" alt="Chat de suivi DiagAssist" className="w-full h-48 object-cover object-top" />
            <div className="p-4">
              <h3 className="font-bold text-sm text-white">Chat de suivi</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">Posez vos questions par écrit sur la panne en cours, avec photos à l'appui.</p>
            </div>
          </div>
          <div className="bg-slate-900/60 border border-white/[0.06] rounded-2xl overflow-hidden">
            <img src="/preview/preview-live.png" alt="Copilote vocal en direct DiagAssist" className="w-full h-48 object-cover object-top" />
            <div className="p-4">
              <h3 className="font-bold text-sm text-white">Copilote vocal en direct</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">Parlez à DiagAssist mains libres pendant l'intervention, comme un collègue au téléphone.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Fonctionnalités, condensé */}
      <section id="fonctionnalites" className="w-full max-w-6xl mx-auto px-5 py-16 border-t border-white/[0.05]">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          {[
            { icon: Camera, title: "Photo & son", desc: "Voyant, moteur, écran de valise : envoyez une preuve, DiagAssist l'analyse." },
            { icon: Mic, title: "Assistant vocal live", desc: "Parlez mains libres pendant que vous travaillez sur le véhicule." },
            { icon: ShieldCheck, title: "Jamais à l'aveugle", desc: "Chaque hypothèse est vérifiée par un test avant conclusion." },
            { icon: Smartphone, title: "Partout, même en 3G", desc: "Sur téléphone, en atelier, même en connexion dégradée." },
          ].map((f, i) => (
            <div key={i} className="bg-slate-900/60 border border-white/[0.06] rounded-2xl p-6 space-y-3">
              <div className="w-10 h-10 bg-red-600/10 text-red-500 rounded-xl flex items-center justify-center">
                <f.icon className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-sm text-white">{f.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Forfaits */}
      <section id="tarifs" className="w-full max-w-6xl mx-auto px-5 py-16 border-t border-white/[0.05]">
        <h2 className="text-xl md:text-2xl font-display font-black text-center mb-2 uppercase tracking-tight">
          NOS OFFRES
        </h2>
        <p className="text-center text-slate-500 text-xs mb-10">Choisissez la formule qui vous convient</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
          <div
            onClick={onGetStarted}
            className="bg-slate-900/80 border-2 border-emerald-500/40 hover:border-emerald-400/70 rounded-2xl p-6 space-y-3 text-center relative overflow-hidden cursor-pointer transition"
          >
            <h3 className="font-bold text-xs text-emerald-400 uppercase tracking-wide">Forfait Jour</h3>
            <p className="text-3xl font-black text-white">500F</p>
            <p className="text-[11px] text-slate-500">Accès illimité 24h</p>
          </div>

          <div
            onClick={onGetStarted}
            className="bg-slate-900/60 border border-white/[0.06] hover:border-sky-500/40 rounded-2xl p-6 space-y-3 text-center cursor-pointer transition"
          >
            <h3 className="font-bold text-xs text-sky-400 uppercase tracking-wide">Essai Gratuit</h3>
            <p className="text-3xl font-black text-white">0F</p>
            <p className="text-[11px] text-slate-500">72h, 1 diagnostic/jour</p>
          </div>

          <div
            onClick={onGetStarted}
            className="bg-slate-900/60 border border-white/[0.06] hover:border-sky-500/40 rounded-2xl p-6 space-y-3 text-center cursor-pointer transition"
          >
            <h3 className="font-bold text-xs text-sky-400 uppercase tracking-wide">Lite</h3>
            <p className="text-3xl font-black text-white">6 000F</p>
            <p className="text-[11px] text-slate-500">Par mois</p>
          </div>

          <div
            onClick={onGetStarted}
            className="bg-slate-900/80 border-2 border-red-500/40 hover:border-red-400/70 rounded-2xl p-6 space-y-3 text-center relative overflow-hidden cursor-pointer transition"
          >
            <span className="absolute top-3 right-3 text-[9px] bg-red-600 text-white font-black px-2 py-0.5 rounded-full uppercase">Populaire</span>
            <h3 className="font-bold text-xs text-red-400 uppercase tracking-wide">Premium</h3>
            <p className="text-3xl font-black text-white">15 000F</p>
            <p className="text-[11px] text-slate-500">Par mois</p>
          </div>
        </div>

        <div className="text-center mt-8">
          <a
            href={waLink("Bonjour, je voudrais m'abonner à DiagAssist !")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-emerald-500 hover:text-emerald-400 font-bold text-sm transition cursor-pointer"
          >
            <MessageCircle className="w-4 h-4" /> Activation immédiate par WhatsApp
          </a>
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
          className="inline-flex items-center gap-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-black text-sm uppercase tracking-wider px-8 py-4 rounded-2xl transition cursor-pointer shadow-lg shadow-red-600/20"
        >
          Essayer DiagAssist <ArrowRight className="w-4 h-4" />
        </button>
      </section>

      {/* Footer */}
      <footer className="w-full max-w-6xl mx-auto px-5 py-8 border-t border-white/[0.05] flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5" /> Abidjan, Côte d'Ivoire — NTIC Strategy
        </div>
        <div className="flex items-center gap-2">
          <Phone className="w-3.5 h-3.5" /> 0707312797
        </div>
        <a href="/blog/" className="hover:text-slate-300 underline">Guides & conseils</a>
        <div>© {new Date().getFullYear()} DiagAssist. Tous droits réservés.</div>
      </footer>
    </div>
  );
}
