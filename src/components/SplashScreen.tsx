import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Shield, Activity } from "lucide-react";
import { playV8EngineSound } from "../utils/audioEngine";

interface SplashScreenProps {
  onComplete: () => void;
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [initStage, setInitStage] = useState<"loading" | "finished">("loading");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Play our synthesized V8 GLE Engine roar automatically at launch!
    playV8EngineSound();

    // To handle browsers blocking autoplay: play the sound if the user interacts with the page
    const handleFirstInteraction = () => {
      playV8EngineSound();
      window.removeEventListener("click", handleFirstInteraction);
      window.removeEventListener("touchstart", handleFirstInteraction);
    };

    window.addEventListener("click", handleFirstInteraction);
    window.addEventListener("touchstart", handleFirstInteraction);

    return () => {
      window.removeEventListener("click", handleFirstInteraction);
      window.removeEventListener("touchstart", handleFirstInteraction);
    };
  }, []);

  useEffect(() => {
    if (initStage !== "loading") return;

    // Smooth loading simulation synced with the sound duration (approx 3.2 seconds total)
    const interval = setInterval(() => {
      setProgress((prev) => {
        const next = prev + 1;
        if (next >= 100) {
          clearInterval(interval);
          setInitStage("finished");
          setTimeout(() => {
            onComplete();
          }, 600); // Elegant exit delay
          return 100;
        }
        return next;
      });
    }, 32);

    return () => clearInterval(interval);
  }, [initStage, onComplete]);

  return (
    <AnimatePresence>
      <motion.div
        id="splash-screen"
        initial={{ opacity: 1 }}
        exit={{ opacity: 0, y: -25, transition: { duration: 0.5, ease: "easeInOut" } }}
        className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-between py-12 px-6 z-50 overflow-y-auto"
      >
        {/* Subtle grid lines background & ambient red glow */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-red-950/20 via-slate-950 to-slate-950 pointer-events-none" />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[400px] h-[400px] bg-red-600/5 rounded-full blur-[120px] pointer-events-none" />

        {/* Top Header */}
        <div className="relative text-center shrink-0 z-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-600/10 border border-red-500/20 text-red-500 rounded-full text-[10px] font-bold uppercase tracking-widest font-mono">
            <Shield className="w-3.5 h-3.5" />
            Édition Professionnelle V1
          </div>
        </div>

        {/* Center Logo & Graphics Area */}
        <div className="flex-1 flex flex-col items-center justify-center max-w-lg w-full relative z-10 my-8">
          
          {/* Vraie mascotte DiagAssist (image), remplace l'ancien SVG dessiné à la main */}
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="w-72 h-72 md:w-80 md:h-80 relative flex items-center justify-center"
          >
            <img
              src="/icon-512.png"
              alt="DiagAssist"
              className="w-full h-full object-contain drop-shadow-[0_10px_35px_rgba(220,38,38,0.22)]"
            />

            {/* Glowing heartbeat pulse animation overlays */}
            <div className="absolute inset-0 bg-red-500/5 rounded-full filter blur-xl animate-pulse pointer-events-none" />
          </motion.div>

          <h2 className="text-xl font-display font-bold text-white tracking-wider mt-4">
            DiagAssist v1
          </h2>
          <p className="text-slate-400 text-center text-xs mt-2 px-6 max-w-sm leading-relaxed">
            Identifiez instantanément les pannes de votre véhicule par texte, photo, vidéo ou enregistrement audio.
          </p>
        </div>

        {/* Lower Interaction Area */}
        <div className="w-full max-w-md shrink-0 flex flex-col items-center gap-6 relative z-10">
          
          <div className="w-full space-y-3">
            {/* Progress Bar & Status Text */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-baseline text-[10px] font-mono tracking-widest text-slate-500">
                <span className="text-red-500 font-bold animate-pulse uppercase">
                  DÉMARRAGE DE L'APPLICATION
                </span>
                <span className="text-slate-300 font-bold">{progress}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-900 border border-slate-900/60 rounded-full overflow-hidden p-0.5">
                <div 
                  className="h-full bg-gradient-to-r from-red-600 to-rose-500 rounded-full transition-all duration-75"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>

          {/* Clean system indicator */}
          <div className="text-[10px] text-slate-600 font-mono text-center flex flex-col gap-1.5 pt-2">
            <span className="flex items-center justify-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-red-500 animate-pulse" /> 
              Initialisation Audio V8 GLE
            </span>
          </div>

        </div>
      </motion.div>
    </AnimatePresence>
  );
}
