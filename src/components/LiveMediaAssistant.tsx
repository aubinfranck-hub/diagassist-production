import React, { useState, useRef, useEffect } from "react";
import { 
  Camera, Video, Upload, Trash2, Sparkles, StopCircle, 
  RefreshCw, Play, AlertCircle, Check, HelpCircle
} from "lucide-react";

interface LiveMediaAssistantProps {
  onSendMediaMessage: (text: string, fileBase64: string, mimeType: string, fileName: string) => Promise<void>;
  isSending: boolean;
  isLiveActive?: boolean;
}

export default function LiveMediaAssistant({ onSendMediaMessage, isSending, isLiveActive = false }: LiveMediaAssistantProps) {
  const [activeMode, setActiveMode] = useState<"camera" | "upload">("upload");
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment"); // default to environment (rear) camera for engine bay

  // Captured / Selected File States
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [fileMime, setFileMime] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);

  const [description, setDescription] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stop camera stream on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  // Bind camera stream to video element when stream is active or activeMode changes
  useEffect(() => {
    if (cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream, activeMode]);

  // If live vocal session becomes active, release the microphone immediately from the camera stream to prevent overlap conflicts
  useEffect(() => {
    if (isLiveActive && cameraStream) {
      const audioTracks = cameraStream.getAudioTracks();
      if (audioTracks.length > 0) {
        console.log("[LiveMediaAssistant] Live session activated, releasing camera microphone track...");
        audioTracks.forEach(track => {
          track.stop();
          cameraStream.removeTrack(track);
        });
      }
    }
  }, [isLiveActive, cameraStream]);

  // Start live WebRTC camera stream
  const startCamera = async (forceFacingMode?: "user" | "environment") => {
    setCameraError(null);
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
    }

    const currentFacing = forceFacingMode || facingMode;

    try {
      let stream;
      // If live WebRTC vocal session is active, force video only (audio: false) to prevent double hardware microphone grabs and browser sound conflicts!
      const shouldCaptureAudio = !isLiveActive;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: currentFacing },
          audio: shouldCaptureAudio
        });
      } catch (audioErr) {
        console.warn("Could not acquire microphone along with camera, trying video only...", audioErr);
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: currentFacing },
          audio: false
        });
      }
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error("Camera access failed:", err);
      setCameraError(
        "Impossible d'accéder à la caméra. Vérifiez les permissions de votre navigateur ou utilisez le mode d'importation de fichiers."
      );
      setActiveMode("upload");
    }
  };

  const toggleCameraFacing = () => {
    const nextFacing = facingMode === "user" ? "environment" : "user";
    setFacingMode(nextFacing);
    startCamera(nextFacing);
  };

  const stopCameraStream = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  };

  // Switch between camera live stream and file uploader
  const handleModeChange = (mode: "camera" | "upload") => {
    setActiveMode(mode);
    if (mode === "camera") {
      startCamera();
    } else {
      stopCameraStream();
    }
  };

  // Capture Photo from video element
  const capturePhoto = () => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const base64Data = dataUrl.split(",")[1];
      
      setFileBase64(base64Data);
      setFileMime("image/jpeg");
      setFileName(`capture_atelier_${Date.now()}.jpg`);
      setFilePreview(dataUrl);
      
      // Stop stream after capture to preserve battery and resources
      stopCameraStream();
    }
  };

  // Record short video clips
  const startVideoRecording = () => {
    if (!cameraStream) return;
    setRecordedChunks([]);
    setIsRecording(true);

    try {
      const options = { mimeType: "video/webm;codecs=vp9,opus" };
      let recorder;
      try {
        recorder = new MediaRecorder(cameraStream, options);
      } catch (e) {
        recorder = new MediaRecorder(cameraStream);
      }

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          setRecordedChunks((prev) => [...prev, event.data]);
        }
      };

      recorder.onstop = async () => {
        setIsRecording(false);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
    } catch (err) {
      console.error("Failed to start media recorder:", err);
      setIsRecording(false);
    }
  };

  const stopVideoRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
  };

  // Process recorded chunks into base64
  useEffect(() => {
    if (recordedChunks.length > 0 && !isRecording) {
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64Data = result.split(",")[1];
        setFileBase64(base64Data);
        setFileMime("video/webm");
        setFileName(`video_atelier_${Date.now()}.webm`);
        setFilePreview(URL.createObjectURL(blob));
      };
      reader.readAsDataURL(blob);
    }
  }, [recordedChunks, isRecording]);

  // Handle manual file selection (photo/video)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const mime = file.type;
    const name = file.name;

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64Data = result.split(",")[1];
      setFileBase64(base64Data);
      setFileMime(mime);
      setFileName(name);
      
      if (mime.startsWith("image/")) {
        setFilePreview(result);
      } else {
        setFilePreview(URL.createObjectURL(file));
      }
    };
    reader.readAsDataURL(file);
  };

  const clearAttachment = () => {
    setFileBase64(null);
    setFileMime(null);
    setFileName(null);
    setFilePreview(null);
    setRecordedChunks([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileBase64 || !fileMime || !fileName) return;

    if (!navigator.onLine) {
      alert("Erreur de connexion : Vous êtes actuellement hors ligne. Veuillez rétablir votre connexion internet pour pouvoir envoyer des photos ou des vidéos à l'assistant de diagnostic.");
      return;
    }

    const textToSend = description.trim() || "DiagAssist, analyse ce fichier multimédia de l'atelier s'il te plaît.";
    await onSendMediaMessage(textToSend, fileBase64, fileMime, fileName);
    
    // Clear state after success
    setDescription("");
    clearAttachment();
  };

  return (
    <div className="bg-slate-950/60 border border-slate-850 rounded-2xl p-4 sm:p-5 text-slate-100 animate-fade-in shadow-md">
      <div className="flex items-center justify-between border-b border-slate-850 pb-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-red-600/10 text-red-500 rounded-lg">
            <Camera className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Analyse Visuelle (Photo & Vidéo)
            </h3>
            <p className="text-[10px] text-slate-400 mt-0.5">DiagAssist analyse instantanément vos captures</p>
          </div>
        </div>

        {/* Toggle Mode buttons */}
        <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-[10px] font-bold">
          <button
            type="button"
            onClick={() => handleModeChange("upload")}
            className={`px-2.5 py-1 rounded transition duration-150 cursor-pointer ${
              activeMode === "upload" ? "bg-red-600 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Fichier
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("camera")}
            className={`px-2.5 py-1 rounded transition duration-150 cursor-pointer flex items-center gap-1 ${
              activeMode === "camera" ? "bg-red-600 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            Caméra Live
          </button>
        </div>
      </div>

      {/* Main Mode area */}
      <div className="space-y-4">
        {activeMode === "camera" && (
          <div className="relative aspect-video rounded-xl overflow-hidden bg-black border border-slate-800 flex flex-col justify-between">
            {cameraStream ? (
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : !cameraError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-red-500" />
                <span className="text-xs">Chargement de la caméra...</span>
              </div>
            ) : null}

            {cameraError && (
              <div className="absolute inset-0 p-4 flex flex-col items-center justify-center text-center text-xs text-rose-400 bg-slate-950/90 gap-2">
                <AlertCircle className="w-6 h-6 shrink-0" />
                <p>{cameraError}</p>
              </div>
            )}

            {/* Live Recording HUD overlay */}
            {isRecording && (
              <div className="absolute top-3 left-3 bg-red-600 text-white px-2 py-0.5 rounded text-[9px] font-black font-mono animate-pulse uppercase tracking-widest flex items-center gap-1 z-10">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping"></span>
                REC EN COURS
              </div>
            )}

            {/* Live Camera Controls */}
            {cameraStream && (
              <div className="absolute bottom-3 left-0 right-0 flex justify-center items-center gap-3 z-10 px-4">
                <button
                  type="button"
                  onClick={toggleCameraFacing}
                  className="bg-slate-900/90 hover:bg-slate-800 text-white p-2 rounded-full border border-slate-700/60 shadow-lg transition duration-150 cursor-pointer"
                  title="Changer de caméra (Avant / Arrière)"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={capturePhoto}
                  className="bg-white hover:bg-slate-200 text-slate-950 font-black px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-lg transition duration-150 cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  Prendre Photo
                </button>

                {isRecording ? (
                  <button
                    type="button"
                    onClick={stopVideoRecording}
                    className="bg-red-600 hover:bg-red-700 text-white font-black px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-lg transition duration-150 cursor-pointer"
                  >
                    <StopCircle className="w-3.5 h-3.5 animate-pulse" />
                    Stop Vidéo
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startVideoRecording}
                    className="bg-slate-900/90 hover:bg-slate-800 text-red-500 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 border border-slate-700/60 shadow-lg transition duration-150 cursor-pointer"
                  >
                    <Video className="w-3.5 h-3.5" />
                    Filmer Panne
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {activeMode === "upload" && !filePreview && (
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-800 hover:border-red-500/30 rounded-xl p-6 text-center transition duration-200 bg-slate-950/40 hover:bg-slate-900/30 cursor-pointer group"
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              accept="image/*,video/*" 
              className="hidden" 
            />
            <div className="flex flex-col items-center gap-2">
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-850 text-slate-400 group-hover:text-red-500 transition duration-200">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-bold text-white block">Glissez ou sélectionnez un fichier</span>
                <span className="text-[10px] text-slate-500 block mt-0.5">Prend en charge photos, images de valise OBD, et courtes vidéos</span>
              </div>
            </div>
          </div>
        )}

        {/* Selected Media Preview & Description */}
        {filePreview && (
          <div className="bg-slate-950 border border-slate-850 rounded-xl p-3 animate-fade-in space-y-3">
            <div className="flex justify-between items-center border-b border-slate-850 pb-2">
              <span className="text-[10px] font-mono text-slate-400 truncate max-w-xs block">
                📎 {fileName} ({(fileMime || "").toUpperCase()})
              </span>
              <button
                type="button"
                onClick={clearAttachment}
                className="text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-slate-900 transition duration-150 cursor-pointer"
                title="Supprimer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Dynamic Rendering */}
            <div className="relative aspect-video rounded-lg overflow-hidden bg-black/60 border border-slate-900">
              {fileMime?.startsWith("image/") ? (
                <img 
                  src={filePreview} 
                  alt="Aperçu" 
                  className="w-full h-full object-contain"
                  referrerPolicy="no-referrer"
                />
              ) : fileMime?.startsWith("video/") ? (
                <video 
                  src={filePreview} 
                  controls 
                  className="w-full h-full object-contain"
                />
              ) : null}
            </div>

            {/* Description Form */}
            <form onSubmit={handleSubmit} className="space-y-2 pt-1">
              <label className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest block">
                Votre question ou symptôme pour DiagAssist :
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: DiagAssist, dis-moi ce que tu vois sur ce code défaut ?"
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none"
                />
                <button
                  type="submit"
                  disabled={isSending}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-800 disabled:text-slate-500 text-white px-3.5 py-2 rounded-lg text-xs font-bold transition duration-150 flex items-center gap-1.5 shadow-md shrink-0 cursor-pointer"
                >
                  {isSending ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  Analyser
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Localized assistance info */}
      <div className="mt-3 bg-red-950/10 border border-red-500/5 rounded-xl p-2.5 flex items-start gap-2 text-[10px] text-slate-400 leading-normal">
        <HelpCircle className="w-3.5 h-3.5 shrink-0 text-red-500 mt-0.5" />
        <p>
          <strong>Conseil Pro :</strong> Si vous prenez une photo de l'écran de votre valise OBD, assurez-vous que les codes défauts (ex: P0340, C112A) sont bien nets et lisibles pour que DiagAssist puisse les décoder automatiquement.
        </p>
      </div>
    </div>
  );
}
