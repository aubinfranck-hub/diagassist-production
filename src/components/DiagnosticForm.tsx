import React, { useState, useRef, useEffect } from "react";
import { 
  Car, FileText, Upload, Image as ImageIcon, Video, Mic, Square, Trash2, 
  Sparkles, AlertCircle, Disc, Plus, ArrowRight, ArrowLeft, Check
} from "lucide-react";

interface Attachment {
  base64: string;
  mimeType: string;
  name: string;
}

interface DiagnosticFormProps {
  onDiagnose: (data: {
    vehicleBrand: string;
    vehicleModel: string;
    vehicleYear: string;
    vehicleEngine: string;
    textDescription: string;
    files: { data: string; mimeType: string }[];
    gps?: { latitude: number; longitude: number; accuracy?: number } | null;
  }) => void;
  isLoading: boolean;
}

// Marques les plus courantes sur le marché ivoirien — réduit les fautes de frappe.
const MARQUES_COURANTES = [
  "Toyota", "Peugeot", "Renault", "Hyundai", "Kia", "Mercedes-Benz", "Ford",
  "Nissan", "Volkswagen", "Mitsubishi", "Suzuki", "Honda", "Mazda", "Opel", "BMW", "Audi",
];

type Step = 1 | 2 | 3;

export default function DiagnosticForm({ onDiagnose, isLoading }: DiagnosticFormProps) {
  const [step, setStep] = useState<Step>(1);

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

  // Plusieurs pièces jointes possibles à la fois
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const MAX_ATTACHMENTS = 6;

  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const addFilesAsAttachments = (fileList: FileList | File[]) => {
    const filesArray = Array.from(fileList);
    const remainingSlots = MAX_ATTACHMENTS - attachments.length;
    if (remainingSlots <= 0) {
      alert(`Vous avez déjà ${MAX_ATTACHMENTS} pièces jointes, c'est le maximum. Supprimez-en une pour en ajouter une autre.`);
      return;
    }
    filesArray.slice(0, remainingSlots).forEach((file) => {
      if (file.size > 15 * 1024 * 1024) {
        alert(`"${file.name}" est trop volumineux (max 15 Mo par fichier).`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64Data = result.split(",")[1];
        setAttachments((prev) => [...prev, { base64: base64Data, mimeType: file.type, name: file.name }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesAsAttachments(e.dataTransfer.files);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = (reader.result as string).split(",")[1];
          setAttachments((prev) => {
            if (prev.length >= MAX_ATTACHMENTS) {
              alert(`Maximum ${MAX_ATTACHMENTS} pièces jointes atteint — l'enregistrement n'a pas été ajouté.`);
              return prev;
            }
            return [...prev, { base64: base64data, mimeType: "audio/webm", name: `enregistrement-audio-${prev.length + 1}.webm` }];
          });
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingIntervalRef.current = setInterval(() => setRecordingDuration((prev) => prev + 1), 1000);
    } catch (err) {
      console.error("Impossible d'accéder au microphone:", err);
      alert("Permission d'accéder au microphone refusée ou non disponible dans votre navigateur.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const goNext = () => {
    if (step === 1 && !vehicleBrand.trim()) {
      alert("Merci d'indiquer au moins la marque du véhicule pour continuer.");
      return;
    }
    if (step === 2 && !textDescription.trim() && attachments.length === 0) {
      alert("Décrivez la panne ou joignez au moins une preuve (photo, vidéo, son) pour continuer.");
      return;
    }
    setStep((s) => (Math.min(3, s + 1) as Step));
  };
  const goBack = () => setStep((s) => (Math.max(1, s - 1) as Step));

  const handleSubmit = () => {
    onDiagnose({
      vehicleBrand,
      vehicleModel,
      vehicleYear,
      vehicleEngine,
      textDescription,
      files: attachments.map((a) => ({ data: a.base64, mimeType: a.mimeType })),
      gps: gpsLocation,
    });
  };

  const STEP_LABELS = ["Véhicule", "Symptômes", "Validation"];

  return (
    <div className="premium-glass-card rounded-3xl p-6 md:p-8 text-slate-100 animate-fade-in shadow-2xl relative overflow-hidden border scintillant-bleu-rouge-card">
      <div className="absolute top-0 left-0 w-64 h-64 rounded-full pointer-events-none scintillant-bg"></div>

      {/* Barre de progression + en-tête */}
      <div className="relative mb-6">
        <div className="flex items-center gap-1.5 mb-3">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? "bg-red-600" : "bg-slate-800"}`} />
          ))}
        </div>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Étape {step} sur 3 — {STEP_LABELS[step - 1]}</span>
            <h2 className="text-lg md:text-xl font-display font-black text-white tracking-tight uppercase mt-0.5">Atelier Diagnostic</h2>
          </div>
          <div
            title={gpsLocation ? `Position : ${gpsLocation.latitude.toFixed(4)}, ${gpsLocation.longitude.toFixed(4)}` : "En attente de la localisation"}
            className={`shrink-0 w-2.5 h-2.5 rounded-full ${gpsLocation ? "bg-emerald-500 animate-pulse" : "bg-slate-600"}`}
          />
        </div>
      </div>

      {!isOnline && (
        <div className="mb-6 p-4 bg-red-600/10 border border-red-500/20 rounded-2xl flex items-start gap-3.5 animate-fade-in">
          <AlertCircle className="w-5 h-5 animate-pulse text-red-500 shrink-0" />
          <div className="text-xs md:text-sm">
            <span className="font-extrabold text-red-400 block uppercase tracking-wider mb-0.5">Mode Hors Ligne</span>
            <p className="text-slate-300 leading-relaxed">Rétablissez votre connexion mobile (Orange, MTN, Moov) pour lancer un diagnostic.</p>
          </div>
        </div>
      )}

      <div className="space-y-6 relative">

        {/* ÉTAPE 1 : Véhicule */}
        {step === 1 && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <label className="block text-xs text-slate-300 font-extrabold uppercase tracking-wider mb-2">Marque</label>
              <input
                type="text"
                list="marques-courantes"
                placeholder="ex: Toyota"
                value={vehicleBrand}
                onChange={(e) => setVehicleBrand(e.target.value)}
                className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl px-4 py-3.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition duration-150"
              />
              <datalist id="marques-courantes">
                {MARQUES_COURANTES.map((m) => <option key={m} value={m} />)}
              </datalist>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-300 font-extrabold uppercase tracking-wider mb-2">Modèle</label>
                <input
                  type="text"
                  placeholder="ex: Corolla"
                  value={vehicleModel}
                  onChange={(e) => setVehicleModel(e.target.value)}
                  className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl px-4 py-3.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition duration-150"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 font-extrabold uppercase tracking-wider mb-2">Année</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="ex: 2018"
                  value={vehicleYear}
                  onChange={(e) => setVehicleYear(e.target.value)}
                  className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl px-4 py-3.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition duration-150"
                />
              </div>
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
        )}

        {/* ÉTAPE 2 : Symptômes + preuves */}
        {step === 2 && (
          <div className="space-y-5 animate-fade-in">
            <div>
              <label className="block text-xs text-slate-300 font-extrabold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-red-500" /> Description des symptômes ou codes défauts OBD
              </label>
              <textarea
                rows={4}
                placeholder="Décrivez avec vos mots : quand survient la panne ? Bruit métallique ? Voyant rouge ? Codes défauts (DTC)..."
                value={textDescription}
                onChange={(e) => setTextDescription(e.target.value)}
                className="w-full bg-slate-950/95 border border-white/[0.08] rounded-2xl p-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition duration-150 resize-y leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-300 font-extrabold uppercase tracking-wider mb-2">
                Preuves (photos, vidéos, sons) — {attachments.length}/{MAX_ATTACHMENTS}
              </label>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  disabled={attachments.length >= MAX_ATTACHMENTS}
                  className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-2xl py-6 px-3 text-center transition duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
                    isDragging ? "border-red-500 bg-red-500/5" : "border-white/[0.08] bg-slate-950/50 hover:bg-slate-900/50 hover:border-slate-500"
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    multiple
                    onChange={(e) => e.target.files && addFilesAsAttachments(e.target.files)}
                    accept="image/*,video/*,audio/*"
                    className="hidden"
                  />
                  <Upload className="w-6 h-6 text-slate-400" />
                  <span className="text-sm text-slate-200 font-bold">Ajouter photo/vidéo</span>
                  <span className="text-[10px] text-slate-500">Plusieurs à la fois, max 15 Mo</span>
                </button>

                {!isRecording ? (
                  <button
                    type="button"
                    onClick={startRecording}
                    disabled={attachments.length >= MAX_ATTACHMENTS}
                    className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-white/[0.08] bg-slate-950/50 hover:bg-slate-900/50 hover:border-rose-500/40 rounded-2xl py-6 px-3 text-center transition duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <Mic className="w-6 h-6 text-rose-500" />
                    <span className="text-sm text-slate-200 font-bold">Enregistrer un son</span>
                    <span className="text-[10px] text-slate-500">Bruit moteur, cliquetis...</span>
                  </button>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 border-2 border-rose-500/40 bg-rose-500/5 rounded-2xl py-6 px-3">
                    <div className="flex items-center gap-2">
                      <Disc className="w-5 h-5 text-rose-500 animate-spin" />
                      <span className="font-mono text-sm text-white font-extrabold">{formatDuration(recordingDuration)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer uppercase tracking-wider"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" /> Terminer
                    </button>
                  </div>
                )}
              </div>

              {attachments.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                  {attachments.map((att, index) => (
                    <div key={index} className="relative group bg-slate-950 border border-white/[0.08] rounded-xl overflow-hidden aspect-square flex items-center justify-center">
                      {att.mimeType.startsWith("image/") ? (
                        <img src={`data:${att.mimeType};base64,${att.base64}`} alt={att.name} className="w-full h-full object-cover" />
                      ) : att.mimeType.startsWith("video/") ? (
                        <Video className="w-7 h-7 text-sky-500" />
                      ) : (
                        <Mic className="w-7 h-7 text-rose-500" />
                      )}
                      <button
                        type="button"
                        onClick={() => removeAttachment(index)}
                        className="absolute top-1 right-1 bg-black/70 hover:bg-rose-600 text-white rounded-full p-1 transition cursor-pointer"
                        title="Retirer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {attachments.length < MAX_ATTACHMENTS && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="aspect-square flex items-center justify-center border-2 border-dashed border-white/[0.08] hover:border-slate-500 rounded-xl text-slate-500 hover:text-slate-300 transition cursor-pointer"
                      title="Ajouter"
                    >
                      <Plus className="w-6 h-6" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ÉTAPE 3 : Récapitulatif + validation */}
        {step === 3 && (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-slate-950/60 border border-white/[0.06] rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Véhicule</span>
                <button type="button" onClick={() => setStep(1)} className="text-[11px] text-red-500 font-bold hover:underline cursor-pointer">Modifier</button>
              </div>
              <p className="text-sm text-white font-bold">
                {vehicleBrand || "—"} {vehicleModel} {vehicleYear} <span className="text-slate-400 font-normal">({vehicleEngine})</span>
              </p>
            </div>

            <div className="bg-slate-950/60 border border-white/[0.06] rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Symptômes & preuves</span>
                <button type="button" onClick={() => setStep(2)} className="text-[11px] text-red-500 font-bold hover:underline cursor-pointer">Modifier</button>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                {textDescription || <span className="text-slate-500 italic">Aucune description texte</span>}
              </p>
              {attachments.length > 0 && (
                <p className="text-xs text-emerald-400 font-bold">{attachments.length} pièce(s) jointe(s) prête(s)</p>
              )}
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isLoading}
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
                  <Check className="w-5 h-5 text-white" />
                  <span>Lancer le Diagnostic Auto Intelligent</span>
                </>
              )}
            </button>

            <div className="flex items-start gap-3 text-xs text-slate-400 bg-slate-950/40 p-4 rounded-2xl border border-white/[0.04] leading-relaxed">
              <AlertCircle className="w-4 h-4 text-red-500/70 shrink-0 mt-0.5" />
              <p>Les analyses de cette IA sont indicatives. Faites toujours valider le diagnostic final par un mécanicien certifié avant toute réparation complexe.</p>
            </div>
          </div>
        )}

        {/* Navigation étapes 1 et 2 */}
        {step < 3 && (
          <div className="flex gap-3 pt-1">
            {step > 1 && (
              <button
                type="button"
                onClick={goBack}
                className="flex items-center justify-center gap-2 px-5 py-3.5 bg-slate-900 hover:bg-slate-800 border border-white/[0.08] text-slate-300 font-bold text-sm rounded-2xl transition cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" /> Retour
              </button>
            )}
            <button
              type="button"
              onClick={goNext}
              disabled={!isOnline}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-red-600 to-red-750 hover:from-red-700 hover:to-red-800 disabled:opacity-40 text-white font-black text-sm uppercase tracking-wider rounded-2xl transition cursor-pointer"
            >
              Suivant <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
