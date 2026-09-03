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
          
          {/* Main Visual Logo Render (SVG matching exactly the user's uploaded logo) */}
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="w-72 h-72 md:w-80 md:h-80 relative flex items-center justify-center"
          >
            <svg viewBox="0 0 500 500" className="w-full h-full drop-shadow-[0_10px_35px_rgba(220,38,38,0.22)]">
              <defs>
                {/* Silver Gradient for Logo Loop */}
                <linearGradient id="silverGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="30%" stopColor="#e2e8f0" />
                  <stop offset="70%" stopColor="#94a3b8" />
                  <stop offset="100%" stopColor="#475569" />
                </linearGradient>
                {/* Red Gradient for Left 'D' Bar and accents */}
                <linearGradient id="redGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="50%" stopColor="#dc2626" />
                  <stop offset="100%" stopColor="#991b1b" />
                </linearGradient>
                {/* Neon Red Glow filter */}
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3.5" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>

              {/* Back Red bar forming the D spine and top shelf */}
              <path 
                d="M 190 120 L 320 120 A 130 130 0 0 1 350 380 L 190 380 Z" 
                fill="none" 
              />
              
              {/* Giant Red Curved Segment of the 'D' */}
              <path 
                d="M 180 120 L 260 120 A 40 40 0 0 1 270 200 L 230 200"
                fill="none"
              />

              {/* Let's draw the precise logo: Silver circular D, Red accents, Car Silhouette inside */}
              {/* Outer circular Loop representing 'D' */}
              <path 
                d="M 230 380 C 315 380 380 315 380 230 C 380 145 315 80 230 80 L 175 80 L 175 140 L 230 140 C 280 140 320 180 320 230 C 320 280 280 320 230 320 L 175 320 L 230 380 Z" 
                fill="url(#silverGrad)" 
              />
              
              {/* Red left bar and top shelf of the 'D' */}
              <path 
                d="M 175 80 L 265 80 C 270 80 270 140 265 140 L 210 140 L 180 200 L 140 200" 
                fill="url(#redGrad)" 
              />

              {/* Sleek white sport SUV car silhouette inside the circle */}
              <g transform="translate(145, 130)">
                {/* Roofline */}
                <path 
                  d="M 10 70 C 15 50, 45 35, 115 33 C 145 33, 160 50, 170 65 C 180 75, 185 85, 185 92" 
                  fill="none" 
                  stroke="#ffffff" 
                  strokeWidth="5" 
                  strokeLinecap="round" 
                />
                {/* Windshield glare line */}
                <path 
                  d="M 125 40 L 170 70" 
                  fill="none" 
                  stroke="#ffffff" 
                  strokeWidth="2.5" 
                  strokeLinecap="round" 
                  opacity="0.6"
                />
                {/* Hood and nose */}
                <path 
                  d="M 10 70 C 45 68, 125 73, 180 110 C 175 110, 165 105, 155 105" 
                  fill="none" 
                  stroke="#ffffff" 
                  strokeWidth="4" 
                  strokeLinecap="round" 
                />
                {/* Headlight flare shape */}
                <path 
                  d="M 115 105 C 135 105, 150 90, 160 88" 
                  fill="#ffffff" 
                  opacity="0.9"
                />
              </g>

              {/* Red Heartbeat Pulse line (ECG / Oscillo) with OBD plug on far left */}
              <g transform="translate(45, 20)">
                {/* OBD-II Connector head on left */}
                <rect 
                  x="40" 
                  y="180" 
                  width="65" 
                  height="45" 
                  rx="10" 
                  fill="url(#redGrad)" 
                  stroke="#ef4444"
                  strokeWidth="1.5"
                />
                {/* OBD contact pins details inside plug */}
                <rect x="50" y="190" width="45" height="10" rx="3" fill="#000" />
                <circle cx="55" cy="195" r="1.5" fill="#eab308" />
                <circle cx="61" cy="195" r="1.5" fill="#eab308" />
                <circle cx="67" cy="195" r="1.5" fill="#eab308" />
                <circle cx="73" cy="195" r="1.5" fill="#eab308" />
                <circle cx="79" cy="195" r="1.5" fill="#eab308" />
                <circle cx="85" cy="195" r="1.5" fill="#eab308" />
                <circle cx="91" cy="195" r="1.5" fill="#eab308" />
                
                <rect x="50" y="205" width="45" height="10" rx="3" fill="#000" />
                <circle cx="55" cy="210" r="1.5" fill="#eab308" />
                <circle cx="61" cy="210" r="1.5" fill="#eab308" />
                <circle cx="67" cy="210" r="1.5" fill="#eab308" />
                <circle cx="73" cy="210" r="1.5" fill="#eab308" />
                <circle cx="79" cy="210" r="1.5" fill="#eab308" />
                <circle cx="85" cy="210" r="1.5" fill="#eab308" />
                <circle cx="91" cy="210" r="1.5" fill="#eab308" />

                {/* Cable of OBD looping downwards */}
                <path 
                  d="M 72.5 225 C 72.5 250, 90 290, 160 290 C 230 290, 260 210, 270 200" 
                  fill="none" 
                  stroke="url(#redGrad)" 
                  strokeWidth="12" 
                  strokeLinecap="round" 
                />

                {/* ECG Heartbeat pulse line starting from cable */}
                <path 
                  d="M 120 236 L 155 236 L 165 200 L 180 270 L 195 190 L 210 248 L 225 230 L 260 236 L 275 236" 
                  fill="none" 
                  stroke="#ef4444" 
                  strokeWidth="5" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                  filter="url(#glow)"
                />
                
                {/* Glowing target node at end of pulse */}
                <circle cx="275" cy="236" r="5" fill="#ffffff" filter="url(#glow)" />
              </g>

              {/* DIAGASSIST Text Typography */}
              <text 
                x="250" 
                y="415" 
                textAnchor="middle" 
                fontFamily="'Space Grotesk', sans-serif" 
                fontWeight="900" 
                fontSize="42" 
                letterSpacing="1.5"
              >
                <tspan fill="#ffffff">DIAG</tspan>
                <tspan fill="#dc2626">ASSIST</tspan>
              </text>

              {/* Sub-dot indicator inside the A of DIAGASSIST */}
              <circle cx="152" cy="406" r="3.5" fill="#dc2626" filter="url(#glow)" />

              {/* "VOTRE EXPERT • NOTRE ASSISTANCE" Tagline */}
              <line x1="60" y1="440" x2="110" y2="440" stroke="#dc2626" strokeWidth="2" />
              <text 
                x="250" 
                y="444" 
                textAnchor="middle" 
                fontFamily="'Inter', sans-serif" 
                fontWeight="800" 
                fontSize="11" 
                fill="#cbd5e1" 
                letterSpacing="4"
              >
                VOTRE EXPERT • NOTRE ASSISTANCE
              </text>
              <line x1="390" y1="440" x2="440" y2="440" stroke="#dc2626" strokeWidth="2" />
            </svg>

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
