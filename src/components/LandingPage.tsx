import React, { useEffect, useState } from "react";
import {
  Wrench, Camera, Mic, MessageCircle, ShieldCheck, Smartphone, Clock, ArrowRight, MapPin, Phone, Search, ListChecks, FlaskConical, Stethoscope, CheckCircle2, Menu, X, FileSearch, Play, Sun, Moon
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
  const [lightMode, setLightMode] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("diagassist-theme");
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    setLightMode(saved ? saved === "light" : prefersLight);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", lightMode);
    localStorage.setItem("diagassist-theme", lightMode ? "light" : "dark");
  }, [lightMode]);

  return (
    <div className={`min-h-screen font-sans overflow-x-hidden relative diagassist-landing ${lightMode ? "diagassist-light bg-slate-50 text-slate-900" : "bg-slate-950 text-slate-100"}`}>
      {/* Header */}
      <header className={`w-full border-b backdrop-blur-xl relative z-50 ${lightMode ? "bg-white border-slate-200" : "bg-[#020817] border-white/5"}`}>
        <div className="max-w-7xl mx-auto h-[72px] sm:h-[78px] px-3 sm:px-5 lg:px-8 flex items-center gap-2 sm:gap-4">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className={`lg:hidden shrink-0 w-11 h-11 rounded-xl flex items-center justify-center transition cursor-pointer ${lightMode ? "text-slate-800 hover:bg-slate-100" : "text-white hover:bg-white/10"}`}
            aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
          >
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 lg:flex-none overflow-hidden">
            <img src="/icon-logo-512.png" alt="DiagAssist" className="w-9 h-9 sm:w-12 sm:h-12 object-contain shrink-0 drop-shadow-[0_5px_18px_rgba(239,68,68,.18)]" />
            <span className={`font-display font-black text-[18px] sm:text-2xl tracking-tight leading-none whitespace-nowrap ${lightMode ? "text-slate-900" : "text-white"}`}><span>Diag</span><span className="text-red-500">Assist</span></span>
          </div>

          <nav className="hidden lg:flex items-center gap-6 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">
            {NAV_LINKS.map((l) => (
              <a key={l.label} href={l.href} className="hover:text-slate-900 dark:hover:text-white transition">{l.label}</a>
            ))}
            <a href={waLink("Bonjour, je voudrais des informations sur DiagAssist !")} target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 dark:hover:text-white transition">Contact</a>
          </nav>

          <div className="flex items-center gap-2 shrink-0 ml-auto">
          <button
            onClick={() => setLightMode((v) => !v)}
            className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl border flex items-center justify-center transition shrink-0 ${lightMode ? "bg-white border-slate-300 text-slate-700" : "bg-slate-900/70 border-white/15 text-yellow-300"}`}
            aria-label={lightMode ? "Activer le mode nuit" : "Activer le mode jour"}
            title={lightMode ? "Mode nuit" : "Mode jour"}
          >
            {lightMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
          </button>
          <button
            onClick={onGetStarted}
            className="bg-red-600 hover:bg-red-700 text-white text-[10px] sm:text-xs font-bold uppercase tracking-wide px-2.5 sm:px-5 py-3 rounded-xl transition cursor-pointer shrink-0 whitespace-nowrap max-w-[145px] sm:max-w-none overflow-hidden"
          >
            Se connecter
          </button>
        </div>

        {/* Menu mobile déroulant */}
        {menuOpen && (
          <div className={`lg:hidden absolute top-[72px] sm:top-[78px] left-3 right-3 rounded-2xl shadow-2xl overflow-hidden z-[60] border ${lightMode ? "bg-white border-slate-200" : "bg-[#0f172a] border-white/[0.08]"}`}>
            {NAV_LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className={`block px-5 py-3.5 text-sm font-bold transition border-b ${lightMode ? "text-slate-800 hover:bg-slate-100 border-slate-200" : "text-slate-100 hover:bg-white/[0.06] border-white/[0.05]"}`}
              >
                {l.label}
              </a>
            ))}
            <a
              href={waLink("Bonjour, je voudrais des informations sur DiagAssist !")}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className={`block px-5 py-3.5 text-sm font-bold transition ${lightMode ? "text-slate-800 hover:bg-slate-100" : "text-slate-100 hover:bg-white/[0.06]"}`}
            >
              Contact
            </a>
          </div>
        )}
        </div>
      </header>

      {/* Hero — design mobile fidèle à la maquette */}
      <main className="w-full relative">
        <section className="relative overflow-hidden bg-[#020817] min-h-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_35%,rgba(239,68,68,.20),transparent_28%),radial-gradient(circle_at_25%_75%,rgba(30,41,59,.75),transparent_48%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,8,23,.96)_0%,rgba(2,8,23,.86)_42%,rgba(2,8,23,.42)_72%,rgba(2,8,23,.75)_100%)]" />

          <div className="relative max-w-7xl mx-auto px-5 sm:px-7 lg:px-10 pt-3 md:pt-5 pb-8">
            <div className="relative min-h-[650px] md:min-h-[690px]">
              <div className="relative z-20 max-w-[68%] sm:max-w-[62%] md:max-w-2xl pt-0">
                <h1 className="mt-3 text-[2.45rem] sm:text-5xl md:text-6xl lg:text-[4rem] font-display font-black leading-[.98] tracking-tight text-white uppercase">
                  VOTRE VOITURE<br />
                  AFFICHE UN<br />
                  <span className="text-red-500">CODE DÉFAUT ?</span>
                </h1>

                <div className="mt-4 text-[1.35rem] sm:text-3xl md:text-4xl font-display font-black leading-[1.08] uppercase">
                  <span className="text-red-500">DIAGASSIST</span>{" "}
                  <span className="text-white">VOUS GUIDE</span>
                  <span className="text-white"> POUR TROUVER LA PANNE.</span>
                </div>

                <p className="mt-4 text-[15px] sm:text-base md:text-lg leading-relaxed text-slate-300 max-w-xl">
                  Entrez le code défaut affiché par votre scanner OBD ou décrivez le symptôme.
                  DiagAssist vous guide étape par étape pour identifier les contrôles à effectuer.
                </p>
              </div>

              <div className="absolute z-10 right-[-22%] sm:right-[-10%] md:right-[-3%] top-[175px] sm:top-[145px] md:top-[100px] w-[63%] sm:w-[55%] md:w-[48%] lg:w-[47%] pointer-events-none">
                <div className="absolute inset-0 bg-red-600/20 blur-3xl rounded-full scale-75" />
                <img
                  src="/icon-512.png"
                  alt="Assistant DiagAssist"
                  className="relative w-full object-contain drop-shadow-[0_25px_45px_rgba(0,0,0,.7)]"
                />
              </div>

              <div className="absolute z-0 right-[-15%] top-[210px] w-[72%] h-[320px] rounded-[50%] bg-gradient-to-br from-slate-800/65 to-red-950/30 border border-white/5 blur-[1px]" />

              <div className="absolute z-30 left-0 right-0 bottom-0 rounded-2xl border border-white/15 bg-[#071326]/96 backdrop-blur-xl shadow-2xl overflow-hidden">
                <div className="grid grid-cols-2 md:grid-cols-4">
                  {[
                    { icon: FileSearch, title: "1. CODE DÉFAUT", desc: "Entrez le code ou un symptôme", color: "text-red-400", bg: "bg-red-500" },
                    { icon: Search, title: "2. ANALYSE", desc: "Recherche des informations", color: "text-sky-400", bg: "bg-sky-500" },
                    { icon: Wrench, title: "3. CONTRÔLES", desc: "Tests et vérifications à effectuer", color: "text-emerald-400", bg: "bg-emerald-500" },
                    { icon: CheckCircle2, title: "4. DIAGNOSTIC", desc: "Résultat clair et structuré", color: "text-violet-400", bg: "bg-violet-500" },
                  ].map((step, i) => (
                    <div key={i} className="relative p-4 md:p-6 flex items-center md:items-start gap-3 md:gap-3 md:flex-col">
                      {i < 3 && <div className="hidden md:block absolute right-0 top-8 w-px h-24 bg-white/10" />}
                      <div className={`w-11 h-11 md:w-14 md:h-14 rounded-full ${step.bg} flex items-center justify-center text-white shadow-lg shrink-0`}>
                        <step.icon className="w-5 h-5 md:w-7 md:h-7" />
                      </div>
                      <div>
                        <h3 className={`text-[11px] md:text-base font-black uppercase ${step.color}`}>{step.title}</h3>
                        <p className="text-[10px] md:text-sm text-slate-400 mt-1 leading-snug">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="relative z-40 flex flex-col sm:flex-row gap-3 justify-center mt-5">
              <button
                onClick={onGetStarted}
                className="flex-1 sm:flex-none sm:min-w-[330px] flex items-center justify-center gap-3 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-black text-base md:text-lg uppercase px-8 py-4 rounded-2xl shadow-[0_10px_35px_rgba(239,68,68,.28)] transition"
              >
                <span className="text-xl">🤖</span> Essayer DiagAssist <ArrowRight className="w-5 h-5" />
              </button>
              <a href="#comment-ca-marche" className="flex-1 sm:flex-none sm:min-w-[300px] flex items-center justify-center gap-3 border border-slate-500 bg-slate-900/70 hover:bg-slate-800 text-white font-black text-sm md:text-base uppercase px-8 py-4 rounded-2xl transition">
                <Play className="w-5 h-5 fill-white" /> Voir comment ça marche
              </a>
            </div>

            <div className="flex items-center gap-4 max-w-xl mx-auto my-5 text-slate-500 text-xs uppercase font-bold">
              <div className="h-px bg-slate-700 flex-1" /> OU <div className="h-px bg-slate-700 flex-1" />
            </div>

            <a
              href={waLink("Bonjour, je voudrais des informations sur DiagAssist !")}
              target="_blank"
              rel="noopener noreferrer"
              className="relative z-40 flex items-center justify-center gap-3 max-w-2xl mx-auto border border-emerald-400/90 bg-emerald-500/5 hover:bg-emerald-500/10 text-white font-black text-sm md:text-base px-7 py-4 rounded-2xl transition"
            >
              <MessageCircle className="w-6 h-6 text-emerald-400" /> Contactez-nous sur WhatsApp
            </a>

            <div className="grid grid-cols-3 gap-3 max-w-3xl mx-auto mt-7 pt-5 border-t border-white/10">
              <div className="text-center"><FileSearch className="w-6 h-6 mx-auto text-red-500" /><p className="text-xs md:text-sm text-slate-300 mt-2">Codes défauts<br/>de toutes marques</p></div>
              <div className="text-center border-x border-white/10"><Wrench className="w-6 h-6 mx-auto text-white" /><p className="text-xs md:text-sm text-slate-300 mt-2">Guides de diagnostic<br/>étape par étape</p></div>
              <div className="text-center"><ShieldCheck className="w-6 h-6 mx-auto text-white" /><p className="text-xs md:text-sm text-slate-300 mt-2">Conçu pour<br/>les mécaniciens</p></div>
            </div>
          </div>
        </section>
      </main>

      {/* Le problème */}
      <section className="w-full bg-[#06101f] border-t border-white/5">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-14 md:py-20">
          <div className="grid md:grid-cols-2 gap-8 md:gap-12 items-center">
            <div className="rounded-3xl overflow-hidden border border-white/10 shadow-2xl bg-slate-900">
              <img src="/preview/preview-report.png" alt="Diagnostic DiagAssist" className="w-full h-[260px] md:h-[340px] object-cover object-top" />
            </div>
            <div>
              <div className="flex items-center gap-3 text-red-500 text-xs font-black uppercase tracking-widest">
                <span className="w-10 h-1 bg-red-500 rounded-full" /> Le problème
              </div>
              <h2 className="mt-4 text-3xl md:text-5xl font-display font-black uppercase leading-tight text-white">
                Un code défaut<br/>sur votre voiture ?
              </h2>
              <p className="mt-5 text-slate-300 text-base md:text-lg leading-relaxed">
                DiagAssist vous aide à comprendre la cause du défaut et à savoir quoi contrôler,
                avant de remplacer une pièce.
              </p>
            </div>
          </div>
        </div>
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
