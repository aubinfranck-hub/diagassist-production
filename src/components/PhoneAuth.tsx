import React, { useState, useEffect, useRef } from "react";
import { 
  Phone, ShieldCheck, ArrowRight, MessageSquare, RefreshCw, Sparkles, 
  CheckCircle, Lock, AlertCircle, ArrowLeft
} from "lucide-react";

interface PhoneAuthProps {
  onLoginSuccess: (phoneNumber: string) => void;
}

const COUNTRY_CODES = [
  { code: "+225", country: "Côte d'Ivoire 🇨🇮" },
  { code: "+221", country: "Sénégal 🇸🇳" },
  { code: "+223", country: "Mali 🇲🇱" },
  { code: "+226", country: "Burkina Faso 🇧🇫" },
  { code: "+228", country: "Togo 🇹🇬" },
  { code: "+229", country: "Bénin 🇧🇯" },
  { code: "+224", country: "Guinée 🇬🇳" },
  { code: "+227", country: "Niger 🇳🇪" },
  { code: "+237", country: "Cameroun 🇨🇲" },
  { code: "+241", country: "Gabon 🇬🇦" },
  { code: "+33", country: "France 🇫🇷" },
];

export default function PhoneAuth({ onLoginSuccess }: PhoneAuthProps) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("+225");
  const [step, setStep] = useState<"phone" | "recaptcha" | "otp" | "success">("phone");

  // OTP states
  const [otpValues, setOtpValues] = useState(["", "", "", "", "", ""]);
  const [sentCode, setSentCode] = useState("");
  const [showSmsNotification, setShowSmsNotification] = useState(false);
  const [timer, setTimer] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Input references for automatic focus progression
  const inputRefs = useRef<HTMLInputElement[]>([]);

  // Timer countdown for resending code
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (step === "otp" && timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [step, timer]);

  // Handler to submit phone number & trigger OTP dispatch via Express backend (canal WhatsApp uniquement)
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!navigator.onLine) {
      setError("Erreur de connexion : Vous êtes actuellement hors ligne. Veuillez vérifier votre connexion réseau mobile.");
      return;
    }

    // Basic cleaning and validation
    const cleanNumber = phoneNumber.replace(/\s+/g, "");
    if (!cleanNumber || cleanNumber.length < 8) {
      setError("Veuillez saisir un numéro de téléphone valide (minimum 8 chiffres).");
      return;
    }

    setLoading(true);
    setStep("recaptcha");

    try {
      // Step 1: Security Handshake
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: cleanNumber,
          countryCode: selectedCountry,
          channel: "whatsapp"
        })
      });

      const data = await response.json();

      if (data.success) {
        setSentCode(data.otpCode || "");
        setStep("otp");
        setTimer(60);

        // Display interactive feedback toast
        setTimeout(() => {
          if (data.sentRealMessage) {
            // Real Twilio WhatsApp message dispatched successfully!
            setShowSmsNotification(false);
          } else {
            // Simulation Mode: Show code overlay on screen so they don't get blocked
            setShowSmsNotification(true);
          }
        }, 800);
      } else {
        setError(data.message || "Une erreur est survenue lors de l'envoi du code.");
        setStep("phone");
      }
    } catch (err) {
      console.error("Erreur d'authentification réseau :", err);
      setError("Impossible de joindre la passerelle d'authentification. Veuillez réessayer.");
      setStep("phone");
    } finally {
      setLoading(false);
    }
  };

  // Handle individual digit entries in OTP inputs
  const handleOtpChange = (index: number, val: string) => {
    if (!/^\d*$/.test(val)) return; // numbers only

    const newValues = [...otpValues];
    // Take only the last character typed
    newValues[index] = val.slice(-1);
    setOtpValues(newValues);
    setError(null);

    // Automatically focus next input box
    if (val && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    // Backspace jumps to previous input
    if (e.key === "Backspace" && !otpValues[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  // Resend OTP Code
  const handleResendCode = async () => {
    if (timer > 0) return;
    setError(null);

    if (!navigator.onLine) {
      setError("Erreur de connexion : Vous êtes actuellement hors ligne. Rétablissez votre connexion pour renvoyer le code.");
      return;
    }

    setLoading(true);
    setOtpValues(["", "", "", "", "", ""]);

    try {
      const cleanNumber = phoneNumber.replace(/\s+/g, "");
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: cleanNumber,
          countryCode: selectedCountry,
          channel: "whatsapp"
        })
      });

      const data = await response.json();

      if (data.success) {
        setSentCode(data.otpCode || "");
        setTimer(60);
        if (!data.sentRealMessage) {
          setShowSmsNotification(true);
        }
      } else {
        setError(data.message || "Erreur lors du renvoi du code de validation.");
      }
    } catch (err) {
      setError("Erreur réseau de communication.");
    } finally {
      setLoading(false);
    }
  };

  // Verify OTP Code
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const enteredCode = otpValues.join("");
    if (enteredCode.length < 6) {
      setError("Veuillez remplir les 6 chiffres du code de validation.");
      return;
    }

    if (!navigator.onLine) {
      setError("Erreur de connexion : Vous êtes actuellement hors ligne. Impossible de valider le code.");
      return;
    }

    setLoading(true);

    try {
      const cleanNumber = phoneNumber.replace(/\s+/g, "");
      const response = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: cleanNumber,
          countryCode: selectedCountry,
          code: enteredCode
        })
      });

      const data = await response.json();

      if (data.success) {
        if (data.sessionToken) {
          localStorage.setItem("auth_session_token", data.sessionToken);
        }
        setStep("success");
        // Let user see the glorious success state for 1.2 seconds before passing control
        setTimeout(() => {
          const fullPhoneNumber = `${selectedCountry} ${phoneNumber.trim()}`;
          onLoginSuccess(fullPhoneNumber);
        }, 1200);
      } else {
        setError(data.message || "Code de validation incorrect. Veuillez réessayer.");
      }
    } catch (err) {
      setError("Erreur réseau lors de la vérification. Veuillez réessayer.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Visual Ambient glow backgrounds */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-red-600/[0.03] rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-red-600/[0.02] rounded-full blur-3xl pointer-events-none"></div>

      {/* Top Beautiful Toast WhatsApp Simulation */}
      {showSmsNotification && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4 animate-bounce">
          <div className="bg-slate-900 border-2 rounded-2xl p-4 shadow-2xl flex items-start gap-3 border-emerald-500/80 shadow-emerald-500/10">
            <div className="p-2 rounded-xl text-white bg-emerald-600">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div className="flex-1 space-y-1 text-left">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-white uppercase tracking-wide">
                  💬 WhatsApp de DiagAssist ⚙️
                </span>
                <span className="text-[9px] text-slate-500 font-mono">À l'instant</span>
              </div>
              <p className="text-xs text-slate-300">
                Votre code de validation de sécurité DiagAssist est : <strong className="font-mono text-sm px-2 py-0.5 rounded border text-emerald-400 bg-slate-950 border-slate-800">{sentCode}</strong>
              </p>
              <button 
                onClick={() => {
                  // Autofill OTP values for supreme convenience
                  const codeArr = sentCode.split("");
                  setOtpValues(codeArr);
                  setShowSmsNotification(false);
                }}
                className="text-[10px] font-bold hover:underline mt-1 block text-emerald-400"
              >
                ⚡ Saisir automatiquement le code
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main card panel */}
      <div className="w-full max-w-md premium-glass-card rounded-3xl p-6 md:p-8 shadow-2xl relative overflow-hidden animate-fade-in">
        
        {/* Brand Header */}
        <div className="text-center mb-8 relative">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-red-600 to-red-800 rounded-2xl text-white text-3xl shadow-lg shadow-red-600/20 border border-white/[0.08] mb-4">
            ⚙️
          </div>
          <h1 className="text-xl font-display font-black text-white uppercase tracking-tight">
            DiagAssist <span className="text-red-500">v1</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1.5 font-medium tracking-wide">
            Valise de diagnostic auto intelligente par IA
          </p>
        </div>

        {/* STEP 1: Enter Phone Number */}
        {step === "phone" && (
          <div className="space-y-6 animate-fade-in relative">
            <div className="text-center space-y-2.5">
              <h2 className="text-base font-black text-slate-200 uppercase tracking-wide">
                Inscription & Connexion Téléphonique
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Renseignez votre numéro de mobile pour déverrouiller votre valise diagnostic, synchroniser vos rapports et profiter de l'essai gratuit.
              </p>
            </div>

            <form onSubmit={handleSendCode} className="space-y-5">
              <div className="space-y-2">
                <label className="block text-xs text-slate-400 font-extrabold uppercase tracking-wider">
                  Numéro de téléphone portable
                </label>
                
                <div className="flex gap-2.5">
                  {/* Country Prefix Selector */}
                  <select
                    value={selectedCountry}
                    onChange={(e) => setSelectedCountry(e.target.value)}
                    className="bg-slate-950/90 border border-white/[0.08] text-slate-300 rounded-2xl px-4 py-4 text-sm font-bold focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition max-w-[145px] cursor-pointer"
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} ({c.country.split(" ")[0]})
                      </option>
                    ))}
                  </select>

                  {/* Phone Input */}
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                      <Phone className="h-5 w-5 text-slate-500" />
                    </div>
                    <input
                      type="tel"
                      required
                      placeholder="ex: 07 12 34 56"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl pl-11 pr-4 py-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition duration-150 font-mono tracking-wider"
                    />
                  </div>
                </div>
              </div>

              {/* OTP Reception Channel: WhatsApp uniquement */}
              <div className="space-y-2 pt-1.5">
                <label className="block text-xs text-slate-400 font-extrabold uppercase tracking-wider">
                  Canal de réception du code
                </label>
                <div className="flex items-center gap-3 py-3.5 px-4 bg-emerald-600/10 border border-emerald-500/40 rounded-2xl text-emerald-400">
                  <span className="text-xl">🟢</span>
                  <div className="text-left">
                    <div className="text-xs font-black uppercase tracking-wider">WhatsApp</div>
                    <span className="text-[9px] text-emerald-500/80 font-medium block mt-1">Envoi du code d'authentification sur votre WhatsApp</span>
                  </div>
                </div>
              </div>

              {error && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs p-3.5 rounded-2xl flex items-start gap-2.5 animate-pulse">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2.5 py-4.5 bg-gradient-to-r from-red-600 to-red-750 hover:from-red-700 hover:to-red-800 text-white font-black text-xs md:text-sm uppercase tracking-wider rounded-2xl cursor-pointer hover:shadow-xl hover:shadow-red-600/30 active:scale-[0.99] transition duration-150 glow-btn border border-red-500/20"
              >
                <span>Envoyer le code de validation</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

        {/* STEP 2: reCAPTCHA Verification Simulator */}
        {step === "recaptcha" && (
          <div className="space-y-6 py-6 text-center animate-fade-in">
            <div className="flex justify-center mb-2">
              <div className="relative flex h-14 w-14 items-center justify-center">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-25"></span>
                <div className="relative inline-flex rounded-full h-10 w-10 bg-slate-950 border border-slate-800 items-center justify-center">
                  <Lock className="w-4 h-4 text-red-500 animate-pulse" />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-bold text-white">Vérification de sécurité</h3>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">
                Initialisation de la passerelle WhatsApp sécurisée. Merci de patienter un instant...
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 bg-slate-950 border border-slate-800 p-3 rounded-2xl max-w-xs mx-auto">
              <RefreshCw className="w-4 h-4 text-red-500 animate-spin" />
              <span className="text-[11px] font-mono text-slate-400">auth.gateway.verifier.js</span>
            </div>
          </div>
        )}

        {/* STEP 3: OTP Code verification */}
        {step === "otp" && (
          <div className="space-y-6 animate-fade-in relative">
            <div className="text-center space-y-3.5">
              <button 
                type="button"
                onClick={() => setStep("phone")}
                className="inline-flex items-center gap-1.5 text-xs md:text-sm font-bold text-slate-400 hover:text-slate-200 transition mb-2 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" /> Retour
              </button>
              <h2 className="text-base md:text-lg font-black text-slate-200 uppercase tracking-wide">
                Code de validation reçu ?
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Saisissez le code de validation à 6 chiffres envoyé au <strong className="text-slate-200 font-mono font-black">{selectedCountry} {phoneNumber}</strong>
              </p>
            </div>

            <form onSubmit={handleVerifyOtp} className="space-y-6">
              {/* Digit Input boxes */}
              <div className="flex justify-center sm:justify-between items-center gap-1.5 sm:gap-2 md:gap-3">
                {otpValues.map((val, idx) => (
                  <input
                    key={idx}
                    ref={(el) => { if (el) inputRefs.current[idx] = el; }}
                    type="text"
                    maxLength={1}
                    value={val}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    className="w-10 h-13 sm:w-12 sm:h-14 md:w-14 md:h-16 flex-1 max-w-[56px] bg-slate-950/95 border-2 border-white/[0.08] focus:border-red-500 rounded-xl sm:rounded-2xl text-center font-mono text-xl sm:text-2xl font-black text-white focus:outline-none transition-all focus:ring-4 focus:ring-red-500/10"
                  />
                ))}
              </div>

              {error && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs p-3.5 rounded-2xl flex items-start gap-2.5 animate-pulse">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2.5 py-4.5 bg-gradient-to-r from-red-600 to-red-750 hover:from-red-700 hover:to-red-800 text-white font-black text-xs md:text-sm uppercase tracking-wider rounded-2xl cursor-pointer hover:shadow-xl hover:shadow-red-600/30 active:scale-[0.99] transition duration-150 glow-btn border border-red-500/20"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin text-white" />
                    <span>Vérification du code...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-5 h-5 text-white" />
                    <span>Confirmer et Activer la Valise</span>
                  </>
                )}
              </button>
            </form>

            {/* Resend actions */}
            <div className="text-center pt-2">
              {timer > 0 ? (
                <span className="text-xs text-slate-500">
                  Renvoyer un nouveau code dans <strong className="font-mono text-slate-400">{timer}s</strong>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleResendCode}
                  className="text-xs text-red-500 font-bold hover:underline hover:text-red-400 transition cursor-pointer"
                >
                  Renvoyer un code de validation WhatsApp
                </button>
              )}
            </div>
          </div>
        )}

        {/* STEP 4: Success confirmation */}
        {step === "success" && (
          <div className="space-y-6 text-center py-8 animate-fade-in">
            <div className="flex justify-center">
              <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400 shadow-xl shadow-emerald-500/5 animate-bounce">
                <CheckCircle className="w-8 h-8" />
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-lg font-bold text-white uppercase tracking-tight">Accès Déverrouillé !</h2>
              <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
                Votre numéro de téléphone a été validé avec succès. Vous êtes maintenant connecté.
              </p>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 inline-flex items-center gap-2 max-w-xs mx-auto">
              <Sparkles className="w-4 h-4 text-red-500 animate-pulse" />
              <span className="text-xs font-mono font-bold text-emerald-400">Session Sécurisée Activée</span>
            </div>
          </div>
        )}

        {/* Secure badge footer inside card */}
        <div className="mt-8 pt-4 border-t border-slate-850 flex items-center justify-center gap-2 text-[10px] text-slate-600 font-mono">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/70" />
          <span>Connexion sécurisée par validation WhatsApp</span>
        </div>

      </div>

      {/* Info panel */}
      <div className="mt-6 text-center text-slate-600 text-[10px] max-w-sm leading-relaxed">
        Ce module d'identification permet de préserver votre historique de pannes de voiture, d'associer votre pass Wave ou abonnements LITE/PREMIUM, et de bloquer le vol de vos crédits.
      </div>
    </div>
  );
}
