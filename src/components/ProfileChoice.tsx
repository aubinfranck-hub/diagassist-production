import React from "react";
import { Wrench, Car, ArrowRight, Check } from "lucide-react";

interface ProfileChoiceProps {
  onChoose: (type: "mechanic" | "owner") => void;
}

export default function ProfileChoice({ onChoose }: ProfileChoiceProps) {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-5 font-sans">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl overflow-hidden mb-4 shadow-lg shadow-red-600/20">
            <img src="/icon-192.png" alt="DiagAssist" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-display font-black text-white uppercase tracking-tight">
            Bienvenue sur DiagAssist
          </h1>
          <p className="text-sm text-slate-400 mt-2">Pour commencer, dites-nous qui vous êtes.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Mécanicien */}
          <button
            onClick={() => onChoose("mechanic")}
            className="text-left bg-slate-900 hover:bg-slate-850 border-2 border-white/[0.06] hover:border-red-500/40 rounded-3xl p-6 transition duration-200 cursor-pointer group"
          >
            <div className="w-12 h-12 bg-red-600/10 text-red-500 rounded-2xl flex items-center justify-center mb-4">
              <Wrench className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-display font-black text-white uppercase tracking-tight">
              Je suis mécanicien
            </h2>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Diagnostic technique complet, guidé étape par étape jusqu'à la réparation confirmée.
            </p>
            <ul className="space-y-2 mt-4">
              {[
                "Diagnostic guidé avec mesures et contrôles",
                "Codes défauts OBD et données techniques",
                "Assistant vocal mains libres en atelier",
              ].map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] text-slate-300">
                  <Check className="w-3 h-3 text-red-500 shrink-0 mt-0.5" /> {t}
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-1.5 text-xs font-bold text-red-500 mt-5 group-hover:gap-2.5 transition-all">
              Continuer <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </button>

          {/* Propriétaire */}
          <button
            onClick={() => onChoose("owner")}
            className="text-left bg-slate-900 hover:bg-slate-850 border-2 border-white/[0.06] hover:border-sky-500/40 rounded-3xl p-6 transition duration-200 cursor-pointer group"
          >
            <div className="w-12 h-12 bg-sky-500/10 text-sky-400 rounded-2xl flex items-center justify-center mb-4">
              <Car className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-display font-black text-white uppercase tracking-tight">
              J'ai un véhicule
            </h2>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Comprenez ce qui arrive à votre voiture, en mots simples, et trouvez un mécanicien de confiance.
            </p>
            <ul className="space-y-2 mt-4">
              {[
                "Explication simple, sans jargon technique",
                "Niveau d'urgence : pouvez-vous rouler ?",
                "Mécaniciens agréés équipés près de vous",
              ].map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] text-slate-300">
                  <Check className="w-3 h-3 text-sky-400 shrink-0 mt-0.5" /> {t}
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-1.5 text-xs font-bold text-sky-400 mt-5 group-hover:gap-2.5 transition-all">
              Continuer <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </button>
        </div>

        <p className="text-center text-[10px] text-slate-600 mt-6">
          Vous pourrez changer de profil à tout moment dans l'application.
        </p>
      </div>
    </div>
  );
}
