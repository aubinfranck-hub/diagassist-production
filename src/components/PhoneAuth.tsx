import React, { useState } from "react";
import { Phone, ShieldCheck, ArrowRight, RefreshCw, Sparkles, CheckCircle, AlertCircle, Lock, Eye, EyeOff } from "lucide-react";

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
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [step, setStep] = useState<"login" | "success" | "forgot" | "reset" | "register" | "register-otp">("login");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Création de compte (numéro + mot de passe), validée par un code OTP WhatsApp
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState("");
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [registerCode, setRegisterCode] = useState("");
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerInfo, setRegisterInfo] = useState<string | null>(null);
  // En mode simulation (Twilio non configuré, hors production), le serveur renvoie le code
  // directement pour ne pas bloquer les tests — jamais en production.
  const [registerDevCode, setRegisterDevCode] = useState<string | null>(null);

  // Mot de passe oublié
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);
    setResetMessage(null);
    setResetLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail }),
      });
      const data = await res.json();
      setResetMessage(data.message);
      setStep("reset");
    } catch {
      setResetError("Erreur réseau.");
    } finally {
      setResetLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);
    setResetLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail, code: resetCode, newPassword: resetNewPassword }),
      });
      const data = await res.json();
      if (data.success) {
        setResetMessage(data.message);
        setTimeout(() => {
          setStep("login");
          setResetMessage(null);
          setResetCode("");
          setResetNewPassword("");
        }, 2000);
      } else {
        setResetError(data.message || "Échec de la réinitialisation.");
      }
    } catch {
      setResetError("Erreur réseau.");
    } finally {
      setResetLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!navigator.onLine) {
      setError("Vous êtes actuellement hors ligne. Veuillez vérifier votre connexion réseau.");
      return;
    }

    const cleanNumber = phoneNumber.replace(/\s+/g, "");
    if (!cleanNumber || cleanNumber.length < 8) {
      setError("Veuillez saisir un numéro de téléphone valide.");
      return;
    }
    if (!password) {
      setError("Veuillez saisir votre mot de passe.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: cleanNumber,
          countryCode: selectedCountry,
          password,
        }),
      });
      const data = await response.json();

      if (data.success) {
        if (data.sessionToken) {
          localStorage.setItem("auth_session_token", data.sessionToken);
        }
        setStep("success");
        setTimeout(() => {
          const fullPhoneNumber = `${selectedCountry} ${phoneNumber.trim()}`;
          onLoginSuccess(fullPhoneNumber);
        }, 1000);
      } else {
        setError(data.message || "Numéro ou mot de passe incorrect.");
      }
    } catch (err) {
      setError("Erreur réseau lors de la connexion. Veuillez réessayer.");
    } finally {
      setLoading(false);
    }
  };

  // Étape 1 de la création de compte : envoie le code de validation WhatsApp au numéro saisi.
  const handleStartRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError(null);
    setRegisterInfo(null);
    setRegisterDevCode(null);

    if (!navigator.onLine) {
      setRegisterError("Vous êtes actuellement hors ligne. Veuillez vérifier votre connexion réseau.");
      return;
    }

    const cleanNumber = phoneNumber.replace(/\s+/g, "");
    if (!cleanNumber || cleanNumber.length < 8) {
      setRegisterError("Veuillez saisir un numéro de téléphone valide.");
      return;
    }
    if (registerPassword.length < 6) {
      setRegisterError("Le mot de passe doit faire au moins 6 caractères.");
      return;
    }
    if (registerPassword !== registerConfirmPassword) {
      setRegisterError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setRegisterLoading(true);
    try {
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: cleanNumber, countryCode: selectedCountry }),
      });
      const data = await response.json();
      if (data.success) {
        setRegisterInfo(data.message);
        if (data.otpCode) {
          // Uniquement renvoyé par le serveur hors production / mode simulation.
          setRegisterDevCode(data.otpCode);
        }
        setStep("register-otp");
      } else {
        setRegisterError(data.message || "Impossible d'envoyer le code de validation.");
      }
    } catch (err) {
      setRegisterError("Erreur réseau lors de l'envoi du code. Veuillez réessayer.");
    } finally {
      setRegisterLoading(false);
    }
  };

  // Étape 2 : valide le code reçu et crée réellement le compte (numéro + mot de passe choisi).
  const handleConfirmRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError(null);

    if (!registerCode || registerCode.trim().length < 4) {
      setRegisterError("Veuillez saisir le code reçu par WhatsApp.");
      return;
    }

    setRegisterLoading(true);
    try {
      const response = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: phoneNumber.replace(/\s+/g, ""),
          countryCode: selectedCountry,
          code: registerCode.trim(),
          password: registerPassword,
        }),
      });
      const data = await response.json();
      if (data.success) {
        if (data.sessionToken) {
          localStorage.setItem("auth_session_token", data.sessionToken);
        }
        setStep("success");
        setTimeout(() => {
          const fullPhoneNumber = `${selectedCountry} ${phoneNumber.trim()}`;
          onLoginSuccess(fullPhoneNumber);
        }, 1000);
      } else {
        setRegisterError(data.message || "Code de validation incorrect.");
      }
    } catch (err) {
      setRegisterError("Erreur réseau lors de la validation. Veuillez réessayer.");
    } finally {
      setRegisterLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-red-600/[0.03] rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-red-600/[0.02] rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-md premium-glass-card rounded-3xl p-6 md:p-8 shadow-2xl relative overflow-hidden animate-fade-in">

        <div className="text-center mb-8 relative">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-white rounded-2xl shadow-lg shadow-red-600/20 border border-white/[0.08] mb-4 overflow-hidden">
            <img src="/icon-logo-192.png" alt="DiagAssist" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-xl font-display font-black text-white uppercase tracking-tight">
            DiagAssist <span className="text-red-500">v1</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1.5 font-medium tracking-wide">
            DiagAssist, assistant mécanique pro
          </p>
        </div>

        {step === "login" && (
          <div className="space-y-6 animate-fade-in relative">
            <div className="text-center space-y-2.5">
              <h2 className="text-base font-black text-slate-200 uppercase tracking-wide">
                Connexion
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Utilisez votre numéro de téléphone et votre mot de passe.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <label className="block text-xs text-slate-400 font-extrabold uppercase tracking-wider">
                  Numéro de téléphone
                </label>
                <div className="flex gap-2.5">
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

              <div className="space-y-2">
                <label className="block text-xs text-slate-400 font-extrabold uppercase tracking-wider">
                  Mot de passe
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-slate-500" />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="Votre mot de passe"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl pl-11 pr-11 py-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition duration-150"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-4 flex items-center text-slate-500 hover:text-slate-300 cursor-pointer"
                    title={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
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
                className="w-full flex items-center justify-center gap-2.5 py-4.5 bg-gradient-to-r from-red-600 to-red-750 hover:from-red-700 hover:to-red-800 text-white font-black text-xs md:text-sm uppercase tracking-wider rounded-2xl cursor-pointer hover:shadow-xl hover:shadow-red-600/30 active:scale-[0.99] transition duration-150 glow-btn border border-red-500/20 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin text-white" />
                    <span>Connexion...</span>
                  </>
                ) : (
                  <>
                    <span>Se connecter</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <button
              type="button"
              onClick={() => { setStep("forgot"); setError(null); }}
              className="w-full text-center text-[11px] text-slate-500 hover:text-slate-300 transition cursor-pointer"
            >
              Mot de passe oublié ?
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("register");
                setError(null);
                setRegisterError(null);
                setRegisterInfo(null);
                setRegisterDevCode(null);
                setRegisterPassword("");
                setRegisterConfirmPassword("");
                setRegisterCode("");
              }}
              className="w-full text-center py-3 border border-white/[0.08] hover:border-red-500/30 text-slate-300 hover:text-white rounded-2xl text-xs font-bold uppercase tracking-wider transition cursor-pointer"
            >
              Créer un compte
            </button>
          </div>
        )}

        {step === "register" && (
          <div className="space-y-6 animate-fade-in relative">
            <div className="text-center space-y-2.5">
              <h2 className="text-base font-black text-slate-200 uppercase tracking-wide">
                Créer un compte
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Choisissez votre numéro et un mot de passe. Un code de validation vous sera envoyé par WhatsApp.
              </p>
            </div>

            <form onSubmit={handleStartRegister} className="space-y-5">
              <div className="space-y-2">
                <label className="block text-xs text-slate-400 font-extrabold uppercase tracking-wider">
                  Numéro de téléphone
                </label>
                <div className="flex gap-2.5">
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

              <div className="space-y-2">
                <label className="block text-xs text-slate-400 font-extrabold uppercase tracking-wider">
                  Mot de passe
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-slate-500" />
                  </div>
                  <input
                    type={showRegisterPassword ? "text" : "password"}
                    required
                    minLength={6}
                    placeholder="Min. 6 caractères"
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                    className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl pl-11 pr-11 py-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition duration-150"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegisterPassword((v) => !v)}
                    className="absolute inset-y-0 right-4 flex items-center text-slate-500 hover:text-slate-300 cursor-pointer"
                    title={showRegisterPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  >
                    {showRegisterPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs text-slate-400 font-extrabold uppercase tracking-wider">
                  Confirmer le mot de passe
                </label>
                <input
                  type={showRegisterPassword ? "text" : "password"}
                  required
                  minLength={6}
                  placeholder="Retapez le même mot de passe"
                  value={registerConfirmPassword}
                  onChange={(e) => setRegisterConfirmPassword(e.target.value)}
                  className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl px-4 py-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition duration-150"
                />
              </div>

              {registerError && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs p-3.5 rounded-2xl flex items-start gap-2.5 animate-pulse">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span>{registerError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={registerLoading}
                className="w-full flex items-center justify-center gap-2.5 py-4.5 bg-gradient-to-r from-red-600 to-red-750 hover:from-red-700 hover:to-red-800 text-white font-black text-xs md:text-sm uppercase tracking-wider rounded-2xl cursor-pointer hover:shadow-xl hover:shadow-red-600/30 active:scale-[0.99] transition duration-150 glow-btn border border-red-500/20 disabled:opacity-50"
              >
                {registerLoading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin text-white" />
                    <span>Envoi du code...</span>
                  </>
                ) : (
                  <>
                    <span>Recevoir mon code par WhatsApp</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <button
              type="button"
              onClick={() => { setStep("login"); setRegisterError(null); }}
              className="w-full text-center text-[11px] text-slate-500 hover:text-slate-300 transition cursor-pointer"
            >
              ← Retour à la connexion
            </button>
          </div>
        )}

        {step === "register-otp" && (
          <div className="space-y-6 animate-fade-in relative">
            <div className="text-center space-y-2.5">
              <h2 className="text-base font-black text-slate-200 uppercase tracking-wide">
                Validez votre numéro
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                {registerInfo || `Entrez le code envoyé par WhatsApp au ${selectedCountry} ${phoneNumber}.`}
              </p>
              {registerDevCode && (
                <p className="text-[11px] text-amber-400 font-mono bg-amber-500/10 border border-amber-500/20 rounded-xl py-2 px-3">
                  Mode test (WhatsApp non configuré) — votre code : <strong>{registerDevCode}</strong>
                </p>
              )}
            </div>

            <form onSubmit={handleConfirmRegister} className="space-y-4">
              <input
                type="text"
                required
                placeholder="Code reçu par WhatsApp (6 chiffres)"
                value={registerCode}
                onChange={(e) => setRegisterCode(e.target.value)}
                className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl px-4 py-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 font-mono tracking-widest text-center"
              />

              {registerError && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs p-3.5 rounded-2xl flex items-start gap-2.5 animate-pulse">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span>{registerError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={registerLoading}
                className="w-full flex items-center justify-center gap-2.5 py-4.5 bg-gradient-to-r from-red-600 to-red-750 hover:from-red-700 hover:to-red-800 text-white font-black text-xs md:text-sm uppercase tracking-wider rounded-2xl cursor-pointer hover:shadow-xl hover:shadow-red-600/30 active:scale-[0.99] transition duration-150 glow-btn border border-red-500/20 disabled:opacity-50"
              >
                {registerLoading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin text-white" />
                    <span>Validation...</span>
                  </>
                ) : (
                  <>
                    <span>Valider et créer mon compte</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <button
              type="button"
              onClick={() => { setStep("register"); setRegisterError(null); }}
              className="w-full text-center text-[11px] text-slate-500 hover:text-slate-300 transition cursor-pointer"
            >
              ← Modifier le numéro ou le mot de passe
            </button>
          </div>
        )}

        {step === "forgot" && (
          <div className="space-y-6 animate-fade-in relative">
            <div className="text-center space-y-2.5">
              <h2 className="text-base font-black text-slate-200 uppercase tracking-wide">
                Mot de passe oublié
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Entrez l'adresse email associée à votre compte. Un code de réinitialisation vous sera envoyé si elle est reconnue.
              </p>
            </div>
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <input
                type="email"
                required
                placeholder="votre@email.com"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl px-4 py-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500"
              />
              <button
                type="submit"
                disabled={resetLoading}
                className="w-full py-4 bg-gradient-to-r from-red-600 to-red-750 text-white font-black text-xs uppercase tracking-wider rounded-2xl cursor-pointer disabled:opacity-50"
              >
                {resetLoading ? "Envoi..." : "Envoyer le code"}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setStep("login")}
              className="w-full text-center text-[11px] text-slate-500 hover:text-slate-300 transition cursor-pointer"
            >
              ← Retour à la connexion
            </button>
          </div>
        )}

        {step === "reset" && (
          <div className="space-y-6 animate-fade-in relative">
            <div className="text-center space-y-2.5">
              <h2 className="text-base font-black text-slate-200 uppercase tracking-wide">
                Nouveau mot de passe
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Entrez le code reçu par email et votre nouveau mot de passe.
              </p>
            </div>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <input
                type="text"
                required
                placeholder="Code reçu par email (6 chiffres)"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl px-4 py-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 font-mono tracking-widest text-center"
              />
              <div className="relative">
                <input
                  type={showResetPassword ? "text" : "password"}
                  required
                  minLength={6}
                  placeholder="Nouveau mot de passe (min. 6 caractères)"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl px-4 pr-11 py-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500"
                />
                <button
                  type="button"
                  onClick={() => setShowResetPassword((v) => !v)}
                  className="absolute inset-y-0 right-4 flex items-center text-slate-500 hover:text-slate-300 cursor-pointer"
                  title={showResetPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                >
                  {showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {resetMessage && <p className="text-xs text-emerald-400 text-center">{resetMessage}</p>}
              {resetError && <p className="text-xs text-rose-400 text-center">{resetError}</p>}
              <button
                type="submit"
                disabled={resetLoading}
                className="w-full py-4 bg-gradient-to-r from-red-600 to-red-750 text-white font-black text-xs uppercase tracking-wider rounded-2xl cursor-pointer disabled:opacity-50"
              >
                {resetLoading ? "..." : "Réinitialiser le mot de passe"}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setStep("login")}
              className="w-full text-center text-[11px] text-slate-500 hover:text-slate-300 transition cursor-pointer"
            >
              ← Retour à la connexion
            </button>
          </div>
        )}

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
                Vous êtes maintenant connecté.
              </p>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 inline-flex items-center gap-2 max-w-xs mx-auto">
              <Sparkles className="w-4 h-4 text-red-500 animate-pulse" />
              <span className="text-xs font-mono font-bold text-emerald-400">Session Sécurisée Activée</span>
            </div>
          </div>
        )}

        <div className="mt-8 pt-4 border-t border-slate-850 flex items-center justify-center gap-2 text-[10px] text-slate-600 font-mono">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/70" />
          <span>Connexion sécurisée</span>
        </div>
      </div>

      <div className="mt-6 text-center text-slate-600 text-[10px] max-w-sm leading-relaxed">
        Ce module d'identification permet de préserver votre historique de pannes de voiture, d'associer votre pass Wave ou abonnements LITE/PREMIUM, et de bloquer le vol de vos crédits.
      </div>
    </div>
  );
}
