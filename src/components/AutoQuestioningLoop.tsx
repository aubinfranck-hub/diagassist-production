import React, { useState, useEffect, useRef } from "react";
import {
  Wrench,
  CheckCircle2,
  AlertTriangle,
  Send,
  Camera,
  Mic,
  MicOff,
  RefreshCw,
  Search,
  Volume2,
  HelpCircle,
  Activity,
  Layers,
  ArrowRight,
  ShieldAlert,
  Cpu,
  Plus,
  X,
  Radio,
  FileCheck2,
  Award
} from "lucide-react";
import {
  DiagnosticLoopState,
  GeminiLoopTurnResponse,
  InitialProof,
  SubscriptionPlan
} from "../types";
import { playNotificationSound } from "../utils/audioEngine";

interface AutoQuestioningLoopProps {
  initialVehicle?: {
    marque: string;
    modele: string;
    moteur: string;
    kilometrage: number;
  };
  initialDtcCodes?: string[];
  initialSymptom?: string;
  userPlan?: SubscriptionPlan;
  onCompleteDiagnosis?: (result: any) => void;
}

export default function AutoQuestioningLoop({
  initialVehicle = { marque: "Toyota", modele: "Corolla", moteur: "1.8 VVTi", kilometrage: 120000 },
  initialDtcCodes = [],
  initialSymptom = "",
  userPlan = "free_trial",
  onCompleteDiagnosis
}: AutoQuestioningLoopProps) {
  // Vehicle & Symptom state
  const [vehicle, setVehicle] = useState(initialVehicle);
  const [dtcInput, setDtcInput] = useState(initialDtcCodes.join(", "));
  const [symptomInput, setSymptomInput] = useState(initialSymptom);

  // Initial proofs lot state (Tour 0)
  const [initialProofs, setInitialProofs] = useState<InitialProof[]>([]);
  const [newProofType, setNewProofType] = useState<"mesure" | "observation">("mesure");
  const [newProofTest, setNewProofTest] = useState("");
  const [newProofVal, setNewProofVal] = useState("");

  // Loop session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loopState, setLoopState] = useState<DiagnosticLoopState | null>(null);
  const [currentTurnResponse, setCurrentTurnResponse] = useState<GeminiLoopTurnResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  // Mechanic interaction state
  const [userAnswer, setUserAnswer] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [scannerModelInput, setScannerModelInput] = useState("");
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Audio recording ref
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Sound toast helper
  const triggerToast = (msg: string) => {
    setErrorToast(msg);
    setTimeout(() => setErrorToast(null), 4000);
  };

  // Pre-fill initial state when props change
  useEffect(() => {
    if (initialVehicle.marque) setVehicle(initialVehicle);
    if (initialDtcCodes.length > 0) setDtcInput(initialDtcCodes.join(", "));
    if (initialSymptom) setSymptomInput(initialSymptom);
  }, [initialVehicle, initialDtcCodes, initialSymptom]);

  // Handle adding an initial proof item to Tour 0 lot
  const handleAddInitialProof = () => {
    if (!newProofTest && !newProofVal) return;
    const item: InitialProof = {
      type: newProofType,
      test: newProofTest || "Vérification",
      valeur: newProofVal,
      contenu: `${newProofTest}: ${newProofVal}`.trim()
    };
    setInitialProofs([...initialProofs, item]);
    setNewProofTest("");
    setNewProofVal("");
  };

  const handleRemoveInitialProof = (index: number) => {
    setInitialProofs(initialProofs.filter((_, i) => i !== index));
  };

  // Convert image file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        resolve(base64);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  // File selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setFilePreviewUrl(URL.createObjectURL(file));
    }
  };

  // Speech synthesis for questions
  const speakQuestion = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = 0.95;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  // Audio recording toggle
  const toggleAudioRecording = async () => {
    if (isRecordingAudio) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      setIsRecordingAudio(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          const file = new File([audioBlob], "audio_answer.webm", { type: "audio/webm" });
          setSelectedFile(file);
          setFilePreviewUrl(URL.createObjectURL(audioBlob));
          setUserAnswer((prev) => (prev ? `${prev} [Enregistrement audio joint]` : "[Enregistrement audio joint]"));
          stream.getTracks().forEach((track) => track.stop());
        };

        mediaRecorder.start();
        setIsRecordingAudio(true);
      } catch (err) {
        triggerToast("Impossible d'accéder au microphone.");
      }
    }
  };

  // Start Diagnostic Loop (Tour 0)
  const handleStartLoop = async () => {
    if (!symptomInput.trim() && !dtcInput.trim()) {
      triggerToast("Veuillez saisir au moins un symptôme ou un code DTC pour démarrer.");
      return;
    }

    setIsLoading(true);
    try {
      const token = localStorage.getItem("auth_session_token");
      let base64File = undefined;
      let mimeType = undefined;

      if (selectedFile) {
        base64File = await fileToBase64(selectedFile);
        mimeType = selectedFile.type;
      }

      const res = await fetch("/api/diagnostic/loop/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          vehicule: vehicle,
          symptome: symptomInput,
          codesDtc: dtcInput.split(/[\s,]+/).filter(Boolean),
          preuvesInitiales: initialProofs,
          file: base64File,
          mimeType
        })
      });

      const data = await res.json();
      if (!data.success) {
        triggerToast(data.message || "Échec d'initialisation du diagnostic.");
        setIsLoading(false);
        return;
      }

      setSessionId(data.sessionId);
      setLoopState(data.state);
      setCurrentTurnResponse(data.response);
      setSelectedFile(null);
      setFilePreviewUrl(null);
      playNotificationSound();

      if (data.response?.next_question) {
        speakQuestion(data.response.next_question);
      }
    } catch (err: any) {
      triggerToast("Erreur réseau lors de l'initialisation du diagnostic.");
    } finally {
      setIsLoading(false);
    }
  };

  // Next Step in Loop (Tour 1 to N)
  const handleNextStep = async (isPostRepairConfirmed: boolean = false) => {
    if (!sessionId) return;
    if (!userAnswer.trim() && !selectedFile && !isPostRepairConfirmed && !scannerModelInput.trim()) {
      triggerToast("Veuillez entrer une réponse, une valeur ou joindre une photo.");
      return;
    }

    setIsLoading(true);
    try {
      const token = localStorage.getItem("auth_session_token");
      let base64File = undefined;
      let mimeType = undefined;

      if (selectedFile) {
        base64File = await fileToBase64(selectedFile);
        mimeType = selectedFile.type;
      }

      const res = await fetch("/api/diagnostic/loop/step", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          sessionId,
          userResponse: userAnswer,
          responseType: selectedFile ? "photo" : "texte",
          file: base64File,
          mimeType,
          isPostRepairConfirmed,
          scannerModel: scannerModelInput.trim() || undefined
        })
      });

      const data = await res.json();
      if (!data.success) {
        triggerToast(data.message || "Échec lors de l'étape de diagnostic.");
        setIsLoading(false);
        return;
      }

      setLoopState(data.state);
      setCurrentTurnResponse(data.response);
      setUserAnswer("");
      setSelectedFile(null);
      setFilePreviewUrl(null);
      playNotificationSound();

      if (data.response?.next_question) {
        speakQuestion(data.response.next_question);
      }

      if (data.response?.stop && onCompleteDiagnosis) {
        onCompleteDiagnosis(data.response);
      }
    } catch (err) {
      triggerToast("Erreur de connexion avec le serveur de diagnostic.");
    } finally {
      setIsLoading(false);
    }
  };

  // Reset / New Session
  const handleResetLoop = () => {
    setSessionId(null);
    setLoopState(null);
    setCurrentTurnResponse(null);
    setUserAnswer("");
    setSelectedFile(null);
    setFilePreviewUrl(null);
    setScannerModelInput("");
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  };

  // Render Phase Stepper
  const renderPhaseStepper = () => {
    const phase = loopState?.phase_actuelle || "action_avant_dtc";
    const phases = [
      { id: "action_avant_dtc", label: "1. Historique & Antécédents" },
      { id: "verification_technique", label: "2. Tests Techniques Pas-à-Pas" },
      { id: "validation_post_reparation", label: "3. Validation Post-Réparation" },
      { id: "conclusion", label: "4. Cause Racine Finalisée" }
    ];

    const currentIdx = phases.findIndex((p) => p.id === phase);

    return (
      <div className="flex items-center justify-between gap-1 bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-xs overflow-x-auto">
        {phases.map((p, idx) => {
          const isActive = idx === currentIdx;
          const isDone = idx < currentIdx;
          return (
            <div key={p.id} className="flex items-center gap-1.5 whitespace-nowrap">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center font-semibold ${
                  isDone
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                    : isActive
                    ? "bg-amber-500 text-slate-950 font-bold"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {isDone ? "✓" : idx + 1}
              </div>
              <span className={isActive ? "text-amber-400 font-semibold" : isDone ? "text-emerald-400" : "text-slate-500"}>
                {p.label}
              </span>
              {idx < phases.length - 1 && <ArrowRight size={12} className="text-slate-700 mx-1" />}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Toast alert */}
      {errorToast && (
        <div className="bg-amber-500/20 border border-amber-500/50 text-amber-300 px-4 py-2.5 rounded-xl text-sm flex items-center gap-2 animate-fadeIn">
          <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />
          <span>{errorToast}</span>
        </div>
      )}

      {/* HEADER: Vehicle & Diagnostic Loop Title */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-amber-500 text-xs font-bold uppercase tracking-wider mb-1">
            <Activity size={15} /> Boucle Auto-Questionnante Intelligence Terrain
          </div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span>Diagnostic Interactif Pas-à-Pas</span>
            {loopState && (
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                Tour {loopState.tour_actuel} / {loopState.tour_max}
              </span>
            )}
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Enquête guidée sans saut de pièce. Approche scientifique atelier Côte d'Ivoire.
          </p>
        </div>

        {sessionId ? (
          <button
            onClick={handleResetLoop}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
          >
            <RefreshCw size={13} /> Recommencer le diagnostic
          </button>
        ) : (
          <div className="text-right">
            <span className="text-xs text-slate-400">Forfait actif :</span>
            <span className="ml-1.5 px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 uppercase">
              {userPlan}
            </span>
          </div>
        )}
      </div>

      {/* STEP 1: START FORM (If loop not started yet) */}
      {!sessionId ? (
        <div className="bg-slate-900/90 border border-slate-800 p-6 rounded-2xl space-y-6 shadow-lg">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Marque</label>
              <input
                type="text"
                value={vehicle.marque}
                onChange={(e) => setVehicle({ ...vehicle, marque: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                placeholder="Ex: Toyota"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Modèle</label>
              <input
                type="text"
                value={vehicle.modele}
                onChange={(e) => setVehicle({ ...vehicle, modele: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                placeholder="Ex: Hilux"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Motorisation</label>
              <input
                type="text"
                value={vehicle.moteur}
                onChange={(e) => setVehicle({ ...vehicle, moteur: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                placeholder="Ex: 2.5 D4D"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Kilométrage (km)</label>
              <input
                type="number"
                value={vehicle.kilometrage}
                onChange={(e) => setVehicle({ ...vehicle, kilometrage: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                placeholder="150000"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Codes DTC détectés (obd / valise)
              </label>
              <input
                type="text"
                value={dtcInput}
                onChange={(e) => setDtcInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                placeholder="Ex: P0343, P0A0F, C112A"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Symptôme principal ressenti</label>
              <input
                type="text"
                value={symptomInput}
                onChange={(e) => setSymptomInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                placeholder="Ex: Moteur cale à chaud / broute au ralenti"
              />
            </div>
          </div>

          {/* SECTION 4bis: Multi-proofs initial lot (mode "je l'ai déjà fait") */}
          <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                <FileCheck2 size={14} /> Entrée directe multi-preuves (Avez-vous déjà fait des tests ?)
              </span>
              <span className="text-[10px] text-slate-500">Intégré au Tour 0 sans redemande</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={newProofType}
                onChange={(e) => setNewProofType(e.target.value as any)}
                className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
              >
                <option value="mesure">Mesure (tension, ohms)</option>
                <option value="observation">Observation visuelle</option>
              </select>

              <input
                type="text"
                value={newProofTest}
                onChange={(e) => setNewProofTest(e.target.value)}
                placeholder="Test (ex: Tension batterie)"
                className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 flex-1 min-w-[140px]"
              />

              <input
                type="text"
                value={newProofVal}
                onChange={(e) => setNewProofVal(e.target.value)}
                placeholder="Résultat (ex: 11.2V)"
                className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 flex-1 min-w-[120px]"
              />

              <button
                type="button"
                onClick={handleAddInitialProof}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg flex items-center gap-1 transition"
              >
                <Plus size={14} /> Ajouter
              </button>
            </div>

            {/* List of initial proofs added */}
            {initialProofs.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {initialProofs.map((p, idx) => (
                  <div
                    key={idx}
                    className="bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg text-xs flex items-center gap-2 text-slate-300"
                  >
                    <span className="text-amber-400 font-semibold">{p.type === "mesure" ? "📊" : "👁️"} {p.test}:</span>
                    <span className="font-mono text-emerald-400">{p.valeur || p.contenu}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveInitialProof(idx)}
                      className="text-slate-500 hover:text-rose-400"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={handleStartLoop}
            disabled={isLoading}
            className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm rounded-xl shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <RefreshCw size={16} className="animate-spin" /> Démarrage de l'enquête...
              </>
            ) : (
              <>
                <Wrench size={16} /> Démarrer la Boucle Auto-Questionnante
              </>
            )}
          </button>
        </div>
      ) : (
        /* STEP 2: ACTIVE LOOP SCREEN */
        <div className="space-y-6">
          {/* Phase Stepper */}
          {renderPhaseStepper()}

          {/* Incoherence warning if detected */}
          {currentTurnResponse?.incoherence_detectee && (
            <div className="bg-rose-500/10 border border-rose-500/30 p-4 rounded-xl flex items-start gap-3">
              <ShieldAlert className="text-rose-400 flex-shrink-0 mt-0.5" size={18} />
              <div>
                <div className="text-xs font-bold text-rose-300 uppercase">
                  Incohérence Détectée (Symptôme vs Code DTC)
                </div>
                <p className="text-xs text-rose-200/90 mt-1">{currentTurnResponse.incoherence_detectee}</p>
              </div>
            </div>
          )}

          {/* MAIN GRID: Left = Hypotheses & Confidence Gauge, Right = Next Question & Guided Protocol */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* LEFT COLUMN: Hypotheses & Confidence Gauge (5 Cols) */}
            <div className="md:col-span-5 bg-slate-900/90 border border-slate-800 p-4 rounded-2xl space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers size={14} className="text-amber-500" /> Évolution des Hypothèses
                </span>
                <span className="text-[10px] text-slate-500 font-mono">Scores de confiance</span>
              </div>

              <div className="space-y-3">
                {currentTurnResponse?.hypotheses.map((hyp, idx) => {
                  const isHighConf = hyp.confiance >= 80;
                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-xl border text-xs space-y-2 transition ${
                        isHighConf
                          ? "bg-amber-500/10 border-amber-500/40"
                          : "bg-slate-950/60 border-slate-800"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-slate-200 leading-snug">{hyp.cause}</span>
                        <span
                          className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
                            isHighConf
                              ? "bg-amber-500 text-slate-950"
                              : "bg-slate-800 text-slate-300"
                          }`}
                        >
                          {hyp.confiance}%
                        </span>
                      </div>

                      {/* Confidence Progress Bar */}
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${
                            isHighConf ? "bg-amber-400" : "bg-emerald-500"
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, hyp.confiance))}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span className="capitalize text-slate-500">
                          {hyp.type === "cause_racine_probable" ? "🎯 Cause racine" : "⚡ Cause directe"}
                        </span>
                        <span className="text-slate-400 truncate max-w-[150px]">{hyp.lien_avec_dtc}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Grounded Scanner Menu Path Box */}
              {currentTurnResponse?.groundedMenuPath && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 p-3 rounded-xl space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                    <Search size={13} /> Menu Scanner Groundé (Google Search)
                  </div>
                  <p className="text-xs text-emerald-200/90 leading-relaxed font-mono">
                    {currentTurnResponse.groundedMenuPath}
                  </p>
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: Question & Guided Test Protocol (7 Cols) */}
            <div className="md:col-span-7 bg-slate-900/90 border border-slate-800 p-5 rounded-2xl space-y-5 flex flex-col justify-between">
              <div className="space-y-4">
                {/* Active Question Box */}
                <div className="bg-slate-950 border border-amber-500/30 p-4 rounded-xl space-y-2 relative">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                      <HelpCircle size={14} /> Question du Tour {loopState?.tour_actuel}
                    </span>
                    <button
                      type="button"
                      onClick={() => currentTurnResponse?.next_question && speakQuestion(currentTurnResponse.next_question)}
                      className={`p-1.5 rounded-lg text-xs flex items-center gap-1 ${
                        isSpeaking ? "bg-amber-500 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                      title="Écouter la question (Synthèse vocale garage)"
                    >
                      <Volume2 size={14} />
                      <span className="text-[10px]">{isSpeaking ? "Lecture..." : "Écouter"}</span>
                    </button>
                  </div>

                  <p className="text-sm font-medium text-slate-100 leading-relaxed">
                    {currentTurnResponse?.next_question}
                  </p>
                </div>

                {/* GUIDED TEST PROTOCOL BOX (Phase 2 Detail) */}
                {currentTurnResponse?.test_protocole && (
                  <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl space-y-3">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Wrench size={13} className="text-amber-500" /> Protocole de Test Requis
                    </span>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {currentTurnResponse.test_protocole.outil && (
                        <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                          <span className="text-[10px] text-slate-500 block">Outil :</span>
                          <span className="font-semibold text-slate-200">{currentTurnResponse.test_protocole.outil}</span>
                        </div>
                      )}
                      {currentTurnResponse.test_protocole.emplacement_exact && (
                        <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                          <span className="text-[10px] text-slate-500 block">Emplacement/Broche :</span>
                          <span className="font-semibold text-slate-200">{currentTurnResponse.test_protocole.emplacement_exact}</span>
                        </div>
                      )}
                      {currentTurnResponse.test_protocole.etat_vehicule && (
                        <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                          <span className="text-[10px] text-slate-500 block">État véhicule :</span>
                          <span className="font-semibold text-amber-400 capitalize">{currentTurnResponse.test_protocole.etat_vehicule.replace("_", " ")}</span>
                        </div>
                      )}
                      {currentTurnResponse.test_protocole.valeur_reference_normale && (
                        <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                          <span className="text-[10px] text-slate-500 block">Valeur normale attendue :</span>
                          <span className="font-semibold text-emerald-400 font-mono">{currentTurnResponse.test_protocole.valeur_reference_normale}</span>
                        </div>
                      )}
                    </div>

                    {currentTurnResponse.test_protocole.alerte_securite && (
                      <div className="bg-rose-500/10 border border-rose-500/30 p-2.5 rounded-lg text-xs text-rose-300 flex items-center gap-2">
                        <ShieldAlert size={15} className="text-rose-400 flex-shrink-0" />
                        <span>{currentTurnResponse.test_protocole.alerte_securite}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Pre-set garage answers */}
                <div className="space-y-1.5">
                  <span className="text-[10px] text-slate-500 uppercase font-semibold">Réponses rapides terrain :</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      "Rien n'a été touché sur la voiture",
                      "Batterie débranchée récemment",
                      "Dernier entretien : changement filtres",
                      "Nettoyage / lavage moteur effectué",
                      "Valeur mesurée conforme",
                      "Valeur hors tolérance"
                    ].map((preset, pIdx) => (
                      <button
                        key={pIdx}
                        type="button"
                        onClick={() => setUserAnswer(preset)}
                        className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-lg border border-slate-700 transition"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* INPUT BAR & ACTION BUTTONS */}
              <div className="space-y-3 pt-3 border-t border-slate-800">
                {filePreviewUrl && (
                  <div className="flex items-center justify-between bg-slate-950 p-2 rounded-lg border border-slate-800 text-xs">
                    <span className="text-slate-300 truncate max-w-[200px]">📷 {selectedFile?.name}</span>
                    <button onClick={() => { setSelectedFile(null); setFilePreviewUrl(null); }} className="text-rose-400 hover:text-rose-300">
                      <X size={14} />
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={userAnswer}
                    onChange={(e) => setUserAnswer(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleNextStep(false)}
                    placeholder="Saisissez la valeur ou l'observation..."
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                  />

                  {/* Photo Attachment Button */}
                  <label className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 cursor-pointer transition">
                    <Camera size={18} />
                    <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                  </label>

                  {/* Audio Microphone Button */}
                  <button
                    type="button"
                    onClick={toggleAudioRecording}
                    className={`p-2.5 rounded-xl border transition ${
                      isRecordingAudio
                        ? "bg-rose-500 text-slate-950 border-rose-400 animate-pulse"
                        : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
                    }`}
                    title="Enregistrer une réponse vocale"
                  >
                    {isRecordingAudio ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>

                  <button
                    onClick={() => handleNextStep(false)}
                    disabled={isLoading}
                    className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm rounded-xl transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isLoading ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                </div>

                {/* Validation post-réparation button trigger */}
                {loopState?.phase_actuelle === "validation_post_reparation" && (
                  <button
                    onClick={() => handleNextStep(true)}
                    disabled={isLoading}
                    className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition"
                  >
                    <CheckCircle2 size={16} /> Confirmer la réparation & Valider l'absence du DTC
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* FINAL CONCLUSION CARD (When stop = true) */}
          {currentTurnResponse?.stop && (
            <div className="bg-gradient-to-r from-emerald-950/60 via-slate-900 to-emerald-950/60 border border-emerald-500/40 p-6 rounded-2xl space-y-4 shadow-2xl animate-fadeIn">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm uppercase tracking-wider">
                  <Award size={18} /> Diagnostic Finalisé — Cause Racine Isolée
                </div>
                <span className="text-xs text-slate-400 font-mono">Enquête bouclée avec succès</span>
              </div>

              <div className="space-y-3">
                <p className="text-slate-200 text-sm leading-relaxed">
                  L'analyse de l'historique et des mesures pas-à-pas confirme l'hypothèse principale avec une confiance élevée :
                </p>

                {currentTurnResponse.hypotheses.slice(0, 1).map((topHyp, idx) => (
                  <div key={idx} className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-xl space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-base font-bold text-emerald-300">{topHyp.cause}</span>
                      <span className="text-xs font-bold font-mono px-2.5 py-1 bg-emerald-500 text-slate-950 rounded-full">
                        {topHyp.confiance}% de confiance
                      </span>
                    </div>
                    <p className="text-xs text-emerald-200/80">{topHyp.lien_avec_dtc}</p>
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleResetLoop}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700"
                >
                  Nouveau diagnostic
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
