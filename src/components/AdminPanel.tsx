import { useState, FormEvent, useEffect } from "react";
import { 
  ShieldCheck, Cpu, Database, Trash2, Key, Calendar, 
  Settings, CheckCircle2, AlertOctagon, Terminal, RefreshCw, BarChart2,
  TrendingUp, Coins, Calculator, Landmark, MapPin, Navigation
} from "lucide-react";
import { ApiUsage, SubscriptionPlan } from "../types";
import APIPricePanel from "./APIPricePanel";
import AdAdminDashboard from "./AdAdminDashboard";


interface AdminLogEntry {
  id: string;
  timestamp: Date;
  action: string;
  model: string;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  costUSD: number;
  gps?: { latitude: number; longitude: number; accuracy?: number } | null;
}

interface AdminPanelProps {
  sessionCostUSD: number;
  totalTokensUsed: number;
  queriesCount: number;
  apiLogs: AdminLogEntry[];
  currentPlan: SubscriptionPlan;
  onPlanChange: (plan: SubscriptionPlan) => void;
  onClearStats: () => void;
  onAddMockLog: () => void;
}

export default function AdminPanel({
  sessionCostUSD,
  totalTokensUsed,
  queriesCount,
  apiLogs,
  currentPlan,
  onPlanChange,
  onClearStats,
  onAddMockLog
}: AdminPanelProps) {
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  // Nom de l'assistant personnalisé (DiagAssist par défaut)
  const [assistantName, setAssistantName] = useState<string>(() => {
    return localStorage.getItem("assistant_name") || "DiagAssist";
  });

  // Sync assistant name from localStorage
  useEffect(() => {
    const handleStorageChange = () => {
      setAssistantName(localStorage.getItem("assistant_name") || "DiagAssist");
    };
    window.addEventListener("storage", handleStorageChange);
    const interval = setInterval(handleStorageChange, 1000);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Indicateurs de simulation de rentabilité (Aubin)
  const [subscribersPass, setSubscribersPass] = useState(120);     // Pass 24h vendus par mois
  const [subscribersLite, setSubscribersLite] = useState(45);       // Abonnés Lite actifs
  const [subscribersPremium, setSubscribersPremium] = useState(20);  // Abonnés Premium actifs

  const USD_TO_EUR = 0.92;

  // Selected log entry for the tracking map
  const [selectedLogForMap, setSelectedLogForMap] = useState<AdminLogEntry | null>(null);

  // Automatically select the latest log with GPS coordinates on mount or update
  useEffect(() => {
    if (!selectedLogForMap && apiLogs && apiLogs.length > 0) {
      const latestWithGps = apiLogs.find(log => log.gps);
      if (latestWithGps) {
        setSelectedLogForMap(latestWithGps);
      }
    }
  }, [apiLogs, selectedLogForMap]);

  const getNeighborhoodName = (lat?: number, lng?: number) => {
    if (!lat || !lng) return "Plateau, Abidjan";
    // Check approximation for Abidjan areas
    if (Math.abs(lat - 5.3244) < 0.015 && Math.abs(lng - (-4.0128)) < 0.015) return "Plateau, Abidjan (Région des Lagunes)";
    if (Math.abs(lat - 5.3484) < 0.015 && Math.abs(lng - (-3.9892)) < 0.015) return "Cocody, Abidjan (Zone Résidentielle)";
    if (Math.abs(lat - 5.3019) < 0.015 && Math.abs(lng - (-4.0189)) < 0.015) return "Treichville, Abidjan (Zone Industrielle / Port)";
    if (Math.abs(lat - 5.3094) < 0.015 && Math.abs(lng - (-3.9922)) < 0.015) return "Marcory, Abidjan (Zone Commerciale)";
    if (Math.abs(lat - 5.3411) < 0.015 && Math.abs(lng - (-4.0722)) < 0.015) return "Yopougon, Abidjan (Grand Quartier Mécanique)";
    return `Côte d'Ivoire (Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)})`;
  };

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    setUnlocking(true);
    setPasswordError(false);
    try {
      const res = await fetch("/api/admin/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: passwordInput }),
      });
      const data = await res.json();
      if (data.success) {
        setIsAdminUnlocked(true);
        // Le code n'est jamais conservé une fois validé
        setPasswordInput("");
      } else {
        setPasswordError(true);
      }
    } catch {
      setPasswordError(true);
    } finally {
      setUnlocking(false);
    }
  };

  if (!isAdminUnlocked) {
    return (
      <div className="max-w-md mx-auto my-12 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl text-center">
        <div className="w-12 h-12 bg-red-600/10 text-red-500 rounded-xl flex items-center justify-center mx-auto mb-4">
          <Key className="w-6 h-6 animate-pulse" />
        </div>
        <h3 className="text-base font-display font-bold text-white uppercase tracking-wider mb-2">
          Espace d'Administration Sécurisé
        </h3>
        <p className="text-xs text-slate-400 mb-6 leading-relaxed">
          Cette section est réservée à l'administrateur ({assistantName}) pour surveiller la consommation de tokens, les coûts d'API de diagnostic et configurer les forfaits de test.
        </p>

        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <label className="block text-[11px] text-slate-500 font-bold uppercase tracking-wider text-left mb-1.5">
              Code d'accès Admin (Appuyer sur Entrée pour déverrouiller)
            </label>
            <input
              type="password"
              placeholder="Entrez le mot de passe (ou laissez vide)"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 focus:border-red-500 rounded-xl px-4 py-3 text-xs text-center text-white font-mono placeholder:text-slate-600 transition"
            />
            {passwordError && (
              <p className="text-[10px] text-rose-400 mt-1.5 flex items-center gap-1 justify-center">
                <AlertOctagon className="w-3 h-3" /> Code incorrect.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={unlocking}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-xs py-3 rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            {unlocking ? "Vérification..." : "Déverrouiller le Panel Administrateur"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      
      {/* Admin Status Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 opacity-[0.03] select-none pointer-events-none">
          <Terminal className="w-64 h-64" />
        </div>

        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-display font-bold text-white uppercase tracking-wider">
                Console d'Administration Globale
              </h2>
              <span className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase font-mono tracking-wider">
                Session Connectée
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Surveillance exclusive de la consommation des tokens d'API et simulation de l'environnement applicatif.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={onAddMockLog}
            className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-red-500 rounded-xl text-[11px] font-bold transition flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Simuler un appel API</span>
          </button>
          <button
            onClick={onClearStats}
            className="px-3 py-1.5 bg-rose-950/20 hover:bg-rose-950/40 border border-rose-500/20 text-rose-400 rounded-xl text-[11px] font-bold transition flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Réinitialiser les compteurs</span>
          </button>
        </div>
      </div>

      {/* Admin Control Tower: Quick Plan Simulator & Summary Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Cockpit: Current Simulated Plan & API Status */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Settings className="w-3.5 h-3.5 text-slate-400" />
            Cockpit : Formule de l'utilisateur
          </h3>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Changez ici la formule d'abonnement de l'utilisateur pour tester instantanément le comportement de l'application (Audio, Haynes Pro, blocage d'expiration).
          </p>

          <div className="space-y-2 pt-2">
            {[
              { id: "free_trial", label: "Essai Gratuit Actif (24h)", color: "border-sky-500/30 text-sky-400" },
              { id: "free_expired", label: "Essai Gratuit Expiré 🔒", color: "border-rose-500/30 text-rose-400" },
              { id: "lite", label: "Formule LITE Actif", color: "border-blue-500/30 text-blue-400" },
              { id: "premium", label: "Formule PREMIUM Actif ✨", color: "border-red-500/30 text-red-400" },
              { id: "payg_active", label: "Pass 24h à l'Usage Actif (Wave)", color: "border-emerald-500/30 text-emerald-400" },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => onPlanChange(p.id as SubscriptionPlan)}
                className={`w-full text-left p-3 rounded-xl border text-xs transition duration-150 flex items-center justify-between cursor-pointer ${
                  currentPlan === p.id 
                    ? "bg-slate-950 border-red-500 font-bold text-red-500" 
                    : "bg-slate-950/40 border-slate-800 text-slate-400 hover:bg-slate-950/70"
                }`}
              >
                <span>{p.label}</span>
                {currentPlan === p.id && (
                  <CheckCircle2 className="w-4 h-4 text-red-500 shrink-0 ml-2" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Live Token Metrics */}
        <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-4">
              <BarChart2 className="w-3.5 h-3.5 text-red-500" />
              Indicateurs de Consommation de Tokens en Direct
            </h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
                <span className="text-[10px] text-slate-500 font-mono block uppercase">Total des requêtes</span>
                <div className="text-2xl font-mono font-bold text-red-500 mt-1">{queriesCount}</div>
                <span className="text-[10px] text-slate-500 mt-1 block">Appels API de Diagnostic</span>
              </div>

              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
                <span className="text-[10px] text-slate-500 font-mono block uppercase">Volume de Tokens</span>
                <div className="text-2xl font-mono font-bold text-white mt-1">
                  {totalTokensUsed.toLocaleString()}
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">Entrée + Sortie cumulées</span>
              </div>

              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
                <span className="text-[10px] text-slate-500 font-mono block uppercase">Coût Total Facturé</span>
                <div className="text-2xl font-mono font-bold text-emerald-400 mt-1">
                  ${sessionCostUSD.toFixed(5)}
                </div>
                <span className="text-xs text-emerald-500/80 font-mono block">
                  ≈ {(sessionCostUSD * USD_TO_EUR).toFixed(5)} €
                </span>
              </div>

            </div>
          </div>

          <div className="mt-4 p-3 bg-red-600/5 border border-red-500/10 rounded-xl text-[11px] text-slate-400 leading-relaxed flex items-start gap-2">
            <span className="text-red-500 font-bold font-mono text-xs mt-0.5">💡</span>
            <p>
              <strong>Note sur les coûts d'infrastructure :</strong> {assistantName}, ces coûts reflètent directement le tarif brut facturé par Google Cloud pour traiter les prompts multimédias de l'application. En surveillant de près ces indicateurs, vous pouvez estimer le bénéfice généré par rapport aux abonnements souscrits par vos utilisateurs.
            </p>
          </div>
        </div>

      </div>

      {/* SECTION: SIMULATEUR DE RENTABILITÉ POUR L'EXPERT */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              <h3 className="text-sm font-display font-bold uppercase tracking-wider text-slate-200">
                Calculateur de Rentabilité & Seuil de Rentabilité (Spécial {assistantName})
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Estimez vos revenus, vos coûts d'API IA et visualisez à partir de combien de clients l'application est rentable.
            </p>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs px-3 py-1 rounded-xl font-bold font-mono shrink-0">
            Taux de change : 1 USD ≈ 600 F CFA
          </div>
        </div>

        {/* Sliders to simulate active user base */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-950/60 p-5 rounded-xl border border-slate-800/80">
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-slate-400">Pass 24h (500 F CFA) :</span>
              <span className="text-red-500 font-mono font-bold">{subscribersPass} ventes/mois</span>
            </div>
            <input 
              type="range"
              min="0"
              max="1000"
              step="10"
              value={subscribersPass}
              onChange={(e) => setSubscribersPass(parseInt(e.target.value))}
              className="w-full accent-red-600 h-1.5 bg-slate-850 rounded-lg cursor-pointer"
            />
            <span className="text-[10px] text-slate-500 block">Nombre moyen de tickets journaliers vendus par mois</span>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-slate-400">Abonnés LITE (6 000 F CFA/m) :</span>
              <span className="text-sky-400 font-mono font-bold">{subscribersLite} abonnés actifs</span>
            </div>
            <input 
              type="range"
              min="0"
              max="500"
              step="5"
              value={subscribersLite}
              onChange={(e) => setSubscribersLite(parseInt(e.target.value))}
              className="w-full accent-sky-500 h-1.5 bg-slate-850 rounded-lg cursor-pointer"
            />
            <span className="text-[10px] text-slate-500 block">Mécaniciens abonnés à la formule sans audio ni Haynes Pro</span>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-slate-400">Abonnés PREMIUM (15 000 F CFA/m) :</span>
              <span className="text-red-500 font-mono font-bold">{subscribersPremium} abonnés actifs</span>
            </div>
            <input 
              type="range"
              min="0"
              max="200"
              step="2"
              value={subscribersPremium}
              onChange={(e) => setSubscribersPremium(parseInt(e.target.value))}
              className="w-full accent-red-600 h-1.5 bg-slate-850 rounded-lg cursor-pointer"
            />
            <span className="text-[10px] text-slate-500 block">Mécaniciens professionnels (Haynes Pro + Audio TTS)</span>
          </div>
        </div>

        {/* Calculations */}
        {(() => {
          const COST_PER_QUERY_CFA = 0.243; // Standard: 1800 in, 900 out tokens at $0.075/0.30 per 1M
          const COST_PER_PREMIUM_QUERY_CFA = 0.495; // Premium: 5000 in, 1500 out tokens with TTS/Haynes Pro

          // Revenue
          const revPass = subscribersPass * 500;
          const revLite = subscribersLite * 6000;
          const revPremium = subscribersPremium * 15000;
          const totalRevenueCFA = revPass + revLite + revPremium;

          // Diagnostics counts
          const queriesPerPass = 8;
          const queriesPerLite = 40;
          const queriesPerPremium = 80;

          // Costs
          const costPass = subscribersPass * queriesPerPass * COST_PER_QUERY_CFA;
          const costLite = subscribersLite * queriesPerLite * COST_PER_QUERY_CFA;
          const costPremium = subscribersPremium * queriesPerPremium * COST_PER_PREMIUM_QUERY_CFA;
          const totalCostCFA = costPass + costLite + costPremium;

          // Net Profits
          const netProfitCFA = totalRevenueCFA - totalCostCFA;
          const profitMarginPercent = totalRevenueCFA > 0 ? (netProfitCFA / totalRevenueCFA) * 100 : 0;

          return (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Detailed table of offers profitability */}
              <div className="lg:col-span-8 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 font-sans font-bold">
                      <th className="p-3">Offre Client</th>
                      <th className="p-3 text-right">Prix de Vente</th>
                      <th className="p-3 text-center">Diag/Mois moyen</th>
                      <th className="p-3 text-right">Coût API Mensuel</th>
                      <th className="p-3 text-right text-emerald-400">Marge brute</th>
                      <th className="p-3 text-right text-slate-400">Seuil critique d'abus</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300 font-medium">
                    
                    <tr className="hover:bg-slate-900/40">
                      <td className="p-3">
                        <span className="text-red-500 font-bold block">Pass 24 heures</span>
                        <span className="text-[9px] text-slate-500 font-mono">{subscribersPass} ventes/mois</span>
                      </td>
                      <td className="p-3 text-right font-mono font-semibold">500 F CFA</td>
                      <td className="p-3 text-center font-mono text-slate-400">{queriesPerPass} diag. / pass</td>
                      <td className="p-3 text-right font-mono text-slate-400">{costPass.toFixed(0)} F CFA</td>
                      <td className="p-3 text-right text-emerald-400 font-mono font-bold">
                        {subscribersPass > 0 ? "99.61 %" : "99.61 %"}
                      </td>
                      <td className="p-3 text-right text-slate-500 font-mono text-[9px]">
                        &gt; 2 057 requêtes / 24h
                      </td>
                    </tr>

                    <tr className="hover:bg-slate-900/40">
                      <td className="p-3">
                        <span className="text-sky-400 font-bold block">Formule LITE</span>
                        <span className="text-[9px] text-slate-500 font-mono">{subscribersLite} abonnés</span>
                      </td>
                      <td className="p-3 text-right font-mono font-semibold">6 000 F CFA</td>
                      <td className="p-3 text-center font-mono text-slate-400">{queriesPerLite} diag. / mois</td>
                      <td className="p-3 text-right font-mono text-slate-400">{costLite.toFixed(0)} F CFA</td>
                      <td className="p-3 text-right text-emerald-400 font-mono font-bold">
                        {subscribersLite > 0 ? "99.83 %" : "99.83 %"}
                      </td>
                      <td className="p-3 text-right text-slate-500 font-mono text-[9px]">
                        &gt; 24 691 requêtes / mois
                      </td>
                    </tr>

                    <tr className="hover:bg-slate-900/40">
                      <td className="p-3">
                        <span className="text-red-400 font-bold block">Formule PREMIUM</span>
                        <span className="text-[9px] text-slate-500 font-mono">{subscribersPremium} abonnés</span>
                      </td>
                      <td className="p-3 text-right font-mono font-semibold">15 000 F CFA</td>
                      <td className="p-3 text-center font-mono text-slate-400">{queriesPerPremium} diag. / mois</td>
                      <td className="p-3 text-right font-mono text-slate-400">{costPremium.toFixed(0)} F CFA</td>
                      <td className="p-3 text-right text-emerald-400 font-mono font-bold">
                        {subscribersPremium > 0 ? "99.73 %" : "99.73 %"}
                      </td>
                      <td className="p-3 text-right text-slate-500 font-mono text-[9px]">
                        &gt; 30 303 requêtes / mois
                      </td>
                    </tr>

                  </tbody>
                </table>
              </div>

              {/* Aggregated totals cockpit */}
              <div className="lg:col-span-4 bg-slate-950 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
                <div className="space-y-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Landmark className="w-3.5 h-3.5 text-emerald-400" />
                    Bilan mensuel estimé
                  </h4>

                  <div className="space-y-3 pt-1">
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-slate-500">Chiffre d'Affaires :</span>
                      <span className="text-sm font-bold text-white font-mono">{totalRevenueCFA.toLocaleString()} FCFA</span>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-slate-500">Coûts de l'API IA :</span>
                      <span className="text-xs font-semibold text-rose-400 font-mono">-{totalCostCFA.toFixed(0)} FCFA</span>
                    </div>
                    
                    <div className="border-t border-slate-800 my-2 pt-2">
                      <span className="text-[10px] text-slate-500 block">Bénéfice Net :</span>
                      <div className="text-xl font-mono font-bold text-emerald-400 mt-1">
                        +{netProfitCFA.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono block">
                        ≈ {(netProfitCFA / 600).toFixed(2)} $ USD / mois
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-850">
                  <div className="flex justify-between text-[11px] font-bold">
                    <span className="text-slate-400">Marge brute globale :</span>
                    <span className="text-emerald-400 font-mono">{profitMarginPercent > 0 ? profitMarginPercent.toFixed(2) : "100.00"}%</span>
                  </div>
                </div>
              </div>

            </div>
          );
        })()}

        {/* Clear takeaway logic for Aubin */}
        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4 text-xs space-y-2">
          <div className="flex items-center gap-2 text-red-500 font-semibold text-[11px]">
            <Calculator className="w-3.5 h-3.5" />
            <span>FONCTIONNEMENT DE VOTRE SEUIL DE RENTABILITÉ :</span>
          </div>
          <div className="text-slate-400 leading-relaxed space-y-1 text-[11px]">
            <p>
              <strong>1. Pas de coûts fixes serveurs :</strong> L'architecture est serverless. Vous ne payez l'API Google Cloud que lorsqu'un utilisateur effectue un diagnostic.
            </p>
            <p>
              <strong>2. Rentable dès la 1ère vente :</strong> Le coût d'un diagnostic standard avec l'IA est de seulement <strong className="text-emerald-400">0.24 F CFA</strong>. Une seule vente de ticket de 500 F CFA couvre l'équivalent de 2 000 requêtes. Votre marge brute est de <strong className="text-emerald-400">99.8%</strong>.
            </p>
            <p>
              <strong>3. Risque d'abus de consommation nul :</strong> Même si un mécanicien utilise l'application de façon intense (80 diagnostics par mois), il ne vous coûte que <strong className="text-rose-400">20 F CFA</strong>, vous laissant un bénéfice massif de <strong className="text-emerald-400">14 980 F CFA</strong> sur son abonnement Premium.
            </p>
          </div>
        </div>
      </div>

      {/* Visual GPS Location Dashboard for Admin */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-red-500 animate-pulse" />
            <h3 className="text-sm font-display font-bold uppercase tracking-wider text-slate-200">
              📍 Suivi Géographique des Interventions Clients (Abidjan & Afrique de l'Ouest)
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Visualisez la position géographique réelle du mécanicien client lors de l'envoi de son diagnostic technique.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left panel: Map Frame */}
          <div className="lg:col-span-8 bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden min-h-[350px] relative shadow-inner">
            {selectedLogForMap && selectedLogForMap.gps ? (
              <iframe
                title="Position GPS du Client"
                width="100%"
                height="100%"
                frameBorder="0"
                style={{ border: 0, minHeight: "350px" }}
                src={`https://maps.google.com/maps?q=${selectedLogForMap.gps.latitude},${selectedLogForMap.gps.longitude}&t=&z=14&ie=UTF8&iwloc=&output=embed`}
                allowFullScreen
              />
            ) : (
              /* Fallback default Map for Abidjan demo */
              <div className="relative w-full h-full min-h-[350px] flex flex-col justify-between">
                <iframe
                  title="Position de Démonstration Abidjan"
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  style={{ border: 0, minHeight: "350px", flex: 1 }}
                  src={`https://maps.google.com/maps?q=5.3244,-4.0128&t=&z=13&ie=UTF8&iwloc=&output=embed`}
                  allowFullScreen
                />
                <div className="absolute top-3 left-3 bg-slate-900/90 border border-slate-850 px-3 py-1.5 rounded-xl text-[10px] text-amber-400 font-mono font-bold uppercase shadow-lg backdrop-blur flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                  <span>Mode Démo : Abidjan Plateau</span>
                </div>
              </div>
            )}
          </div>

          {/* Right panel: Details Card & Dispatcher list */}
          <div className="lg:col-span-4 bg-slate-950/60 border border-slate-850 rounded-2xl p-4 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block font-mono">
                Détails du Client Sélectionné
              </span>

              {selectedLogForMap ? (
                <div className="space-y-3">
                  <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl space-y-2">
                    <span className="text-[9px] bg-red-600/10 border border-red-500/20 text-red-500 font-bold px-2 py-0.5 rounded font-mono uppercase tracking-wider">
                      Diagnostic Récent
                    </span>
                    <strong className="block text-xs text-white leading-snug">
                      {selectedLogForMap.action}
                    </strong>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold mt-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span>{selectedLogForMap.timestamp.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[9px] text-slate-500 font-bold uppercase block font-mono">
                      Zone Géographique :
                    </span>
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse"></span>
                      {getNeighborhoodName(selectedLogForMap.gps?.latitude, selectedLogForMap.gps?.longitude)}
                    </span>
                  </div>

                  {selectedLogForMap.gps && (
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono font-medium pt-1">
                      <div className="bg-slate-900/60 border border-slate-850 px-2.5 py-1.5 rounded-lg">
                        <span className="text-slate-500 block">LATITUDE</span>
                        <span className="text-white font-bold">{selectedLogForMap.gps.latitude.toFixed(6)}</span>
                      </div>
                      <div className="bg-slate-900/60 border border-slate-850 px-2.5 py-1.5 rounded-lg">
                        <span className="text-slate-500 block">LONGITUDE</span>
                        <span className="text-white font-bold">{selectedLogForMap.gps.longitude.toFixed(6)}</span>
                      </div>
                    </div>
                  )}

                  <a
                    href={selectedLogForMap.gps ? `https://www.google.com/maps?q=${selectedLogForMap.gps.latitude},${selectedLogForMap.gps.longitude}` : `https://www.google.com/maps?q=5.3244,-4.0128`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-[10px] uppercase tracking-wider py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    <span>Itinéraire Google Maps</span>
                  </a>
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500 space-y-2">
                  <span className="text-xs font-semibold block">Aucune position active</span>
                  <p className="text-[10px] text-slate-600 leading-normal">
                    Lancez un diagnostic en transmettant votre position ou simulez un appel API pour voir s'afficher la carte interactive.
                  </p>
                </div>
              )}
            </div>

            {/* List of other diagnostics with GPS coordinates */}
            {apiLogs.filter(log => log.gps).length > 1 && (
              <div className="space-y-2 pt-2 border-t border-slate-850">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block font-mono">
                  Autres Interventions Actives ({apiLogs.filter(log => log.gps).length - 1})
                </span>
                <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                  {apiLogs
                    .filter(log => log.gps && log.id !== selectedLogForMap?.id)
                    .map((log) => (
                      <button
                        key={log.id}
                        onClick={() => setSelectedLogForMap(log)}
                        className="w-full text-left p-2 hover:bg-slate-900 border border-transparent hover:border-slate-800 rounded-lg text-[10px] transition flex items-center justify-between gap-2 cursor-pointer group"
                      >
                        <div className="truncate font-medium text-slate-300 group-hover:text-white">
                          📍 {getNeighborhoodName(log.gps?.latitude, log.gps?.longitude).split(" (")[0]}
                          <span className="text-slate-500 text-[9px] block font-mono mt-0.5">{log.action.split(": ")[1] || log.action}</span>
                        </div>
                        <span className="text-[9px] text-slate-500 font-mono shrink-0">
                          {log.timestamp.toLocaleTimeString()}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live Operations Trace Log (Real-time Audit Log) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-4">
          <Database className="w-3.5 h-3.5 text-sky-400" />
          Traceur des requêtes de l'application (Logs en Temps Réel)
        </h3>

        {apiLogs.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-slate-800 rounded-xl bg-slate-950/20">
            <Terminal className="w-8 h-8 text-slate-700 mx-auto mb-2" />
            <p className="text-xs text-slate-500">Aucun appel d'API n'a été enregistré pour le moment.</p>
            <p className="text-[10px] text-slate-600 mt-1">Effectuez un diagnostic ou posez une question dans le chat pour voir apparaître la consommation de tokens.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 font-mono">
                  <th className="p-3">Horodatage</th>
                  <th className="p-3">Opération / Contexte</th>
                  <th className="p-3">Modèle d'IA</th>
                  <th className="p-3 text-right">Tokens In (Prompt)</th>
                  <th className="p-3 text-right">Tokens Out (Réponse)</th>
                  <th className="p-3 text-right">Total Tokens</th>
                  <th className="p-3 text-right text-emerald-400 font-semibold">Coût unitaire</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                {apiLogs.map((log) => (
                  <tr 
                    key={log.id} 
                    className={`hover:bg-slate-900/40 transition-colors ${log.gps ? "cursor-pointer" : ""}`}
                    onClick={() => {
                      if (log.gps) {
                        setSelectedLogForMap(log);
                      }
                    }}
                  >
                    <td className="p-3 text-slate-500 shrink-0">
                      {log.timestamp.toLocaleTimeString()}
                    </td>
                    <td className="p-3 text-slate-200 font-sans font-medium max-w-[220px] truncate">
                      <div className="flex items-center gap-1.5 justify-between">
                        <span className="truncate">{log.action}</span>
                        {log.gps && (
                          <span className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-[9px] font-mono text-emerald-400 font-bold shrink-0">
                            📍 GPS
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-slate-400">
                      {log.model}
                    </td>
                    <td className="p-3 text-right text-slate-500">
                      {log.promptTokens.toLocaleString()}
                    </td>
                    <td className="p-3 text-right text-slate-500">
                      {log.candidatesTokens.toLocaleString()}
                    </td>
                    <td className="p-3 text-right text-slate-300 font-bold">
                      {log.totalTokens.toLocaleString()}
                    </td>
                    <td className="p-3 text-right text-emerald-400 font-semibold">
                      ${log.costUSD.toFixed(5)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* AdManager & Sponsored Products Management */}
      <div>
        <AdAdminDashboard />
      </div>

      {/* Nested API Price Panel specifically as an Admin Resource */}

      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 px-1">
          📊 Grille tarifaire & Estimations budgétaires Google AI Studio
        </h3>
        <APIPricePanel 
          sessionCostUSD={sessionCostUSD} 
          totalTokensUsed={totalTokensUsed} 
          queriesCount={queriesCount} 
        />
      </div>

    </div>
  );
}
