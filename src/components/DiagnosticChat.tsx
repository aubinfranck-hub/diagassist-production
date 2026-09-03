import React, { useState, useRef, useEffect } from "react";
import { 
  MessageSquare, Send, Cpu, Sparkles, AlertCircle, HelpCircle, 
  Volume2, VolumeX, Mic, MicOff, Play, Square, Paperclip, Camera,
  Image as ImageIcon, Film, Music, X
} from "lucide-react";
import { ChatMessage, Diagnosis, ApiUsage } from "../types";
import { 
  playMicStartSound, 
  playMicStopSound, 
  playClickFeedbackSound, 
  playNotificationSound 
} from "../utils/audioEngine";
import { initElevenLabsClient } from "./IntegratedVoiceController";

interface DiagnosticChatProps {
  diagnosis: Diagnosis;
  chatHistory: ChatMessage[];
  onSendMessage: (text: string, file?: string, mimeType?: string, fileName?: string) => Promise<void>;
  isSending: boolean;
}

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

export default function DiagnosticChat({ diagnosis, chatHistory, onSendMessage, isSending }: DiagnosticChatProps) {
  const [inputText, setInputText] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // File Attachment State (multimodal at any time)
  const [attachedFile, setAttachedFile] = useState<{
    base64: string;
    mimeType: string;
    fileName: string;
    previewUrl: string;
    type: "photo" | "video" | "audio" | "file";
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
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

      setAttachedFile({
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

  const handleRemoveAttachedFile = () => {
    setAttachedFile(null);
  };

  // Connectivity monitoring state
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Audio interaction states
  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [recognition, setRecognition] = useState<any>(null);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [isGeneratingTts, setIsGeneratingTts] = useState<string | null>(null);
  
  // Audio playback ref
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Preferred Voice Selection State (shares with main page)
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>("fr-FR-Neural2-B");

  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [elevenLabsVoices, setElevenLabsVoices] = useState<{ id: string; name: string; label: string }[]>([]);

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
        console.warn("Could not fetch ElevenLabs voices from API in chat:", err);
      }
    };
    fetchElevenLabs();
    return () => {
      active = false;
    };
  }, []);

  // Toggle for automated readout when new model message is received
  const [autoReadChat, setAutoReadChat] = useState<boolean>(() => {
    return localStorage.getItem("auto_read_chat") === "true";
  });

  // Suggestions of standard follow-up mechanic questions
  const SUGGESTIONS = [
    "Puis-je rouler jusqu'au garage le plus proche ?",
    "Comment commander cette pièce au 0141116026 ?",
    "Quels outils spécifiques me faut-il pour réparer ?",
    "Où se trouve cette pièce exactement sur mon véhicule ?",
    "Comment tester si l'actionneur est vraiment mort ?"
  ];

  // Initialize Speech Recognition for hands-free typing
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "fr-FR";

      rec.onstart = () => {
        setIsListening(true);
        setMicError(null);
        try { playMicStartSound(); } catch (e) {}
      };

      rec.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        if (text && text.trim()) {
          setInputText(prev => {
            const current = prev.trim();
            return current ? `${current} ${text.trim()}` : text.trim();
          });
        }
      };

      rec.onerror = (event: any) => {
        console.warn("Speech recognition error in chat:", event.error);
        if (event.error === "not-allowed") {
          setMicError("Permission micro refusée");
        } else if (event.error === "no-speech") {
          setMicError("Aucun mot capturé");
        } else {
          setMicError("Erreur microphone");
        }
        setIsListening(false);
        try { playMicStopSound(); } catch (e) {}
      };

      rec.onend = () => {
        setIsListening(false);
        try { playMicStopSound(); } catch (e) {}
      };

      setRecognition(rec);
    }
  }, []);

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

  // Set preferred speech voice, default to "fr-FR-Neural2-B" for ultra-realistic voice
  useEffect(() => {
    const saved = localStorage.getItem("preferred_speech_voice");
    setSelectedVoiceName(saved || "fr-FR-Neural2-B");
  }, []);

  // Sync preference changes
  const handleVoiceChange = (voiceId: string) => {
    setSelectedVoiceName(voiceId);
    localStorage.setItem("preferred_speech_voice", voiceId);
    try { playClickFeedbackSound(); } catch (e) {}
  };

  const handleAutoReadToggle = () => {
    const nextVal = !autoReadChat;
    setAutoReadChat(nextVal);
    localStorage.setItem("auto_read_chat", String(nextVal));
    try { playClickFeedbackSound(); } catch (e) {}
  };

  // Auto-speak incoming model reply if autoReadChat is enabled
  const lastProcessedMessageId = useRef<string>("");
  useEffect(() => {
    if (chatHistory.length > 0 && autoReadChat) {
      const lastMsg = chatHistory[chatHistory.length - 1];
      if (lastMsg.role === "model" && lastMsg.id !== lastProcessedMessageId.current) {
        lastProcessedMessageId.current = lastMsg.id;
        // Trigger speech play for this message
        setTimeout(() => {
          playMessageAudio(lastMsg.id, lastMsg.text);
        }, 500);
      }
    }
  }, [chatHistory, autoReadChat]);

  // Clean up audio & speech synthesis on unmount
  useEffect(() => {
    return () => {
      stopMessageAudio();
      if (recognition) {
        try { recognition.abort(); } catch (e) {}
      }
    };
  }, [recognition]);

  // Auto scroll to latest message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isSending]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const textToSend = inputText.trim();
    if (!textToSend && !attachedFile) return;
    if (isSending) return;

    if (!navigator.onLine) {
      setMicError("Erreur : Vous êtes hors ligne. Rétablissez la connexion pour envoyer un message.");
      alert("Impossible d'envoyer votre message : vous êtes actuellement hors ligne.");
      return;
    }

    try { playClickFeedbackSound(); } catch (e) {}

    const finalMessage = textToSend || (attachedFile 
      ? `Fichier joint pour analyse : ${attachedFile.fileName}` 
      : "");

    onSendMessage(
      finalMessage,
      attachedFile?.base64,
      attachedFile?.mimeType,
      attachedFile?.fileName
    );

    setInputText("");
    setAttachedFile(null);
    stopMessageAudio();
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (isSending) return;

    if (!navigator.onLine) {
      alert("Impossible d'envoyer la suggestion : vous êtes actuellement hors ligne.");
      return;
    }

    try { playClickFeedbackSound(); } catch (e) {}
    onSendMessage(suggestion);
    // Stop reading any current audio when sending a message
    stopMessageAudio();
  };

  const handleMicToggle = () => {
    if (!navigator.onLine) {
      setMicError("Erreur : La reconnaissance vocale requiert une connexion internet active.");
      return;
    }

    if (!recognition) {
      setMicError("Reconnaissance vocale non supportée par votre navigateur.");
      return;
    }
    if (isListening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (err) {
        console.warn("Failed to start speech recognition:", err);
      }
    }
  };

  // Text-To-Speech Play/Pause implementation for chat
  const playMessageAudio = async (msgId: string, text: string) => {
    if (selectedVoiceName === "none") {
      return;
    }
    if (playingMessageId === msgId) {
      stopMessageAudio();
      return;
    }

    stopMessageAudio();
    setIsGeneratingTts(msgId);

    // Clean markdown content before reading
    const cleanedText = text
      .replace(/[\*\#\`\_]/g, "")
      .replace(/^\s*-\s*/gm, "")
      .replace(/\s+/g, " ")
      .trim();

    const isApiVoice = selectedVoiceName.startsWith("eleven-api-");
    const isCloudVoice = CLOUD_VOICES.some(v => v.id === selectedVoiceName) || 
                         ELEVENLABS_VOICES.some(v => v.id === selectedVoiceName) ||
                         isApiVoice;

    if (isCloudVoice) {
      try {
        if (isApiVoice) {
          const voiceId = selectedVoiceName.replace("eleven-api-", "");
          const client = initElevenLabsClient();
          if (!client) throw new Error("ElevenLabs non configuré côté client.");
          const audioBlob = await client.textToSpeech(cleanedText, voiceId);
          const audioUrl = URL.createObjectURL(audioBlob);
          const audioObj = new Audio(audioUrl);

          audioObj.onplay = () => {
            setPlayingMessageId(msgId);
            setIsGeneratingTts(null);
          };

          audioObj.onended = () => {
            setPlayingMessageId(null);
            URL.revokeObjectURL(audioUrl);
          };

          audioObj.onerror = () => {
            setPlayingMessageId(null);
            setIsGeneratingTts(null);
            URL.revokeObjectURL(audioUrl);
            fallbackToLocalSpeech(cleanedText, msgId);
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
              text: cleanedText,
              voiceName: selectedVoiceName
            })
          });

          if (!response.ok) throw new Error("TTS API unreachable");

          const data = await response.json();
          if (data.success && data.audioContent) {
            const audioUrl = `data:audio/mp3;base64,${data.audioContent}`;
            const audioObj = new Audio(audioUrl);

            audioObj.onplay = () => {
              setPlayingMessageId(msgId);
              setIsGeneratingTts(null);
            };

            audioObj.onended = () => {
              setPlayingMessageId(null);
            };

            audioObj.onerror = () => {
              setPlayingMessageId(null);
              setIsGeneratingTts(null);
              fallbackToLocalSpeech(cleanedText, msgId);
            };

            audioRef.current = audioObj;
            await audioObj.play();
          } else {
            throw new Error("No voice synthesized");
          }
        }
      } catch (err) {
        console.warn("API TTS failed, falling back to client synthesis:", err);
        fallbackToLocalSpeech(cleanedText, msgId);
      } finally {
        setIsGeneratingTts(null);
      }
    } else {
      fallbackToLocalSpeech(cleanedText, msgId);
    }
  };

  const fallbackToLocalSpeech = (cleanedText: string, msgId: string) => {
    if (!("speechSynthesis" in window)) {
      setIsGeneratingTts(null);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanedText);
    utterance.lang = "fr-FR";
    utterance.rate = 1.1;

    // Select suitable French voice if available
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

    if (frVoice) {
      utterance.voice = frVoice;
    }

    utterance.onstart = () => {
      setPlayingMessageId(msgId);
      setIsGeneratingTts(null);
    };

    utterance.onend = () => {
      setPlayingMessageId(null);
    };

    utterance.onerror = () => {
      setPlayingMessageId(null);
      setIsGeneratingTts(null);
    };

    window.speechSynthesis.speak(utterance);
  };

  const stopMessageAudio = () => {
    if (audioRef.current) {
      try { audioRef.current.pause(); } catch (e) {}
      audioRef.current = null;
    }
    if ("speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    setPlayingMessageId(null);
    setIsGeneratingTts(null);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-slate-100 animate-fade-in shadow-xl flex flex-col h-[640px]">
      
      {/* Chat Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-red-600/10 text-red-500 rounded-xl">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-display font-bold text-white tracking-tight">
              Assistant Mécanicien Privé
            </h2>
            <p className="text-[11px] text-slate-400">
              Discutez à voix haute ou par écrit de votre <span className="text-red-500 font-semibold">{diagnosis.brandModelInfo}</span>.
            </p>
          </div>
        </div>

        {/* Audio controls in Header */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {/* Autoplay toggle */}
          <button
            type="button"
            onClick={handleAutoReadToggle}
            title={autoReadChat ? "Lecture automatique active" : "Lecture automatique inactive"}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold transition duration-150 ${
              autoReadChat 
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                : "bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200"
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">{autoReadChat ? "Lecture Auto" : "Silencieux"}</span>
          </button>
        </div>
      </div>

      {/* Suggestion prompt chips */}
      <div className="py-3 border-b border-slate-850 shrink-0">
        <span className="text-[10px] text-slate-400 font-semibold block mb-2 uppercase tracking-wider">Suggestions de questions :</span>
        <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto pr-1">
          {SUGGESTIONS.map((sug, idx) => (
            <button
              key={idx}
              type="button"
              disabled={isSending}
              onClick={() => handleSuggestionClick(sug)}
              className="text-left bg-slate-950/60 hover:bg-slate-800 border border-slate-850 hover:border-red-500/30 text-[10px] text-slate-300 px-2.5 py-1.5 rounded-lg transition duration-150 disabled:opacity-50 disabled:pointer-events-none"
            >
              {sug}
            </button>
          ))}
        </div>
      </div>

      {/* Messages viewport */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1 min-h-[220px]">
        {chatHistory.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-full text-slate-600">
              <MessageSquare className="w-8 h-8 text-slate-500" />
            </div>
            <div className="max-w-[320px]">
              <h3 className="text-xs font-semibold text-slate-300">Aucun message de discussion</h3>
              <p className="text-[11px] text-slate-500 mt-1">
                Utilisez l'une des suggestions ci-dessus ou tapez une question pour en savoir plus sur les réparations requises.
              </p>
            </div>
          </div>
        ) : (
          chatHistory.map((msg) => {
            const isUser = msg.role === "user";
            const isPlaying = playingMessageId === msg.id;
            const isGenerating = isGeneratingTts === msg.id;

            return (
              <div
                key={msg.id}
                className={`flex flex-col space-y-1 ${
                  isUser ? "items-end" : "items-start"
                }`}
              >
                <div className="flex items-start gap-2 max-w-[85%] group">
                  
                  {/* Speaker icon for assistant replies (on left/under bubble) */}
                  {!isUser && (
                    <button
                      type="button"
                      onClick={() => playMessageAudio(msg.id, msg.text)}
                      className={`p-1.5 rounded-lg border transition duration-150 shrink-0 self-end mb-1 ${
                        isPlaying 
                          ? "bg-red-500/20 text-red-400 border-red-500/30 animate-pulse" 
                          : isGenerating 
                          ? "bg-slate-850 text-slate-400 border-slate-800 cursor-wait" 
                          : "bg-slate-950 text-slate-500 border-slate-850 hover:text-slate-200 hover:border-slate-700 opacity-60 group-hover:opacity-100"
                      }`}
                      title="Lire le message à haute voix"
                    >
                      {isPlaying ? (
                        <Square className="w-3 h-3 fill-current" />
                      ) : isGenerating ? (
                        <svg className="animate-spin h-3 w-3 text-slate-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      ) : (
                        <Volume2 className="w-3 h-3" />
                      )}
                    </button>
                  )}

                  <div
                    className={`rounded-2xl px-4 py-3 text-xs leading-relaxed relative ${
                      isUser
                        ? "bg-red-600 text-white font-medium rounded-tr-none shadow-md shadow-red-900/10"
                        : "bg-slate-950/80 border border-slate-800 text-slate-200 rounded-tl-none"
                    }`}
                  >
                    {msg.file && (
                      <div className="mb-2 max-w-full overflow-hidden rounded-xl border border-white/10 bg-slate-900/40">
                        {msg.mimeType?.startsWith("image/") ? (
                          <img
                            src={`data:${msg.mimeType};base64,${msg.file}`}
                            alt={msg.fileName || "Photo jointe"}
                            className="max-h-48 object-cover rounded-xl"
                            referrerPolicy="no-referrer"
                          />
                        ) : msg.mimeType?.startsWith("video/") ? (
                          <video
                            src={`data:${msg.mimeType};base64,${msg.file}`}
                            controls
                            className="max-h-48 rounded-xl bg-black w-full"
                          />
                        ) : (
                          <div className="p-2 flex items-center gap-2 text-[10px] text-slate-300">
                            <span>📁 {msg.fileName || "Fichier joint"}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div>{msg.text}</div>

                    {/* Simple playing state soundwave visualizer */}
                    {isPlaying && !isUser && (
                      <div className="flex gap-0.5 mt-2 justify-start items-center h-2">
                        <span className="w-0.5 bg-red-500 rounded-full animate-bounce h-2" style={{ animationDelay: "0.1s" }}></span>
                        <span className="w-0.5 bg-red-500 rounded-full animate-bounce h-1" style={{ animationDelay: "0.3s" }}></span>
                        <span className="w-0.5 bg-red-500 rounded-full animate-bounce h-1.5" style={{ animationDelay: "0.5s" }}></span>
                        <span className="w-0.5 bg-red-500 rounded-full animate-bounce h-2.5" style={{ animationDelay: "0.2s" }}></span>
                        <span className="w-0.5 bg-red-500 rounded-full animate-bounce h-1" style={{ animationDelay: "0.4s" }}></span>
                        <span className="text-[9px] text-red-500/80 font-mono ml-1.5 uppercase font-bold tracking-wider">Lecture en cours...</span>
                      </div>
                    )}
                  </div>

                  {/* Speaker icon for user questions (on right) */}
                  {isUser && (
                    <button
                      type="button"
                      onClick={() => playMessageAudio(msg.id, msg.text)}
                      className={`p-1.5 rounded-lg border transition duration-150 shrink-0 self-end mb-1 ${
                        isPlaying 
                          ? "bg-red-500/20 text-red-400 border-red-500/30 animate-pulse" 
                          : isGenerating 
                          ? "bg-slate-850 text-slate-400 border-slate-800 cursor-wait" 
                          : "bg-slate-950 text-slate-500 border-slate-850 hover:text-slate-200 hover:border-slate-700 opacity-60 group-hover:opacity-100"
                      }`}
                      title="Lire ma question"
                    >
                      {isPlaying ? (
                        <Square className="w-3 h-3 fill-current" />
                      ) : isGenerating ? (
                        <svg className="animate-spin h-3 w-3 text-slate-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      ) : (
                        <Volume2 className="w-3 h-3" />
                      )}
                    </button>
                  )}

                </div>
              </div>
            );
          })
        )}

        {/* Loading placeholder response */}
        {isSending && (
          <div className="flex flex-col space-y-1 items-start">
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl rounded-tl-none px-4 py-3 text-xs text-slate-400 flex items-center gap-2 animate-pulse">
              <svg className="animate-spin h-3.5 w-3.5 text-red-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>MécanoIA est en train de rédiger des explications détaillées...</span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Mic status or error line */}
      {micError && (
        <div className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/15 rounded-lg px-3 py-1 mb-2 flex items-center gap-1.5 shrink-0 animate-fade-in">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{micError}</span>
        </div>
      )}

      {/* Attachment Preview Chip */}
      {attachedFile && (
        <div className="mb-2 p-2 bg-slate-900 border border-red-500/30 rounded-xl flex items-center justify-between gap-2 text-xs animate-fade-in shrink-0">
          <div className="flex items-center gap-2.5 overflow-hidden">
            {attachedFile.type === "photo" ? (
              <img src={attachedFile.previewUrl} alt="Aperçu" className="w-10 h-10 object-cover rounded-lg border border-slate-700 shrink-0" />
            ) : attachedFile.type === "video" ? (
              <div className="w-10 h-10 bg-slate-950 border border-slate-700 rounded-lg flex items-center justify-center shrink-0 text-red-400">
                <Film className="w-5 h-5" />
              </div>
            ) : attachedFile.type === "audio" ? (
              <div className="w-10 h-10 bg-slate-950 border border-slate-700 rounded-lg flex items-center justify-center shrink-0 text-emerald-400">
                <Music className="w-5 h-5" />
              </div>
            ) : (
              <div className="w-10 h-10 bg-slate-950 border border-slate-700 rounded-lg flex items-center justify-center shrink-0 text-amber-400">
                <Paperclip className="w-5 h-5" />
              </div>
            )}
            <div className="truncate text-left">
              <div className="text-slate-200 font-bold truncate text-[11px]">{attachedFile.fileName}</div>
              <div className="text-[9px] text-slate-400 uppercase font-mono">
                {attachedFile.type === "photo" ? "📷 Image prête pour l'analyse" : attachedFile.type === "video" ? "🎥 Vidéo prête pour l'analyse" : attachedFile.type === "audio" ? "🎙️ Audio prêt pour l'analyse" : "📁 Fichier prêt"}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRemoveAttachedFile}
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
            title="Supprimer la pièce jointe"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Message input footer form */}
      <form onSubmit={handleSubmit} className="mt-2 pt-3 border-t border-slate-800 flex gap-2 shrink-0">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="image/*,video/*,audio/*"
          className="hidden"
        />

        {/* Attachment Button - Always Active */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2.5 rounded-xl bg-slate-950 border border-slate-850 text-slate-400 hover:text-red-400 hover:border-slate-700 transition duration-150 flex items-center justify-center cursor-pointer shrink-0"
          title="Joindre une photo, vidéo ou enregistrement audio (multimodal)"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        <input
          type="text"
          disabled={isSending}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={isListening ? "Parlez maintenant, l'IA écoute..." : attachedFile ? "Ajoutez une explication ou envoyez directement..." : "Posez une question ou rejoignez une photo/audio..."}
          className={`flex-1 bg-slate-950 border focus:border-red-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none disabled:opacity-60 disabled:pointer-events-none transition duration-150 ${
            isListening ? "border-red-500/50 ring-1 ring-red-500/30" : "border-slate-850"
          }`}
        />

        {/* Dynamic Speech Recording Button inside input bar */}
        <button
          type="button"
          onClick={handleMicToggle}
          className={`p-2.5 rounded-xl transition duration-150 flex items-center justify-center cursor-pointer shrink-0 border ${
            isListening 
              ? "bg-red-600 border-red-500 text-white animate-pulse" 
              : "bg-slate-950 border-slate-850 text-slate-400 hover:text-slate-200 hover:border-slate-700"
          }`}
          title={isListening ? "Arrêter la dictée" : "Parler pour poser une question (Dictée)"}
        >
          {isListening ? (
            <Mic className="w-4 h-4" />
          ) : (
            <MicOff className="w-4 h-4" />
          )}
        </button>

        <button
          type="submit"
          disabled={isSending || (!inputText.trim() && !attachedFile)}
          className="bg-red-600 hover:bg-red-700 disabled:bg-slate-800 disabled:text-slate-600 text-white p-2.5 rounded-xl transition duration-150 flex items-center justify-center cursor-pointer shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

    </div>
  );
}
