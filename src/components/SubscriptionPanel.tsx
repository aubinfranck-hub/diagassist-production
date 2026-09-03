import React, { useState } from "react";
import { 
  Sparkles, ShieldCheck, Zap, Layers, ExternalLink, Check, Volume2, 
  BookOpen, HelpCircle, AlertCircle, RefreshCw, Coins, Lock
} from "lucide-react";
import { SubscriptionPlan } from "../types";

interface SubscriptionPanelProps {
  currentPlan: SubscriptionPlan;
  onPlanChange: (plan: SubscriptionPlan) => void;
  onActivatePayg: () => void;
  onRequestActivation: (plan: SubscriptionPlan, amount: number) => void;
}

export default function SubscriptionPanel({ currentPlan, onPlanChange, onActivatePayg, onRequestActivation }: SubscriptionPanelProps) {
  
  // State to hold the dynamically selected payment amount for Wave
  const [selectedAmount, setSelectedAmount] = useState<number>(6000);
  const [requestSent, setRequestSent] = useState(false);

  // Changement de mot de passe (self-service)
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(false);
    setPwdLoading(true);
    try {
      const token = localStorage.getItem("auth_session_token");
      const res = await fetch("/api/user/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token || ""}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        setPwdSuccess(true);
        setCurrentPassword("");
        setNewPassword("");
      } else {
        setPwdError(data.message || "Échec du changement de mot de passe.");
      }
    } catch {
      setPwdError("Erreur réseau.");
    } finally {
      setPwdLoading(false);
    }
  };

  // Dynamic Wave payment URL generator
  const getWavePaymentUrl = (amount: number) => {
    return `https://pay.wave.com/m/M_ci_kwfmSykm6_et/c/ci/?amount=${amount}`;
  };

  const currentWaveUrl = getWavePaymentUrl(selectedAmount);

  const handlePayWithWave = (amount: number) => {
    setSelectedAmount(amount);
    // Open payment link in a new tab. L'activation du forfait N'EST PLUS automatique :
    // elle est déclenchée manuellement par l'admin après vérification réelle du paiement Wave.
    window.open(getWavePaymentUrl(amount), "_blank");
  };

  const handleConfirmTransfer = (amount: number) => {
    const plan: SubscriptionPlan = amount === 15000 ? "premium" : "lite";
    onRequestActivation(plan, amount);
    setRequestSent(true);
  };

  return (
    <div className="space-y-8 animate-fade-in">

      {/* Mon compte : changement de mot de passe (self-service) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-slate-400" />
          Mon compte : changer mon mot de passe
        </h3>
        <form onSubmit={handleChangePassword} className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input
            type="password"
            required
            placeholder="Mot de passe actuel"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Nouveau mot de passe (min. 6 caractères)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500"
          />
          <button
            type="submit"
            disabled={pwdLoading}
            className="sm:col-span-2 bg-slate-800 hover:bg-slate-700 border border-white/[0.08] text-white font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer disabled:opacity-50 whitespace-nowrap w-full"
          >
            {pwdLoading ? "..." : "Changer"}
          </button>
        </form>
        {pwdError && <p className="text-xs text-rose-400">{pwdError}</p>}
        {pwdSuccess && <p className="text-xs text-emerald-400">Mot de passe mis à jour avec succès.</p>}
      </div>

      {/* Banner indicating currently active plan */}
      <div className="premium-glass-card rounded-3xl p-6 md:p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-red-600/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative">
          <div>
            <span className="text-xs text-slate-400 font-mono font-bold uppercase tracking-wider">État actuel du compte</span>
            <h2 className="text-2xl font-display font-black text-white mt-1.5 flex items-center flex-wrap gap-2.5">
              Plan Actuel : 
              {currentPlan === "free_trial" && (
                <span className="text-red-500 bg-red-600/10 border border-red-500/20 px-4 py-1.5 rounded-xl text-xs md:text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-4.5 h-4.5" /> Essai Gratuit 24h (Premium Actif !)
                </span>
              )}
              {currentPlan === "free_expired" && (
                <span className="text-rose-500 bg-rose-500/10 border border-rose-500/20 px-4 py-1.5 rounded-xl text-xs md:text-sm font-black uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
                  <AlertCircle className="w-4.5 h-4.5" /> Essai de 24h Expiré
                </span>
              )}
              {currentPlan === "payg_active" && (
                <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-4 py-1.5 rounded-xl text-xs md:text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="w-4.5 h-4.5" /> Pass 24h Actif (À l'usage)
                </span>
              )}
              {currentPlan === "lite" && (
                <span className="text-sky-400 bg-sky-400/10 border border-sky-400/20 px-4 py-1.5 rounded-xl text-xs md:text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-4.5 h-4.5" /> Formule LITE Active
                </span>
              )}
              {currentPlan === "premium" && (
                <span className="text-red-400 bg-red-600/10 border border-red-500/20 px-4 py-1.5 rounded-xl text-xs md:text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-4.5 h-4.5" /> Formule PREMIUM Active
                </span>
              )}
            </h2>
            <p className="text-sm text-slate-300 mt-3 leading-relaxed">
              {currentPlan === "free_trial" && "Vous bénéficiez d'un accès complet à toutes les fonctionnalités Premium pendant vos premières 24 heures de test."}
              {currentPlan === "free_expired" && "Votre période d'essai gratuit de 24 heures est terminée. Veuillez prendre un pass 24h à l'usage ou vous abonner pour continuer à diagnostiquer vos pannes."}
              {currentPlan === "payg_active" && "Votre pass d'accès à l'usage de 500 F CFA est actif. Il expirera dans 24 heures."}
              {currentPlan === "lite" && "Vous bénéficiez d'un accès normal illimité à l'analyse de panne standard et aux guides de réparation."}
              {currentPlan === "premium" && "Accès illimité ! Explications audio TTS de haute qualité et fiches Haynes Pro d'expert incluses."}
            </p>
          </div>
 
          {/* Statut de la demande d'activation en attente, le cas échéant */}
          {requestSent && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 w-full md:w-auto text-emerald-300 text-xs font-bold flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>Demande envoyée — activation sous vérification manuelle du paiement.</span>
            </div>
          )}
        </div>
      </div>
 
      {/* Official Tiers Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
 
        {/* Tier 2: Lite */}
        <div className={`premium-glass-card rounded-3xl p-6 md:p-8 flex flex-col justify-between shadow-2xl relative overflow-hidden transition-all duration-300 ${selectedAmount === 6000 ? "border-2 border-sky-400/50 bg-slate-900/85" : "border border-white/[0.05]"}`}>
          <div>
            <span className="text-xs text-slate-400 font-mono font-black uppercase tracking-wider block mb-1">Palier 2</span>
            <h3 className="text-xl font-display font-black text-white flex items-center gap-1.5">
              Formule LITE
            </h3>
 
            <div className="my-5">
              <div className="text-xs text-slate-400">Abonnement mensuel :</div>
              <div className="text-3xl font-display font-extrabold text-sky-400">6 000 F CFA <span className="text-sm font-normal text-slate-500">/ mois</span></div>
              <div className="text-xs text-slate-400 mt-1.5 font-medium">
                Diagnostics complets normaux illimités
              </div>
            </div>
 
             <ul className="space-y-3.5 text-sm text-slate-300 mt-6 border-t border-white/[0.05] pt-4">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-sky-400 shrink-0" />
                <span>Analyses de pannes illimitées</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-sky-400 shrink-0" />
                <span>Guide de réparation étape par étape</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-sky-400 shrink-0" />
                <span>Identification des codes défaut OBD</span>
              </li>
              <li className="flex items-center gap-2 text-slate-500 line-through">
                <Volume2 className="w-4 h-4 shrink-0" />
                <span>Explications vocales audio</span>
              </li>
              <li className="flex items-center gap-2 text-slate-500 line-through">
                <BookOpen className="w-4 h-4 shrink-0" />
                <span>Données techniques Haynes Pro</span>
              </li>
            </ul>
          </div>
 
          <div className="mt-8 pt-4 border-t border-white/[0.05]">
            <button
              onClick={() => handlePayWithWave(6000)}
              className="w-full bg-sky-500 hover:bg-sky-600 text-slate-950 font-black text-sm py-4 px-4 rounded-xl transition duration-150 flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider shadow-md"
            >
              <span>S'abonner Lite (6 000F)</span>
            </button>
          </div>
        </div>
 
        {/* Tier 3: Premium */}
        <div className={`premium-glass-card rounded-3xl p-6 md:p-8 flex flex-col justify-between shadow-2xl relative overflow-hidden transition-all duration-300 ${selectedAmount === 15000 ? "border-2 border-red-500 bg-slate-900/85" : "border-2 border-red-600/40"}`}>
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] font-black px-4.5 py-1.5 rounded-full uppercase tracking-widest border border-red-500/20">
            Recommandé
          </div>
 
          <div className="pt-3">
            <span className="text-xs text-slate-400 font-mono font-black uppercase tracking-wider block mb-1">Palier 3</span>
            <h3 className="text-xl font-display font-black text-white flex items-center gap-1.5">
              Formule PREMIUM
            </h3>
 
            <div className="my-5">
              <div className="text-xs text-slate-400">Abonnement expert :</div>
              <div className="text-3xl font-display font-extrabold text-red-500">15 000 F CFA <span className="text-sm font-normal text-slate-500">/ mois</span></div>
              <div className="text-xs text-red-400 font-bold flex items-center gap-1 mt-1.5">
                <Sparkles className="w-4 h-4" /> Fonctionnalités ultimes incluses
              </div>
            </div>
 
            <ul className="space-y-3.5 text-sm text-slate-300 mt-6 border-t border-white/[0.05] pt-4">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-red-500 shrink-0" />
                <span>Tout en texte et <strong>AUDIO</strong></span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-red-500 shrink-0" />
                <span>
                  Données techniques <strong>Haynes Pro</strong>
                </span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-red-500 shrink-0" />
                <span>Analyses & dialogues avec l'IA illimités</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-red-500 shrink-0" />
                <span>Reconnaissance multimédia ultra-précise</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-red-500 shrink-0" />
                <span>Support diagnostic prioritaire 24h/7j</span>
              </li>
            </ul>
          </div>
 
          <div className="mt-8 pt-4 border-t border-white/[0.05]">
            <button
              onClick={() => handlePayWithWave(15000)}
              className="w-full bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-750 text-white font-black text-sm py-4 px-4 rounded-xl transition duration-150 flex items-center justify-center gap-2.5 cursor-pointer shadow-lg shadow-red-600/10 glow-btn uppercase tracking-wider"
            >
              <Sparkles className="w-4 h-4 fill-current text-white" />
              <span>S'abonner Premium (15 000F)</span>
            </button>
          </div>
        </div>
 
      </div>
 
      {/* Official Wave instructions provided by user */}
      <div className="bg-red-600/10 border border-red-500/20 rounded-3xl p-6 md:p-8 flex gap-5 items-start animate-fade-in relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-red-600/[0.03] rounded-full blur-2xl pointer-events-none" />
        <div className="p-3 bg-red-600/10 text-red-500 rounded-xl shrink-0 border border-red-500/10">
          <Zap className="w-7 h-7 animate-pulse" />
        </div>
        <div className="space-y-3 relative w-full">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <span className="font-display font-black text-red-400 block text-base uppercase tracking-wide">Méthode de Paiement Mobile Wave</span>
            
            {/* Quick manual selection within the instructions box to demonstrate the requirement */}
            <div className="flex items-center gap-1.5 bg-slate-950/50 p-1 rounded-xl border border-white/[0.05]">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider px-2 font-mono">Montant :</span>
              <button 
                onClick={() => setSelectedAmount(6000)}
                className={`px-2 py-1 text-[10px] font-black rounded-lg transition ${selectedAmount === 6000 ? "bg-sky-500 text-slate-950" : "text-slate-400 hover:text-slate-200"}`}
              >
                6000F
              </button>
              <button 
                onClick={() => setSelectedAmount(15000)}
                className={`px-2 py-1 text-[10px] font-black rounded-lg transition ${selectedAmount === 15000 ? "bg-red-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                15000F
              </button>
            </div>
          </div>

          <p className="text-slate-200 font-medium leading-relaxed bg-slate-950/60 p-5 md:p-6 border border-white/[0.05] rounded-xl text-sm md:text-base">
            "Veuillez Payer <strong className="text-white">NTIC STRATEGY {selectedAmount}F</strong> avec Wave en cliquant sur ce lien{" "}
            <a 
              href={currentWaveUrl} 
              target="_blank" 
              rel="noreferrer" 
              className="text-red-400 font-bold underline hover:text-red-300 break-all inline-flex items-center gap-1 text-sm md:text-base cursor-pointer"
            >
              {currentWaveUrl} <ExternalLink className="w-4 h-4 shrink-0" />
            </a>
            ."
          </p>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={() => window.open(currentWaveUrl, "_blank")}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black text-xs py-3.5 px-4 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider shadow"
            >
              <ExternalLink className="w-4.5 h-4.5" />
              <span>Ouvrir Wave pour {selectedAmount}F</span>
            </button>
            
            <button
              onClick={() => handleConfirmTransfer(selectedAmount)}
              disabled={requestSent}
              className="flex-1 bg-slate-900 hover:bg-slate-850 border border-white/[0.08] text-emerald-400 hover:text-emerald-300 font-black text-xs py-3.5 px-4 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4" />
              <span>{requestSent ? "Demande envoyée" : "Confirmer l'activation après transfert"}</span>
            </button>
          </div>

          <div className="flex items-start gap-2.5 text-xs text-slate-500 pt-1.5">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <span>
              Après votre transfert Wave, cliquez sur "Confirmer l'activation" : votre forfait sera activé manuellement dès vérification du paiement (généralement sous quelques minutes).
            </span>
          </div>
        </div>
      </div>

    </div>
  );
}
