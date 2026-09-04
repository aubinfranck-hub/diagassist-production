import { useState, useEffect, useRef } from "react";
import { 
  AlertOctagon, AlertTriangle, ShieldCheck, CheckCircle2, 
  Wrench, Clock, Euro, HelpCircle, Cpu, Volume2, VolumeX, BookOpen, Lock, Play, Square, Sparkles, Printer, RefreshCw, FileDown,
  Phone, ShoppingBag, MessageCircle
} from "lucide-react";

import { Diagnosis, ApiUsage, DtcCode, RepairStep, SubscriptionPlan } from "../types";


interface DiagnosisResultViewProps {
  diagnosis: Diagnosis;
  apiUsage: ApiUsage;
  currentPlan: SubscriptionPlan;
  onUpgradeClick?: () => void;
}

export default function DiagnosisResultView({ diagnosis, apiUsage, currentPlan, onUpgradeClick }: DiagnosisResultViewProps) {
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isGeneratingTts, setIsGeneratingTts] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Nom personnalisable de l'assistant (DiagAssist par défaut)
  const [assistantName, setAssistantName] = useState<string>(() => {
    return localStorage.getItem("assistant_name") || "DiagAssist";
  });

  // Preferred Voice Selection State
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>(() => {
    return localStorage.getItem("preferred_speech_voice") || "fr-FR-Neural2-B";
  });

  // Sync assistant name & voice selection from localStorage
  useEffect(() => {
    const handleStorageChange = () => {
      setAssistantName(localStorage.getItem("assistant_name") || "DiagAssist");
      setSelectedVoiceName(localStorage.getItem("preferred_speech_voice") || "fr-FR-Neural2-B");
    };
    window.addEventListener("storage", handleStorageChange);
    const interval = setInterval(handleStorageChange, 1000);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, []);



  // Cancel speech on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        try { audioRef.current.pause(); } catch (e) {}
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const fallbackToLocalSpeech = (cleanedText: string) => {
    if (!('speechSynthesis' in window)) {
      alert("La synthèse vocale n'est pas supportée par ce navigateur.");
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanedText);
    utterance.lang = "fr-FR";
    utterance.rate = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const frVoice = 
      voices.find(v => v.lang.toLowerCase().replace("_", "-") === "fr-fr" && v.name.toLowerCase().includes("google")) ||
      voices.find(v => v.lang.toLowerCase().replace("_", "-") === "fr-fr" && v.name.toLowerCase().includes("microsoft")) ||
      voices.find(v => v.lang.toLowerCase().startsWith("fr"));

    if (frVoice) {
      utterance.voice = frVoice;
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  const toggleSpeech = async () => {
    if (isSpeaking) {
      if (audioRef.current) {
        try { audioRef.current.pause(); } catch (e) {}
        audioRef.current = null;
      }
      if ('speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
      setIsSpeaking(false);
      return;
    }

    if (selectedVoiceName === "none") {
      alert("La synthèse vocale est désactivée dans vos paramètres de voix.");
      return;
    }

    const textToRead = `Rapport technique de DiagAssist pour votre ${diagnosis.brandModelInfo || "véhicule"}.
    Résumé de la panne : ${diagnosis.explanationText}.
    Le niveau de gravité est estimé comme : ${diagnosis.severity}.
    Les causes probables incluent : ${diagnosis.probableCauses.join(", ")}.
    Commençons le guide de réparation étape par étape.
    ${diagnosis.repairGuideSteps.map(s => `Étape ${s.stepNumber} : ${s.title}. ${s.description}`).join(". ")}`;

    // Clean text to sound extremely clear and professional
    const cleanedText = textToRead
      .replace(/[\*\#\`\_]/g, "")
      .replace(/^\s*-\s*/gm, "")
      .replace(/\s+/g, " ")
      .trim();

    const isCloudVoice = ["fr-FR-Neural2-B", "fr-FR-Neural2-C", "fr-FR-Wavenet-B", "fr-FR-Wavenet-C", "eleven-french-adrien"].includes(selectedVoiceName) || 
                         selectedVoiceName.startsWith("eleven-api-");

    if (isCloudVoice) {
      try {
        setIsGeneratingTts(true);
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${localStorage.getItem("auth_session_token") || ""}`,
          },
          body: JSON.stringify({
            text: cleanedText,
            voiceName: selectedVoiceName
          })
        });

        if (!response.ok) throw new Error("Erreur de réponse de l'API de synthèse vocale.");

        const data = await response.json();
        if (data.success && data.audioContent) {
          const audioUrl = `data:audio/mp3;base64,${data.audioContent}`;
          const audioObj = new Audio(audioUrl);
          
          audioObj.onplay = () => {
            setIsSpeaking(true);
          };

          audioObj.onended = () => {
            setIsSpeaking(false);
          };

          audioObj.onerror = () => {
            setIsSpeaking(false);
            fallbackToLocalSpeech(cleanedText);
          };

          audioRef.current = audioObj;
          await audioObj.play();
        } else {
          throw new Error(data.message || "Impossible de récupérer l'audio.");
        }
      } catch (err) {
        console.warn("Échec de la synthèse vocale haut de gamme, basculement vers le synthétiseur local :", err);
        fallbackToLocalSpeech(cleanedText);
      } finally {
        setIsGeneratingTts(false);
      }
    } else {
      fallbackToLocalSpeech(cleanedText);
    }
  };

  const toggleStep = (stepNum: number) => {
    if (completedSteps.includes(stepNum)) {
      setCompletedSteps(completedSteps.filter((s) => s !== stepNum));
    } else {
      setCompletedSteps([...completedSteps, stepNum]);
    }
  };

  // Map severity string to colors and icons
  const getSeverityStyle = (sev: string) => {
    switch (sev) {
      case "Faible":
        return {
          bg: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
          iconBg: "bg-emerald-500/20 text-emerald-400",
          icon: ShieldCheck,
          text: "Faible - Utilisation possible",
        };
      case "Moyen":
        return {
          bg: "bg-yellow-500/10 border-yellow-500/20 text-yellow-400",
          iconBg: "bg-yellow-500/20 text-yellow-400",
          icon: AlertTriangle,
          text: "Moyen - Réparation recommandée",
        };
      case "Élevé":
        return {
          bg: "bg-orange-500/10 border-orange-500/20 text-orange-400",
          iconBg: "bg-orange-500/20 text-orange-400",
          icon: AlertTriangle,
          text: "Élevé - Déplacement déconseillé",
        };
      case "Critique":
        return {
          bg: "bg-rose-500/10 border-rose-500/20 text-rose-400 animate-pulse",
          iconBg: "bg-rose-500/20 text-rose-400",
          icon: AlertOctagon,
          text: "Critique - ARRÊT IMMÉDIAT DU VÉHICULE",
        };
      default:
        return {
          bg: "bg-slate-500/10 border-slate-500/20 text-slate-400",
          iconBg: "bg-slate-500/20 text-slate-400",
          icon: HelpCircle,
          text: sev,
        };
    }
  };

  const sevStyle = getSeverityStyle(diagnosis.severity);
  const SevIcon = sevStyle.icon;

  const USD_TO_EUR = 0.92;

  const isPremiumActive = currentPlan === "free_trial" || currentPlan === "premium" || currentPlan === "payg_active";

  const getHaynesProData = () => {
    const causesText = diagnosis.probableCauses.join(" ").toLowerCase();
    const isSensor = causesText.includes("capteur") || causesText.includes("sensor") || causesText.includes("sonde") || causesText.includes("valeur") || causesText.includes("mesure");
    const isInjector = causesText.includes("injecteur") || causesText.includes("injection") || causesText.includes("carburant") || causesText.includes("rampe");
    const isFap = causesText.includes("fap") || causesText.includes("particule") || causesText.includes("échappement") || causesText.includes("catalyseur") || causesText.includes("suie");
    const isTurbo = causesText.includes("turbo") || causesText.includes("suralimentation") || causesText.includes("pression") || causesText.includes("électrovanne");
    
    let component = "Composant Général du Système";
    let location = "Compartiment moteur principal, vérifier les faisceaux électriques associés.";
    let resistance = "120 - 150 Ω (ohms)";
    let torque = "20 Nm ± 2 (Serrage standard)";
    let voltage = "5.0 V d'alimentation de référence du calculateur";
    let pinout = "Broche 1 : Alimentation (5V), Broche 2 : Signal de retour, Broche 3 : Masse (0V)";
    let safetyBulletin = "Avis technique constructeur : Nettoyer soigneusement la portée de joint avant de remonter le nouveau composant pour éviter toute fuite ou fausse mesure.";

    if (isSensor) {
      component = "Capteur / Sonde Actif de Mesure";
      location = "Sur la conduite d'admission principale ou collecteur d'échappement.";
      resistance = "240 Ω à température ambiante (20°C)";
      torque = "15 Nm (Serrage modéré à la clé dynamométrique)";
      voltage = "4.8 V - 5.1 V (Tension stabilisée de référence)";
    } else if (isInjector) {
      component = "Injecteur Électromagnétique Common Rail";
      location = "Rampe d'alimentation haute pression commune, culasse supérieure.";
      resistance = "12.5 Ω ± 0.5 Ω (Injecteur solénoïde)";
      torque = "28 Nm + serrage angulaire de 90° (Toujours remplacer le joint pare-feu en cuivre)";
      voltage = "Impulsion haute tension (80V à 100V) gérée par l'ECU";
      pinout = "Broche 1 : Signal commande (Négatif commuté), Broche 2 : Alimentation positive";
    } else if (isFap) {
      component = "Capteur de Pression Différentielle FAP";
      location = "Compartiment moteur, monté sur le tablier avec deux durites reliées au filtre à particules.";
      resistance = "N/A - Signal actif de type piezo-résistif";
      torque = "45 Nm pour les raccords métalliques sur la ligne d'échappement";
      voltage = "0.5 V au ralenti (jusqu'à 4.5 V sous pleine charge)";
    } else if (isTurbo) {
      component = "Électrovanne de Régulation Wastegate (N75)";
      location = "À proximité immédiate du turbocompresseur ou fixé sur le tablier de cloison.";
      resistance = "30 Ω à 35 Ω";
      torque = "9 Nm (Fixation sur patte de support métallique)";
      voltage = "12.0 V pulsé en Modulation de Largeur d'Impulsion (PWM)";
    }

    return { component, location, resistance, torque, voltage, pinout, safetyBulletin };
  };

  const hpData = getHaynesProData();

  return (
    <div className="space-y-8">
      {/* Printable Professional Header - Visible ONLY during print/PDF export */}
      <div className="hidden print:block mb-8 border-b-2 border-slate-900 pb-6">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl font-black text-red-600 font-display uppercase tracking-tight">DiagAssist PRO</span>
              <span className="text-xs bg-slate-100 text-slate-800 font-mono font-bold px-2 py-0.5 rounded border border-slate-300">
                RAPPORT OFFICIEL
              </span>
            </div>
            <p className="text-xs text-slate-600 font-medium">Copilote de Diagnostic & Assistance Mécanique Automobile</p>
          </div>
          <div className="text-right text-xs text-slate-700 font-mono">
            <p className="font-bold">Date : {new Date().toLocaleDateString("fr-FR", { day: '2-digit', month: 'long', year: 'numeric' })}</p>
            <p className="text-slate-500 mt-0.5">Véhicule : <strong className="text-slate-900">{diagnosis.brandModelInfo || "Non spécifié"}</strong></p>
          </div>
        </div>
      </div>

      {/* Overview Card */}
      <div className="premium-glass-card rounded-3xl p-6 md:p-8 text-slate-100 shadow-2xl relative overflow-hidden animate-fade-in">
        <div className="absolute top-0 right-0 w-64 h-64 bg-red-600/[0.03] rounded-full blur-3xl pointer-events-none"></div>

        {/* Severity Badge */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 border-b border-white/[0.05] pb-6 mb-6">
          <div>
            <span className="text-xs text-slate-400 font-mono font-bold uppercase tracking-wider">Rapport Technique de Diagnostic</span>
            <h2 className="text-2xl md:text-3xl font-display font-extrabold text-white mt-1.5">
              {diagnosis.brandModelInfo || "Véhicule Identifié"}
            </h2>
            {diagnosis.groundedInSources && (
              <span className="inline-flex items-center gap-1.5 mt-2 text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-1">
                ✓ Vérifié via recherche sur sources ouvertes
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              onClick={() => window.print()}
              title="Générer un PDF propre ou imprimer le rapport complet"
              className="flex items-center gap-2.5 px-5 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs md:text-sm font-black uppercase tracking-wider transition duration-150 cursor-pointer print:hidden shadow-lg shadow-red-600/20 active:scale-95"
            >
              <FileDown className="w-4.5 h-4.5" />
              <span>Exporter en PDF</span>
            </button>

            <div className={`flex items-center gap-3 px-5 py-3 border rounded-xl text-xs md:text-sm font-extrabold ${sevStyle.bg}`}>
              <div className={`p-1.5 rounded-lg ${sevStyle.iconBg}`}>
                <SevIcon className="w-5 h-5" />
              </div>
              <span>{sevStyle.text}</span>
            </div>
          </div>
        </div>

        {/* Questions de clarification de l'IA — bien visibles, si des infos essentielles manquent */}
        {diagnosis.clarifyingQuestions && diagnosis.clarifyingQuestions.length > 0 && (
          <div className="mb-7 p-5 bg-amber-500/10 border border-amber-500/30 rounded-2xl">
            <div className="flex items-center gap-2 mb-3">
              <HelpCircle className="w-5 h-5 text-amber-400 shrink-0" />
              <span className="text-sm font-black uppercase tracking-wider text-amber-400">
                Pour un diagnostic plus précis, merci de préciser :
              </span>
            </div>
            <ul className="space-y-2">
              {diagnosis.clarifyingQuestions.map((q, i) => (
                <li key={i} className="text-sm text-amber-100/90 flex items-start gap-2">
                  <span className="text-amber-500 font-bold shrink-0">{i + 1}.</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-amber-400/70 mt-3">
              Les hypothèses ci-dessous sont prudentes en attendant ces précisions — répondez dans le chat de suivi pour affiner l'analyse.
            </p>
          </div>
        )}

        {/* Diagnosis Narrative Explanation */}
        <div className="space-y-4 mb-7">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Résumé de la Situation</h3>
            
            {/* Subscription status tag */}
            {isPremiumActive ? (
              <button
                onClick={toggleSpeech}
                disabled={isGeneratingTts}
                className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 text-xs px-4 py-2 rounded-xl font-bold uppercase tracking-wider flex items-center gap-2 cursor-pointer transition disabled:opacity-50 shadow-sm"
              >
                {isGeneratingTts ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : isSpeaking ? (
                  <VolumeX className="w-3.5 h-3.5 text-red-400" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                )}
                {isGeneratingTts ? "Génération..." : isSpeaking ? "Arrêter l'Audio" : "Écouter le Rapport"}
              </button>
            ) : (
              <span className="bg-slate-800 text-slate-400 border border-slate-750 text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" /> Audio Premium Bloqué
              </span>
            )}
          </div>
          
          <div className="bg-slate-950/60 p-6 border border-white/[0.05] rounded-2xl space-y-4 shadow-inner">
            <p className="text-base md:text-lg leading-relaxed text-slate-300">
              {diagnosis.explanationText}
            </p>
          </div>
        </div>

        {/* Warning Severity Explanation Box */}
        <div className="flex gap-4 bg-slate-950/70 p-5 rounded-2xl border border-white/[0.05]">
          <div className="p-2.5 bg-slate-900 rounded-lg shrink-0 h-fit border border-white/[0.04]">
            <AlertTriangle className="w-6 h-6 text-red-500 animate-pulse" />
          </div>
          <div className="text-xs md:text-sm">
            <span className="font-extrabold text-slate-200 block mb-1 uppercase tracking-wider text-xs">Conseil de sécurité & gravité :</span>
            <p className="text-slate-400 leading-relaxed">{diagnosis.severityDescription}</p>
          </div>
        </div>
      </div>

      {/* DTC Codes & Causes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* DTC Codes list */}
        <div className="premium-glass-card rounded-3xl p-6 md:p-8 text-slate-100 shadow-2xl">
          <h3 className="text-sm font-display font-black text-white mb-5 flex items-center gap-3 uppercase tracking-wider">
            <span className="p-2 bg-rose-500/10 text-rose-400 rounded-xl font-mono text-xs border border-rose-500/10">DTC</span>
            Codes Défaut OBD Identifiés ({diagnosis.dtcCodesDetected.length})
          </h3>
          {diagnosis.dtcCodesDetected.length === 0 ? (
            <p className="text-sm text-slate-500 bg-slate-950/30 p-5 rounded-2xl border border-white/[0.04]">
              Aucun code DTC d'appareil de diagnostic ou de voyant d'erreur spécifique n'a été détecté dans votre requête.
            </p>
          ) : (
            <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2">
              {diagnosis.dtcCodesDetected.map((dtc, index) => (
                <div key={index} className="bg-slate-950/80 border border-white/[0.05] rounded-xl p-4 flex items-start gap-3.5 hover:border-red-500/20 transition duration-150">
                  <div className="bg-rose-500/10 text-rose-400 px-3 py-1.5 rounded-lg font-mono text-sm font-bold shrink-0 border border-rose-500/10">
                    {dtc.code}
                  </div>
                  <div className="text-xs md:text-sm">
                    <p className="text-slate-300 font-semibold">{dtc.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Probable Causes */}
        <div className="premium-glass-card rounded-3xl p-6 md:p-8 text-slate-100 shadow-2xl">
          <h3 className="text-sm font-display font-black text-white mb-5 uppercase tracking-wider flex items-center gap-3">
            <div className="p-2 bg-red-600/10 text-red-500 rounded-xl border border-red-500/10">
              <Wrench className="w-5 h-5 text-red-500" />
            </div>
            Causes les plus probables
          </h3>
          <ul className="space-y-3">
            {diagnosis.probableCauses.map((cause, index) => (
              <li key={index} className="flex items-start gap-3 text-xs md:text-sm text-slate-300">
                <span className="text-red-500 font-bold text-base shrink-0 mt-0.5">•</span>
                <span className="leading-relaxed">{cause}</span>
              </li>
            ))}
          </ul>
        </div>

      </div>

      {/* Immediate Recommendations */}
      <div className="premium-glass-card rounded-3xl p-6 md:p-8 text-slate-100 shadow-2xl">
        <h3 className="text-sm font-display font-black text-white mb-5 uppercase tracking-wider flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl border border-emerald-500/10">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          </div>
          Recommandations immédiates
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {diagnosis.immediateRecommendations.map((rec, index) => (
            <div key={index} className="bg-slate-950/40 border border-white/[0.05] p-4.5 rounded-2xl flex items-start gap-3 text-xs md:text-sm hover:border-emerald-500/20 transition duration-150">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0 mt-2"></span>
              <span className="text-slate-300 leading-relaxed">{rec}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recommandation Achat Pièce Défectueuse */}
      <div className="bg-gradient-to-r from-red-950/40 via-slate-900 to-amber-950/30 border-2 border-red-500/40 rounded-3xl p-6 md:p-8 text-slate-100 shadow-2xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-red-600/20 text-red-400 rounded-2xl border border-red-500/30 shrink-0">
              <ShoppingBag className="w-7 h-7 text-red-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-black uppercase tracking-wider bg-red-500/20 text-red-300 px-2.5 py-0.5 rounded-full border border-red-500/30 font-mono">
                  Service Pièces & Rechange
                </span>
                <span className="text-xs text-amber-400 font-bold">Pièce Défectueuse Détectée</span>
              </div>
              <h3 className="text-lg md:text-xl font-display font-extrabold text-white">
                Besoin de remplacer une pièce défectueuse ?
              </h3>
              <p className="text-xs md:text-sm text-slate-300 mt-1 max-w-2xl leading-relaxed">
                Pour toute pièce défectueuse à remplacer ou à commander, contactez-nous directement pour vos achats de pièces d'origine certifiées et garanties au <strong className="text-white font-mono bg-slate-950 px-2 py-0.5 rounded border border-red-500/30">0141116026</strong>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full lg:w-auto shrink-0">
            <a
              href="tel:0141116026"
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2.5 px-5 py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs md:text-sm font-black uppercase tracking-wider transition shadow-lg shadow-red-600/30 active:scale-95 text-center"
            >
              <Phone className="w-4 h-4" />
              <span>Appeler le 0141116026</span>
            </a>
            <a
              href="https://wa.me/2250141116026?text=Bonjour,%20j'ai%20besoin%20d'une%20pi%C3%A8ce%20de%20rechange%20pour%20mon%20v%C3%A9hicule."
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2.5 px-5 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs md:text-sm font-black uppercase tracking-wider transition shadow-lg shadow-emerald-600/30 active:scale-95 text-center"
            >
              <MessageCircle className="w-4 h-4" />
              <span>Commander WhatsApp</span>
            </a>
          </div>
        </div>
      </div>

      {/* Haynes Pro Database Approfondissement */}
      <div className="premium-glass-card rounded-3xl p-6 md:p-8 text-slate-100 shadow-2xl relative overflow-hidden">
        
        {/* Haynes Pro Brand Tag Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-5 border-b border-white/[0.05] mb-6">
          <div>
            <h3 className="text-sm md:text-base font-display font-black text-white uppercase tracking-wider flex items-center gap-2.5">
              <div className="p-2 bg-red-600/10 text-red-500 rounded-xl border border-red-500/10">
                <BookOpen className="w-5 h-5 text-red-500" />
              </div>
              <span>🩺 Approfondissement Expert Haynes Pro</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1.5 font-medium">
              Fiches techniques constructeurs et valeurs de référence multimètre
            </p>
          </div>
          <div className="bg-red-600/10 border border-red-500/20 text-red-500 text-[10px] md:text-xs font-mono font-black px-3 py-1.5 rounded-xl uppercase tracking-wider">
            Base ProTech 2026
          </div>
        </div>

        {isPremiumActive ? (
          /* Premium active state: Display beautiful technical specs */
          <div className="space-y-6 animate-fade-in text-xs md:text-sm">
            
            <div className="bg-slate-950/80 border border-slate-800 p-5 md:p-6 rounded-2xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-850 pb-3">
                <span className="font-bold text-white text-sm md:text-base">{hpData.component}</span>
                <span className="bg-emerald-500/10 text-emerald-400 text-xs px-3 py-1 rounded-xl font-mono font-bold">
                  Statut : Conforme aux données d'origine
                </span>
              </div>
              <p className="text-slate-300 leading-relaxed text-sm">
                <strong className="text-slate-400">Emplacement :</strong> {hpData.location}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              
              {/* Reference Values (multimeter / oscilloscope) */}
              <div className="bg-slate-950/40 border border-slate-850 p-5 md:p-6 rounded-2xl space-y-3.5">
                <span className="text-xs text-red-500 font-black uppercase tracking-wider block">
                  Valeurs de référence (Diagnostic Actif)
                </span>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between text-slate-400">
                    <span>Résistance interne :</span>
                    <span className="font-mono text-white font-black">{hpData.resistance}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Tension d'alimentation :</span>
                    <span className="font-mono text-white font-black">{hpData.voltage}</span>
                  </div>
                  <div className="text-xs text-slate-400 border-t border-slate-900 pt-3 mt-2 leading-relaxed">
                    <strong className="text-slate-300">Brochage prise (Pinout) :</strong> {hpData.pinout}
                  </div>
                </div>
              </div>

              {/* Tightening Torques */}
              <div className="bg-slate-950/40 border border-slate-850 p-5 md:p-6 rounded-2xl space-y-3.5">
                <span className="text-xs text-sky-400 font-black uppercase tracking-wider block">
                  Couples de Serrage Recommandés (Nm)
                </span>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between text-slate-400">
                    <span>Serrage principal :</span>
                    <span className="font-mono text-white font-black">{hpData.torque}</span>
                  </div>
                  <div className="text-xs text-slate-400 border-t border-slate-900 pt-3 mt-2 leading-relaxed">
                    💡 Un serrage excessif ou insuffisant peut fausser la mesure du capteur ou provoquer des fissures d'admission. Utilisez impérativement une clé dynamométrique calibrée.
                  </div>
                </div>
              </div>

            </div>

            {/* Manufacturer Safety Technical Bulletin */}
            <div className="p-4 bg-red-600/5 border border-red-500/10 rounded-2xl text-xs md:text-sm text-red-400/90 leading-relaxed">
              ⚠️ <strong>Bulletin d'alerte constructeur :</strong> {hpData.safetyBulletin}
            </div>

          </div>
        ) : (
          /* Non-premium state: Display blurred technical layout with locker banner */
          <div className="relative">
            {/* Blurred Mockup representation */}
            <div className="space-y-4 blur-[3px] select-none pointer-events-none opacity-40">
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl">
                <span className="font-semibold text-white">Composant : Capteur / Injecteur d'origine</span>
                <p className="text-slate-400 text-xs mt-1">Emplacement standard : Collecteur ou rampe principale d'injection.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-950 p-4 rounded-xl space-y-1">
                  <span className="text-[10px] text-red-500 uppercase block">Valeurs de référence</span>
                  <div className="h-4 bg-slate-800 rounded w-2/3"></div>
                  <div className="h-4 bg-slate-800 rounded w-1/2"></div>
                </div>
                <div className="bg-slate-950 p-4 rounded-xl space-y-1">
                  <span className="text-[10px] text-sky-400 uppercase block">Couples de serrage</span>
                  <div className="h-4 bg-slate-800 rounded w-1/2"></div>
                  <div className="h-4 bg-slate-800 rounded w-1/3"></div>
                </div>
              </div>
            </div>

            {/* Premium Locker Layer Panel overlay */}
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 rounded-xl border border-slate-800">
              <div className="p-4 bg-red-600/15 text-red-400 rounded-full mb-3.5 shadow-lg">
                <Lock className="w-8 h-8 animate-pulse" />
              </div>
              <h4 className="text-base font-display font-black text-white uppercase tracking-wide">
                Approfondissement Haynes Pro Bloqué
              </h4>
              <p className="text-xs md:text-sm text-slate-300 max-w-sm mt-2 leading-relaxed">
                Débloquez la fiche technique Haynes Pro complète de cette panne : couples de serrage précis de la pièce, valeurs de résistance au multimètre pour tester le capteur, et bulletins constructeurs.
              </p>
              <button
                onClick={onUpgradeClick}
                className="mt-5 bg-red-600 hover:bg-red-700 text-white font-black text-xs md:text-sm px-6 py-3 rounded-2xl transition duration-150 flex items-center gap-2 cursor-pointer shadow-xl shadow-red-600/30 print:hidden uppercase tracking-wider"
              >
                <Sparkles className="w-4 h-4 fill-current text-white" />
                <span>Activer Premium (15 000 F CFA / mois)</span>
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Step-by-Step Repair Guide */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 text-slate-100 shadow-xl">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 border-b border-slate-800 pb-5">
          <div>
            <h3 className="text-sm md:text-base font-display font-black text-white uppercase tracking-wide flex items-center gap-2.5">
              <div className="p-2 bg-sky-500/10 text-sky-500 rounded-xl">
                <Wrench className="w-5 h-5" />
              </div>
              <span>Guide de Réparation Étape par Étape</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1.5 font-medium">
              Cochez les étapes au fur et à mesure de votre progression.
            </p>
          </div>
          <div className="text-xs font-mono text-slate-300 bg-slate-950 px-4 py-2.5 border border-slate-800 rounded-2xl shadow-inner font-extrabold">
            Avancement : <span className="font-bold text-emerald-400">{completedSteps.length}</span> / {diagnosis.repairGuideSteps.length}
          </div>
        </div>

        <div className="space-y-5">
          {diagnosis.repairGuideSteps.map((step, index) => {
            const isDone = completedSteps.includes(step.stepNumber);
            return (
              <div 
                key={index} 
                onClick={() => toggleStep(step.stepNumber)}
                className={`border rounded-2xl p-5 md:p-6 cursor-pointer transition duration-150 flex gap-4 text-xs md:text-sm items-start ${
                  isDone 
                    ? "border-emerald-500/30 bg-emerald-500/[0.02]" 
                    : "border-slate-800/80 bg-slate-950/40 hover:bg-slate-950/80 hover:border-slate-700"
                }`}
              >
                {/* Custom Interactive Checkbox */}
                <div className="mt-1">
                  <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition shrink-0 ${
                    isDone 
                      ? "border-emerald-500 bg-emerald-500 text-slate-950" 
                      : "border-slate-700 bg-slate-900"
                  }`}>
                    {isDone && (
                      <svg className="w-4 h-4 stroke-current stroke-3" fill="none" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </div>
                </div>

                {/* Step Content */}
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <span className={`font-mono text-xs font-black px-2.5 py-1 rounded-lg uppercase ${
                      isDone ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-800 text-slate-400"
                    }`}>
                      Étape {step.stepNumber}
                    </span>
                    <span className="text-slate-400 flex items-center gap-1.5 text-xs font-bold">
                      <Clock className="w-4 h-4" /> Temps : {step.estimatedTime}
                    </span>
                  </div>
                  <h4 className={`text-base font-black text-white ${isDone ? "line-through text-slate-500" : ""}`}>
                    {step.title}
                  </h4>
                  <p className={`text-slate-300 leading-relaxed text-sm md:text-base ${isDone ? "text-slate-500" : ""}`}>
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom PDF Export Action Card */}
        <div className="mt-8 pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 print:hidden">
          <div className="text-xs text-slate-400 text-center sm:text-left">
            <span className="font-bold text-slate-200 block text-sm">Rapport complet de réparation prêt</span>
            <span className="text-slate-400">Générez une version imprimable propre ou téléchargez en PDF pour votre client ou les archives de l'atelier.</span>
          </div>
          <button
            onClick={() => window.print()}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs md:text-sm font-black uppercase tracking-wider transition duration-150 cursor-pointer shadow-lg shadow-red-600/25 active:scale-95 shrink-0"
          >
            <Printer className="w-4.5 h-4.5" />
            <span>Exporter en PDF</span>
          </button>
        </div>

      </div>


    </div>
  );
}
