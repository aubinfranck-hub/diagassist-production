import React, { useState } from "react";
import {
  Wrench, Camera, Mic, MessageCircle, ShieldCheck, Smartphone, Clock, ArrowRight, MapPin, Phone, Search, ListChecks, FlaskConical, Stethoscope, CheckCircle2, Menu, X, FileSearch, Play
} from "lucide-react";

interface LandingPageProps {
  onGetStarted: () => void;
}

const WHATSAPP_NUMBER = "2250707312797";
const waLink = (message: string) => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

const NAV_LINKS = [
  { href: "#comment-ca-marche", label: "Comment ça marche" },
  { href: "#fonctionnalites", label: "Fonctionnalités" },
  { href: "#tarifs", label: "Tarifs" },
  { href: "/blog/", label: "Blog" },
];

const METHOD_STEPS = [
  { icon: Search, title: "Historique & symptôme", desc: "DiagAssist vérifie d'abord si la panne s'est déjà produite sur ce véhicule et confirme le symptôme exact." },
  { icon: ListChecks, title: "Inspection visuelle", desc: "Avant tout outil : fils, connecteurs, durites, niveaux — les causes évidentes d'abord." },
  { icon: Stethoscope, title: "Codes & données figées", desc: "Le code défaut est interprété avec les données figées au moment de la panne, pas seul." },
  { icon: FlaskConical, title: "Test guidé", desc: "Protocole de vérification précis : quel outil, quel emplacement, quelle valeur de référence attendre." },
  { icon: Wrench, title: "Réparation", desc: "Une fois la cause confirmée par le test — pas avant — le geste de réparation à effectuer." },
  { icon: CheckCircle2, title: "Vérification post-réparation", desc: "Contrôle final pour confirmer que la panne est bien résolue avant de rendre le véhicule." },
];

const MOBILE_STEPS = [
  { icon: FileSearch, label: "Code défaut", color: "bg-red-600" },
  { icon: Search, label: "Analyse", color: "bg-sky-600" },
  { icon: Wrench, label: "Contrôles", color: "bg-emerald-600" },
  { icon: CheckCircle2, label: "Diagnostic", color: "bg-violet-600" },
];

const TRUST_BADGES = [
  { icon: FileSearch, label: "Codes défauts de toutes marques" },
  { icon: ListChecks, label: "Protocole de test étape par étape" },
  { icon: Wrench, label: "Conçu avec des mécaniciens" },
];

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans overflow-x-hidden relative">
      {/* Header */}
      <header className="w-full max-w-6xl mx-auto px-5 py-5 flex items-center justify-between gap-4 relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="lg:hidden shrink-0 w-9 h-9 flex items-center justify-center text-[#e2e8f0] hover:text-white transition cursor-pointer"
          aria-label="Ouvrir le menu"
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-lg shadow-red-600/20 overflow-hidden">
            <img src="/icon-logo-192.png" alt="DiagAssist" className="w-full h-full object-cover" />
          </div>
          <span className="hidden sm:block font-display font-black text-lg uppercase tracking-tight leading-none">DiagAssist</span>
        </div>

        <nav className="hidden lg:flex items-center gap-6 text-xs font-bold uppercase tracking-wide text-[#94a3b8] whitespace-nowrap">
          {NAV_LINKS.map((l) => (
            <a key={l.label} href={l.href} className="hover:text-[#f8fafc] transition">{l.label}</a>
          ))}
          <a href={waLink("Bonjour, je voudrais des informations sur DiagAssist !")} target="_blank" rel="noopener noreferrer" className="hover:text-[#f8fafc] transition">Contact</a>
        </nav>

        <button
          onClick={onGetStarted}
          className="bg-red-600 hover:bg-red-700 text-white text-[11px] sm:text-xs font-bold uppercase tracking-wider px-3.5 sm:px-5 py-2.5 rounded-xl transition cursor-pointer shrink-0 whitespace-nowrap"
        >
          Se connecter
        </button>

        {/* Menu mobile déroulant */}
        {menuOpen && (
          <div className="lg:hidden absolute top-full left-0 right-0 mt-2 mx-5 bg-[#0f172a] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden z-50">
            {NAV_LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="block px-5 py-3.5 text-sm font-bold text-[#e2e8f0] hover:bg-white/[0.06] border-b border-white/[0.05] transition"
              >
                {l.label}
              </a>
            ))}
            <a
              href={waLink("Bonjour, je voudrais des informations sur DiagAssist !")}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className="block px-5 py-3.5 text-sm font-bold text-[#e2e8f0] hover:bg-white/[0.06] transition"
            >
              Contact
            </a>
          </div>
        )}
      </header>

      {/* Hero — démonstration concrète du produit : un code DTC entre, un protocole sort */}
      <main className="w-full max-w-6xl mx-auto px-5 pt-8 pb-16 relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-red-600/[0.08] rounded-full blur-3xl pointer-events-none" />

        {/* Hero mobile/tablette : mascotte, parcours en 4 étapes, badges de confiance */}
        <div className="lg:hidden relative bg-gradient-to-br from-slate-900 to-slate-950 border border-white/[0.06] rounded-3xl p-6 overflow-hidden">
          <div className="absolute -top-10 -right-10 w-52 h-52 bg-red-600/[0.12] rounded-full blur-3xl pointer-events-none" />

          <span className="inline-flex items-center gap-1.5 bg-red-600/15 border border-red-500/30 text-red-400 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full relative">
            <Wrench className="w-3 h-3" /> Pour les mécaniciens
          </span>

          <h1 className="text-[#f8fafc] text-3xl font-display font-black leading-tight mt-4 relative">
            VOTRE VOITURE AFFICHE UN CODE DÉFAUT ? <span className="text-red-500">DIAGASSIST VOUS GUIDE POUR TROUVER LA PANNE.</span>
          </h1>
          <p className="text-[#cbd5e1] text-sm mt-3 leading-relaxed relative">
            Entrez le code défaut affiché par votre scanner OBD ou décrivez le symptôme. DiagAssist vous guide
            étape par étape pour identifier les contrôles à effectuer.
          </p>

          <div className="relative flex justify-center my-5">
            <div className="absolute w-44 h-44 bg-red-600/20 rounded-full blur-3xl" />
            <div className="relative w-52 h-52 rounded-[2rem] border border-red-500/20 bg-gradient-to-br from-red-600/10 to-slate-950/80 shadow-2xl shadow-red-900/20 flex items-center justify-center overflow-hidden">
              <img src="/icon-512.png" alt="Assistant DiagAssist" className="w-full h-full object-contain scale-110" />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5 relative">
            {MOBILE_STEPS.map((s, i) => (
              <div key={i} className="flex flex-col items-center text-center gap-1.5">
                <div className={`w-9 h-9 rounded-full ${s.color} flex items-center justify-center shrink-0`}>
                  <s.icon className="w-4 h-4 text-white" />
                </div>
                <span className="text-[9px] font-bold text-[#cbd5e1] leading-tight">{s.label}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 mt-6 relative">
            <button
              onClick={onGetStarted}
              className="flex items-center justify-center gap-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-black text-sm uppercase tracking-wider px-7 py-4 rounded-2xl transition cursor-pointer shadow-lg shadow-red-600/20"
            >
              Essayer DiagAssist <ArrowRight className="w-4 h-4" />
            </button>
            <a
              href="#comment-ca-marche"
              className="flex items-center justify-center gap-2 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.12] text-[#f8fafc] font-bold text-sm px-7 py-4 rounded-2xl transition cursor-pointer"
            >
              <Play className="w-4 h-4" /> Voir comment ça marche
            </a>

            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-white/[0.08]" />
              <span className="text-[10px] text-[#64748b] font-bold uppercase">Ou</span>
              <div className="flex-1 h-px bg-white/[0.08]" />
            </div>

            <a
              href={waLink("Bonjour, je voudrais essayer DiagAssist !")}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30 text-emerald-400 font-bold text-sm px-7 py-4 rounded-2xl transition cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" /> Contactez-nous sur WhatsApp
            </a>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 pt-6 border-t border-white/[0.06] relative">
            {TRUST_BADGES.map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-center sm:flex-col sm:text-center">
                <b.icon className="w-4 h-4 text-red-500 shrink-0" />
                <span className="text-[10px] text-[#94a3b8] font-medium leading-tight">{b.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="hidden lg:grid grid-cols-1 lg:grid-cols-2 gap-10 items-center relative">
          <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-white/[0.06] rounded-3xl p-6 md:p-8">
            <h1 className="text-[#f8fafc] text-3xl md:text-5xl font-display font-black leading-tight">
              VOTRE VOITURE AFFICHE UN CODE DÉFAUT ? <span className="text-red-500">DIAGASSIST VOUS GUIDE POUR TROUVER LA PANNE.</span>
            </h1>
            <p className="text-[#cbd5e1] text-sm md:text-base max-w-xl mt-4 leading-relaxed">
              Votre scanner OBD vous donne un code, mais pas toujours la cause ni l'ordre des contrôles. Entrez le code défaut,
              décrivez le symptôme ou ajoutez une photo. DiagAssist vous guide étape par étape dans le diagnostic.
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
          P0301, P0171, P0420... votre scanner identifie le défaut. Le vrai travail commence ensuite :
          comprendre la cause, choisir les bons contrôles et vérifier avant de remplacer une pièce.
          DiagAssist structure cette démarche avec vous, étape par étape.
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
