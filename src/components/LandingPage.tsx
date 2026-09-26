import React, { useEffect, useState } from "react";
import {
  Wrench, Camera, Mic, MessageCircle, ShieldCheck, Smartphone, Clock, ArrowRight, ArrowUp, MapPin, Phone, Search, ListChecks, FlaskConical, Stethoscope, CheckCircle2, Menu, X, FileSearch, Play, Sun, Moon
} from "lucide-react";

interface LandingPageProps { onGetStarted: () => void; }

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
      <header className={`w-full border-b backdrop-blur-xl relative z-50 ${lightMode ? "bg-white border-slate-200" : "bg-[#020817] border-white/5"}`}>
        <div className="max-w-7xl mx-auto h-[72px] sm:h-[78px] px-1.5 sm:px-5 lg:px-8 flex items-center gap-1.5 sm:gap-4">
          <button onClick={() => setMenuOpen(v => !v)} className={`lg:hidden shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center transition cursor-pointer ${lightMode ? "text-slate-800 hover:bg-slate-100" : "text-white hover:bg-white/10"}`} aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}>
            {menuOpen ? <X className="w-5 h-5 sm:w-6 sm:h-6" /> : <Menu className="w-5 h-5 sm:w-6 sm:h-6" />}
          </button>
          <div className="flex items-center gap-1 sm:gap-2 min-w-0 flex-1 lg:flex-none overflow-hidden">
            <img src="/icon-logo-512.png" alt="DiagAssist" className="w-8 h-8 sm:w-12 sm:h-12 object-contain shrink-0 drop-shadow-[0_5px_18px_rgba(239,68,68,.18)]" />
            <span className={`font-display font-black text-[16px] sm:text-2xl tracking-tight leading-none whitespace-nowrap ${lightMode ? "text-slate-900" : "text-white"}`}><span>Diag</span><span className="text-red-500">Assist</span></span>
          </div>
          <nav className="hidden lg:flex items-center gap-6 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">
            {NAV_LINKS.map(l => <a key={l.label} href={l.href} className="hover:text-slate-900 dark:hover:text-white transition">{l.label}</a>)}
            <a href={waLink("Bonjour, je voudrais des informations sur DiagAssist !")} target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 dark:hover:text-white transition">Contact</a>
          </nav>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
            <button onClick={() => setLightMode(v => !v)} className={`w-9 h-9 sm:w-11 sm:h-11 rounded-xl border flex items-center justify-center transition shrink-0 ${lightMode ? "bg-white border-slate-300 text-slate-700" : "bg-slate-900/70 border-white/15 text-yellow-300"}`} aria-label={lightMode ? "Activer le mode nuit" : "Activer le mode jour"} title={lightMode ? "Mode nuit" : "Mode jour"}>{lightMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}</button>
            <button onClick={onGetStarted} className="bg-red-600 hover:bg-red-700 text-white text-[9px] sm:text-xs font-bold uppercase tracking-wide px-2 sm:px-5 py-3 rounded-xl transition cursor-pointer shrink-0 whitespace-nowrap max-w-[112px] sm:max-w-none overflow-hidden">Se connecter</button>
          </div>
        </div>
        {menuOpen && (
          <div className={`lg:hidden absolute top-[72px] sm:top-[78px] left-3 right-3 rounded-2xl shadow-2xl overflow-hidden z-[60] border ${lightMode ? "bg-white border-slate-200" : "bg-[#0f172a] border-white/[0.08]"}`}>
            {NAV_LINKS.map(l => <a key={l.label} href={l.href} onClick={() => setMenuOpen(false)} className={`block px-5 py-3.5 text-sm font-bold transition border-b ${lightMode ? "text-slate-800 hover:bg-slate-100 border-slate-200" : "text-slate-100 hover:bg-white/[0.06] border-white/[0.05]"}`}>{l.label}</a>)}
            <a href={waLink("Bonjour, je voudrais des informations sur DiagAssist !")} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)} className={`block px-5 py-3.5 text-sm font-bold transition ${lightMode ? "text-slate-800 hover:bg-slate-100" : "text-slate-100 hover:bg-white/[0.06]"}`}>Contact</a>
          </div>
        )}
      </header>

      <main id="top" className="w-full relative">
        <section className="relative overflow-hidden bg-[#020817] min-h-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_35%,rgba(239,68,68,.20),transparent_28%),radial-gradient(circle_at_25%_75%,rgba(30,41,59,.75),transparent_48%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,8,23,.96)_0%,rgba(2,8,23,.86)_42%,rgba(2,8,23,.42)_72%,rgba(2,8,23,.75)_100%)]" />
          <div className="relative max-w-7xl mx-auto px-5 sm:px-7 lg:px-10 pt-3 md:pt-5 pb-8">
            <div className="relative min-h-[555px] sm:min-h-[620px] md:min-h-[690px]">
              <div className="relative z-20 max-w-full sm:max-w-[62%] md:max-w-2xl pt-0">
                <h1 className="mt-2 text-[2.18rem] sm:text-5xl md:text-6xl lg:text-[4rem] font-display font-black leading-[.98] tracking-tight text-white uppercase">VOTRE VOITURE<br />AFFICHE UN<br /><span className="text-red-500">CODE DÉFAUT ?</span></h1>
                <div className="mt-3 text-[1.12rem] sm:text-3xl md:text-4xl font-display font-black leading-[1.08] uppercase"><span className="text-red-500">DIAGASSIST</span>{" "}<span className="text-white">VOUS GUIDE</span><span className="text-white"> POUR TROUVER LA PANNE.</span></div>
                <p className="mt-3 text-[14px] sm:text-base md:text-lg leading-relaxed text-slate-300 max-w-[92%] sm:max-w-xl">Entrez le code défaut affiché par votre scanner OBD ou décrivez le symptôme. DiagAssist vous guide étape par étape pour identifier les contrôles à effectuer.</p>
              </div>
              <div className="absolute z-10 right-[-4%] sm:right-[-10%] md:right-[-3%] top-[305px] sm:top-[320px] md:top-[100px] w-[47%] sm:w-[55%] md:w-[48%] lg:w-[47%] pointer-events-none">
                <div className="absolute inset-0 bg-red-600/20 blur-3xl rounded-full scale-75" />
                <img src="/icon-512.png" alt="Assistant DiagAssist" className="relative w-full object-contain drop-shadow-[0_25px_45px_rgba(0,0,0,.7)]" />
              </div>
              <div className="absolute z-0 right-[-8%] top-[315px] sm:top-[350px] md:top-[210px] w-[62%] sm:w-[72%] h-[220px] sm:h-[320px] rounded-[50%] bg-gradient-to-br from-slate-800/65 to-red-950/30 border border-white/5 blur-[1px]" />
              <div className="absolute z-30 left-0 right-0 bottom-0 rounded-2xl border border-white/15 bg-[#071326]/96 backdrop-blur-xl shadow-2xl overflow-hidden">
                <div className="grid grid-cols-2 md:grid-cols-4">
                  {[
                    { icon: FileSearch, title: "1. CODE DÉFAUT", desc: "Entrez le code ou un symptôme", color: "text-red-400", bg: "bg-red-500" },
                    { icon: Search, title: "2. ANALYSE", desc: "Recherche des informations", color: "text-sky-400", bg: "bg-sky-500" },
                    { icon: Wrench, title: "3. CONTRÔLES", desc: "Tests et vérifications à effectuer", color: "text-emerald-400", bg: "bg-emerald-500" },
                    { icon: CheckCircle2, title: "4. DIAGNOSTIC", desc: "Résultat clair et structuré", color: "text-violet-400", bg: "bg-violet-500" },
                  ].map((step, i) => (
                    <div key={i} className="relative p-3 sm:p-4 md:p-6 flex items-center md:items-start gap-2.5 md:gap-3 md:flex-col">
                      {i < 3 && <div className="hidden md:block absolute right-0 top-8 w-px h-24 bg-white/10" />}
                      <div className={`w-10 h-10 sm:w-11 sm:h-11 md:w-14 md:h-14 rounded-full ${step.bg} flex items-center justify-center text-white shadow-lg shrink-0`}><step.icon className="w-5 h-5 md:w-7 md:h-7" /></div>
                      <div><h3 className={`text-[10px] sm:text-[11px] md:text-base font-black uppercase ${step.color}`}>{step.title}</h3><p className="text-[9px] sm:text-[10px] md:text-sm text-slate-400 mt-1 leading-snug">{step.desc}</p></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="relative z-40 flex flex-col sm:flex-row gap-3 justify-center mt-5">
              <button onClick={onGetStarted} className="flex-1 sm:flex-none sm:min-w-[330px] flex flex-col items-center justify-center gap-0.5 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-black uppercase px-6 py-3.5 rounded-2xl shadow-[0_10px_35px_rgba(239,68,68,.28)] transition">
                <span className="flex items-center justify-center gap-2 text-sm md:text-lg"><span className="text-xl">🤖</span> ESSAYER DIAGASSIST — GRATUIT 72H <ArrowRight className="w-5 h-5 shrink-0" /></span>
                <span className="text-[11px] md:text-xs font-bold normal-case tracking-normal text-red-100">Puis à partir de 500 F</span>
              </button>
              <a href="#comment-ca-marche" className="flex-1 sm:flex-none sm:min-w-[300px] flex items-center justify-center gap-3 border border-slate-500 bg-slate-900/70 hover:bg-slate-800 text-white font-black text-sm md:text-base uppercase px-8 py-4 rounded-2xl transition"><Play className="w-5 h-5 fill-white" /> Voir comment ça marche</a>
            </div>

            <div className="flex items-center gap-4 max-w-xl mx-auto my-5 text-slate-500 text-xs uppercase font-bold"><div className="h-px bg-slate-700 flex-1" /> OU <div className="h-px bg-slate-700 flex-1" /></div>
            <a href={waLink("Bonjour, je voudrais des informations sur DiagAssist !")} target="_blank" rel="noopener noreferrer" className="relative z-40 flex items-center justify-center gap-3 max-w-2xl mx-auto border border-emerald-400/90 bg-emerald-500/5 hover:bg-emerald-500/10 text-white font-black text-sm md:text-base px-7 py-4 rounded-2xl transition"><MessageCircle className="w-6 h-6 text-emerald-400" /> Contactez-nous sur WhatsApp</a>
            <div className="grid grid-cols-3 gap-3 max-w-3xl mx-auto mt-7 pt-5 border-t border-white/10">
              <div className="text-center"><FileSearch className="w-6 h-6 mx-auto text-red-500" /><p className="text-xs md:text-sm text-slate-300 mt-2">Codes défauts<br/>de toutes marques</p></div>
              <div className="text-center border-x border-white/10"><Wrench className="w-6 h-6 mx-auto text-white" /><p className="text-xs md:text-sm text-slate-300 mt-2">Guides de diagnostic<br/>étape par étape</p></div>
              <div className="text-center"><ShieldCheck className="w-6 h-6 mx-auto text-white" /><p className="text-xs md:text-sm text-slate-300 mt-2">Conçu pour<br/>les mécaniciens</p></div>
            </div>
          </div>
        </section>
      </main>

      <section className="w-full bg-[#06101f] border-t border-white/5">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-14 md:py-20"><div className="grid md:grid-cols-2 gap-8 md:gap-12 items-center"><div className="rounded-3xl overflow-hidden border border-white/10 shadow-2xl bg-slate-900"><img src="/preview/preview-report.png" alt="Diagnostic DiagAssist" className="w-full h-[260px] md:h-[340px] object-cover object-top" /></div><div><div className="flex items-center gap-3 text-red-500 text-xs font-black uppercase tracking-widest"><span className="w-10 h-1 bg-red-500 rounded-full" /> Le problème</div><h2 className="mt-4 text-3xl md:text-5xl font-display font-black uppercase leading-tight text-white">Un code défaut<br/>sur votre voiture ?</h2><p className="mt-5 text-slate-300 text-base md:text-lg leading-relaxed">DiagAssist vous aide à comprendre la cause du défaut et à savoir quoi contrôler, avant de remplacer une pièce.</p></div></div></div>
      </section>

      <section id="comment-ca-marche" className="w-full max-w-6xl mx-auto px-5 py-16 border-t border-white/[0.05]">
        <h2 className="text-xl md:text-2xl font-display font-black text-center mb-2 uppercase tracking-tight">Comment DiagAssist vous accompagne</h2>
        <p className="text-center text-slate-500 text-xs mb-10">La même méthodologie que suit le moteur de diagnostic, à chaque code traité</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">{METHOD_STEPS.map((s,i)=><div key={i} className="bg-slate-900/60 border border-white/[0.06] rounded-2xl p-6 space-y-3"><div className="flex items-center gap-3"><div className="w-9 h-9 bg-red-600/10 text-red-500 rounded-xl flex items-center justify-center shrink-0"><s.icon className="w-4 h-4" /></div><span className="text-[10px] font-black text-slate-600 font-mono">0{i+1}</span></div><h3 className="font-bold text-sm text-white">{s.title}</h3><p className="text-xs text-slate-400 leading-relaxed">{s.desc}</p></div>)}</div>
      </section>

      <section className="w-full max-w-6xl mx-auto px-5 py-16 border-t border-white/[0.05]">
        <h2 className="text-xl md:text-2xl font-display font-black text-center mb-10 uppercase tracking-tight">Voyez DiagAssist en action</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[["/preview/preview-report.png","Rapport de diagnostic","Causes probables classées, protocole de test, guide de réparation et chiffrage."],["/preview/preview-chat.png","Chat de suivi","Posez vos questions par écrit sur la panne en cours, avec photos à l'appui."],["/preview/preview-live.png","Copilote vocal en direct","Parlez à DiagAssist mains libres pendant l'intervention, comme un collègue au téléphone."]].map(([img,title,desc])=><div key={title} className="bg-slate-900/60 border border-white/[0.06] rounded-2xl overflow-hidden"><img src={img} alt={title} className="w-full h-48 object-cover object-top" /><div className="p-4"><h3 className="font-bold text-sm text-white">{title}</h3><p className="text-xs text-slate-400 mt-1 leading-relaxed">{desc}</p></div></div>)}
        </div>
      </section>

      <section id="fonctionnalites" className="w-full max-w-6xl mx-auto px-5 py-14 md:py-16 border-t border-white/[0.05] scroll-mt-20">
        <div className="flex items-center justify-between gap-4 mb-7">
          <div>
            <div className="flex items-center gap-3 text-red-500 text-xs font-black uppercase tracking-widest">
              <span className="w-10 h-1 bg-red-500 rounded-full" /> Fonctionnalités
            </div>
            <h2 className="mt-3 text-2xl md:text-4xl font-display font-black uppercase tracking-tight text-white">Tout ce qu'il faut pour diagnostiquer</h2>
            <p className="mt-2 text-sm text-slate-400">Des outils conçus pour accompagner le mécanicien pendant toute l'intervention.</p>
          </div>
          <a href="#top" className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-xs font-black uppercase text-slate-300 hover:text-white hover:border-red-500/40 transition">
            <ArrowUp className="w-4 h-4" /> Retour
          </a>
        </div>

        <div className="grid md:grid-cols-[1.05fr_1.95fr] gap-5 md:gap-6 items-stretch">
          <div className="rounded-3xl overflow-hidden border border-white/10 bg-slate-900/70 shadow-2xl min-h-[250px] md:min-h-[390px]">
            <img src="/preview/preview-live.png" alt="Assistant vocal live DiagAssist en intervention" className="w-full h-full min-h-[250px] md:min-h-[390px] object-cover object-top" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[["Photo & son","Voyant, moteur, écran de valise : envoyez une preuve, DiagAssist l'analyse.",Camera],["Assistant vocal live","Parlez mains libres pendant que vous travaillez sur le véhicule.",Mic],["Jamais à l'aveugle","Chaque hypothèse est vérifiée par un test avant conclusion.",ShieldCheck],["Partout, même en 3G","Sur téléphone, en atelier, même en connexion dégradée.",Smartphone]].map(([title,desc,Icon],i)=><div key={i} className="bg-slate-900/60 border border-white/[0.06] rounded-2xl p-5 md:p-6 space-y-3"><div className="w-11 h-11 bg-red-600/10 text-red-500 rounded-xl flex items-center justify-center"><Icon className="w-5 h-5" /></div><h3 className="font-bold text-sm md:text-base text-white">{title}</h3><p className="text-xs md:text-sm text-slate-400 leading-relaxed">{desc}</p></div>)}
          </div>
        </div>

        <a href="#top" className="sm:hidden mt-5 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-xs font-black uppercase text-slate-300 hover:text-white hover:border-red-500/40 transition">
          <ArrowUp className="w-4 h-4" /> Retour en haut
        </a>
      </section>

      <section id="tarifs" className="w-full max-w-6xl mx-auto px-5 py-16 border-t border-white/[0.05]">
        <h2 className="text-xl md:text-2xl font-display font-black text-center mb-2 uppercase tracking-tight">NOS OFFRES</h2>
        <p className="text-center text-slate-500 text-xs mb-10">Choisissez la formule qui vous convient</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
          {[["Forfait Jour","500F","Accès illimité 24h","emerald"],["Essai Gratuit","0F","72h, 1 diagnostic/jour","sky"],["Lite","6 000F","Par mois","sky"],["Premium","15 000F","Par mois","red"]].map(([title,price,desc,color],i)=><div key={title} onClick={onGetStarted} className={`bg-slate-900/80 border-2 ${color==="red"?"border-red-500/40 hover:border-red-400/70":color==="emerald"?"border-emerald-500/40 hover:border-emerald-400/70":"border-white/[0.06] hover:border-sky-500/40"} rounded-2xl p-6 space-y-3 text-center relative overflow-hidden cursor-pointer transition`}>{i===3&&<span className="absolute top-3 right-3 text-[9px] bg-red-600 text-white font-black px-2 py-0.5 rounded-full uppercase">Populaire</span>}<h3 className={`font-bold text-xs uppercase tracking-wide ${color==="red"?"text-red-400":color==="emerald"?"text-emerald-400":"text-sky-400"}`}>{title}</h3><p className="text-3xl font-black text-white">{price}</p><p className="text-[11px] text-slate-500">{desc}</p></div>)}
        </div>
        <div className="text-center mt-8"><a href={waLink("Bonjour, je voudrais m'abonner à DiagAssist !")} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-emerald-500 hover:text-emerald-400 font-bold text-sm transition cursor-pointer"><MessageCircle className="w-4 h-4" /> Activation immédiate par WhatsApp</a></div>
      </section>

      <section className="w-full max-w-4xl mx-auto px-5 py-16 border-t border-white/[0.05] text-center">
        <h2 className="text-xl md:text-2xl font-display font-black mb-4 uppercase tracking-tight">Prêt à diagnostiquer plus vite ?</h2>
        <p className="text-slate-400 text-sm mb-6">Rejoignez les mécaniciens qui utilisent déjà DiagAssist au quotidien.</p>
        <button onClick={onGetStarted} className="inline-flex flex-col items-center gap-0.5 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-black text-sm uppercase tracking-wider px-8 py-3.5 rounded-2xl transition cursor-pointer shadow-lg shadow-red-600/20">
          <span>Essayer DiagAssist — GRATUIT 72H <ArrowRight className="w-4 h-4 inline ml-1" /></span>
          <span className="text-[11px] font-bold normal-case tracking-normal text-red-100">Puis à partir de 500 F</span>
        </button>
      </section>

      <footer className="w-full max-w-6xl mx-auto px-5 py-8 border-t border-white/[0.05] flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500">
        <div className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5" /> Abidjan, Côte d'Ivoire — NTIC Strategy</div>
        <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5" /> 0707312797</div>
        <a href="/blog/" className="hover:text-slate-300 underline">Guides & conseils</a>
        <div>© {new Date().getFullYear()} DiagAssist. Tous droits réservés.</div>
      </footer>
    </div>
  );
}
