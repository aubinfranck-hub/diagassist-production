import { useState } from "react";
import { 
  Sparkles, Wrench, Compass, Info, Mic, Volume2, VolumeX, ChevronLeft, ChevronRight, 
  CheckCircle2, AlertTriangle, ShieldCheck, Cpu, Database, Activity, Check, ListChecks,
  Phone, ShoppingBag
} from "lucide-react";
import { Diagnosis, SubscriptionPlan } from "../types";

interface VisualRepairAssistantProps {
  diagnosis: Diagnosis;
  currentPlan: SubscriptionPlan;
  onUpgradeClick: () => void;
}

export default function VisualRepairAssistant({ diagnosis, currentPlan, onUpgradeClick }: VisualRepairAssistantProps) {
  // Stepper state to guide the mechanic step-by-step through the 5 Modules
  const [activeModule, setActiveModule] = useState<number>(1);
  
  // States for interactive checklist items in Module 3
  const [checkedSteps, setCheckedSteps] = useState<Record<number, boolean>>({});
  
  // Voice simulation state
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [vocalHistory, setVocalHistory] = useState<{ role: "user" | "assistant"; text: string }[]>([
    { role: "assistant", text: "DiagAssist, je t'écoute. Dis-moi ce que tu veux tester." }
  ]);

  const isPremiumActive = currentPlan === "free_trial" || currentPlan === "premium" || currentPlan === "payg_active";

  // Dynamic values based on diagnosis
  const selectedDtc = diagnosis.dtcCodesDetected && diagnosis.dtcCodesDetected.length > 0
    ? diagnosis.dtcCodesDetected[0]
    : { code: "P0101", description: "Débitmètre d'air massique - signal hors tolérance" };

  const brandModel = diagnosis.brandModelInfo || "Véhicule Générique";
  const descLower = selectedDtc.description.toLowerCase() + " " + (diagnosis.explanationText || "").toLowerCase();

  // Determine car system context
  const isEbp = descLower.includes("frein") || descLower.includes("park") || selectedDtc.code.includes("C11");
  const isMaf = descLower.includes("débitmètre") || descLower.includes("admission") || descLower.includes("air") || selectedDtc.code.includes("P010");
  const isInjector = descLower.includes("injecteur") || descLower.includes("rampe") || descLower.includes("carburant") || selectedDtc.code.includes("P020");
  const isTurbo = descLower.includes("turbo") || descLower.includes("suralimentation") || selectedDtc.code.includes("P023");

  // Custom data to populate modules clearly
  let partName = "Capteur / Actionneur";
  let systemName = "Système moteur";
  let gravity = "Moyenne";
  let difficulty = "Moyen (Niveau 2)";
  let tools = ["Multimètre", "Coffret de douilles standard", "Nettoyant contact"];
  let timeEstimate = "30 - 45 minutes";
  
  let causes = [
    "Câblage ou connecteur endommagé",
    "Capteur défectueux ou encrassé",
    "Fusible d'alimentation grillé"
  ];

  if (isEbp) {
    partName = "Actionneur d'Étrier de Frein Électrique (EPB)";
    systemName = "Châssis & Système de Freinage";
    gravity = "Élevée (Sécurité)";
    difficulty = "Difficile (Niveau 3)";
    tools = ["Clé Torx T30", "Cric et chandelles", "Multimètre numérique", "Valise DiagAssist"];
    timeEstimate = "45 - 60 minutes";
    causes = [
      "Moteur de l'étrier électrique grippé ou usé",
      "Faisceau électrique coupé près du bras de suspension",
      "Humidité ou corrosion dans le connecteur de l'étrier"
    ];
  } else if (isMaf) {
    partName = "Débitmètre d'Air Massique (MAF)";
    systemName = "Admission d'Air & Moteur";
    gravity = "Moyenne (Perte de puissance / Fumée noire)";
    difficulty = "Facile (Niveau 1)";
    tools = ["Tournevis cruciforme", "Nettoyant aérosol pour débitmètre", "Chiffon propre"];
    timeEstimate = "15 - 20 minutes";
    causes = [
      "Fil chaud du débitmètre encrassé par des vapeurs d'huile",
      "Prise d'air ou fissure sur la durite d'admission",
      "Fiches du connecteur oxydées ou mal clipsées"
    ];
  } else if (isInjector) {
    partName = "Injecteur de Carburant Common Rail";
    systemName = "Injection & Carburation";
    gravity = "Élevée (Risque de claquement moteur)";
    difficulty = "Difficile (Niveau 3)";
    tools = ["Clé à tuyauter 17mm", "Clé dynamométrique", "Extracteur d'injecteur", "Joint pare-feu neuf"];
    timeEstimate = "60 - 90 minutes";
    causes = [
      "Grippage interne de l'aiguille d'injecteur (calamine)",
      "Bobine solénoïde ou élément piézo-électrique en court-circuit",
      "Fils d'alimentation endommagés sur la rampe commune"
    ];
  } else if (isTurbo) {
    partName = "Électrovanne de Régulation de Turbo (N75)";
    systemName = "Suralimentation & Turbocompresseur";
    gravity = "Élevée (Mode dégradé sans puissance)";
    difficulty = "Moyen (Niveau 2)";
    tools = ["Pince pour colliers", "Pompe à vide manuelle", "Multimètre"];
    timeEstimate = "30 - 40 minutes";
    causes = [
      "Durites de dépression poreuses, percées ou débranchées",
      "Membrane de la capsule de turbo (wastegate) percée",
      "Électrovanne N75 grippée électriquement ou filtre bouché"
    ];
  }

  // Define steps for Module 3 (Diagnostic) & Module 4 (Réparation)
  const diagSteps = [
    { num: 1, title: "Contrôle Visuel Rapide", detail: "Vérifiez que le connecteur de la pièce est bien branché et que le faisceau électrique n'est pas coupé ou frotté contre le moteur." },
    { num: 2, title: "Mesure de la Tension d'Alimentation", detail: "Débranchez la pièce, mettez le contact du véhicule (sans démarrer). Avec un multimètre sur le calibre 20V continu, mesurez la tension entre la borne positive d'alimentation et la masse châssis. Vous devez trouver environ 5V ou 12V." },
    { num: 3, title: "Mesure de la Résistance Interne", detail: "Coupez le contact. Réglez le multimètre sur Ohm (Ω). Mesurez la résistance directement sur les broches de la pièce. Comparez la valeur obtenue avec les données constructeur." },
    { num: 4, title: "Vérification des durites / tuyaux d'air", detail: "Si applicable, inspectez l'étanchéité des durites connectées au système d'admission ou de dépression." },
    { num: 5, title: "Effacement des codes défauts", detail: "Après réparation ou échange, utilisez l'onglet de diagnostic pour effacer le code DTC de la mémoire du calculateur et faites un essai routier." }
  ];

  const repairSteps = [
    { num: 1, title: "Sécurisation", instruction: "Coupez le moteur et le contact. Attendez 10 minutes que le moteur refroidisse pour éviter tout risque de brûlure." },
    { num: 2, title: "Démontage d'accès", instruction: `Retirez le cache plastique du moteur ou la boîte à air avec vos outils de démontage si nécessaire pour atteindre le composant : ${partName}.` },
    { num: 3, title: "Déconnexion électrique", instruction: "Appuyez sur le clip de sécurité du connecteur en plastique et tirez doucement sans forcer pour libérer la fiche." },
    { num: 4, title: "Remplacement / Nettoyage", instruction: `Dévissez les fixations de la pièce. Nettoyez ou remplacez la pièce défectueuse par la nouvelle référence certifiée.` },
    { num: 5, title: "Remontage", instruction: "Remontez le tout dans le sens inverse. Serrez modérément les vis sans écraser les joints." }
  ];

  // Synthesis engine for voice command simulation
  const speakText = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    setIsSynthesizing(true);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = 1.0;

    utterance.onend = () => setIsSynthesizing(false);
    utterance.onerror = () => setIsSynthesizing(false);
    window.speechSynthesis.speak(utterance);
  };

  const handleVoiceSimulation = (command: string, promptText: string, responseText: string) => {
    const newHistory = [
      ...vocalHistory,
      { role: "user" as const, text: promptText },
      { role: "assistant" as const, text: responseText }
    ];
    setVocalHistory(newHistory);
    speakText(responseText);
  };

  const toggleCheckStep = (num: number) => {
    setCheckedSteps(prev => ({ ...prev, [num]: !prev[num] }));
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-slate-100 shadow-xl space-y-6 animate-fade-in">
      
      {/* HEADER SECTION */}
      <div className="border-b border-slate-800 pb-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
            Assistant de Réparation Guidée IA
          </span>
          <span className="bg-slate-800 text-slate-400 text-[10px] px-2 py-0.5 rounded font-mono">
            {brandModel}
          </span>
        </div>
        
        <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <Wrench className="w-5 h-5 text-red-500" />
          Guide Technique de Réparation Automobile
        </h2>
        
        <p className="text-xs text-slate-400 leading-relaxed">
          Pour vous simplifier le travail, nous avons découpé l'intervention en <strong>5 modules clairs et successifs</strong>. Cliquez sur les étapes ci-dessous pour suivre la procédure pas à pas en atelier.
        </p>
      </div>

      {/* STEPPER NAVIGATION (THE 5 MODULES) */}
      <div className="grid grid-cols-5 gap-2 pb-2">
        {[
          { id: 1, label: "1. Analyse", icon: "📋" },
          { id: 2, label: "2. Emplacement", icon: "📍" },
          { id: 3, label: "3. Diagnostic", icon: "⚡" },
          { id: 4, label: "4. Réparation", icon: "🛠️" },
          { id: 5, label: "5. Voix IA", icon: "🎙️" }
        ].map((mod) => (
          <button
            key={mod.id}
            onClick={() => setActiveModule(mod.id)}
            className={`py-3 px-1 rounded-xl border flex flex-col items-center gap-1.5 transition text-center ${
              activeModule === mod.id
                ? "bg-red-600/10 border-red-500 text-white font-bold"
                : "bg-slate-950/60 border-slate-850 text-slate-400 hover:bg-slate-900 hover:text-slate-200"
            }`}
          >
            <span className="text-lg">{mod.icon}</span>
            <span className="text-[10px] sm:text-[11px] font-medium hidden sm:inline">{mod.label}</span>
            <span className="text-[10px] font-bold sm:hidden">{mod.id}</span>
          </button>
        ))}
      </div>

      {/* MODULE CONTAINER VIEW */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 min-h-[300px]">
        
        {/* MODULE 1: ANALYSE DU DEFAUT */}
        {activeModule === 1 && (
          <div className="space-y-4">
            <div className="border-b border-slate-900 pb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="text-base">📋</span> Module 1 : Analyse technique du code défaut
              </h3>
              <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                gravity.includes("Élevée") ? "bg-red-500/10 text-red-400" : "bg-yellow-500/10 text-yellow-400"
              }`}>
                Gravité : {gravity}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1 md:col-span-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Code Défaut Obtenu</span>
                <div className="text-2xl font-mono font-black text-red-500">{selectedDtc.code}</div>
                <p className="text-[11px] text-slate-300 font-medium leading-relaxed mt-1">
                  {selectedDtc.description}
                </p>
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1.5 md:col-span-2">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">🛠️ Système affecté</span>
                <span className="text-xs font-bold text-white block bg-slate-950 px-2.5 py-1 rounded border border-slate-850 w-fit">
                  {systemName}
                </span>
                <p className="text-xs text-slate-400 leading-relaxed pt-1">
                  Ce défaut indique une anomalie mesurée par le calculateur moteur concernant le composant : <strong>{partName}</strong>. Cela entraîne généralement des baisses de régime ou l'allumage du voyant moteur orange.
                </p>
              </div>
            </div>

            <div className="p-4 bg-red-650/5 border border-red-500/10 rounded-xl space-y-2">
              <span className="text-[11px] font-bold text-red-400 block uppercase tracking-wider">
                🔍 Causes possibles les plus fréquentes (Classées par probabilité) :
              </span>
              <ol className="text-xs space-y-1.5 list-decimal list-inside text-slate-300">
                {causes.map((cause, i) => (
                  <li key={i} className="leading-relaxed">
                    <strong className="text-white">Cause {i+1} :</strong> {cause}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {/* MODULE 2: LOCALISATION VISUELLE */}
        {activeModule === 2 && (
          <div className="space-y-4">
            <div className="border-b border-slate-900 pb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="text-base">📍</span> Module 2 : Où se trouve cette pièce dans le moteur ?
              </h3>
              <span className="bg-slate-900 text-slate-400 text-[10px] px-2 py-0.5 rounded font-mono border border-slate-800">
                Composant : {partName}
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-center">
              {/* Interactive Vector Map Graphic */}
              <div className="relative bg-slate-950 border border-slate-900 rounded-xl h-[220px] overflow-hidden flex items-center justify-center">
                <svg className="w-full h-full text-slate-800" viewBox="0 0 500 300" fill="none">
                  {/* Grid background */}
                  <defs>
                    <pattern id="grid-mod2" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255, 255, 255, 0.02)" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#grid-mod2)" />

                  {/* Car Frame Line */}
                  <path d="M 60,150 C 60,100 110,90 160,90 L 320,90 C 370,90 410,120 430,150 C 450,180 430,210 400,210 L 100,210 C 80,210 60,190 60,150 Z" 
                        stroke="rgba(148, 163, 184, 0.15)" strokeWidth="1.5" />
                  
                  {/* Wheels */}
                  <circle cx="130" cy="210" r="25" stroke="rgba(148, 163, 184, 0.2)" strokeWidth="2" fill="rgba(15, 23, 42, 0.8)" />
                  <circle cx="350" cy="210" r="25" stroke="rgba(148, 163, 184, 0.2)" strokeWidth="2" fill="rgba(15, 23, 42, 0.8)" />

                  {/* Highlight target hotspot */}
                  {isEbp ? (
                    <>
                      <circle cx="350" cy="210" r="16" className="fill-red-600/20 stroke-red-500 animate-pulse" strokeWidth="2.5" />
                      <circle cx="350" cy="210" r="5" className="fill-red-500" />
                      <text x="240" y="240" fill="#f87171" className="text-xs font-bold font-mono">Arrière (Étriers de freins)</text>
                    </>
                  ) : (
                    <>
                      {/* Engine Area Hotspot for MAF, Injectors, Turbo */}
                      <circle cx="150" cy="130" r="18" className="fill-red-600/20 stroke-red-500 animate-pulse" strokeWidth="2.5" />
                      <circle cx="150" cy="130" r="5" className="fill-red-500" />
                      <text x="90" y="175" fill="#f87171" className="text-xs font-bold font-mono">Compartiment Moteur</text>
                    </>
                  )}
                </svg>

                <div className="absolute top-2 left-2 bg-slate-900/95 border border-slate-800 px-2 py-1 rounded text-[10px] text-red-400 font-mono font-bold">
                  ⚠️ ZONE CIBLE SÉLECTIONNÉE
                </div>
              </div>

              {/* Explanatory text of the location */}
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Description de l'emplacement :</span>
                  <p className="text-slate-200 leading-relaxed font-medium">
                    {isEbp 
                      ? "L'actionneur de frein est fixé à l'arrière de l'étrier de frein à disque, directement derrière la roue concernée."
                      : isMaf 
                      ? "Le débitmètre est installé sur le gros tube d'admission d'air, juste à la sortie du boîtier de filtre à air principal."
                      : isInjector
                      ? "Les injecteurs sont implantés sur le dessus de la culasse moteur, reliés aux tuyaux métalliques haute pression de la rampe commune."
                      : "L'électrovanne se trouve fixée sur la cloison d'habitacle au fond du compartiment moteur, reconnaissable à ses 3 tuyaux de dépression en caoutchouc."
                    }
                  </p>
                </div>

                <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Identification du connecteur :</span>
                  <p className="text-slate-300">
                    Fiche électrique en plastique noir avec <strong>{isMaf ? "5 broches (pins)" : "2 broches d'alimentation"}</strong> et un ergot de verrouillage gris ou jaune.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MODULE 3: DIAGNOSTIC PAS A PAS */}
        {activeModule === 3 && (
          <div className="space-y-4">
            <div className="border-b border-slate-900 pb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="text-base">⚡</span> Module 3 : Diagnostic de test avant remplacement
              </h3>
              <span className="text-[10px] bg-slate-900 text-slate-400 px-2 py-0.5 rounded border border-slate-800 flex items-center gap-1">
                <ListChecks className="w-3.5 h-3.5" /> Liste de contrôles
              </span>
            </div>

            <p className="text-xs text-slate-400">
              Ne remplacez pas la pièce aveuglément ! Cochez chaque test effectué avec votre multimètre pour valider la panne :
            </p>

            <div className="space-y-2.5">
              {diagSteps.map((step) => (
                <div 
                  key={step.num}
                  onClick={() => toggleCheckStep(step.num)}
                  className={`p-3.5 rounded-xl border transition cursor-pointer flex gap-3.5 items-start ${
                    checkedSteps[step.num]
                      ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300"
                      : "bg-slate-900 border-slate-800/80 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  <div className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition ${
                    checkedSteps[step.num] ? "bg-emerald-500 border-emerald-500 text-slate-950" : "border-slate-700 bg-slate-950"
                  }`}>
                    {checkedSteps[step.num] && <Check className="w-4 h-4 stroke-[3]" />}
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      Test {step.num} : {step.title}
                    </span>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {step.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MODULE 4: GUIDE DE REPARATION */}
        {activeModule === 4 && (
          <div className="space-y-4">
            <div className="border-b border-slate-900 pb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="text-base">🛠️</span> Module 4 : Procédure de dépose et repose
              </h3>
              <div className="flex gap-2">
                <span className="bg-slate-900 text-slate-300 text-[10px] px-2 py-0.5 rounded border border-slate-800 font-bold">
                  ⏱️ {timeEstimate}
                </span>
                <span className="bg-slate-900 text-slate-300 text-[10px] px-2 py-0.5 rounded border border-slate-800 font-bold">
                  📊 {difficulty}
                </span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl text-xs space-y-1.5">
              <span className="font-bold text-slate-400">🔧 Outils requis :</span>
              <div className="flex flex-wrap gap-1.5">
                {tools.map((t, idx) => (
                  <span key={idx} className="bg-slate-950 text-slate-200 border border-slate-800 px-2.5 py-1 rounded-lg text-[10px] font-medium">
                    {t}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-3 text-xs">
              {repairSteps.map((step) => (
                <div key={step.num} className="p-3 bg-slate-900/40 border border-slate-850 rounded-xl flex gap-3.5 items-start">
                  <span className="w-6 h-6 rounded-full bg-red-600/10 border border-red-500/20 text-red-400 font-bold font-mono text-xs flex items-center justify-center shrink-0">
                    {step.num}
                  </span>
                  <div className="space-y-1">
                    <span className="font-bold text-white">{step.title}</span>
                    <p className="text-slate-300 leading-relaxed text-[11px]">{step.instruction}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Achat Pièce Défectueuse Contact Box */}
            <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-red-950/40 via-slate-900 to-slate-900 border border-red-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-red-600/20 text-red-400 rounded-lg shrink-0">
                  <ShoppingBag className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-bold text-white block">Pièce défectueuse à remplacer ?</span>
                  <span className="text-slate-400 text-[11px]">Commandez votre pièce de rechange garantie au <strong>0141116026</strong>.</span>
                </div>
              </div>
              <a
                href="tel:0141116026"
                className="w-full sm:w-auto px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg flex items-center justify-center gap-1.5 transition text-[11px] shrink-0"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>0141116026</span>
              </a>
            </div>
          </div>
        )}

        {/* MODULE 5: ASSISTANT VOCAL */}
        {activeModule === 5 && (
          <div className="space-y-4">
            <div className="border-b border-slate-900 pb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="text-base">🎙️</span> Module 5 : Discuter à voix haute avec l'IA
              </h3>
              
              {/* Mic / speaker mute indicator */}
              <button
                onClick={() => {
                  if ('speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                  }
                  setIsSynthesizing(false);
                }}
                className={`p-1.5 rounded-lg border transition ${
                  isSynthesizing 
                    ? "bg-red-600/20 border-red-500/30 text-red-500" 
                    : "bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300"
                }`}
                title="Arrêter la voix"
              >
                {isSynthesizing ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-normal">
              Posez une question technique par commande vocale. L'assistant vous répond instantanément à l'écrit et à l'oral pour garder vos mains libres sur le moteur.
            </p>

            {/* Vocal Interaction logs screen simulated bubble */}
            <div className="bg-slate-950 border border-slate-900 rounded-xl p-3 h-[140px] overflow-y-auto space-y-2.5 scrollbar-thin scrollbar-thumb-slate-800">
              {vocalHistory.map((log, index) => (
                <div 
                  key={index} 
                  className={`flex flex-col space-y-0.5 text-xs max-w-[85%] ${
                    log.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
                  }`}
                >
                  <span className="text-[8px] text-slate-500 font-semibold uppercase tracking-wider">
                    {log.role === "user" ? "Mécanicien (Vous)" : "Assistant DiagAssist"}
                  </span>
                  <div className={`p-2.5 rounded-2xl leading-normal ${
                    log.role === "user" 
                      ? "bg-red-600 text-white rounded-tr-none font-medium" 
                      : "bg-slate-900 text-slate-300 rounded-tl-none border border-slate-800"
                  }`}>
                    {log.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Preconfigured Vocal mechanic command triggers */}
            <div className="space-y-2">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                👉 Cliquez sur une commande vocale ci-dessous pour l'essayer :
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <button
                  onClick={() => handleVoiceSimulation(
                    "explain", 
                    "Explique-moi la cause de ce problème.",
                    `Le code défaut indique un dysfonctionnement de la pièce : ${partName}. Les causes les plus fréquentes sont soit de la saleté accumulée sur le capteur, soit un fil coupé dans le câblage d'alimentation.`
                  )}
                  className="p-3 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-xl text-left text-slate-200 font-semibold flex items-center gap-2 transition"
                >
                  💬 "Explique-moi cette panne."
                </button>
                <button
                  onClick={() => handleVoiceSimulation(
                    "where", 
                    "Montre-moi où se trouve la pièce.",
                    `D'après notre base de données pour ${brandModel}, le composant se situe dans la zone : ${systemName}. Reportez-vous au schéma du Module 2 pour voir le point clignotant rouge.`
                  )}
                  className="p-3 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-xl text-left text-slate-200 font-semibold flex items-center gap-2 transition"
                >
                  📍 "Où se trouve la pièce ?"
                </button>
                <button
                  onClick={() => handleVoiceSimulation(
                    "measure", 
                    "Quelle mesure dois-je prendre au multimètre ?",
                    "Mettez le contact et réglez le multimètre sur volts continus. Mesurez ensuite entre cinq et douze volts sur le connecteur d'alimentation débranché."
                  )}
                  className="p-3 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-xl text-left text-slate-200 font-semibold flex items-center gap-2 transition"
                >
                  ⚡ "Quelle mesure dois-je prendre ?"
                </button>
                <button
                  onClick={() => handleVoiceSimulation(
                    "next", 
                    "Quelle est la prochaine étape de réparation ?",
                    "Maintenant que les tests électriques sont validés, passez au Module 4 pour dévisser et démonter le composant défectueux en toute sécurité."
                  )}
                  className="p-3 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-xl text-left text-slate-200 font-semibold flex items-center gap-2 transition"
                >
                  ⏭️ "Quelle est la prochaine étape ?"
                </button>
              </div>
            </div>

            {/* Simulated Live Microphone toggle */}
            <div className="p-3 bg-slate-900/40 border border-slate-850 rounded-xl flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-400">
                <div className="relative">
                  <span className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping"></span>
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                </div>
                <span className="font-medium text-[11px]">Écoute vocale active</span>
              </div>
              <button
                onClick={() => {
                  alert("La commande d'activation vocale en direct est activée. Dans votre atelier de réparation, prononcez simplement les commandes ci-dessus à voix haute !");
                }}
                className="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-[10px] font-bold uppercase transition"
              >
                Micro Actif 🟢
              </button>
            </div>
          </div>
        )}

      </div>

      {/* FOOTER NAVIGATION CONTROLLERS */}
      <div className="flex justify-between items-center pt-2">
        <button
          onClick={() => setActiveModule((prev) => Math.max(1, prev - 1))}
          disabled={activeModule === 1}
          className="flex items-center gap-1.5 py-2 px-4 bg-slate-950/60 hover:bg-slate-900 disabled:opacity-40 text-slate-300 font-bold rounded-xl text-xs border border-slate-800 transition"
        >
          <ChevronLeft className="w-4 h-4" /> Module précédent
        </button>
        
        <span className="text-[10px] font-mono text-slate-500 font-bold">
          DiagAssist Pro • Assistant de Réparation
        </span>

        <button
          onClick={() => {
            if (activeModule < 5) {
              setActiveModule((prev) => prev + 1);
            } else {
              alert("Vous avez parcouru tous les modules de l'Assistant de Réparation Guidée IA !");
            }
          }}
          className="flex items-center gap-1.5 py-2 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs transition"
        >
          {activeModule === 5 ? "Terminer" : "Module suivant"} <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Premium upgrade recommendation promotion */}
      {!isPremiumActive && (
        <div className="p-4 bg-gradient-to-r from-red-600/10 via-red-950/5 to-slate-950 border border-red-500/10 rounded-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-xs">
          <div className="space-y-0.5">
            <h4 className="font-bold text-white flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-red-500 fill-current animate-pulse" />
              Profitez d'un accès complet et illimité
            </h4>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Le guide de réparation complet, les schémas électriques couleur et l'assistant vocal interactif sont inclus dans l'abonnement Premium.
            </p>
          </div>
          <button
            onClick={onUpgradeClick}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs transition duration-150 shrink-0"
          >
            S'abonner à DiagAssist Premium
          </button>
        </div>
      )}

    </div>
  );
}
