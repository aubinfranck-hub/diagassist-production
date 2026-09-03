import React, { useState, useRef, useEffect } from "react";
import {
  Paperclip,
  Camera,
  X,
  Phone,
  PhoneOff,
  Gauge,
  Radio,
  Sparkles,
  Video as VideoIcon,
  CheckCircle2,
  ChevronRight,
  Send,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  AlertCircle,
  MessageSquare,
  RefreshCw,
  Wrench,
  Activity,
  Layers,
  HelpCircle,
  FileCheck2,
  Plus
} from "lucide-react";
import { Diagnosis, ChatMessage, DiagnosticLoopState, GeminiLoopTurnResponse, InitialProof } from "../types";
import { playMicStartSound, playMicStopSound, playNotificationSound } from "../utils/audioEngine";
import { globalAdManager } from "../services/adManager";


// ---------------------------------------------------------------------------
// TOKENS — identiques à l'écran Chat pour cohérence de marque DiagAssist
// ---------------------------------------------------------------------------
const T = {
  bg: "#12151A",
  panel: "#1B2029",
  panelAlt: "#20262F",
  border: "#2A3038",
  accent: "#FF7A29",
  accentDim: "#7A3D1B",
  confirm: "#3ED598",
  critical: "#FF4757",
  text: "#EDEFF2",
  muted: "#8B93A1",
};

const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Barlow+Condensed:wght@600;700&display=swap');
`;

let uid = 0;
const nextId = () => `c${++uid}`;

function fileKind(file: File) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "file";
}

function formatTime(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

// Clean markdown characters for TTS so SpeechSynthesis doesn't read out "astérisque", "hashtag", etc.
function cleanPhoneticText(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\*\#\`\-\_\~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface DiagAssistLiveScreenProps {
  diagnosis: Diagnosis | null;
  chatHistory: ChatMessage[];
  onSendMessage: (text: string, file?: string, mimeType?: string, fileName?: string) => Promise<void>;
  isSendingChat: boolean;
  assistantName: string;
  isPremiumActive: boolean;
  onUpgradeClick: () => void;
  isLiveActive: boolean;
  setIsLiveActive: (active: boolean) => void;
  onLoadDemo: () => void;
  setActiveTab: (tab: "diagnose" | "live" | "prices" | "admin") => void;
}

interface CaptureItem {
  id: string;
  kind: "image" | "video" | "file";
  url: string;
  status: "envoi" | "ok";
  base64?: string;
  mimeType?: string;
  fileName?: string;
}

export default function DiagAssistLiveScreen({
  diagnosis,
  chatHistory,
  onSendMessage,
  isSendingChat,
  assistantName,
  isPremiumActive,
  onUpgradeClick,
  isLiveActive,
  setIsLiveActive,
  onLoadDemo,
  setActiveTab,
}: DiagAssistLiveScreenProps) {
  const [callState, setCallState] = useState<"idle" | "connecting" | "live">(
    isLiveActive ? "live" : "idle"
  );
  const [elapsed, setElapsed] = useState(0);
  const [captures, setCaptures] = useState<CaptureItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  // BUG CORRIGÉ : processor.onaudioprocess est défini une seule fois au démarrage de l'appel et
  // capturait la valeur de isMuted au moment de sa création (fermeture figée React). Basculer le
  // bouton "muet" en cours d'appel n'avait donc aucun effet réel sur l'envoi audio. On utilise une
  // ref, toujours à jour, lue directement dans le callback.
  const isMutedRef = useRef(false);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [liveTranscript, setLiveTranscript] = useState<string>("");
  const [liveInputText, setLiveInputText] = useState("");
  const [currentlySpeakingId, setCurrentlySpeakingId] = useState<string | null>(null);

  // Section 10: Integrated Auto-Questioning Loop State
  const [activeLoopSessionId, setActiveLoopSessionId] = useState<string | null>(null);
  const [activeLoopState, setActiveLoopState] = useState<DiagnosticLoopState | null>(null);
  const [activeTurnResponse, setActiveTurnResponse] = useState<GeminiLoopTurnResponse | null>(null);
  const [isLoopLoading, setIsLoopLoading] = useState(false);
  const [showLoopOverlay, setShowLoopOverlay] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const lastSpokenMsgIdRef = useRef<string>("");

  // Register Audio Ad Playback Handler for Priority Audio Ads at Natural Pauses
  useEffect(() => {
    globalAdManager.registerAudioPlaybackHandler((ad) => {
      console.log("[DiagAssistLiveScreen] Playing priority audio ad at natural pause:", ad.title);
      setToast(`📢 Annonce vocale insérée en pause naturelle : ${ad.title}`);
      if (ad.mp3Url) {
        const audio = new Audio(ad.mp3Url);
        audio.play().catch(() => {
          speakText(ad.vocalScript);
        });
      } else if (ad.vocalScript) {
        speakText(ad.vocalScript);
      }
    });
  }, []);

  // ---------------------------------------------------------------------------
  // SECTION 10: CLIENT-SIDE DIAGNOSTIC LOOP FUNCTIONS
  // ---------------------------------------------------------------------------

  /**
   * 1. Demarre une session de diagnostic boucle IA (tous parametres optionnels)
   */
  const startDiagnosticSession = async (
    vehicule?: { marque?: string; modele?: string; moteur?: string; kilometrage?: number },
    dtc?: string[],
    symptome?: string,
    preuvesInitiales?: InitialProof[]
  ) => {
    setIsLoopLoading(true);
    try {
      const token = localStorage.getItem("auth_session_token");
      const res = await fetch("/api/diagnostic/loop/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          vehicule: vehicule || { marque: "Toyota", modele: "Corolla", moteur: "2.0 L D4D", kilometrage: 120000 },
          symptome: symptome || diagnosis?.explanationText || "Recherche de panne en direct atelier",
          codesDtc: dtc || diagnosis?.dtcCodesDetected.map(c => c.code) || [],
          preuvesInitiales: preuvesInitiales || []
        })
      });
      const data = await res.json();
      if (data.success) {
        setActiveLoopSessionId(data.sessionId);
        setActiveLoopState(data.state);
        setActiveTurnResponse(data.response);
        setShowLoopOverlay(true);
        setToast("✓ Diagnostic boucle IA activé en direct.");
        if (data.response?.next_question) {
          setLiveTranscript((prev) => prev + (prev ? "\n" : "") + "DiagAssist (Diagnostic): " + data.response.next_question);
        }
      }
      return data;
    } catch (err) {
      console.error("Error starting diagnostic session:", err);
    } finally {
      setIsLoopLoading(false);
    }
  };

  /**
   * 2. Envoie la reponse au tour en cours
   */
  const submitReponse = async (
    sId: string,
    tour: number,
    reponse: string,
    responseType: "texte" | "photo" | "audio" = "texte",
    file?: string,
    mimeType?: string
  ) => {
    setIsLoopLoading(true);
    try {
      const token = localStorage.getItem("auth_session_token");
      const res = await fetch("/api/diagnostic/loop/step", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          sessionId: sId,
          userResponse: reponse,
          responseType,
          file,
          mimeType
        })
      });
      const data = await res.json();
      if (data.success) {
        setActiveLoopState(data.state);
        setActiveTurnResponse(data.response);
        if (data.response?.next_question) {
          setLiveTranscript((prev) => prev + (prev ? "\n" : "") + "DiagAssist (Test suivant): " + data.response.next_question);
        }
      }
      return data;
    } catch (err) {
      console.error("Error submitting response:", err);
    } finally {
      setIsLoopLoading(false);
    }
  };

  /**
   * 3. Mode 'j'ai deja teste' — Injecte un lot de preuves groupees a tout moment
   */
  const submitPreuvesGroupees = async (sId: string, preuves: InitialProof[]) => {
    setIsLoopLoading(true);
    try {
      const token = localStorage.getItem("auth_session_token");
      const res = await fetch("/api/diagnostic/loop/step", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          sessionId: sId,
          userResponse: `Preuves groupees fournies (${preuves.length} tests): ` + preuves.map(p => `${p.test}: ${p.valeur || p.contenu}`).join("; "),
          responseType: "texte"
        })
      });
      const data = await res.json();
      if (data.success) {
        setActiveLoopState(data.state);
        setActiveTurnResponse(data.response);
        setToast("✓ Preuves groupees integrees au diagnostic.");
      }
      return data;
    } catch (err) {
      console.error("Error submitting grouped proofs:", err);
    } finally {
      setIsLoopLoading(false);
    }
  };

  /**
   * 4. Recupere l'etat courant de la session
   */
  const getSessionState = async (sId: string) => {
    try {
      const res = await fetch(`/api/diagnostic/loop/session/${sId}`);
      const data = await res.json();
      if (data.success) {
        setActiveLoopState(data.session);
      }
      return data;
    } catch (err) {
      console.error("Error getting session state:", err);
    }
  };

  /**
   * 5. Declenche la phase de validation post-reparation
   */
  const confirmerReparation = async (sId: string) => {
    setIsLoopLoading(true);
    try {
      const token = localStorage.getItem("auth_session_token");
      const res = await fetch("/api/diagnostic/loop/step", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          sessionId: sId,
          userResponse: "Reparation effectuee, redemarrage moteur effectue.",
          isPostRepairConfirmed: true
        })
      });
      const data = await res.json();
      if (data.success) {
        setActiveLoopState(data.state);
        setActiveTurnResponse(data.response);
        setToast("✓ Validation post-reparation initiee.");
      }
      return data;
    } catch (err) {
      console.error("Error confirming repair:", err);
    } finally {
      setIsLoopLoading(false);
    }
  };

  // Refs for Web Audio Live & WebSocket
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxInputRef = useRef<AudioContext | null>(null);
  const audioCtxOutputRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  // Synchronize internal callState with isLiveActive
  useEffect(() => {
    if (isLiveActive && callState === "idle") {
      startLiveCallSession();
    } else if (!isLiveActive && callState === "live") {
      stopLiveCallSession();
    }
  }, [isLiveActive]);

  useEffect(() => {
    if (callState === "live") {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (callState === "idle") setElapsed(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callState]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Scroll to bottom when chat history or transcript updates
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, liveTranscript]);

  // Helper: Convert Float32Array PCM to Base64 Int16 for Gemini Live
  const pcmToBase64 = (float32Array: Float32Array): string => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      const intSample = s < 0 ? s * 0x8000 : s * 0x7FFF;
      view.setInt16(i * 2, intSample, true);
    }
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  // Stop any playing audio buffer sources (for interruption / barge-in)
  const stopAllAudioPlayback = () => {
    activeSourcesRef.current.forEach((src) => {
      try { src.stop(); } catch (e) {}
    });
    activeSourcesRef.current = [];
    nextStartTimeRef.current = 0;
  };

  // Play chunk of 24kHz raw Int16 PCM audio from Gemini Live
  const playAudioChunk = (base64Data: string) => {
    if (!speakerEnabled) return;
    if (!audioCtxOutputRef.current) return;
    const ctx = audioCtxOutputRef.current;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    try {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const int16Array = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32[i] = int16Array[i] / 32768.0;
      }

      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.copyToChannel(float32, 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      activeSourcesRef.current.push(source);

      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
      };

      const now = ctx.currentTime;
      let startTime = nextStartTimeRef.current;
      if (startTime < now) {
        startTime = now + 0.02;
      }
      source.start(startTime);
      nextStartTimeRef.current = startTime + buffer.duration;
    } catch (err) {
      console.error("[LiveAudio] Error playing audio chunk:", err);
    }
  };

  // Function to speak text aloud using Web Speech API (SpeechSynthesis)
  const speakText = (rawText: string, msgId?: string) => {
    if (!speakerEnabled) return;
    if (!("speechSynthesis" in window)) {
      console.warn("Speech synthesis is not supported in this browser.");
      return;
    }

    try {
      window.speechSynthesis.cancel(); // Cancel any existing speech
      setCurrentlySpeakingId(null);

      const cleanText = cleanPhoneticText(rawText);
      if (!cleanText) return;

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = "fr-FR";
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // Select French voice if available
      const voices = window.speechSynthesis.getVoices();
      const frVoice = voices.find((v) => v.lang.toLowerCase().startsWith("fr"));
      if (frVoice) {
        utterance.voice = frVoice;
      }

      utterance.onstart = () => {
        if (msgId) setCurrentlySpeakingId(msgId);
        globalAdManager.setGeminiSpeakingStatus(true);
      };

      utterance.onend = () => {
        setCurrentlySpeakingId(null);
        globalAdManager.setGeminiSpeakingStatus(false); // Natural pause! Triggers pending priority audio ads
        maybeTriggerAutomaticVocalAd();
      };

      utterance.onerror = (e) => {
        console.warn("SpeechSynthesis error:", e);
        setCurrentlySpeakingId(null);
        globalAdManager.setGeminiSpeakingStatus(false);
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.error("SpeechSynthesis error:", e);
    }
  };

  // Auto-read new model responses from chatHistory when not in live WS mode
  useEffect(() => {
    if (callState === "live") return; // During Live WS session, Gemini sends audio PCM directly
    if (chatHistory.length > 0) {
      const lastMsg = chatHistory[chatHistory.length - 1];
      if (lastMsg.role === "model" && lastMsg.id !== lastSpokenMsgIdRef.current) {
        lastSpokenMsgIdRef.current = lastMsg.id;
        playNotificationSound();
        speakText(lastMsg.text, lastMsg.id);
      }
    }
  }, [chatHistory, callState, speakerEnabled]);

  // Start real-time Gemini Live WebSocket call
  const startLiveCallSession = async () => {
    setCallState("connecting");
    playMicStartSound();

    try {
      // 1. Acquire mic stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      // 2. Audio Contexts (16kHz for input mic, 24kHz for Gemini output)
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioCtxInputRef.current = inputCtx;

      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioCtxOutputRef.current = outputCtx;
      nextStartTimeRef.current = 0;

      // BUG CORRIGÉ : certains navigateurs créent l'AudioContext en état "suspended" — le son ne
      // joue alors jamais, silencieusement, même si tout le reste du code fonctionne correctement
      // (texte affiché normalement). On force explicitement la reprise des deux contextes.
      if (inputCtx.state === "suspended") await inputCtx.resume();
      if (outputCtx.state === "suspended") await outputCtx.resume();

      // 3. Connect WebSocket
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const authToken = localStorage.getItem("auth_session_token") || "";
      const wsUrl = `${protocol}//${window.location.host}/api/live-ws?token=${encodeURIComponent(authToken)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[LiveWS] Connected to Gemini Live server.");

        const brandInfo = diagnosis?.brandModelInfo || "Véhicule non précisé";
        const explanation = diagnosis?.explanationText || "Recherche de panne en cours";
        const dtcCodes = diagnosis?.dtcCodesDetected?.map(c => `${c.code}: ${c.description}`).join(", ") || "Aucun code OBD";

        const contextText = `SITUATION VÉHICULE EN DIRECT:
Modèle: ${brandInfo}
Panne principale: ${explanation}
Codes DTC: ${dtcCodes}`;

        ws.send(JSON.stringify({
          type: "start",
          diagnosticContext: contextText
        }));

        setCallState("live");
        setIsLiveActive(true);
        playNotificationSound();
        setToast("Duplex vocal actif — Parlez à voix haute, DiagAssist vous écoute.");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "audio") {
            globalAdManager.setGeminiSpeakingStatus(true);
            playAudioChunk(msg.audio);
          } else if (msg.type === "interrupted") {
            globalAdManager.setGeminiSpeakingStatus(false);
            stopAllAudioPlayback();
          } else if (msg.type === "userTranscript") {
            setLiveTranscript((prev) => prev + (prev ? "\n" : "") + "Mécano: " + msg.text);
          } else if (msg.type === "text") {
            setLiveTranscript((prev) => prev + (prev ? "\n" : "") + "DiagAssist: " + msg.text);
          } else if (msg.type === "turnComplete") {
            // End of AI turn: Gemini is silent -> update status and trigger priority audio queue at natural pause
            globalAdManager.setGeminiSpeakingStatus(false);
            maybeTriggerAutomaticVocalAd();
          } else if (msg.type === "error") {
            setToast(`Avertissement : ${msg.message}`);
          }
        } catch (err) {
          console.error("WS message parse error:", err);
        }
      };

      ws.onerror = (err) => {
        console.warn("WebSocket Live error:", err);
        setToast("Réseau vocal indisponible. Mode vocal par synthèse activé.");
        setCallState("live");
        setIsLiveActive(true);
      };

      ws.onclose = () => {
        console.log("[LiveWS] WebSocket closed.");
      };

      // 4. Stream Mic PCM
      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(inputCtx.destination);

      processor.onaudioprocess = (e) => {
        if (ws.readyState === WebSocket.OPEN && !isMutedRef.current) {
          const inputData = e.inputBuffer.getChannelData(0);
          const base64 = pcmToBase64(inputData);
          ws.send(JSON.stringify({ type: "audio", audio: base64 }));
        }
      };

    } catch (err: any) {
      console.warn("Could not start WebSocket Live Audio stream:", err);
      // Fallback to active live state with SpeechSynthesis
      setCallState("live");
      setIsLiveActive(true);
      setToast("Avis : Duplex micro local actif (Synthèse vocale Gemini active).");
      // Initial greeting aloud
      speakText("DiagAssist, je t'écoute. Je suis connecté pour t'accompagner en atelier.");
    }
  };

  // Stop real-time call
  const stopLiveCallSession = () => {
    playMicStopSound();

    if (wsRef.current) {
      try { wsRef.current.close(); } catch (e) {}
      wsRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch (e) {}
      processorRef.current = null;
    }

    if (audioCtxInputRef.current) {
      try { audioCtxInputRef.current.close(); } catch (e) {}
      audioCtxInputRef.current = null;
    }

    stopAllAudioPlayback();

    if (audioCtxOutputRef.current) {
      try { audioCtxOutputRef.current.close(); } catch (e) {}
      audioCtxOutputRef.current = null;
    }

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    setCallState("idle");
    setIsLiveActive(false);
    setCurrentlySpeakingId(null);
    setToast("Appel vocal terminé.");
  };

  // Helper to determine if the Gemini Live WebSocket session is genuinely active
  const isLiveSessionActive = (): boolean => {
    return callState === "live" && wsRef.current !== null && wsRef.current.readyState === WebSocket.OPEN;
  };

  // Dedicated function for sending an image during an active Gemini Live call via sendRealtimeInput
  const sendImageDuringLive = async (base64Data: string, mimeType: string, fileName: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      throw new Error("Session Gemini Live inexistante ou déconnectée");
    }

    console.log("[LiveWS] Sending realtime image input to Gemini Live session via sendRealtimeInput...");
    wsRef.current.send(JSON.stringify({
      type: "image",
      data: base64Data,
      mimeType: mimeType.startsWith("image/") ? mimeType : "image/jpeg"
    }));
  };

  // Automatic Vocal Ad Triggering between AI messages (respects priority, interval, and max limits)
  const maybeTriggerAutomaticVocalAd = () => {
    const queuedAd = globalAdManager.playAudioAd({
      userPlan: isPremiumActive ? "premium" : undefined,
      force: false
    });

    if (queuedAd) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "triggerVocalAd",
          offerScript: queuedAd.vocalScript,
          adVoicePrompt: queuedAd.adVoicePrompt,
        }));
        setToast(`📢 Annonce vocale prioritaire insérée : ${queuedAd.title}`);
      } else {
        setToast(`📢 Pub audio MP3 insérée dans la file prioritaire : ${queuedAd.title}`);
      }
    }
  };

  // Main image handler handling both Live active and Live inactive scenarios cleanly
  const handleImageInput = async (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      setToast("⚠️ Fichier trop volumineux (25 Mo max).");
      return;
    }

    const kind = fileKind(file);
    const mimeType = file.type || (kind === "image" ? "image/jpeg" : "application/octet-stream");

    // Display immediate feedback
    setToast(`📷 Envoi de ${file.name}...`);

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const base64Data = dataUrl.split(",")[1];

      const newItem: CaptureItem = {
        id: nextId(),
        kind,
        url: dataUrl,
        status: "envoi",
        base64: base64Data,
        mimeType,
        fileName: file.name,
      };

      setCaptures((c) => [...c, newItem]);

      if (isLiveSessionActive()) {
        // --- 1. SESSION LIVE ACTIVE ---
        // Send image via sendRealtimeInput without interrupting the Live session or changing state
        try {
          await sendImageDuringLive(base64Data, mimeType, file.name);
          setToast(`✓ Photo envoyée à Gemini (${file.name}) — Analyse Live en cours...`);
          setCaptures((c) =>
            c.map((x) => (x.id === newItem.id ? { ...x, status: "ok" } : x))
          );
        } catch (err) {
          console.error("Erreur lors de l'envoi de l'image à Gemini Live:", err);
          setToast("⚠️ Impossible d'envoyer la photo. Vérifiez que la session de diagnostic est toujours active.");
          setCaptures((c) => c.filter((x) => x.id !== newItem.id));
        }
      } else {
        // --- 2. SESSION LIVE INACTIVE ---
        // Add image to initial context / chat history for upcoming call
        try {
          await onSendMessage(
            `Fichier joint pour analyse : ${file.name}`,
            base64Data,
            mimeType,
            file.name
          );
          setToast(`✓ Photo ajoutée au contexte initial (${file.name}).`);
          setCaptures((c) =>
            c.map((x) => (x.id === newItem.id ? { ...x, status: "ok" } : x))
          );
        } catch (err) {
          console.error("Erreur lors de l'envoi de l'image au contexte:", err);
          setToast("⚠️ Erreur lors de l'envoi du fichier.");
          setCaptures((c) => c.filter((x) => x.id !== newItem.id));
        }
      }
    };

    reader.readAsDataURL(file);
  };

  const handleFiles = (fileList: FileList) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    files.forEach((file) => handleImageInput(file));
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!liveInputText.trim() || isSendingChat) return;
    const text = liveInputText.trim();
    setLiveInputText("");

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "text", text }));
      setLiveTranscript((prev) => prev + (prev ? "\n" : "") + "Mécano: " + text);
    } else {
      await onSendMessage(text);
    }
  };

  return (
    <div
      style={{
        fontFamily: "'Inter', sans-serif",
        background: T.bg,
        color: T.text,
        minHeight: "82vh",
        display: "flex",
        flexDirection: "column",
        maxWidth: 520,
        margin: "0 auto",
        position: "relative",
        overflow: "hidden",
        borderRadius: 24,
        border: `1px solid ${T.border}`,
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
      }}
    >
      <style>{FONT_IMPORT}{`
        @keyframes pulseRing {
          0% { box-shadow: 0 0 0 0 rgba(255,122,41,0.5); }
          70% { box-shadow: 0 0 0 22px rgba(255,122,41,0); }
          100% { box-shadow: 0 0 0 0 rgba(255,122,41,0); }
        }
        @keyframes pulseRingLive {
          0% { box-shadow: 0 0 0 0 rgba(62,213,152,0.5); }
          70% { box-shadow: 0 0 0 26px rgba(62,213,152,0); }
          100% { box-shadow: 0 0 0 0 rgba(62,213,152,0); }
        }
        @keyframes bar1 { 0%,100% { height: 10px; } 50% { height: 26px; } }
        @keyframes bar2 { 0%,100% { height: 22px; } 50% { height: 8px; } }
        @keyframes bar3 { 0%,100% { height: 14px; } 50% { height: 30px; } }
        @keyframes bar4 { 0%,100% { height: 26px; } 50% { height: 12px; } }
        @keyframes dotBlink { 0%,100% { opacity:1; } 50% { opacity:0.35; } }
        @keyframes slideUp { from { opacity:0; transform: translateY(8px);} to { opacity:1; transform: translateY(0);} }
        .cap-in { animation: slideUp 0.25s ease-out; }
        .attach-glow { animation: pulseRing 2.4s infinite; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 4px; }
      `}</style>

      {/* HEADER — marque DiagAssist PRO */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px",
          borderBottom: `1px solid ${T.border}`,
          background: T.panel,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: `linear-gradient(135deg, ${T.accent}, ${T.accentDim})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'Barlow Condensed', sans-serif",
            fontWeight: 700,
            fontSize: 15,
            flexShrink: 0,
            boxShadow: `0 4px 12px ${T.accentDim}`,
          }}
        >
          DA
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
            {assistantName}
            <span
              style={{
                fontSize: 9,
                fontFamily: "'Barlow Condensed', sans-serif",
                letterSpacing: 0.5,
                color: T.accent,
                border: `1px solid ${T.accent}`,
                borderRadius: 4,
                padding: "1px 5px",
                fontWeight: 700,
              }}
            >
              PRO
            </span>
          </div>
          <div style={{ fontSize: 11, color: T.muted }}>Copilote vocal · Duplex temps réel</div>
        </div>

        {/* Toggles Micro & Haut-parleur */}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setIsMuted(!isMuted)}
            title={isMuted ? "Micro coupé" : "Micro actif"}
            style={{
              padding: "6px 8px",
              borderRadius: 8,
              background: isMuted ? "rgba(255,71,87,0.15)" : T.panelAlt,
              border: `1px solid ${isMuted ? T.critical : T.border}`,
              color: isMuted ? T.critical : T.text,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
          <button
            onClick={() => {
              const next = !speakerEnabled;
              setSpeakerEnabled(next);
              if (!next && "speechSynthesis" in window) {
                window.speechSynthesis.cancel();
                setCurrentlySpeakingId(null);
              }
            }}
            title={speakerEnabled ? "Haut-parleur actif" : "Haut-parleur coupé"}
            style={{
              padding: "6px 8px",
              borderRadius: 8,
              background: !speakerEnabled ? "rgba(255,71,87,0.15)" : T.panelAlt,
              border: `1px solid ${!speakerEnabled ? T.critical : T.border}`,
              color: !speakerEnabled ? T.critical : T.text,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            {speakerEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
        </div>
      </div>

      {/* CONTEXTE VÉHICULE & BOUTON BOUCLE IA */}
      <div style={{ margin: "12px 16px 0", display: "flex", gap: 8 }}>
        <button
          onClick={onLoadDemo}
          style={{
            flex: 1,
            padding: "9px 12px",
            background: T.panel,
            border: `1px solid ${diagnosis ? T.accent : T.border}`,
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            color: T.text,
            fontSize: 12,
            textAlign: "left",
            transition: "all 0.2s ease",
          }}
        >
          <Gauge size={14} color={diagnosis ? T.accent : T.muted} />
          <span style={{ color: diagnosis ? T.text : T.muted, flex: 1, fontWeight: diagnosis ? 600 : 400 }} className="truncate">
            {diagnosis ? diagnosis.brandModelInfo : "Aucun véhicule chargé pour cette session"}
          </span>
          <span style={{ color: T.accent, fontSize: 11, display: "flex", alignItems: "center", gap: 2, shrink: 0 }}>
            {diagnosis ? "Changer" : "Charger démo"} <ChevronRight size={12} />
          </span>
        </button>

        <button
          onClick={() => {
            if (!activeLoopSessionId) {
              startDiagnosticSession();
            } else {
              setShowLoopOverlay(!showLoopOverlay);
            }
          }}
          style={{
            padding: "9px 12px",
            background: activeLoopSessionId ? "rgba(255,122,41,0.15)" : T.panel,
            border: `1px solid ${activeLoopSessionId ? T.accent : T.border}`,
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
            color: activeLoopSessionId ? T.accent : T.text,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <Wrench size={14} />
          <span>{activeLoopSessionId ? (showLoopOverlay ? "Masquer Boucle" : "Panneau IA") : "Lancer Boucle IA"}</span>
        </button>
      </div>

      {/* PANNEAU DE BORD INTÉGRÉ : BOUCLE DE DIAGNOSTIC AUTO-QUESTIONNANTE */}
      {showLoopOverlay && (
        <div
          style={{
            margin: "10px 16px 0",
            padding: "14px",
            background: T.panelAlt,
            border: `1px solid ${T.accent}`,
            borderRadius: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Activity size={16} color={T.accent} />
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                Diagnostic Interactif Pas-à-Pas
              </span>
              {activeLoopState && (
                <span
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "rgba(255,122,41,0.2)",
                    color: T.accent,
                    fontWeight: 700,
                  }}
                >
                  Tour #{activeLoopState.tour_actuel || 1}
                </span>
              )}
            </div>
            <button
              onClick={() => setShowLoopOverlay(false)}
              style={{ background: "transparent", border: "none", color: T.muted, cursor: "pointer" }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Phase de progression */}
          {activeTurnResponse && (
            <div style={{ background: T.panel, padding: "8px 12px", borderRadius: 8, fontSize: 11 }}>
              <div style={{ color: T.accent, fontWeight: 600, marginBottom: 2 }}>
                Phase : {activeTurnResponse.phase_diag || "Élimination rapide"}
              </div>
              <div style={{ color: T.text, fontWeight: 500 }}>
                {activeTurnResponse.next_question}
              </div>
            </div>
          )}

          {/* Protocole de test physique conseillé */}
          {activeTurnResponse?.protocole_test && (
            <div style={{ background: "rgba(62,213,152,0.08)", border: `1px solid ${T.confirm}`, padding: "10px", borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.confirm, marginBottom: 4 }}>
                🛠️ Protocole de test immédiat :
              </div>
              <div style={{ fontSize: 12, color: T.text }}>
                {activeTurnResponse.protocole_test.etape}
              </div>
              {activeTurnResponse.protocole_test.valeur_attendue && (
                <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>
                  Valeur cible : <strong style={{ color: T.text }}>{activeTurnResponse.protocole_test.valeur_attendue}</strong>
                </div>
              )}
            </div>
          )}

          {/* Chemin Scanner Grounded */}
          {activeTurnResponse?.chemin_scanner && (
            <div style={{ fontSize: 11, background: T.panel, padding: "6px 10px", borderRadius: 6, color: T.muted }}>
              📟 Scanner : <span style={{ color: T.accent, fontWeight: 600 }}>{activeTurnResponse.chemin_scanner}</span>
            </div>
          )}

          {/* Hypothèses & Niveaux de confiance */}
          {activeLoopState?.hypotheses && activeLoopState.hypotheses.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, uppercase: true }}>
                Hypothèses courantes & Confiance :
              </div>
              {activeLoopState.hypotheses.map((h, i) => (
                <div key={i} style={{ background: T.panel, padding: "8px 10px", borderRadius: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: T.text }}>{h.cause}</span>
                    <span style={{ fontWeight: 700, color: h.confiance >= 70 ? T.confirm : T.accent }}>
                      {h.confiance}%
                    </span>
                  </div>
                  <div style={{ width: "100%", height: 4, background: T.border, borderRadius: 2, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${h.confiance}%`,
                        height: "100%",
                        background: h.confiance >= 70 ? T.confirm : T.accent,
                        transition: "width 0.4s ease",
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>
                    {h.lien_avec_dtc}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Action : Bouton Post-Réparation */}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              onClick={() => activeLoopSessionId && confirmerReparation(activeLoopSessionId)}
              disabled={isLoopLoading}
              style={{
                flex: 1,
                padding: "8px",
                background: "rgba(62,213,152,0.15)",
                border: `1px solid ${T.confirm}`,
                color: T.confirm,
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <FileCheck2 size={14} /> Valider la Réparation
            </button>
            <button
              onClick={() => {
                const testVal = prompt("Entrez le résultat de test physique (ex: Pression rail 350 bar) :");
                if (testVal && activeLoopSessionId) {
                  submitReponse(activeLoopSessionId, activeLoopState?.tour_actuel || 1, testVal);
                }
              }}
              disabled={isLoopLoading}
              style={{
                padding: "8px 12px",
                background: T.panel,
                border: `1px solid ${T.border}`,
                color: T.text,
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Répondre
            </button>
          </div>
        </div>
      )}

      {/* ZONE CENTRALE — Orbe Vocal Duplex */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: "20px 24px",
          minHeight: 280,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            fontFamily: "'Barlow Condensed', sans-serif",
            letterSpacing: 1,
            color: callState === "live" ? T.confirm : T.muted,
            fontWeight: 700,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: callState === "live" ? T.confirm : T.border,
              animation: callState === "live" ? "dotBlink 1.4s infinite" : "none",
            }}
          />
          DUPLEX TEMPS RÉEL {callState === "live" ? "· ACTIF" : ""}
        </div>

        {/* Bouton Orbe Central */}
        <button
          onClick={callState === "idle" ? startLiveCallSession : stopLiveCallSession}
          style={{
            width: 140,
            height: 140,
            borderRadius: "50%",
            border: `3px solid ${callState === "live" ? T.confirm : T.accent}`,
            background: callState === "live" ? "rgba(62,213,152,0.08)" : T.panel,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            cursor: "pointer",
            color: T.text,
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            animation:
              callState === "connecting"
                ? "pulseRing 1.1s infinite"
                : callState === "live"
                ? "pulseRingLive 1.8s infinite"
                : "none",
          }}
        >
          {callState === "live" ? (
            <div style={{ display: "flex", gap: 3, alignItems: "center", height: 30 }}>
              <span style={{ width: 3, background: T.confirm, borderRadius: 2, animation: "bar1 0.9s infinite" }} />
              <span style={{ width: 3, background: T.confirm, borderRadius: 2, animation: "bar2 0.8s infinite" }} />
              <span style={{ width: 3, background: T.confirm, borderRadius: 2, animation: "bar3 1s infinite" }} />
              <span style={{ width: 3, background: T.confirm, borderRadius: 2, animation: "bar4 0.75s infinite" }} />
            </div>
          ) : callState === "connecting" ? (
            <Radio size={32} color={T.accent} />
          ) : (
            <Phone size={32} color={T.accent} />
          )}
          <span style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>
            {callState === "idle" && "Démarrer"}
            {callState === "connecting" && "Connexion…"}
            {callState === "live" && formatTime(elapsed)}
          </span>
        </button>

        <div style={{ fontSize: 13, color: T.muted, textAlign: "center", maxWidth: 280, lineHeight: 1.4 }}>
          {callState === "idle" &&
            "Appuyez pour parler avec DiagAssist en direct pendant votre intervention."}
          {callState === "connecting" && "Établissement de la connexion vocale…"}
          {callState === "live" && "En écoute — vous pouvez aussi joindre une photo ou vidéo à tout moment."}
        </div>

        {callState === "live" && (
          <button
            onClick={stopLiveCallSession}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: `1px solid ${T.critical}`,
              color: T.critical,
              borderRadius: 20,
              padding: "7px 16px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <PhoneOff size={13} /> Terminer l'appel
          </button>
        )}
      </div>

      {/* HISTORIQUE DE DIALOGUE AVEC LECTURE VOCALE */}
      <div style={{ padding: "0 16px 10px", maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {liveTranscript && (
          <div
            style={{
              fontSize: 11,
              padding: "8px 12px",
              borderRadius: 10,
              background: "rgba(62,213,152,0.08)",
              border: `1px solid ${T.confirm}`,
              color: T.text,
              whiteSpace: "pre-wrap",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            <div style={{ color: T.confirm, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>
              🎙️ TRANSCRIPTION DIRECTE DUPLEX
            </div>
            {liveTranscript}
          </div>
        )}

        {chatHistory.slice(-4).map((msg) => (
          <div
            key={msg.id}
            style={{
              fontSize: 11,
              padding: "8px 12px",
              borderRadius: 10,
              background: msg.role === "user" ? T.panelAlt : "rgba(255,122,41,0.08)",
              border: `1px solid ${msg.role === "user" ? T.border : "rgba(255,122,41,0.2)"}`,
              color: T.text,
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "92%",
              position: "relative",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "between", gap: 6, marginBottom: 3 }}>
              <strong style={{ color: msg.role === "user" ? T.muted : T.accent, fontSize: 10 }}>
                {msg.role === "user" ? "Mécanicien" : assistantName}
              </strong>

              {/* Bouton Écouter individuel pour chaque réponse */}
              {msg.role === "model" && (
                <button
                  type="button"
                  onClick={() => speakText(msg.text, msg.id)}
                  title="Écouter la réponse de l'IA"
                  style={{
                    marginLeft: "auto",
                    background: currentlySpeakingId === msg.id ? T.accent : T.panel,
                    color: currentlySpeakingId === msg.id ? "#fff" : T.accent,
                    border: `1px solid ${T.accent}`,
                    borderRadius: 6,
                    padding: "2px 6px",
                    fontSize: 9,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <Volume2 size={11} />
                  {currentlySpeakingId === msg.id ? "Lecture…" : "Écouter"}
                </button>
              )}
            </div>
            <div>{msg.text}</div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* TOAST */}
      {toast && (
        <div
          className="cap-in"
          style={{
            margin: "0 16px 8px",
            background: T.panelAlt,
            border: `1px solid ${T.accent}`,
            borderRadius: 10,
            padding: "8px 12px",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.5)",
          }}
        >
          <Sparkles size={14} color={T.accent} style={{ flexShrink: 0 }} />
          <span>{toast}</span>
        </div>
      )}

      {/* BANDE DES CAPTURES */}
      {captures.length > 0 && (
        <div style={{ display: "flex", gap: 8, padding: "0 16px 8px", overflowX: "auto" }}>
          {captures.map((c) => (
            <div
              key={c.id}
              className="cap-in"
              style={{
                position: "relative",
                width: 56,
                height: 56,
                borderRadius: 10,
                overflow: "hidden",
                border: `1px solid ${T.border}`,
                background: T.panelAlt,
                flexShrink: 0,
              }}
            >
              {c.kind === "image" ? (
                <img src={c.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <VideoIcon size={18} color={T.muted} />
                </div>
              )}
              <div
                style={{
                  position: "absolute",
                  bottom: 2,
                  right: 2,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.7)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {c.status === "ok" ? (
                  <CheckCircle2 size={11} color={T.confirm} />
                ) : (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      border: `2px solid ${T.accent}`,
                      borderTopColor: "transparent",
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ENVOI DE MESSAGE TEXTE */}

      <form onSubmit={handleTextSubmit} style={{ padding: "0 12px 8px", display: "flex", gap: 6 }}>
        <input
          type="text"
          value={liveInputText}
          onChange={(e) => setLiveInputText(e.target.value)}
          placeholder="Posez une question à l'IA en direct..."
          disabled={isSendingChat}
          style={{
            flex: 1,
            background: T.panel,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: "8px 12px",
            color: T.text,
            fontSize: 12,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={!liveInputText.trim() || isSendingChat}
          style={{
            background: T.accent,
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "0 12px",
            cursor: "pointer",
            opacity: !liveInputText.trim() || isSendingChat ? 0.5 : 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Send size={14} />
        </button>
      </form>

      {/* DOCK DE CAPTURE MEDIAS */}
      <div
        style={{
          padding: 12,
          borderTop: `1px solid ${T.border}`,
          background: T.panel,
          display: "flex",
          gap: 10,
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <button
          className="attach-glow"
          onClick={() => fileInputRef.current?.click()}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "11px 0",
            borderRadius: 12,
            border: `1px solid ${T.accent}`,
            background: "transparent",
            color: T.accent,
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          <Paperclip size={16} /> Fichier
        </button>

        <button
          onClick={() => cameraInputRef.current?.click()}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "11px 0",
            borderRadius: 12,
            border: `1px solid ${T.border}`,
            background: T.panelAlt,
            color: T.text,
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          <Camera size={15} /> Caméra live
        </button>
      </div>

      {/* NAV INFÉRIEURE */}
      <div
        style={{
          display: "flex",
          borderTop: `1px solid ${T.border}`,
          background: T.bg,
        }}
      >
        {[
          { id: "diagnose" as const, label: "Atelier", icon: Gauge },
          { id: "live" as const, label: "Live", icon: Radio },
          { id: "prices" as const, label: "Offres", icon: Sparkles },
        ].map((tab) => {
          const isActive = tab.id === "live";
          return (
            <button
              key={tab.label}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                padding: "10px 0",
                color: isActive ? T.accent : T.muted,
                fontSize: 11,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontWeight: isActive ? 600 : 400,
              }}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
