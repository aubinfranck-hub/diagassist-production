import { useState } from "react";
import { Coins, HelpCircle, TrendingUp, Info, Calculator, Sparkles } from "lucide-react";

interface APIPricePanelProps {
  sessionCostUSD: number;
  totalTokensUsed: number;
  queriesCount: number;
}

export default function APIPricePanel({ sessionCostUSD, totalTokensUsed, queriesCount }: APIPricePanelProps) {
  const [monthlyQueries, setMonthlyQueries] = useState<number>(100);

  // Constants for API pricing (per 1,000,000 tokens)
  const FLASH_INPUT_PRICE = 0.075;  // $
  const FLASH_OUTPUT_PRICE = 0.300; // $
  
  const PRO_INPUT_PRICE = 1.25;     // $
  const PRO_OUTPUT_PRICE = 5.00;    // $

  // Average tokens per query in our app
  const AVG_INPUT_TOKENS = 1800;  // text description + moderate base64 image or audio
  const AVG_OUTPUT_TOKENS = 900;  // rich structured diagnosis report

  // Calculated average cost per single query
  const avgCostFlash = (AVG_INPUT_TOKENS * (FLASH_INPUT_PRICE / 1000000)) + (AVG_OUTPUT_TOKENS * (FLASH_OUTPUT_PRICE / 1000000));
  const avgCostPro = (AVG_INPUT_TOKENS * (PRO_INPUT_PRICE / 1000000)) + (AVG_OUTPUT_TOKENS * (PRO_OUTPUT_PRICE / 1000000));

  // Projected monthly costs
  const monthlyCostFlash = monthlyQueries * avgCostFlash;
  const monthlyCostPro = monthlyQueries * avgCostPro;
  const savings = monthlyCostPro - monthlyCostFlash;

  // Conversion rate (approx 1 USD = 0.92 EUR)
  const USD_TO_EUR = 0.92;

  return (
    <div id="api-pricing-panel" className="premium-glass-card border border-white/[0.05] rounded-3xl p-6 text-slate-100 animate-fade-in shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-80 h-80 bg-red-600/[0.02] rounded-full blur-3xl pointer-events-none"></div>

      <div className="flex items-center gap-3.5 mb-6 relative">
        <div className="p-3 bg-red-600/10 text-red-500 rounded-xl border border-red-500/10 shadow-inner">
          <Coins className="w-5 h-5 text-red-500" />
        </div>
        <div>
          <h2 className="text-lg font-display font-black tracking-tight text-white uppercase">Tarification & Coût des API de Diagnostic</h2>
          <p className="text-[11px] text-slate-400 mt-0.5">Combien coûte l'analyse d'une panne avec l'IA ?</p>
        </div>
      </div>

      {/* Actual Live Cost Tracker */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 relative">
        <div className="bg-slate-950/60 border border-white/[0.05] rounded-2xl p-4 flex flex-col justify-between">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Requêtes de la Session</span>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-mono font-black text-red-500">{queriesCount}</span>
            <span className="text-xs text-slate-500">analyses</span>
          </div>
          <p className="text-[9px] text-slate-500 mt-1">Nombre d'appels à l'API effectués</p>
        </div>

        <div className="bg-slate-950/60 border border-white/[0.05] rounded-2xl p-4 flex flex-col justify-between">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Tokens Consommés</span>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-mono font-black text-white">
              {totalTokensUsed.toLocaleString()}
            </span>
            <span className="text-xs text-slate-500 font-mono">tkn</span>
          </div>
          <p className="text-[9px] text-slate-500 mt-1">Volume de données textuelles & multimédia traitées</p>
        </div>

        <div className="bg-slate-950/60 border-red-500/20 bg-gradient-to-br from-slate-950/80 to-red-950/10 border rounded-2xl p-4 flex flex-col justify-between">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1 block">
            Coût Cumulé Estimé <Sparkles className="w-3 h-3 text-red-500 animate-pulse" />
          </span>
          <div className="mt-2">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-mono font-black text-emerald-400">${sessionCostUSD.toFixed(5)}</span>
              <span className="text-xs text-slate-500">USD</span>
            </div>
            <div className="text-[11px] text-emerald-500/80 font-mono font-bold">
              ≈ {(sessionCostUSD * USD_TO_EUR).toFixed(5)} €
            </div>
          </div>
          <p className="text-[9px] text-slate-500 mt-1">Calculé en temps réel selon votre usage exact</p>
        </div>
      </div>

      {/* Formal Pricing Grid */}
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-2">
        <Info className="w-4 h-4 text-red-500" /> Grille tarifaire officielle de Google AI Studio
      </h3>
      <div className="overflow-x-auto rounded-2xl border border-white/[0.05] mb-8 relative">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-950/80 text-slate-400 border-b border-white/[0.05]">
              <th className="p-3 font-bold uppercase tracking-wider text-[10px]">Modèle de langage</th>
              <th className="p-3 font-bold uppercase tracking-wider text-[10px]">Tokens d'Entrée (Prompt)</th>
              <th className="p-3 font-bold uppercase tracking-wider text-[10px]">Tokens de Sortie (Réponse)</th>
              <th className="p-3 font-bold uppercase tracking-wider text-[10px] text-right">Coût Diagnostic Moyen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05] text-slate-300">
            <tr className="hover:bg-slate-900/50 bg-red-500/[0.02]">
              <td className="p-3">
                <div className="font-bold text-slate-200">Modèle IA Flash (Éco)</div>
                <div className="text-[10px] text-emerald-500 font-semibold">Par défaut (Super rapide & Éco)</div>
              </td>
              <td className="p-3 font-mono">0,075 $ / 1M tkn</td>
              <td className="p-3 font-mono">0,30 $ / 1M tkn</td>
              <td className="p-3 font-mono text-emerald-400 text-right font-bold">
                ≈ 0,00040 $ <span className="text-slate-500 font-normal">({(0.00040 * USD_TO_EUR).toFixed(5)} €)</span>
              </td>
            </tr>
            <tr className="hover:bg-slate-900/50">
              <td className="p-3">
                <div className="font-bold text-slate-400">Modèle IA Pro (Expert)</div>
                <div className="text-[10px] text-slate-500">Pour raisonnements ultra-complexes</div>
              </td>
              <td className="p-3 font-mono text-slate-400">1,25 $ / 1M tkn</td>
              <td className="p-3 font-mono text-slate-400">5,00 $ / 1M tkn</td>
              <td className="p-3 font-mono text-slate-400 text-right">
                ≈ 0,00675 $ <span className="text-slate-600 font-normal">({(0.00675 * USD_TO_EUR).toFixed(5)} €)</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Breakdown block specifically addressing "10 min 130 f" or voice conversation costs */}
      <div className="bg-slate-950/60 border border-white/[0.05] rounded-2xl p-5 mb-8 space-y-4 relative">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-red-500" /> Coût d'une discussion de 10 minutes (Comparatif)
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Pour rassurer vos clients et optimiser votre budget, voici ce que coûte réellement 
          <strong> 10 minutes de conversation continue</strong> selon la technologie vocale choisie :
        </p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs pt-1">
          <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl space-y-1">
            <span className="font-bold text-emerald-400 block">1. Chat Écrit Flash</span>
            <div className="text-sm font-mono font-bold text-white">~ 1,2 F CFA</div>
            <p className="text-[10px] text-slate-500">Gemini 3.5 Flash en texte uniquement (Coût quasi-nul).</p>
          </div>

          <div className="p-3 bg-red-600/[0.03] border border-red-500/10 rounded-xl space-y-1">
            <span className="font-bold text-red-400 block">2. Appel Vocal Live</span>
            <div className="text-sm font-mono font-bold text-white">~ 30 F CFA</div>
            <p className="text-[10px] text-slate-500">Gemini 3.1 Flash Live (audio bidirectionnel en temps réel).</p>
          </div>

          <div className="p-3 bg-slate-900 border border-white/[0.05] rounded-xl space-y-1">
            <span className="font-bold text-slate-400 block">3. Voix Standard</span>
            <div className="text-sm font-mono font-bold text-emerald-400">0 F CFA (GRATUIT)</div>
            <p className="text-[10px] text-slate-500">Synthèse vocale locale du téléphone ou Google Neural2/Wavenet.</p>
          </div>

          <div className="p-3 bg-rose-950/10 border border-rose-500/10 rounded-xl space-y-1">
            <span className="font-bold text-rose-400 block">4. Voix ElevenLabs</span>
            <div className="text-sm font-mono font-bold text-rose-400">~ 1 350 F CFA</div>
            <p className="text-[10px] text-slate-500">Voix ultra-réaliste premium (facturée au caractère par ElevenLabs).</p>
          </div>
        </div>

        <div className="p-3 bg-slate-900/50 border border-white/[0.05] rounded-xl text-[11px] text-slate-400 leading-relaxed">
          💡 <strong>Recommandation pour Aubin :</strong> Pour garder des coûts d'API extrêmement bas tout en offrant une expérience incroyable, nous conseillons à vos utilisateurs d'utiliser les <strong>Voix Standard Google (Neural2/Wavenet)</strong> ou la voix <strong>Gemini Flash Live</strong>. Ces dernières offrent un réalisme professionnel parfait pour seulement quelques centimes de francs CFA par heure, évitant ainsi le surcoût d'ElevenLabs.
        </div>
      </div>

      {/* Interactive Monthly Simulator */}
      <div className="bg-slate-950/40 border border-white/[0.05] rounded-2xl p-5 relative">
        <h3 className="text-sm font-display font-black uppercase text-white mb-4 flex items-center gap-2">
          <Calculator className="w-4 h-4 text-red-500" /> Simulateur de budget mensuel
        </h3>

        <div className="mb-5">
          <div className="flex justify-between text-xs text-slate-400 mb-2">
            <span>Diagnostics prévus par mois :</span>
            <span className="font-mono text-red-500 font-black text-sm">{monthlyQueries} pannes/mois</span>
          </div>
          <input
            type="range"
            min="10"
            max="5000"
            step="10"
            value={monthlyQueries}
            onChange={(e) => setMonthlyQueries(parseInt(e.target.value))}
            className="w-full accent-red-600 h-2 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-600 font-mono mt-1">
            <span>10</span>
            <span>1 000</span>
            <span>2 500</span>
            <span>5 000</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3 bg-slate-900 border border-white/[0.05] rounded-xl">
            <div className="text-[10px] text-slate-400 font-bold uppercase">Budget IA Flash (Éco)</div>
            <div className="text-xl font-mono font-black text-emerald-400 mt-1">
              {(monthlyCostFlash * USD_TO_EUR).toFixed(2)} € <span className="text-xs font-normal text-slate-500">/ mois</span>
            </div>
            <div className="text-[10px] text-slate-500">({monthlyCostFlash.toFixed(2)} $ USD)</div>
          </div>

          <div className="p-3 bg-slate-900 border border-white/[0.05] rounded-xl">
            <div className="text-[10px] text-slate-400 font-bold uppercase">Budget IA Pro (Expert)</div>
            <div className="text-xl font-mono font-black text-slate-400 mt-1">
              {(monthlyCostPro * USD_TO_EUR).toFixed(2)} € <span className="text-xs font-normal text-slate-500">/ mois</span>
            </div>
            <div className="text-[10px] text-slate-500">({monthlyCostPro.toFixed(2)} $ USD)</div>
          </div>
        </div>

        {/* Savings alert banner */}
        <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-emerald-400">
            <TrendingUp className="w-4 h-4" />
            <span>Économies réalisées avec <strong>l'IA Flash</strong> :</span>
          </div>
          <span className="font-mono font-bold text-emerald-400">
            + {(savings * USD_TO_EUR).toFixed(2)} €
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2 text-[10px] text-slate-500">
        <HelpCircle className="w-3.5 h-3.5 text-slate-600 mt-0.5 shrink-0" />
        <p>
          Note : Les coûts ci-dessus sont calculés sur la base des tarifs d'infrastructure IA en vigueur (Juillet 2026). 
          Le modèle IA Flash est environ 16x moins coûteux que le modèle IA Pro, tout en offrant d'excellentes performances multimodales 
          pour l'écoute des bruits moteurs et la reconnaissance de voyants ou rapports de valises de diagnostic OBD.
        </p>
      </div>
    </div>
  );
}
