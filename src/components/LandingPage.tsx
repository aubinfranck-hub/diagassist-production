import React from "react";
import {
  Wrench, Camera, Mic, MessageCircle, ShieldCheck, Zap, Check,
  Smartphone, Clock, Sparkles, ArrowRight, MapPin, Phone, Package, AlertTriangle, Coins
} from "lucide-react";

interface LandingPageProps {
  onGetStarted: () => void;
  isOwner?: boolean;
  onChangeProfile?: () => void;
}

const WHATSAPP_NUMBER = "2250707312797";
const waLink = (message: string) => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

export default function LandingPage({ onGetStarted, isOwner = false, onChangeProfile }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans overflow-x-hidden relative">
      {/* Bouton WhatsApp flottant, visible partout sur la page */}
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
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-lg shadow-red-600/20 overflow-hidden">
            <img src="/icon-logo-192.png" alt="DiagAssist" className="w-full h-full object-cover" />
          </div>
          <div>
            <span className="font-display font-black text-lg uppercase tracking-tight block leading-none">DiagAssist</span>
            {onChangeProfile && (
              <button
                onClick={onChangeProfile}
                className="text-[10px] text-slate-500 hover:text-slate-300 transition cursor-pointer"
              >
                {isOwner ? "Propriétaire" : "Mécanicien"} · changer
              </button>
            )}
          </div>
        </div>
        <button
          onClick={onGetStarted}
          className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider px-5 py-2.5 rounded-xl transition cursor-pointer"
        >
          Se connecter
        </button>
      </header>

      {/* Hero */}
      <main className="w-full max-w-6xl mx-auto px-5 pt-8 pb-16 relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-red-600/[0.08] rounded-full blur-3xl pointer-events-none" />

        <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-white/[0.06] rounded-3xl p-6 md:p-10 relative overflow-hidden">
          {/* Photo de fond réelle (mécaniciens nigérians au travail), assombrie pour rester lisible */}
          <div
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage: "url('https://images.pexels.com/photos/12555014/pexels-photo-12555014.jpeg?w=1600&auto=compress&cs=tinysrgb')",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/80 to-transparent" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(220,38,38,0.12),transparent_60%)]" />

          <a
            href={waLink("Bonjour, je voudrais des informations sur DiagAssist !")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 bg-emerald-600/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full mb-5 relative hover:bg-emerald-600/25 transition cursor-pointer"
          >
            <MessageCircle className="w-3 h-3" /> Contactez-nous sur WhatsApp
          </a>

          <h1 className="text-[#f8fafc] text-3xl md:text-5xl font-display font-black leading-tight max-w-3xl relative">
            {isOwner ? (
              <>VOTRE VOITURE FAIT UN BRUIT ? <span className="text-red-500">SACHEZ SI C'EST GRAVE</span></>
            ) : (
              <>"ÇA FAIT UN BRUIT BIZARRE", DIT LE CLIENT. <span className="text-red-500">VOUS, VOUS TESTEZ QUOI ?</span></>
            )}
          </h1>

          <p className="text-[#cbd5e1] text-sm md:text-base max-w-xl mt-4 leading-relaxed relative">
            {isOwner
              ? "Décrivez ce que vous constatez, en mots simples. DiagAssist vous explique ce qui se passe, si vous pouvez rouler, combien ça devrait coûter — et vous oriente vers un mécanicien agréé près de chez vous."
              : "Pas de code défaut clair, pas envie de changer une pièce au hasard pour voir. Décrivez le symptôme, joignez une photo ou un son du moteur : DiagAssist vous guide test par test jusqu'à la vraie cause, avant de toucher à quoi que ce soit."}
          </p>

          <div className="space-y-2.5 mt-6 relative">
            {(isOwner
              ? [
                  "Comprenez la panne sans jargon technique",
                  "Sachez si vous pouvez rouler ou non",
                  "Évitez de vous faire surfacturer au garage",
                ]
              : [
                  "Jamais de pièce changée à l'aveugle : un protocole de test avant chaque conclusion",
                  "Un diagnostic argumenté à montrer au client, pas juste \"il faut changer ça\"",
                  "Fonctionne avec le matériel que vous avez déjà en atelier",
                ]
            ).map((t, i) => (
              <div key={i} className="flex items-center gap-2.5 text-sm text-[#e2e8f0]">
                <span className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3 text-emerald-400" />
                </span>
                {t}
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-8 relative">
            <button
              onClick={onGetStarted}
              className="flex items-center justify-center gap-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-black text-sm uppercase tracking-wider px-7 py-4 rounded-2xl transition cursor-pointer shadow-lg shadow-red-600/20"
            >
              Commencer maintenant <ArrowRight className="w-4 h-4" />
            </button>
            <a
              href={waLink("Bonjour, je voudrais essayer DiagAssist !")}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-7 py-4 rounded-2xl transition cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" /> Essai gratuit via WhatsApp
            </a>
          </div>
        </div>
      </main>

      {/* Explication immédiate : ce qu'est concrètement DiagAssist, avant que le visiteur n'aille plus loin */}
      <section className="w-full max-w-6xl mx-auto px-5 py-10 border-t border-white/[0.05]">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-xl md:text-2xl font-display font-black uppercase tracking-tight mb-3">
            DiagAssist, c'est quoi exactement ?
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Un bruit métallique au freinage, un voyant moteur sans code clair, une panne électrique qui va et vient :
            DiagAssist est un assistant de diagnostic automobile conçu avec des professionnels de la mécanique pour
            traiter exactement ce genre de cas. Vous décrivez le symptôme — par texte, photo ou son du moteur — et
            vous recevez un vrai rapport technique (causes probables classées par fréquence, protocole de test,
            guide de réparation, chiffrage), avec un chat de suivi et un copilote vocal en direct pendant l'intervention.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-slate-900/60 border border-white/[0.06] rounded-2xl overflow-hidden">
            <img src="/preview/preview-report.png" alt="Rapport de diagnostic DiagAssist" className="w-full h-48 object-cover object-top" />
            <div className="p-4">
              <h3 className="font-bold text-sm text-white">Rapport de diagnostic</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">Codes défauts, causes probables, guide de réparation étape par étape et chiffrage.</p>
            </div>
          </div>
          <div className="bg-slate-900/60 border border-white/[0.06] rounded-2xl overflow-hidden">
            <img src="/preview/preview-chat.png" alt="Chat de suivi DiagAssist" className="w-full h-48 object-cover object-top" />
            <div className="p-4">
              <h3 className="font-bold text-sm text-white">Chat de suivi</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">Posez vos questions par écrit ou à voix haute sur la panne en cours, avec photos à l'appui.</p>
            </div>
          </div>
          <div className="bg-slate-900/60 border border-white/[0.06] rounded-2xl overflow-hidden">
            <img src="/preview/preview-live.png" alt="Copilote vocal en direct DiagAssist" className="w-full h-48 object-cover object-top" />
            <div className="p-4">
              <h3 className="font-bold text-sm text-white">Copilote vocal en direct</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">Parlez à DiagAssist les mains libres pendant l'intervention, comme un collègue au téléphone.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Fonctionnalités */}
      <section className="w-full max-w-6xl mx-auto px-5 py-16 border-t border-white/[0.05]">
        <h2 className="text-xl md:text-2xl font-display font-black text-center mb-10 uppercase tracking-tight">
          {isOwner ? "Tout ce qu'il faut savoir sur votre véhicule" : "Tout ce qu'il faut pour diagnostiquer vite et bien"}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {(isOwner
            ? [
                { icon: AlertTriangle, title: "Est-ce grave ?", desc: "Vous savez immédiatement si vous pouvez continuer à rouler ou s'il faut arrêter tout de suite." },
                { icon: Coins, title: "Le juste prix", desc: "Une fourchette de coût pour la réparation, pour ne pas vous faire surfacturer au garage." },
                { icon: Camera, title: "Une simple photo suffit", desc: "Photographiez le voyant allumé ou enregistrez le bruit : DiagAssist analyse directement." },
                { icon: Wrench, title: "Mécaniciens agréés", desc: "Nous vous orientons vers un professionnel vérifié, équipé d'une valise de diagnostic, près de chez vous." },
                { icon: Package, title: "Vendeurs de pièces", desc: "Trouvez où acheter la pièce dont vous avez besoin, chez des fournisseurs vérifiés." },
                { icon: Smartphone, title: "Sans jargon technique", desc: "Tout est expliqué avec des mots simples. Pas besoin d'être mécanicien pour comprendre." },
              ]
            : [
                { icon: Camera, title: "Photos & vidéos", desc: "Envoyez une photo du voyant, du moteur, ou de l'écran de la valise OBD — DiagAssist les analyse directement." },
                { icon: Mic, title: "Assistant vocal live", desc: "Décrivez le bruit du moteur, ou parlez directement à DiagAssist en mains libres pendant que vous travaillez." },
                { icon: Wrench, title: "Diagnostic guidé", desc: "Contrôles étape par étape, du plus simple au plus poussé, jusqu'à confirmer la vraie cause de la panne." },
                { icon: ShieldCheck, title: "Protocole rigoureux", desc: "Jamais de remplacement de pièce à l'aveugle — chaque hypothèse est vérifiée par un test avant conclusion." },
                { icon: Smartphone, title: "Fonctionne partout", desc: "Sur téléphone, en atelier, même en connexion 3G/4G dégradée." },
                { icon: Clock, title: "Réponse immédiate", desc: "Plus besoin d'attendre — le rapport de diagnostic arrive en quelques secondes." },
              ]
          ).map((f, i) => (
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
        <h2 className="text-xl md:text-2xl font-display font-black text-center mb-8 uppercase tracking-tight">
          Comment ça marche
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-10 rounded-2xl overflow-hidden">
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
          {(isOwner
            ? [
                { n: "01", title: "Décrivez le problème", desc: "Le bruit, le voyant, ce que vous constatez — avec vos mots." },
                { n: "02", title: "Recevez l'explication", desc: "Ce qui se passe, si c'est urgent, et le coût à prévoir." },
                { n: "03", title: "Trouvez un pro", desc: "Nous vous orientons vers un mécanicien agréé près de chez vous." },
              ]
            : [
                { n: "01", title: "Décrivez le symptôme", desc: "Marque, modèle, année, et ce que vous constatez sur le véhicule." },
                { n: "02", title: "Joignez une preuve", desc: "Photo, vidéo ou son — pour un diagnostic plus précis." },
                { n: "03", title: "Suivez le guide", desc: "Contrôles étape par étape jusqu'à la réparation confirmée." },
              ]
          ).map((s, i) => (
            <div key={i} className="text-center space-y-2">
              <div className="text-3xl font-black text-red-600/40 font-mono">{s.n}</div>
              <h3 className="font-bold text-sm text-white">{s.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Forfaits — style cartes percutantes avec badges */}
      <section className="w-full max-w-6xl mx-auto px-5 py-16 border-t border-white/[0.05]">
        <h2 className="text-xl md:text-2xl font-display font-black text-center mb-2 uppercase tracking-tight">
          NOS OFFRES
        </h2>
        <p className="text-center text-slate-500 text-xs mb-10">Choisissez la formule qui vous convient</p>

        {isOwner ? (
          /* Offres propriétaires : simples, deux choix seulement */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            <div
              onClick={onGetStarted}
              className="bg-slate-900/60 border border-white/[0.06] hover:border-sky-500/40 rounded-2xl p-6 space-y-3 text-center cursor-pointer transition"
            >
              <h3 className="font-bold text-xs text-sky-400 uppercase tracking-wide">Essai Gratuit</h3>
              <p className="text-3xl font-black text-white">0F</p>
              <p className="text-[11px] text-slate-500">Pendant 72h</p>
              <ul className="text-left space-y-1.5 pt-2">
                {["1 diagnostic par jour", "Sans carte bancaire", "Accès aux mécaniciens agréés"].map((t, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                    <Check className="w-3 h-3 text-sky-400 shrink-0 mt-0.5" /> {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-slate-900/80 border-2 border-emerald-500/40 rounded-2xl p-6 space-y-3 text-center relative overflow-hidden">
              <span className="absolute top-3 right-3 text-[9px] bg-emerald-500 text-slate-950 font-black px-2 py-0.5 rounded-full uppercase">Populaire</span>
              <h3 className="font-bold text-xs text-emerald-400 uppercase tracking-wide">Pass Semaine</h3>
              <p className="text-3xl font-black text-white">500F</p>
              <p className="text-[11px] text-slate-500">Pour 7 jours</p>
              <ul className="text-left space-y-1.5 pt-2">
                {["15 diagnostics sur 7 jours", "Fourchette de prix détaillée", "Mécaniciens et vendeurs de pièces"].map((t, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                    <Check className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" /> {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
          {/* Forfait Jour — nouveau, mis en avant */}
          <div
            onClick={onGetStarted}
            className="bg-slate-900/80 border-2 border-emerald-500/40 hover:border-emerald-400/70 rounded-2xl p-6 space-y-3 text-center relative overflow-hidden cursor-pointer transition"
          >
            <span className="absolute top-3 right-3 text-[9px] bg-emerald-500 text-slate-950 font-black px-2 py-0.5 rounded-full uppercase">Nouveau</span>
            <h3 className="font-bold text-xs text-emerald-400 uppercase tracking-wide">Forfait Jour</h3>
            <p className="text-3xl font-black text-white">500F</p>
            <p className="text-[11px] text-slate-500">Accès illimité 24h</p>
            <ul className="text-left space-y-1.5 pt-2">
              {["Diagnostics illimités 24h", "Activation immédiate", "Sans engagement"].map((t, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                  <Check className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" /> {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Essai gratuit */}
          <div
            onClick={onGetStarted}
            className="bg-slate-900/60 border border-white/[0.06] hover:border-sky-500/40 rounded-2xl p-6 space-y-3 text-center cursor-pointer transition"
          >
            <h3 className="font-bold text-xs text-sky-400 uppercase tracking-wide">Essai Gratuit</h3>
            <p className="text-3xl font-black text-white">0F</p>
            <p className="text-[11px] text-slate-500">Pendant 72h</p>
            <ul className="text-left space-y-1.5 pt-2">
              {["1 diagnostic par jour", "Sans carte bancaire", "Activation immédiate"].map((t, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                  <Check className="w-3 h-3 text-sky-400 shrink-0 mt-0.5" /> {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Lite */}
          <div
            onClick={onGetStarted}
            className="bg-slate-900/60 border border-white/[0.06] hover:border-sky-500/40 rounded-2xl p-6 space-y-3 text-center cursor-pointer transition"
          >
            <h3 className="font-bold text-xs text-sky-400 uppercase tracking-wide">Lite</h3>
            <p className="text-3xl font-black text-white">6 000F</p>
            <p className="text-[11px] text-slate-500">Par mois</p>
            <ul className="text-left space-y-1.5 pt-2">
              {["Diagnostics illimités", "Rapport texte détaillé", "Historique conservé"].map((t, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                  <Check className="w-3 h-3 text-sky-400 shrink-0 mt-0.5" /> {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Premium */}
          <div
            onClick={onGetStarted}
            className="bg-slate-900/80 border-2 border-red-500/40 hover:border-red-400/70 rounded-2xl p-6 space-y-3 text-center relative overflow-hidden cursor-pointer transition"
          >
            <span className="absolute top-3 right-3 text-[9px] bg-red-600 text-white font-black px-2 py-0.5 rounded-full uppercase">Populaire</span>
            <h3 className="font-bold text-xs text-red-400 uppercase tracking-wide">Premium</h3>
            <p className="text-3xl font-black text-white">15 000F</p>
            <p className="text-[11px] text-slate-500">Par mois</p>
            <ul className="text-left space-y-1.5 pt-2">
              {["Diagnostics illimités", "Explications vocales", "Données techniques Haynes Pro"].map((t, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                  <Check className="w-3 h-3 text-red-400 shrink-0 mt-0.5" /> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
        )}

        <div className="text-center mt-8">
          <a
            href={waLink("Bonjour, je voudrais m'abonner à DiagAssist !")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-7 py-3.5 rounded-2xl transition cursor-pointer"
          >
            <MessageCircle className="w-4 h-4" /> Activation immédiate par WhatsApp
          </a>
        </div>
      </section>

      {/* CTA final */}
      <section className="w-full max-w-4xl mx-auto px-5 py-16 border-t border-white/[0.05] text-center">
        <h2 className="text-xl md:text-2xl font-display font-black mb-4 uppercase tracking-tight">
          {isOwner ? "Prêt à comprendre votre véhicule ?" : "Prêt à diagnostiquer plus vite ?"}
        </h2>
        <p className="text-slate-400 text-sm mb-6">{isOwner ? "Rejoignez les conducteurs qui ne se font plus surprendre par une panne." : "Rejoignez les mécaniciens qui utilisent déjà DiagAssist au quotidien."}</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onGetStarted}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-black text-sm uppercase tracking-wider px-8 py-4 rounded-2xl transition cursor-pointer shadow-lg shadow-red-600/20"
          >
            <Sparkles className="w-4 h-4" /> Commencer maintenant
          </button>
          <button
            onClick={onGetStarted}
            className="inline-flex items-center gap-2 bg-transparent hover:bg-slate-800/40 border border-slate-700 hover:border-slate-500 text-slate-100 font-bold text-sm uppercase tracking-wider px-8 py-4 rounded-2xl transition cursor-pointer"
          >
            Se connecter
          </button>
        </div>
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
