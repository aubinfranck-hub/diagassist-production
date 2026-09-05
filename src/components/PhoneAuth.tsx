import React, { useState } from "react";
import { Phone, ShieldCheck, ArrowRight, RefreshCw, Sparkles, CheckCircle, AlertCircle, Lock } from "lucide-react";

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
  const [step, setStep] = useState<"login" | "success" | "forgot" | "reset">("login");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-red-600/[0.03] rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-red-600/[0.02] rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-md premium-glass-card rounded-3xl p-6 md:p-8 shadow-2xl relative overflow-hidden animate-fade-in">

        <div className="text-center mb-8 relative">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-white rounded-2xl shadow-lg shadow-red-600/20 border border-white/[0.08] mb-4 overflow-hidden">
            <img src="/icon-192.png" alt="DiagAssist" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-xl font-display font-black text-white uppercase tracking-tight">
            DiagAssist <span className="text-red-500">v1</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1.5 font-medium tracking-wide">
            Valise de diagnostic auto intelligente par IA
          </p>
        </div>

        {step === "login" && (
          <div className="space-y-6 animate-fade-in relative">
            <div className="text-center space-y-2.5">
              <h2 className="text-base font-black text-slate-200 uppercase tracking-wide">
                Connexion
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Utilisez le numéro de téléphone et le mot de passe qui vous ont été communiqués. Pas de compte ? Contactez-nous.
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
                    type="password"
                    required
                    placeholder="Votre mot de passe"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl pl-11 pr-4 py-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition duration-150"
                  />
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
              <input
                type="password"
                required
                minLength={6}
                placeholder="Nouveau mot de passe (min. 6 caractères)"
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
                className="w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl px-4 py-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500"
              />
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
