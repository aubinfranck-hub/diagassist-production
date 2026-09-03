import React, { useState, useRef, useEffect } from "react";
import { 
  Car, FileText, Upload, Image as ImageIcon, Video, Mic, Square, Trash2, 
  Sparkles, AlertCircle, Play, Pause, Disc
} from "lucide-react";

interface DiagnosticFormProps {
  onDiagnose: (data: {
    vehicleBrand: string;
    vehicleModel: string;
    vehicleYear: string;
    vehicleEngine: string;
    textDescription: string;
    file: string | null;
    mimeType: string | null;
    gps?: { latitude: number; longitude: number; accuracy?: number } | null;
  }) => void;
  isLoading: boolean;
}

export default function DiagnosticForm({ onDiagnose, isLoading }: DiagnosticFormProps) {
  // GPS Geolocation state
  const [gpsLocation, setGpsLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracy?: number;
  } | null>(null);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setGpsLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        (error) => {
          console.warn("Erreur de géolocalisation ou refus de l'utilisateur :", error.message);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    }
  }, []);

  // Connectivity state
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

  // Form fields state
  const [vehicleBrand, setVehicleBrand] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleEngine, setVehicleEngine] = useState("Essence");
  const [textDescription, setTextDescription] = useState("");

  // Attachment state
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [fileMime, setFileMime] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);

  // Convert File to Base64 helper
  const handleFileChange = (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      alert("Le fichier est trop volumineux. La limite est de 15 Mo.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is in the format "data:image/png;base64,iVBORw..."
      const base64Data = result.split(",")[1];
      setFileBase64(base64Data);
      setFileMime(file.type);
      setFileName(file.name);
      setRecordedAudioUrl(null); // Clear recorded voice if uploading file
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  // Live Audio Recorder Functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const audioUrl = URL.createObjectURL(audioBlob);
        setRecordedAudioUrl(audioUrl);

        // Convert audio blob to base64
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = (reader.result as string).split(",")[1];
          setFileBase64(base64data);
          setFileMime("audio/webm");
          setFileName("enregistrement-audio-panne.webm");
        };
        reader.readAsDataURL(audioBlob);

        // Stop all audio tracks from stream to release the mic
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Impossible d'accéder au microphone:", err);
      alert("Permission d'accéder au microphone refusée ou non disponible dans votre navigateur.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    }
  };

  const removeAttachment = () => {
    setFileBase64(null);
    setFileMime(null);
    setFileName(null);
    setRecordedAudioUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textDescription && !fileBase64) {
      alert("Veuillez saisir une description textuelle de la panne ou joindre/enregistrer un fichier.");
      return;
    }
    onDiagnose({
      vehicleBrand,
      vehicleModel,
      vehicleYear,
      vehicleEngine,
      textDescription,
      file: fileBase64,
      mimeType: fileMime,
      gps: gpsLocation,
    });
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="premium-glass-card rounded-3xl p-6 md:p-8 text-slate-100 animate-fade-in shadow-2xl relative overflow-hidden border scintillant-bleu-rouge-card">
      {/* Aesthetic glowing background accent */}
      <div className="absolute top-0 left-0 w-64 h-64 rounded-full pointer-events-none scintillant-bg"></div>
      
      <div className="flex items-center gap-4 mb-8 relative">
        <div className="p-3.5 rounded-2xl border shadow-inner scintillant-badge relative shrink-0">
          <Car className="w-6 h-6" />
          <Sparkles className="w-3.5 h-3.5 absolute -top-1 -right-1 star-sparkle-blue" />
          <Sparkles className="w-2.5 h-2.5 absolute -bottom-1 -left-1 star-sparkle-red" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl md:text-2xl font-display font-black text-white tracking-tight uppercase">Atelier Diagnostic</h2>
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 star-sparkle-blue shrink-0" />
              <Sparkles className="w-3.5 h-3.5 star-sparkle-red shrink-0" />
            </div>
          </div>
          <p className="text-xs md:text-sm text-slate-400 mt-1">Décrivez les symptômes et obtenez un rapport de réparation immédiat.</p>
          {gpsLocation ? (
            <div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-[10px] font-mono font-bold text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>📍 GPS Activé : {gpsLocation.latitude.toFixed(4)}, {gpsLocation.longitude.toFixed(4)}</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 bg-slate-800/40 border border-slate-800/60 rounded-lg text-[10px] font-mono font-bold text-slate-500">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600"></span>
              <span>📍 En attente du GPS...</span>
            </div>
          )}
        </div>
      </div>

      {!isOnline && (
        <div className="mb-6 p-4 bg-red-600/10 border border-red-500/20 rounded-2xl flex items-start gap-3.5 animate-fade-in relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-red-600/[0.03] rounded-full blur-2xl pointer-events-none"></div>
          <div className="p-2 bg-red-600/10 text-red-500 rounded-xl shrink-0 border border-red-500/10">
            <AlertCircle className="w-5 h-5 animate-pulse text-red-500" />
          </div>
          <div className="text-xs md:text-sm">
            <span className="font-extrabold text-red-400 block uppercase tracking-wider mb-0.5">Mode Hors Ligne Activé</span>
            <p className="text-slate-300 leading-relaxed">
              Vous êtes actuellement déconnecté. Le diagnostic intelligent avec l'IA et le chargement de fichiers sont indisponibles. Veuillez rétablir votre connexion mobile (Orange, MTN, Moov).
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 relative">
        {/* Vehicle Fields Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-slate-300 font-extrabold uppercase tracking-wider mb-2">Marque</label>
            <input
              type="text"
              placeholder="ex: Ford"
              value={vehicleBrand}
              onChange={(e) => setVehicleBrand(e.target.value)}
              className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl px-4 py-3.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition duration-150"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 font-extrabold uppercase tracking-wider mb-2">Modèle</label>
            <input
              type="text"
              placeholder="ex: C-Max"
              value={vehicleModel}
              onChange={(e) => setVehicleModel(e.target.value)}
              className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl px-4 py-3.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition duration-150"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 font-extrabold uppercase tracking-wider mb-2">Année</label>
            <input
              type="text"
              maxLength={4}
              placeholder="ex: 2018"
              value={vehicleYear}
              onChange={(e) => setVehicleYear(e.target.value)}
              className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl px-4 py-3.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition duration-150"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 font-extrabold uppercase tracking-wider mb-2">Moteur</label>
            <select
              value={vehicleEngine}
              onChange={(e) => setVehicleEngine(e.target.value)}
              className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl px-4 py-3.5 text-sm text-slate-200 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition duration-150"
            >
              <option value="Essence">Essence</option>
              <option value="Diesel">Diesel</option>
              <option value="Hybride">Hybride</option>
              <option value="Électrique">Électrique</option>
            </select>
          </div>
        </div>

        {/* Text Description */}
        <div>
          <label className="block text-xs text-slate-300 font-extrabold uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-red-500" /> Description des symptômes ou codes défauts OBD
          </label>
          <textarea
            rows={5}
            placeholder="Décrivez avec vos mots : quand survient la panne ? Bruit métallique ? Voyant rouge ? Codes défauts (DTC) de la valise de diagnostic..."
            value={textDescription}
            onChange={(e) => setTextDescription(e.target.value)}
            className="w-full bg-slate-950/95 border border-white/[0.08] rounded-2xl p-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition duration-150 resize-y leading-relaxed"
          />
        </div>

        {/* File and Recording Dual Segment */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          
          {/* File Upload Area */}
          <div>
            <label className="block text-xs text-slate-300 font-extrabold uppercase tracking-wider mb-2">
              Capture ou Rapport de Valise
            </label>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-5 flex flex-col items-center justify-center text-center cursor-pointer transition duration-200 h-[145px] ${
                isDragging 
                  ? "border-red-500 bg-red-500/5 shadow-inner" 
                  : "border-white/[0.08] bg-slate-950/50 hover:bg-slate-900/50 hover:border-slate-500"
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
                accept="image/*,video/*,audio/*"
                className="hidden"
              />
              <Upload className="w-6 h-6 text-slate-400 mb-2" />
              <span className="text-sm text-slate-200 font-semibold">
                Glissez-déposez ou <span className="text-red-500 font-bold">parcourez</span>
              </span>
              <span className="text-xs text-slate-500 mt-1.5">
                Images, rapports, vidéos (Max 15 Mo)
              </span>
            </div>
          </div>

          {/* Audio Recording Area */}
          <div>
            <label className="block text-xs text-slate-300 font-extrabold uppercase tracking-wider mb-2">
              Enregistrer un bruit de panne
            </label>
            <div className="bg-slate-950/50 border border-white/[0.08] rounded-2xl p-4 flex flex-col justify-center h-[145px]">
              {!isRecording && !recordedAudioUrl && (
                <button
                  type="button"
                  onClick={startRecording}
                  className="flex items-center justify-center gap-2.5 bg-slate-900/60 hover:bg-slate-800/80 text-slate-200 px-5 py-4 rounded-2xl border border-white/[0.06] hover:border-red-500/20 text-sm transition duration-150 w-full font-bold cursor-pointer shadow-md active:scale-[0.98]"
                >
                  <Mic className="w-5 h-5 text-rose-500 animate-pulse" />
                  <span>Enregistrer un fichier audio</span>
                </button>
              )}

              {isRecording && (
                <div className="flex flex-col items-center justify-center space-y-3">
                  <div className="flex items-center gap-3">
                    <Disc className="w-5 h-5 text-rose-500 animate-spin" />
                    <span className="text-xs text-rose-500 font-black uppercase tracking-widest animate-pulse">REC</span>
                    <span className="font-mono text-sm text-white font-extrabold">[{formatDuration(recordingDuration)}]</span>
                  </div>
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition duration-150 cursor-pointer shadow-lg uppercase tracking-wider"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" /> Terminer
                  </button>
                </div>
              )}

              {!isRecording && recordedAudioUrl && (
                <div className="flex flex-col space-y-2">
                  <div className="text-xs text-emerald-400 flex items-center gap-1.5 font-bold uppercase tracking-wider">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping"></span>
                    Enregistrement audio prêt
                  </div>
                  <audio src={recordedAudioUrl} controls className="h-10 w-full rounded-xl bg-slate-950 outline-none" />
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Display attachment indicator */}
        {fileBase64 && fileName && (
          <div className="flex items-center justify-between p-3 bg-slate-950 border border-white/[0.08] rounded-2xl animate-fade-in text-sm shadow-inner">
            <div className="flex items-center gap-2.5 text-slate-300 truncate">
              {fileMime?.startsWith("image/") ? (
                <ImageIcon className="w-5 h-5 text-red-500 shrink-0" />
              ) : fileMime?.startsWith("video/") ? (
                <Video className="w-5 h-5 text-sky-500 shrink-0" />
              ) : (
                <Mic className="w-5 h-5 text-rose-500 shrink-0" />
              )}
              <span className="truncate font-bold text-slate-200">{fileName}</span>
              <span className="text-[10px] text-slate-400 bg-slate-900 border border-white/[0.08] px-2 py-0.5 rounded-lg font-mono uppercase font-black shrink-0">
                {fileMime?.split("/")[1]}
              </span>
            </div>
            <button
              type="button"
              onClick={removeAttachment}
              className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition cursor-pointer"
              title="Supprimer la pièce jointe"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Diagnostic Button */}
        <button
          type="submit"
          disabled={isLoading || isRecording}
          className="w-full flex items-center justify-center gap-3 py-4.5 bg-gradient-to-r from-red-600 to-red-750 hover:from-red-700 hover:to-red-800 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 font-black text-white text-sm md:text-base uppercase tracking-wider rounded-2xl cursor-pointer hover:shadow-xl hover:shadow-red-600/30 active:scale-[0.99] transition duration-150 glow-btn border border-red-500/20"
        >
          {isLoading ? (
            <div className="flex items-center gap-2.5">
              <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Analyse technique par l'IA en cours...</span>
            </div>
          ) : (
            <>
              <Sparkles className="w-5 h-5 fill-current animate-pulse text-white" />
              <span>Lancer le Diagnostic Auto Intelligent</span>
            </>
          )}
        </button>

        {/* Safety Warning */}
        <div className="flex items-start gap-3 text-xs text-slate-400 bg-slate-950/40 p-4 rounded-2xl border border-white/[0.04] leading-relaxed">
          <AlertCircle className="w-4 h-4 text-red-500/70 shrink-0 mt-0.5" />
          <p>
            Avertissement : Les analyses de pannes fournies par cette intelligence artificielle sont indicatives. 
            Elles s'appuient sur l'analyse acoustique des sons, la lecture des codes DTC et les symptômes découlant de votre description. 
            Faites toujours valider le diagnostic final par un mécanicien automobile certifié avant toute opération mécanique complexe.
          </p>
        </div>

      </form>
    </div>
  );
}
