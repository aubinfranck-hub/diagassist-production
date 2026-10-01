import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

interface SplashScreenProps {
  onComplete: () => void;
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    // L'affiche reste visible exactement 6 secondes au démarrage.
    const closeTimer = window.setTimeout(() => setClosing(true), 5400);
    const completeTimer = window.setTimeout(() => onComplete(), 6000);

    return () => {
      window.clearTimeout(closeTimer);
      window.clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <AnimatePresence>
      {!closing && (
        <motion.div
          id="splash-screen"
          initial={{ opacity: 1 }}
          exit={{
            opacity: 0,
            transition: { duration: 0.45, ease: "easeInOut" },
          }}
          className="fixed inset-0 z-[9999] overflow-hidden bg-[#07090d]"
          aria-label="DiagAssist — Bon mois d'Octobre 2026"
        >
          {/* Atelier en arrière-plan */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_25%,rgba(220,38,38,0.16),transparent_32%),linear-gradient(135deg,#05070a_0%,#10151d_55%,#07090d_100%)]" />
          <div className="absolute inset-0 opacity-20 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.05)_50%,transparent_100%)]" />

          {/* Feuille qui se déroule depuis le haut */}
          <motion.div
            initial={{ scaleY: 0, y: -40, opacity: 0 }}
            animate={{ scaleY: 1, y: 0, opacity: 1 }}
            transition={{ duration: 1.05, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformOrigin: "top center" }}
            className="absolute inset-x-3 top-3 bottom-3 sm:inset-x-6 sm:top-6 sm:bottom-6 lg:inset-x-16 lg:top-10 lg:bottom-10"
          >
            <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-black/35 shadow-[0_30px_100px_rgba(0,0,0,0.6)] backdrop-blur-sm">
              {/* Reflet vertical de la feuille */}
              <div className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-gradient-to-b from-red-500 via-white/30 to-red-600 opacity-70" />

              <div className="relative mx-auto flex h-full max-w-6xl flex-col px-5 py-5 sm:px-10 sm:py-8 lg:px-16 lg:py-10">
                {/* Logo / identité */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <img
                      src="/icon-logo-512.png"
                      alt="DiagAssist"
                      className="h-12 w-12 object-contain sm:h-16 sm:w-16"
                    />
                    <div className="mt-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/75 sm:text-sm">
                      Votre assistant diagnostic automobile
                    </div>
                  </div>
                  <div className="rounded-full border border-red-500/40 bg-red-600/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-red-400 sm:text-[10px]">
                    Pour les mécaniciens
                  </div>
                </div>

                {/* Contenu principal */}
                <div className="grid min-h-0 flex-1 grid-cols-1 items-center gap-4 sm:grid-cols-[0.85fr_1.15fr] sm:gap-8">
                  <div className="relative flex h-full min-h-0 items-end justify-center sm:items-center">
                    <motion.img
                      src="/icon-512.png"
                      alt="Mascotte DiagAssist"
                      className="max-h-[48vh] w-auto max-w-[88%] object-contain drop-shadow-[0_25px_45px_rgba(220,38,38,0.28)] sm:max-h-[62vh]"
                      initial={{ y: 30, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.65, duration: 0.75, ease: "easeOut" }}
                    />
                  </div>

                  <div className="text-center sm:text-left">
                    <p className="text-sm font-semibold text-white/80 sm:text-lg">
                      DiagAssist vous souhaite un
                    </p>
                    <h1 className="mt-1 text-[clamp(2.7rem,8vw,6.8rem)] font-black leading-[0.86] tracking-tight text-white">
                      Bon mois
                    </h1>
                    <div className="mt-1 text-[clamp(2.8rem,8vw,7rem)] font-black leading-[0.9] tracking-tight text-red-500">
                      d’Octobre
                    </div>
                    <div className="mt-1 flex items-center justify-center gap-3 sm:justify-start">
                      <span className="h-1 w-12 rounded-full bg-red-500" />
                      <span className="text-[clamp(2rem,5vw,4.5rem)] font-black leading-none text-white">
                        2026
                      </span>
                      <span className="h-1 w-12 rounded-full bg-red-500" />
                    </div>

                    <div className="mx-auto mt-5 max-w-xl rounded-xl border border-red-500/25 bg-black/35 px-5 py-4 text-sm leading-relaxed text-white/85 sm:mx-0 sm:mt-7 sm:px-6 sm:py-5 sm:text-base">
                      Que ce mois d’Octobre 2026 vous apporte la santé,
                      de nouvelles opportunités, du succès et de belles
                      réalisations dans tous vos projets.
                    </div>

                    <div className="mt-5 text-sm font-medium italic text-white/60 sm:text-base">
                      Votre assistant pour réparer, passez à l’action.
                    </div>
                  </div>
                </div>

                {/* Signature discrète */}
                <div className="flex items-center justify-center gap-3 pt-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
                  <span className="h-px w-10 bg-red-500/60" />
                  DiagAssist
                  <span className="h-px w-10 bg-red-500/60" />
                </div>
              </div>

              {/* Petit effet de lumière qui accompagne le déroulement */}
              <motion.div
                initial={{ x: "-120%" }}
                animate={{ x: "120%" }}
                transition={{ delay: 0.8, duration: 1.6, ease: "easeInOut" }}
                className="pointer-events-none absolute inset-y-0 w-24 rotate-[8deg] bg-gradient-to-r from-transparent via-white/10 to-transparent blur-xl"
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
