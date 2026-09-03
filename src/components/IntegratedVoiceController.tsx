import React, { useState, useEffect, useRef } from "react";
import { 
  Volume2, VolumeX, Mic, MicOff, Play, Pause, Square, RefreshCw, Sparkles, 
  ChevronRight, ChevronLeft, HelpCircle, AlertCircle, Paperclip, Camera, 
  Film, Music, X, Send, Upload
} from "lucide-react";
import { Diagnosis, ChatMessage } from "../types";
import { playMicStartSound, playMicStopSound, playNotificationSound, playClickFeedbackSound } from "../utils/audioEngine";
import { globalAdManager } from "../services/adManager";

interface IntegratedVoiceControllerProps {
  diagnosis: Diagnosis;
  chatHistory: ChatMessage[];
  onSendMessage: (text: string, file?: string, mimeType?: string, fileName?: string) => Promise<void>;
  isSendingChat: boolean;
  assistantName: string;
  isPremiumActive: boolean;
  onUpgradeClick: () => void;
  isLiveActive?: boolean;
  setIsLiveActive?: (active: boolean) => void;
}

// Custom phonetic cleaner to make Speech Synthesis sound local, natural, clear and extremely professional in French
const cleanPhoneticText = (text: string): string => {
  if (!text) return "";
  let cleaned = text;

  // Strips out any markdown characters like asterisks (** or *), hashes (#), underscores (_) and backticks (`)
  // which make readings sound amateurish or fragmented.
  cleaned = cleaned.replace(/[\*\#\`\_]/g, "");

  // Clean starting bullet-points or dashes from lines
  cleaned = cleaned.replace(/^\s*-\s*/gm, "");

  cleaned = cleaned
    .replace(/\bOEM\b/gi, "pièce d'origine constructeur")
    .replace(/\bOES\b/gi, "pièce d'équipementier certifié")
    .replace(/\bDTC\b/gi, "code de défaut")
    .replace(/\bPSA\b/gi, "P. S. A.")
    .replace(/\bCO2\b/gi, "C. O. deux")
    .replace(/FCFA/gi, " Francs SÉFA ")
    .replace(/F CFA/gi, " Francs SÉFA ")
    .replace(/F\b/g, " Francs ")
    .replace(/%/g, " pour cent ")
    .replace(/\bréf\./gi, " référence ")
    .replace(/\bmin\b/gi, " minimum ")
    .replace(/\bmax\b/gi, " maximum ")
    .replace(/\bBosch\b/gi, " boche ")
    .replace(/\bValéo\b/gi, " valé-o ")
    .replace(/\bDelphi\b/gi, " delfille ")
    .replace(/\bGarrett\b/gi, " garrelt ")
    .replace(/\bAbidjan\b/g, "Abidjan, ");

  return cleaned.replace(/\s+/g, " ").trim();
};

// Ultra-realistic Deep Learning voices from Google Cloud Text-to-Speech API
const CLOUD_VOICES = [
  { id: "fr-FR-Neural2-B", name: "fr-FR-Neural2-B", label: "fr-FR-Neural2-B (⭐ Google Neural2 - Voix Pro Masculine)" },
  { id: "fr-FR-Neural2-C", name: "fr-FR-Neural2-C", label: "fr-FR-Neural2-C (⭐ Google Neural2 - Voix Pro Féminine)" },
  { id: "fr-FR-Wavenet-B", name: "fr-FR-Wavenet-B", label: "fr-FR-Wavenet-B (⭐ Google WaveNet - Homme HD)" },
  { id: "fr-FR-Wavenet-C", name: "fr-FR-Wavenet-C", label: "fr-FR-Wavenet-C (⭐ Google WaveNet - Femme HD)" }
];

// Ultra-realistic Deep Learning voices from ElevenLabs API
const ELEVENLABS_VOICES = [
  { id: "eleven-french-adrien", name: "eleven-french-adrien", label: "🎙️ ElevenLabs - Adrien (Mécano Expert 👑)" }
];

// ElevenLabs Client Implementation for Dynamic Voice Integration & Client-Side Synthesis
export class ElevenLabsClient {
  private apiKey: string;
  private baseUrl: string = "https://api.elevenlabs.io/v1";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getVoices() {
    const response = await fetch(`${this.baseUrl}/voices`, {
      method: "GET",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ElevenLabs voices: ${response.statusText}`);
    }
    const data = await response.json();
    return data.voices || [];
  }

  async textToSpeech(text: string, voiceId: string) {
    const response = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
        "accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });
    if (!response.ok) {
      throw new Error(`ElevenLabs TTS generation failed: ${response.statusText}`);
    }
    return await response.blob();
  }
}

// Helper to initialize ElevenLabs client
// FAILLE CORRIGÉE : une vraie clé API ElevenLabs était codée en dur ici, directement visible
// dans le bundle JavaScript envoyé au navigateur de CHAQUE visiteur (DevTools > Sources).
// Cette clé a été utilisée en production et doit être révoquée/régénérée dans votre compte
// ElevenLabs sans délai — elle est compromise, peu importe ce correctif de code.
// Architecture à corriger ensuite : ces appels devraient passer par /api/tts (déjà sécurisé
// côté serveur) plutôt que d'appeler ElevenLabs directement depuis le navigateur, car toute
// clé utilisée ici restera visible dans le bundle, même si elle est renouvelée.
export const initElevenLabsClient = (apiKey?: string): ElevenLabsClient | null => {
  if (!apiKey) {
    console.warn("[ElevenLabs] Aucune clé API fournie côté client — synthèse vocale ElevenLabs directe désactivée.");
    return null;
  }
  return new ElevenLabsClient(apiKey);
};

// Helper to dynamically match vehicle name with a professional photo for visual clarity
const getCarPhotoUrl = (brandModelInfo: string): string => {
  if (!brandModelInfo) return "https://images.unsplash.com/photo-1517524206127-48bbd363f3d7?auto=format&fit=crop&w=600&q=80";
  const name = brandModelInfo.toLowerCase();
  
  if (name.includes("ford") && name.includes("c-max")) {
    return "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=600&q=80";
  }
  if (name.includes("toyota") || name.includes("corolla") || name.includes("yaris") || name.includes("rav")) {
    return "https://images.unsplash.com/photo-1617469767053-d3b508a0d822?auto=format&fit=crop&w=600&q=80";
  }
  if (name.includes("peugeot") || name.includes("renault") || name.includes("citroen") || name.includes("dacia")) {
    return "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&w=600&q=80";
  }
  if (name.includes("mercedes") || name.includes("bmw") || name.includes("audi") || name.includes("volkswagen") || name.includes("vw")) {
    return "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=600&q=80";
  }
  return "https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=600&q=80";
};

export default function IntegratedVoiceController({
  diagnosis,
  chatHistory,
  onSendMessage,
  isSendingChat,
  assistantName,
  isPremiumActive,
  onUpgradeClick,
  isLiveActive: propLiveActive,
  setIsLiveActive: propSetLiveActive
}: IntegratedVoiceControllerProps) {
  const [speechStatus, setSpeechStatus] = useState<"stopped" | "playing" | "paused">("stopped");
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [currentSubtitle, setCurrentSubtitle] = useState("");
  const [micPulse, setMicPulse] = useState(false);
  const [isGeneratingTts, setIsGeneratingTts] = useState(false);

  // Sync speech status with global AdManager so audio ads wait for natural pauses
  useEffect(() => {
    globalAdManager.setGeminiSpeaking(speechStatus === "playing");
  }, [speechStatus]);

  const [localLiveActive, setLocalLiveActive] = useState(false);
  const activeLive = propLiveActive !== undefined ? propLiveActive : localLiveActive;
  const setActiveLive = propSetLiveActive !== undefined ? propSetLiveActive : setLocalLiveActive;

  const [liveStatus, setLiveStatus] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<string>("");

  // Live Multimodal Attachment & Chat State
  const [liveInputText, setLiveInputText] = useState("");
  const [attachedLiveFile, setAttachedLiveFile] = useState<{
    base64: string;
    mimeType: string;
    fileName: string;
    previewUrl: string;
    type: "photo" | "video" | "audio" | "file";
  } | null>(null);

  const liveFileInputRef = useRef<HTMLInputElement>(null);

  const handleLiveFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      alert("Le fichier est trop volumineux (25 Mo maximum). Veuillez sélectionner un fichier plus court.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64Data = dataUrl.split(",")[1];
      const mimeType = file.type || "application/octet-stream";

      let mediaType: "photo" | "video" | "audio" | "file" = "file";
      if (mimeType.startsWith("image/")) mediaType = "photo";
      else if (mimeType.startsWith("video/")) mediaType = "video";
      else if (mimeType.startsWith("audio/")) mediaType = "audio";

      setAttachedLiveFile({
        base64: base64Data,
        mimeType,
        fileName: file.name,
        previewUrl: dataUrl,
        type: mediaType,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleRemoveLiveFile = () => {
    setAttachedLiveFile(null);
  };

  const handleSendLiveMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const textToSend = liveInputText.trim();
    if (!textToSend && !attachedLiveFile) return;
    if (isSendingChat) return;

    const finalMsg = textToSend || (attachedLiveFile ? `Fichier joint pour analyse live : ${attachedLiveFile.fileName}` : "");

    await onSendMessage(
      finalMsg,
      attachedLiveFile?.base64,
      attachedLiveFile?.mimeType,
      attachedLiveFile?.fileName
    );

    setLiveInputText("");
    setAttachedLiveFile(null);
  };

  // Refs for Web Audio Live
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxInputRef = useRef<AudioContext | null>(null);
  const audioCtxOutputRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  // Voice Selection States
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [elevenLabsVoices, setElevenLabsVoices] = useState<{ id: string; name: string; label: string }[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>("fr-FR-Neural2-B");

  // Set preferred speech voice, default to "fr-FR-Neural2-B" for ultra-realistic voice
  useEffect(() => {
    const saved = localStorage.getItem("preferred_speech_voice");
    setSelectedVoiceName(saved || "fr-FR-Neural2-B");
  }, []);

  // Fetch ElevenLabs voices from client
  useEffect(() => {
    let active = true;
    const fetchElevenLabs = async () => {
      try {
        const client = initElevenLabsClient();
        if (!client) return;
        const voices = await client.getVoices();
        if (voices && Array.isArray(voices) && active) {
          const mapped = voices.map((v: any) => ({
            id: `eleven-api-${v.voice_id}`,
            name: v.name,
            label: `👑 ElevenLabs - ${v.name} (${v.category || "Pro"})`
          }));
          setElevenLabsVoices(mapped);
        }
      } catch (err) {
        console.warn("Could not fetch ElevenLabs voices from API:", err);
      }
    };
    fetchElevenLabs();
    return () => {
      active = false;
    };
  }, []);

  const recognitionRef = useRef<any>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isAutoPlayingRef = useRef(false);
  const lastSpokenMessageIdRef = useRef<string>("");

  // Load available French voices from SpeechSynthesis
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;

    const loadVoices = () => {
      const allVoices = window.speechSynthesis.getVoices();
      const frVoices = allVoices.filter(v => v.lang.toLowerCase().startsWith("fr"));
      setAvailableVoices(frVoices);
    };

    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  const handleVoiceChange = (voiceName: string) => {
    setSelectedVoiceName(voiceName);
    localStorage.setItem("preferred_speech_voice", voiceName);
    
    // Restart active reading if voice is modified during playback
    if (speechStatus === "playing" || speechStatus === "paused") {
      handleStop();
      setTimeout(() => {
        const sec = sections[currentSectionIndex];
        if (sec) {
          handleSpeakText(sec.text, sec.title);
        }
      }, 150);
    }
  };

  // Define speech sections to play
  const getSpeechSections = () => {
    const list = [
      {
        id: "intro",
        title: "Introduction",
        text: `DiagAssist, je t'écoute. Véhicule ${diagnosis.brandModelInfo || "détecté"}. Panne ${diagnosis.severity}. Laisse-moi t'expliquer.`
      },
      {
        id: "explanation",
        title: "Analyse Technique",
        text: `Voici mon explication technique : ${diagnosis.explanationText}. Les causes probables sont : ${diagnosis.probableCauses.join(", ")}.`
      }
    ];

    diagnosis.repairGuideSteps.forEach((step) => {
      list.push({
        id: `step-${step.stepNumber}`,
        title: `Étape ${step.stepNumber} : ${step.title}`,
        text: `Étape ${step.stepNumber}. ${step.title}. ${step.description}. Durée estimée : ${step.estimatedTime}.`
      });
    });

    list.push({
      id: "outro",
      title: "Recommandations",
      text: "Pour ta sécurité, suis bien ces étapes. Tu peux aussi me poser toutes tes questions directement à l'écrit ou à la voix en cliquant sur le micro juste en dessous !"
    });

    return list;
  };

  const sections = getSpeechSections();

  // Initialize Speech Recognition for voice command inputs
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "fr-FR";

      rec.onstart = () => {
        setIsListening(true);
        setMicPulse(true);
        setMicError(null);
        try { playMicStartSound(); } catch (e) {}
      };

      rec.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        if (text && text.trim()) {
          // Pause reading if speaking to process user query
          handlePause();
          onSendMessage(text.trim());
        }
      };

      rec.onerror = (event: any) => {
        console.warn("Speech recognition error:", event.error);
        if (event.error === "not-allowed") {
          setMicError("Micro bloqué. Activez l'autorisation dans votre navigateur.");
        } else if (event.error === "no-speech") {
          setMicError("Aucune voix détectée. Réessayez.");
        } else {
          setMicError(`Erreur micro : ${event.error}`);
        }
        setIsListening(false);
        setMicPulse(false);
        try { playMicStopSound(); } catch (e) {}
      };

      rec.onend = () => {
        setIsListening(false);
        setMicPulse(false);
        try { playMicStopSound(); } catch (e) {}
      };

      recognitionRef.current = rec;
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {}
      }
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (audioRef.current) {
        try {
          audioRef.current.pause();
        } catch (e) {}
      }
      // Stop Gemini Live session if active on unmount
      if (wsRef.current || micStreamRef.current) {
        stopLiveSession();
      }
    };
  }, []);

  // Helper to convert Float32 to Int16 PCM Base64 for Gemini Live API
  const pcmToBase64 = (float32Array: Float32Array): string => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      const intSample = s < 0 ? s * 0x8000 : s * 0x7FFF;
      view.setInt16(i * 2, intSample, true); // true = little endian
    }
    
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  // Stop any currently playing audio buffer source nodes (for interruption / barge-in)
  const stopAllAudioPlayback = () => {
    activeSourcesRef.current.forEach((src) => {
      try { src.stop(); } catch (e) {}
    });
    activeSourcesRef.current = [];
    nextStartTimeRef.current = 0;
  };

  // Playback a chunk of 24kHz Int16 raw PCM audio from Gemini Live
  const playAudioChunk = (base64Data: string) => {
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
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
      };
      
      const now = ctx.currentTime;
      let startTime = nextStartTimeRef.current;
      
      // If the audio queue was completely silent or dried up, schedule with a very small lookahead delay (20ms)
      // to absorb network and WebSocket rendering jitter, keeping playback perfectly smooth and fast.
      if (startTime < now) {
        startTime = now + 0.02;
      }
      
      source.start(startTime);
      nextStartTimeRef.current = startTime + buffer.duration;
    } catch (err) {
      console.error("[LiveAudio] Failed to play audio chunk:", err);
    }
  };

  // Start Gemini Live zero-latency session
  const startLiveSession = async () => {
    // Stop standard speech first
    handleStop();
    
    setLiveStatus("connecting");
    setLiveError(null);
    setLiveTranscript("");
    setActiveLive(true);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioCtxInputRef.current = inputCtx;
      
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioCtxOutputRef.current = outputCtx;
      nextStartTimeRef.current = 0;

      // BUG CORRIGÉ : certains navigateurs créent l'AudioContext en état "suspended" — le son ne
      // joue alors jamais, silencieusement, même si le reste fonctionne (texte affiché normalement).
      if (inputCtx.state === "suspended") await inputCtx.resume();
      if (outputCtx.state === "suspended") await outputCtx.resume();
      
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const authToken = localStorage.getItem("auth_session_token") || "";
      const wsUrl = `${protocol}//${window.location.host}/api/live-ws?token=${encodeURIComponent(authToken)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      ws.onopen = () => {
        console.log("[LiveWS] Connected, sending context.");
        
        const dtcList = diagnosis.dtcCodesDetected && diagnosis.dtcCodesDetected.length > 0
          ? diagnosis.dtcCodesDetected.map(c => `- Code ${c.code} : ${c.description}`).join("\n")
          : "Aucun code OBD spécifique.";

        const causesList = diagnosis.probableCauses && diagnosis.probableCauses.length > 0
          ? diagnosis.probableCauses.map(c => `- ${c}`).join("\n")
          : "Non spécifié.";

        const recsList = diagnosis.immediateRecommendations && diagnosis.immediateRecommendations.length > 0
          ? diagnosis.immediateRecommendations.map(r => `- ${r}`).join("\n")
          : "Aucune recommandation.";

        const stepsList = diagnosis.repairGuideSteps && diagnosis.repairGuideSteps.length > 0
          ? diagnosis.repairGuideSteps.map(s => `Étape ${s.stepNumber}: ${s.title} (${s.estimatedTime}) - ${s.description}`).join("\n")
          : "Aucune étape disponible.";

        const currency = diagnosis.estimatedCosts?.currency || "F CFA";
        const costParts = `Pièces détachées : de ${diagnosis.estimatedCosts?.partsMin || 0} à ${diagnosis.estimatedCosts?.partsMax || 0} ${currency}`;
        const costLabor = `Main d'œuvre estimée : de ${diagnosis.estimatedCosts?.laborMin || 0} à ${diagnosis.estimatedCosts?.laborMax || 0} ${currency}`;

        const diagnosisText = `FICHE DE DIAGNOSTIC TECHNIQUE ET CONTEXTE COMPLET :
Véhicule sous examen : ${diagnosis.brandModelInfo || "Modèle Non Précisé"}
Niveau de Gravité : ${diagnosis.severity || "Moyen"}
Synthèse de la Panne : ${diagnosis.explanationText || "N/A"}

CODES DÉFAUT OBD (DTC) DETECTES :
${dtcList}

CAUSES PROBABLES :
${causesList}

RECOMMANDATIONS IMMÉDIATES :
${recsList}

ÉTAPES DE RÉPARATION & TESTS ACTIFS CONSEILLÉS :
${stepsList}

ESTIMATION DES COÛTS DE RÉPARATION CONSEILLÉS À ABIDJAN :
- ${costParts}
- ${costLabor}`;

        ws.send(JSON.stringify({
          type: "start",
          diagnosticContext: diagnosisText
        }));
      };
      
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "connected") {
          setLiveStatus("connected");
          try { playMicStartSound(); } catch (e) {}
        } else if (msg.type === "audio") {
          playAudioChunk(msg.audio);
        } else if (msg.type === "interrupted") {
          console.log("[LiveWS] Interrupted by user input, clearing queue.");
          stopAllAudioPlayback();
        } else if (msg.type === "userTranscript") {
          setLiveTranscript((prev) => {
            const cleaned = prev.trim();
            return cleaned + (cleaned ? "\n" : "") + "Mécano : " + msg.text;
          });
        } else if (msg.type === "text") {
          setLiveTranscript((prev) => {
            const cleaned = prev.trim();
            // Find the last line
            const lastNewline = cleaned.lastIndexOf("\n");
            const lastLine = lastNewline !== -1 ? cleaned.substring(lastNewline + 1) : cleaned;
            
            if (lastLine.startsWith("DiagAssist :")) {
              return prev + msg.text; // Append directly to current DiagAssist block
            } else {
              return cleaned + (cleaned ? "\n" : "") + "DiagAssist : " + msg.text;
            }
          });
        } else if (msg.type === "error") {
          setLiveError(msg.message);
          setLiveStatus("error");
        } else if (msg.type === "closed") {
          stopLiveSession();
        }
      };
      
      ws.onerror = (err) => {
        console.error("[LiveWS] error:", err);
        setLiveError("La connexion en temps réel avec le serveur a échoué.");
        setLiveStatus("error");
      };
      
      ws.onclose = () => {
        setLiveStatus("disconnected");
      };
      
      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;
      
      source.connect(processor);
      processor.connect(inputCtx.destination);
      
      processor.onaudioprocess = (e) => {
        if (ws.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          
          const base64 = pcmToBase64(inputData);
          ws.send(JSON.stringify({
            type: "audio",
            audio: base64
          }));
        }
      };
      
    } catch (err: any) {
      console.error("[LiveAudio] Start failed:", err);
      setLiveError(err.message || "Impossible d'accéder au micro ou d'établir la connexion.");
      setLiveStatus("error");
      stopLiveSession();
    }
  };

  // Stop Gemini Live session
  const stopLiveSession = () => {
    if (wsRef.current) {
      try { wsRef.current.close(); } catch (e) {}
      wsRef.current = null;
    }
    
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
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
    
    setActiveLive(false);
    setLiveStatus("disconnected");
    try { playMicStopSound(); } catch (e) {}
  };

  // Auto-start live WebSocket connection if activeLive is true but not yet connected
  useEffect(() => {
    if (activeLive && liveStatus === "disconnected" && !wsRef.current) {
      startLiveSession();
    }
  }, [activeLive, liveStatus]);

  // Auto-play introduction when a new diagnosis arrives
  useEffect(() => {
    if (activeLive) return; // Prevent standard TTS auto-play during live duplex session
    if (diagnosis && !isAutoPlayingRef.current) {
      isAutoPlayingRef.current = true;
      // Small timeout to let user focus on the screen
      const timer = setTimeout(() => {
        handlePlaySection(0);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [diagnosis, activeLive]);

  // Read chat replies out loud automatically
  useEffect(() => {
    if (activeLive) return; // Prevent standard TTS auto-play during live duplex session
    if (chatHistory.length > 0) {
      const lastMsg = chatHistory[chatHistory.length - 1];
      if (lastMsg.role === "model" && lastMsg.id !== lastSpokenMessageIdRef.current) {
        lastSpokenMessageIdRef.current = lastMsg.id;
        try { playNotificationSound(); } catch (e) {}
        // Automatically speak the chat response
        handleSpeakText(lastMsg.text, `Réponse de ${assistantName}`);
      }
    }
  }, [chatHistory, activeLive]);

  const handleSpeakText = async (rawText: string, title: string) => {
    handleStop();

    if (selectedVoiceName === "none") {
      return;
    }

    setCurrentSubtitle(rawText);
    const cleaned = cleanPhoneticText(rawText);

    const isApiVoice = selectedVoiceName.startsWith("eleven-api-");
    const isCloudVoice = CLOUD_VOICES.some(v => v.id === selectedVoiceName) || 
                         ELEVENLABS_VOICES.some(v => v.id === selectedVoiceName) ||
                         isApiVoice;

    if (isCloudVoice) {
      try {
        setIsGeneratingTts(true);
        
        if (isApiVoice) {
          const voiceId = selectedVoiceName.replace("eleven-api-", "");
          const client = initElevenLabsClient();
          if (!client) throw new Error("ElevenLabs non configuré côté client.");
          const audioBlob = await client.textToSpeech(cleaned, voiceId);
          const audioUrl = URL.createObjectURL(audioBlob);
          const audioObj = new Audio(audioUrl);

          audioObj.onplay = () => {
            setSpeechStatus("playing");
          };

          audioObj.onended = () => {
            setSpeechStatus("stopped");
            URL.revokeObjectURL(audioUrl);
          };

          audioObj.onerror = () => {
            setSpeechStatus("stopped");
            URL.revokeObjectURL(audioUrl);
            fallbackToLocalSpeech(cleaned);
          };

          audioRef.current = audioObj;
          await audioObj.play();
        } else {
          const response = await fetch("/api/tts", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${localStorage.getItem("auth_session_token") || ""}`,
            },
            body: JSON.stringify({
              text: cleaned,
              voiceName: selectedVoiceName
            })
          });

          if (!response.ok) {
            throw new Error("Erreur de réponse de l'API de synthèse vocale.");
          }

          const data = await response.json();
          if (data.success && data.audioContent) {
            const audioUrl = `data:audio/mp3;base64,${data.audioContent}`;
            const audioObj = new Audio(audioUrl);
            
            audioObj.onplay = () => {
              setSpeechStatus("playing");
            };

            audioObj.onended = () => {
              setSpeechStatus("stopped");
            };

            audioObj.onerror = () => {
              setSpeechStatus("stopped");
              fallbackToLocalSpeech(cleaned);
            };

            audioRef.current = audioObj;
            await audioObj.play();
          } else {
            throw new Error(data.message || "Impossible de récupérer l'audio.");
          }
        }
      } catch (err: any) {
        console.warn("Échec de la synthèse vocale haut de gamme, basculement vers le synthétiseur local :", err.message);
        fallbackToLocalSpeech(cleaned);
      } finally {
        setIsGeneratingTts(false);
      }
    } else {
      fallbackToLocalSpeech(cleaned);
    }
  };

  const fallbackToLocalSpeech = (cleanedText: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(cleanedText);
    utterance.lang = "fr-FR";
    utterance.rate = 1.1; // Snappy and natural french flow

    // Select the user preferred or absolute best professional French voice available
    const voices = window.speechSynthesis.getVoices();
    let frVoice = voices.find(v => v.name === selectedVoiceName);
    
    if (!frVoice) {
      frVoice = 
        voices.find(v => v.lang.toLowerCase().replace("_", "-") === "fr-fr" && v.name.toLowerCase().includes("google")) ||
        voices.find(v => v.lang.toLowerCase().replace("_", "-") === "fr-fr" && v.name.toLowerCase().includes("microsoft")) ||
        voices.find(v => v.lang.toLowerCase().startsWith("fr") && v.name.toLowerCase().includes("natural")) ||
        voices.find(v => v.lang.toLowerCase().startsWith("fr") && v.name.toLowerCase().includes("premium")) ||
        voices.find(v => v.lang.toLowerCase().startsWith("fr") && (v.name.toLowerCase().includes("paul") || v.name.toLowerCase().includes("hortense") || v.name.toLowerCase().includes("gilles") || v.name.toLowerCase().includes("thomas") || v.name.toLowerCase().includes("nicolas"))) ||
        voices.find(v => v.lang.toLowerCase().startsWith("fr"));
    }

    if (frVoice) utterance.voice = frVoice;

    utterance.onstart = () => {
      setSpeechStatus("playing");
    };

    utterance.onend = () => {
      setSpeechStatus("stopped");
    };

    utterance.onerror = () => {
      setSpeechStatus("stopped");
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const handlePlaySection = (index: number) => {
    if (index < 0 || index >= sections.length) return;
    setCurrentSectionIndex(index);
    const sec = sections[index];
    handleSpeakText(sec.text, sec.title);
  };

  const handlePlayPause = async () => {
    const isCloudVoice = CLOUD_VOICES.some(v => v.id === selectedVoiceName) || 
                         ELEVENLABS_VOICES.some(v => v.id === selectedVoiceName) ||
                         selectedVoiceName.startsWith("eleven-api-");

    if (isCloudVoice) {
      if (audioRef.current) {
        if (speechStatus === "playing") {
          audioRef.current.pause();
          setSpeechStatus("paused");
        } else if (speechStatus === "paused") {
          try {
            await audioRef.current.play();
            setSpeechStatus("playing");
          } catch (e) {
            console.error(e);
          }
        }
      } else {
        handlePlaySection(currentSectionIndex);
      }
    } else {
      if (!("speechSynthesis" in window)) return;

      if (speechStatus === "playing") {
        window.speechSynthesis.pause();
        setSpeechStatus("paused");
      } else if (speechStatus === "paused") {
        window.speechSynthesis.resume();
        setSpeechStatus("playing");
      } else {
        handlePlaySection(currentSectionIndex);
      }
    }
  };

  const handlePause = () => {
    const isCloudVoice = CLOUD_VOICES.some(v => v.id === selectedVoiceName) || 
                         ELEVENLABS_VOICES.some(v => v.id === selectedVoiceName) ||
                         selectedVoiceName.startsWith("eleven-api-");
    if (isCloudVoice) {
      if (audioRef.current && speechStatus === "playing") {
        audioRef.current.pause();
        setSpeechStatus("paused");
      }
    } else {
      if ("speechSynthesis" in window && speechStatus === "playing") {
        window.speechSynthesis.pause();
        setSpeechStatus("paused");
      }
    }
  };

  const handleStop = () => {
    // 1. Stop cloud audio
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current = null;
      } catch (e) {}
    }

    // 2. Stop native synthesis
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    setSpeechStatus("stopped");
    setCurrentSubtitle("");
  };

  const handleNext = () => {
    if (currentSectionIndex + 1 < sections.length) {
      handlePlaySection(currentSectionIndex + 1);
    }
  };

  const handlePrev = () => {
    if (currentSectionIndex - 1 >= 0) {
      handlePlaySection(currentSectionIndex - 1);
    }
  };

  const toggleListening = () => {
    if (!recognitionRef.current) {
      setMicError("La saisie vocale n'est pas supportée sur ce navigateur ou cet appareil.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error(e);
      }
    }
  };

  if (activeLive) {
    return (
      <div className="bg-gradient-to-b from-red-950/40 to-slate-950 border-2 border-emerald-500/30 rounded-2xl p-6 shadow-2xl relative overflow-hidden animate-fade-in">
        {/* Background visual accents */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/[0.04] rounded-full blur-3xl pointer-events-none"></div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-center">
          {/* Left Column: Car Model Photo with pulsing active visualizer overlay */}
          <div className="md:col-span-2 relative rounded-xl border border-emerald-500/40 bg-slate-950 h-56 flex items-center justify-center overflow-hidden">
            <img
              src={getCarPhotoUrl(diagnosis.brandModelInfo)}
              alt={diagnosis.brandModelInfo}
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover opacity-60"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-slate-950/50"></div>
            
            {/* Direct Active Badge */}
            <div className="absolute top-3 left-3 bg-emerald-600 border border-emerald-400 text-white text-[8px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow animate-pulse">
              <span className="w-1.5 h-1.5 bg-white rounded-full"></span>
              EN DIRECT AVEC L'IA
            </div>

            {/* Visualizer bars over the photo */}
            {liveStatus === "connected" && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-end gap-1.5 h-8 bg-slate-950/80 px-4 py-2.5 rounded-full border border-emerald-500/30 backdrop-blur-sm">
                <div className="w-0.5 h-3 bg-emerald-500 rounded animate-bounce [animation-delay:0.1s]"></div>
                <div className="w-0.5 h-6 bg-emerald-500 rounded animate-bounce [animation-delay:0.3s]"></div>
                <div className="w-0.5 h-4 bg-emerald-400 rounded animate-bounce [animation-delay:0.2s]"></div>
                <div className="w-0.5 h-5 bg-emerald-500 rounded animate-bounce [animation-delay:0.4s]"></div>
                <div className="w-0.5 h-2.5 bg-emerald-400 rounded animate-bounce [animation-delay:0.5s]"></div>
              </div>
            )}
            
            {liveStatus === "connecting" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/70 backdrop-blur-xs">
                <RefreshCw className="w-8 h-8 text-red-500 animate-spin mb-2" />
                <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider">Connexion sécurisée...</span>
              </div>
            )}
          </div>

          {/* Right Column: Active status controls & transcription */}
          <div className="md:col-span-3 text-left space-y-4">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-950 border border-slate-850 mb-2">
                <span className={`w-2 h-2 rounded-full ${
                  liveStatus === "connected" ? "bg-emerald-500 animate-pulse" : "bg-red-500"
                }`}></span>
                <span className="text-[9px] font-mono uppercase tracking-wider font-black text-slate-400">
                  {liveStatus === "connected" ? "Duplex temps réel actif" : "Connexion en cours"}
                </span>
              </div>
              <h3 className="text-base font-display font-black text-white uppercase tracking-tight">
                {diagnosis.brandModelInfo || "Véhicule Atelier"}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed mt-1">
                {liveStatus === "connected" 
                  ? "DiagAssist vous écoute et répond sans délai. Demandez-lui les étapes de réparation ou le coût des pièces !"
                  : "Établissement du canal audio bidirectionnel..."}
              </p>
            </div>

            {/* Real-time Subtitle / Transcription */}
            <div className="p-3.5 bg-slate-950/90 border border-slate-850 rounded-xl relative">
              <span className="absolute -top-2 left-3 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-[8px] font-bold text-slate-400 uppercase tracking-widest font-mono">
                Transcription Live
              </span>
              <div className="min-h-14 max-h-24 overflow-y-auto text-xs text-slate-300 leading-relaxed font-mono pt-1 whitespace-pre-wrap">
                {liveTranscript ? (
                  liveTranscript.trim()
                ) : (
                  <span className="text-slate-600 italic">
                    {liveStatus === "connected" ? "Parlez maintenant..." : "Établissement de la connexion..."}
                  </span>
                )}
              </div>
            </div>

            {/* Error state display */}
            {liveError && (
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5 flex items-center gap-2 text-[10px] text-rose-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{liveError}</span>
              </div>
            )}

            {/* Live Multimodal Attachment Preview Chip */}
            {attachedLiveFile && (
              <div className="p-2 bg-slate-950 border border-red-500/40 rounded-xl flex items-center justify-between gap-2 text-xs animate-fade-in shrink-0">
                <div className="flex items-center gap-2 overflow-hidden">
                  {attachedLiveFile.type === "photo" ? (
                    <img src={attachedLiveFile.previewUrl} alt="Aperçu Live" className="w-9 h-9 object-cover rounded-lg border border-slate-700 shrink-0" />
                  ) : attachedLiveFile.type === "video" ? (
                    <div className="w-9 h-9 bg-slate-900 border border-slate-700 rounded-lg flex items-center justify-center shrink-0 text-red-400">
                      <Film className="w-4 h-4" />
                    </div>
                  ) : attachedLiveFile.type === "audio" ? (
                    <div className="w-9 h-9 bg-slate-900 border border-slate-700 rounded-lg flex items-center justify-center shrink-0 text-emerald-400">
                      <Music className="w-4 h-4" />
                    </div>
                  ) : (
                    <div className="w-9 h-9 bg-slate-900 border border-slate-700 rounded-lg flex items-center justify-center shrink-0 text-amber-400">
                      <Paperclip className="w-4 h-4" />
                    </div>
                  )}
                  <div className="truncate text-left">
                    <div className="text-slate-100 font-bold truncate text-[11px]">{attachedLiveFile.fileName}</div>
                    <div className="text-[9px] text-emerald-400 font-mono font-bold uppercase">📷 Média prêt pour l'analyse live</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveLiveFile}
                  className="p-1 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
                  title="Supprimer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Live Interactive Input Bar */}
            <form onSubmit={handleSendLiveMessage} className="pt-2 flex gap-2 shrink-0">
              <input
                type="file"
                ref={liveFileInputRef}
                onChange={handleLiveFileSelect}
                accept="image/*,video/*,audio/*"
                className="hidden"
              />

              <button
                type="button"
                onClick={() => liveFileInputRef.current?.click()}
                className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/50 transition duration-150 flex items-center justify-center cursor-pointer shrink-0"
                title="Joindre une photo, vidéo ou audio à l'IA pendant le direct"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <input
                type="text"
                disabled={isSendingChat}
                value={liveInputText}
                onChange={(e) => setLiveInputText(e.target.value)}
                placeholder={attachedLiveFile ? "Expliquez ce fichier ou envoyez directement..." : "Écrivez un message ou joignez une photo..."}
                className="flex-1 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition duration-150"
              />

              <button
                type="submit"
                disabled={isSendingChat || (!liveInputText.trim() && !attachedLiveFile)}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-800 disabled:text-slate-600 text-white p-2.5 rounded-xl transition duration-150 flex items-center justify-center cursor-pointer shrink-0 shadow-lg shadow-emerald-950/40"
                title="Envoyer à l'IA en direct"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <button
                onClick={stopLiveSession}
                className="bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-black px-5 py-2.5 rounded-xl flex items-center gap-2 shadow-lg shadow-rose-950/30 transition duration-150 cursor-pointer uppercase tracking-wider"
              >
                <VolumeX className="w-3.5 h-3.5" />
                Quitter la conversation
              </button>
              
              <span className="text-[9px] text-slate-500 italic font-mono uppercase tracking-wider">
                Conçu par Franck Exaucé
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-red-950/40 to-slate-900 border border-red-500/10 rounded-2xl p-5 shadow-lg relative overflow-hidden animate-fade-in">
      <div className="absolute top-0 right-0 w-48 h-48 bg-red-600/[0.03] rounded-full blur-2xl pointer-events-none"></div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-5 items-center">
        {/* Left column: Car model photo & branding */}
        <div className="md:col-span-2 relative group overflow-hidden rounded-xl border border-slate-800 bg-slate-950 h-44 flex items-center justify-center">
          <img
            src={getCarPhotoUrl(diagnosis.brandModelInfo)}
            alt={diagnosis.brandModelInfo}
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover opacity-75 group-hover:scale-105 transition duration-500"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent"></div>
          <div className="absolute bottom-3 left-3 right-3 text-left">
            <span className="text-[9px] uppercase font-mono tracking-wider text-red-500 font-bold bg-slate-950/80 px-2 py-0.5 rounded border border-red-500/20">
              Modèle sous diagnostic
            </span>
            <h4 className="text-xs font-black text-white uppercase mt-1 truncate">
              {diagnosis.brandModelInfo || "Véhicule Atelier"}
            </h4>
          </div>
        </div>

        {/* Right column: Copilot Live launcher */}
        <div className="md:col-span-3 text-left space-y-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-bold text-white uppercase tracking-tight font-mono">
              Copilote DiagAssist Vocal Live
            </span>
          </div>
          
          <p className="text-xs text-slate-400 leading-relaxed">
            Activez la connexion vocale bidirectionnelle en direct avec DiagAssist. L'assistant vocal intelligent recevra toutes les spécifications de votre <strong className="text-red-400">{diagnosis.brandModelInfo}</strong> (DTC, coûts, étapes) pour vous guider en duplex direct pendant que vous réparez.
          </p>

          <button
            onClick={startLiveSession}
            className="w-full bg-red-600 hover:bg-red-700 text-white text-xs font-black px-5 py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-red-600/30 transition duration-150 cursor-pointer uppercase tracking-wider"
          >
            <Sparkles className="w-4 h-4 animate-pulse" />
            Lancer la conversation vocale live
          </button>
        </div>
      </div>
    </div>
  );
}
