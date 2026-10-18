import { useState } from "react";
import { Car, Wrench } from "lucide-react";

// Mode d'utilisation choisi côté appareil (aucune API) : automobiliste ou mécanicien.
export type UserMode = "driver" | "mechanic";
const KEY = "app_user_mode";

export function readUserMode(): UserMode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "driver" || v === "mechanic" ? v : null;
  } catch {
    return null;
  }
}

export function saveUserMode(m: UserMode | null) {
  try {
    if (m) localStorage.setItem(KEY, m); else localStorage.removeItem(KEY);
  } catch { /* stockage indisponible : le choix vaut pour la session */ }
}

/** Écran simple à deux gros boutons, affiché après la connexion tant qu'aucun mode n'est choisi. */
export function ModeSelect({ onChoose }: { onChoose: (m: UserMode) => void }) {
  const [pending, setPending] = useState<UserMode | null>(null);
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <img src="/icon-logo-192.png" alt="" className="w-16 h-16 rounded-2xl mx-auto bg-white object-cover" />
          <h1 className="text-3xl font-black text-white">Bienvenue</h1>
          <p className="text-base text-slate-400">Qui êtes-vous ? Vous pourrez changer plus tard.</p>
        </div>
        <button
          onClick={() => { setPending("driver"); onChoose("driver"); }}
          disabled={!!pending}
          className="w-full flex items-center gap-4 text-left p-6 rounded-3xl bg-red-600 hover:bg-red-700 text-[#ffffff] shadow-lg shadow-red-600/25 active:scale-[0.98] transition cursor-pointer"
        >
          <Car className="w-10 h-10 shrink-0" />
          <span>
            <span className="block text-xl font-black">Je suis automobiliste</span>
            <span className="block text-sm opacity-90">Ma voiture est en panne, je veux de l'aide</span>
          </span>
        </button>
        <button
          onClick={() => { setPending("mechanic"); onChoose("mechanic"); }}
          disabled={!!pending}
          className="w-full flex items-center gap-4 text-left p-6 rounded-3xl bg-slate-900 hover:bg-slate-800 text-slate-100 border border-white/[0.12] active:scale-[0.98] transition cursor-pointer"
        >
          <Wrench className="w-10 h-10 shrink-0 text-slate-300" />
          <span>
            <span className="block text-xl font-black">Je suis mécanicien</span>
            <span className="block text-sm text-slate-400">J'utilise les outils professionnels</span>
          </span>
        </button>
      </div>
    </div>
  );
}
