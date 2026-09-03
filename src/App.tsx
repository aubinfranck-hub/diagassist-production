import { useState, useEffect } from "react";
import { AnimatePresence } from "motion/react";
import { 
  Sparkles, ShieldCheck, AlertTriangle, Coins, HelpCircle, FileText, 
  Settings, MessageSquare, Gauge, Info, ChevronRight, RefreshCw, Layers, Lock, Database, Radio, Wrench,
  Sun, Moon, Monitor
} from "lucide-react";

import DiagnosticForm from "./components/DiagnosticForm";
import DiagnosisResultView from "./components/DiagnosisResultView";
import DiagnosticChat from "./components/DiagnosticChat";
import APIPricePanel from "./components/APIPricePanel";
import SubscriptionPanel from "./components/SubscriptionPanel";
import BannerDisplay from "./components/BannerDisplay";
import SplashScreen from "./components/SplashScreen";
import IntegratedVoiceController from "./components/IntegratedVoiceController";
import PhoneAuth from "./components/PhoneAuth";
import VisualRepairAssistant from "./components/VisualRepairAssistant";
import LiveMediaAssistant from "./components/LiveMediaAssistant";
import DiagAssistLiveScreen from "./components/DiagAssistLiveScreen";
import AutoQuestioningLoop from "./components/AutoQuestioningLoop";

import { Diagnosis, ApiUsage, ChatMessage, SubscriptionPlan } from "./types";

const demoDiagnosis: Diagnosis = {
  brandModelInfo: "Ford C-Max 2018 (2.0 TDCi)",
  dtcCodesDetected: [
    { code: "C112A:77-8B", description: "Actionneur de frein de stationnement électrique désengagé" },
    { code: "C2006:07-8B", description: "Moteur de l'actionneur de frein de stationnement gauche" }
  ],
  severity: "Critique",
  severityDescription: "Le frein de stationnement électrique ne s'enclenche pas. Risque d'accident si le véhicule est garé en pente sans vitesse enclenchée.",
  probableCauses: [
    "Câblage de l'actionneur gauche endommagé ou corrodé",
    "Moteur électrique de l'actionneur gauche HS (engrenage en plastique cassé)",
    "Étrier de frein arrière gauche grippé"
  ],
  immediateRecommendations: [
    "Enclencher une vitesse (1ère ou marche arrière) lors du stationnement pour sécuriser le véhicule",
    "Éviter de stationner sur des pentes raides",
    "Inspecter visuellement la prise électrique de l'actionneur arrière gauche"
  ],
  repairGuideSteps: [
    {
      stepNumber: 1,
      title: "Vérification électrique du connecteur",
      description: "Mettre le véhicule sur chandelles à l'arrière. Débrancher la prise électrique de l'actionneur gauche. Inspecter les broches pour détecter des traces d'oxydation ou d'humidité. Nettoyer avec un nettoyant contact électronique.",
      estimatedTime: "20 min"
    },
    {
      stepNumber: 2,
      title: "Test d'alimentation du moteur d'actionneur",
      description: "À l'aide d'un multimètre, mesurer la tension aux bornes du connecteur lors de l'activation du bouton de frein à main. Vous devriez obtenir une impulsion de 12V.",
      estimatedTime: "15 min"
    },
    {
      stepNumber: 3,
      title: "Démontage et inspection de l'actionneur",
      description: "Dévisser les deux vis Torx T30 de l'actionneur électrique de l'étrier. Déposer l'actionneur. Inspecter l'engrenage interne. Si les dents en plastique sont usées ou cassées (bruit de patinage), remplacer l'actionneur.",
      estimatedTime: "30 min"
    }
  ],
  estimatedCosts: {
    partsMin: 29500,
    partsMax: 65000,
    laborMin: 15000,
    laborMax: 30000,
    currency: "F CFA"
  },
  explanationText: "Le système de frein de stationnement électrique (EPB) détecte une absence de résistance ou un défaut électrique sur l'actionneur arrière gauche. Les engrenages internes en plastique de ces boîtiers ont tendance à s'user et à patiner avec le temps, ce qui génère un bruit caractéristique et empêche le serrage du frein."
};

const generalDiagnosis: Diagnosis = {
  brandModelInfo: "Diagnostic Général de l'Atelier",
  dtcCodesDetected: [],
  severity: "Moyen",
  severityDescription: "Assistance technique globale pour l'atelier.",
  probableCauses: ["Posez vos questions de mécanique générale directement à DiagAssist."],
  immediateRecommendations: ["Utilisez le micro ou le clavier pour démarrer."],
  repairGuideSteps: [],
  estimatedCosts: {
    partsMin: 0,
    partsMax: 0,
    laborMin: 0,
    laborMax: 0,
    currency: "F CFA"
  },
  explanationText: "Mode conversationnel libre actif. Je suis à votre service pour vous guider sur n'importe quel code défaut ou symptôme de panne mécanique."
};

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

export default function App() {
  // Splash screen state
  const [showSplash, setShowSplash] = useState(true);

  // Connectivity monitoring state
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial check
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Theme State: "system" | "dark" | "light"
  const [theme, setTheme] = useState<"system" | "dark" | "light">(() => {
    return (localStorage.getItem("theme_preference") as "system" | "dark" | "light") || "system";
  });
  const [effectiveTheme, setEffectiveTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const applyTheme = () => {
      let active: "dark" | "light";
      if (theme === "system") {
        active = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      } else {
        active = theme;
      }
      setEffectiveTheme(active);
      if (active === "light") {
        document.documentElement.classList.add("light");
        document.documentElement.classList.remove("dark");
      } else {
        document.documentElement.classList.add("dark");
        document.documentElement.classList.remove("light");
      }
    };

    applyTheme();

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (theme === "system") {
        applyTheme();
      }
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, [theme]);

  const handleThemeChange = (newTheme: "system" | "dark" | "light") => {
    setTheme(newTheme);
    localStorage.setItem("theme_preference", newTheme);
  };

  // Firebase Phone Auth State
  const [loggedInUser, setLoggedInUser] = useState<string | null>(() => {
    return localStorage.getItem("auth_user_phone");
  });

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

  // Navigation tabs
  const [activeTab, setActiveTab] = useState<"diagnose" | "live" | "prices" | "admin">("diagnose");
  const [activeResultTab, setActiveResultTab] = useState<"report" | "chat" | "visual">("report");
  const [showMobileUserMenu, setShowMobileUserMenu] = useState(false);

  // Shared state to coordinate real-time live vocal session across components to prevent audio conflicts
  const [isLiveActive, setIsLiveActive] = useState(false);

  // Subscription plan states (Free 24h trial by default, linked to user session)
  const [currentPlan, setCurrentPlan] = useState<SubscriptionPlan>(() => {
    const user = localStorage.getItem("auth_user_phone");
    if (user) {
      return (localStorage.getItem(`plan_${user}`) as SubscriptionPlan) || "free_trial";
    }
    return "free_trial";
  });

  const [remainingTimeText, setRemainingTimeText] = useState<string>("");
  // Échéance réelle du forfait, fournie par le serveur (source de vérité — voir /api/user/status)
  const [planExpiresAt, setPlanExpiresAt] = useState<number | null>(null);
  // Compte administrateur ou non — l'onglet Admin n'est visible que si true (renvoyé par le serveur)
  const [isAdminAccount, setIsAdminAccount] = useState(false);

  // Plan changer helper that records activation time (usage interne : expiration du plan, etc.)
  const handlePlanChange = async (plan: SubscriptionPlan) => {
    setCurrentPlan(plan);
    if (loggedInUser) {
      localStorage.setItem(`plan_${loggedInUser}`, plan);
      localStorage.setItem(`plan_activation_time_${loggedInUser}`, Date.now().toString());
    }
  };

  // Envoie une demande d'activation de forfait après paiement Wave.
  // L'activation réelle est faite manuellement côté serveur (admin) après vérification du paiement,
  // et sera reflétée au prochain rafraîchissement du statut de session (/api/user/status).
  const handleRequestActivation = async (plan: SubscriptionPlan, amount: number) => {
    const token = localStorage.getItem("auth_session_token");
    if (!token) return;
    try {
      await fetch("/api/user/request-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ plan, amount })
      });
    } catch (err) {
      console.error("Erreur lors de l'envoi de la demande d'activation:", err);
    }
  };

  // Load and Save the subscription plan dynamically when user changes
  useEffect(() => {
    if (loggedInUser) {
      const savedPlan = localStorage.getItem(`plan_${loggedInUser}`);
      if (savedPlan) {
        setCurrentPlan(savedPlan as SubscriptionPlan);
      } else {
        setCurrentPlan("free_trial");
        localStorage.setItem(`plan_${loggedInUser}`, "free_trial");
        localStorage.setItem(`plan_activation_time_${loggedInUser}`, Date.now().toString());
      }
    }
  }, [loggedInUser]);

  useEffect(() => {
    if (loggedInUser && currentPlan) {
      localStorage.setItem(`plan_${loggedInUser}`, currentPlan);
    }
  }, [currentPlan, loggedInUser]);

  // Load and Save user status from server as source of truth.
  // BUG CORRIGÉ : avant, ce statut n'était récupéré qu'une seule fois à la connexion.
  // Résultat : après une activation manuelle de forfait par l'admin, l'utilisateur déjà connecté
  // ne voyait jamais son nouveau forfait tant qu'il ne se déconnectait/reconnectait pas.
  // Désormais on resynchronise périodiquement pendant toute la session.
  useEffect(() => {
    if (!loggedInUser) return;

    const syncStatus = () => {
      const token = localStorage.getItem("auth_session_token");
      if (!token) return;
      fetch("/api/user/status", {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      })
      .then(res => {
        if (res.status === 401) {
          // Session invalid, log out
          setLoggedInUser(null);
          localStorage.removeItem("auth_user_phone");
          localStorage.removeItem("auth_session_token");
          throw new Error("Session invalide ou expirée.");
        }
        return res.json();
      })
      .then(data => {
        if (data && data.success) {
          setCurrentPlan(data.plan);
          localStorage.setItem(`plan_${loggedInUser}`, data.plan);
          setPlanExpiresAt(typeof data.expiresAt === "number" ? data.expiresAt : null);
          setIsAdminAccount(Boolean(data.isAdmin));
        }
      })
      .catch(err => {
        console.warn("Échec de synchronisation du statut avec le serveur:", err.message);
      });
    };

    syncStatus();
    const statusInterval = setInterval(syncStatus, 60 * 1000); // resynchronise toutes les 60s
    return () => clearInterval(statusInterval);
  }, [loggedInUser]);

  // Signale la position GPS au serveur (avec le consentement du navigateur) pour le tableau de
  // bord admin. Échoue silencieusement si l'utilisateur refuse ou si la géolocalisation est indisponible.
  useEffect(() => {
    if (!loggedInUser || !navigator.geolocation) return;
    const token = localStorage.getItem("auth_session_token");
    if (!token) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        fetch("/api/user/report-location", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          }),
        }).catch(() => {});
      },
      () => {
        // L'utilisateur a refusé ou la géolocalisation a échoué — on n'insiste pas.
      },
      { timeout: 15000, enableHighAccuracy: true, maximumAge: 60000 }
    );
  }, [loggedInUser]);

  // Affichage du compte à rebours du forfait, basé sur l'échéance RÉELLE renvoyée par le serveur.
  // BUG CORRIGÉ : avant, ce minuteur se basait sur une horloge stockée en localStorage, propre à
  // chaque navigateur/appareil — elle pouvait être remise à zéro en vidant le cache, et surtout
  // le client lui-même décidait quand rétrograder le forfait ("free_expired"), ce qui pouvait
  // désynchroniser l'affichage de la réalité côté serveur. Le serveur est désormais seul juge.
  useEffect(() => {
    if (!loggedInUser) {
      setRemainingTimeText("");
      return;
    }

    const tick = () => {
      if (currentPlan === "free_expired" || !planExpiresAt) {
        setRemainingTimeText(currentPlan === "free_expired" ? "Expiré" : "");
        return;
      }

      const remainingMs = planExpiresAt - Date.now();

      if (remainingMs <= 0) {
        setRemainingTimeText("Expiré");
      } else {
        const seconds = Math.floor((remainingMs / 1000) % 60);
        const minutes = Math.floor((remainingMs / (1000 * 60)) % 60);
        const hours = Math.floor((remainingMs / (1000 * 60 * 60)) % 24);
        const days = Math.floor(remainingMs / (1000 * 60 * 60 * 24));

        let text = "";
        if (days > 0) {
          text += `${days}j `;
        }
        text += `${hours.toString().padStart(2, "0")}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
        setRemainingTimeText(text);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [loggedInUser, currentPlan, planExpiresAt]);

  // Diagnosis states
  const [isLoading, setIsLoading] = useState(false);
  const [diagnosisResult, setDiagnosisResult] = useState<Diagnosis | null>(null);
  const [apiUsage, setApiUsage] = useState<ApiUsage | null>(null);

  // Chat follow-up states
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isSendingChat, setIsSendingChat] = useState(false);

  // Session stats for live billing
  const [sessionCostUSD, setSessionCostUSD] = useState<number>(0);
  const [totalTokensUsed, setTotalTokensUsed] = useState<number>(0);
  const [queriesCount, setQueriesCount] = useState<number>(0);

  // Live Audit Logs for Administrator Panel
  const [apiLogs, setApiLogs] = useState<AdminLogEntry[]>(() => {
    const saved = localStorage.getItem("admin_api_logs");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.map((log: any) => ({
          ...log,
          timestamp: new Date(log.timestamp)
        }));
      } catch (e) {
        console.error("Error loading admin api logs:", e);
      }
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem("admin_api_logs", JSON.stringify(apiLogs));
  }, [apiLogs]);

  const USD_TO_EUR = 0.92;

  // Trigger vehicle diagnosis request
  const handleDiagnose = async (formData: {
    vehicleBrand: string;
    vehicleModel: string;
    vehicleYear: string;
    vehicleEngine: string;
    textDescription: string;
    file: string | null;
    mimeType: string | null;
    gps?: { latitude: number; longitude: number; accuracy?: number } | null;
  }) => {
    if (!navigator.onLine) {
      alert("Erreur de connexion : Vous êtes actuellement hors ligne. Veuillez rétablir votre connexion internet (Orange, MTN, Moov) avant de lancer un diagnostic.");
      return;
    }

    if (currentPlan === "free_expired") {
      alert("Votre essai gratuit de 24h est expiré ! Veuillez souscrire à une formule (Lite ou Premium) ou recharger un pass 24h à l'usage de 500 F CFA avec Wave dans l'onglet 'Abonnements & Tarifs' pour pouvoir effectuer des diagnostics.");
      return;
    }

    setIsLoading(true);
    setDiagnosisResult(null);
    setApiUsage(null);
    setChatHistory([]); // Clear prior chat logs for a new diagnosis

    try {
      const response = await fetch("/api/diagnose", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("auth_session_token")}`
        },
        body: JSON.stringify(formData),
      });

      if (response.status === 401) {
        const data = await response.json().catch(() => ({}));
        alert(data.message || "Session invalide ou expirée. Veuillez vous reconnecter.");
        setLoggedInUser(null);
        localStorage.removeItem("auth_user_phone");
        localStorage.removeItem("auth_session_token");
        return;
      }

      if (response.status === 403) {
        const data = await response.json().catch(() => ({}));
        alert(data.message || "Quota atteint pour votre forfait actuel.");
        setActiveTab("prices");
        return;
      }

      const data = await response.json();

      if (data.success) {
        setDiagnosisResult(data.diagnosis);
        setApiUsage(data.apiUsage);
        setActiveResultTab("report");

        // Auto-redirect to Vocal Live page and start live voice session
        setActiveTab("live");
        setIsLiveActive(true);

        // Pre-populate chatHistory with the required starter message
        const initialMsg = {
          id: "welcome-msg",
          role: "model" as const,
          text: "Bonjour, ici DiagAssist. Je suis là pour vous aider à réparer votre véhicule. Avec quel équipement de diagnostic (scanner) travaillez-vous actuellement afin que je puisse vous guider précisément dans les tests d'action ?",
          timestamp: new Date()
        };
        setChatHistory([initialMsg]);

        // Increment session billing trackers
        setSessionCostUSD((prev) => prev + data.apiUsage.estimatedCostUSD);
        setTotalTokensUsed((prev) => prev + data.apiUsage.totalTokens);
        setQueriesCount((prev) => prev + 1);

        // Record entry to admin live logs
        setApiLogs((prev) => [
          {
            id: Math.random().toString(36).substring(7),
            timestamp: new Date(),
            action: `Diagnostic Panne: ${formData.vehicleBrand} ${formData.vehicleModel}`,
            model: data.apiUsage.modelUsed || "Gemini 3.5 Flash",
            promptTokens: data.apiUsage.promptTokens,
            candidatesTokens: data.apiUsage.candidatesTokens,
            totalTokens: data.apiUsage.totalTokens,
            costUSD: data.apiUsage.estimatedCostUSD,
            gps: formData.gps || null,
          },
          ...prev,
        ]);
      } else {
        alert(data.message || "Impossible d'effectuer le diagnostic avec l'IA.");
      }
    } catch (err: any) {
      console.error("Erreur d'appel API de diagnostic:", err);
      alert("Une erreur technique est survenue. Assurez-vous que le serveur tourne correctement.");
    } finally {
      setIsLoading(false);
    }
  };

  // Trigger follow-up chat message
  const handleSendChatMessage = async (text: string, file?: string, mimeType?: string, fileName?: string) => {
    if (isSendingChat) return;

    if (!navigator.onLine) {
      alert("Erreur de connexion : Vous êtes actuellement hors ligne. Veuillez rétablir votre connexion internet pour pouvoir envoyer un message.");
      return;
    }

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      text,
      timestamp: new Date(),
      file,
      mimeType,
      fileName,
    };

    // Optimistically add user message to thread
    setChatHistory((prev) => [...prev, userMsg]);
    setIsSendingChat(true);

    try {
      // Map history to the compact payload format expected by backend, preserving files
      const compactHistory = chatHistory.map((h) => ({
        role: h.role,
        text: h.text,
        file: h.file,
        mimeType: h.mimeType,
        fileName: h.fileName,
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("auth_session_token")}`
        },
        body: JSON.stringify({
          message: text,
          history: compactHistory,
          diagnosticContext: diagnosisResult || generalDiagnosis,
          file,
          mimeType,
        }),
      });

      if (response.status === 401) {
        const data = await response.json().catch(() => ({}));
        alert(data.message || "Session invalide ou expirée. Veuillez vous reconnecter.");
        setLoggedInUser(null);
        localStorage.removeItem("auth_user_phone");
        localStorage.removeItem("auth_session_token");
        return;
      }

      if (response.status === 403) {
        const data = await response.json().catch(() => ({}));
        alert(data.message || "Quota atteint pour votre forfait actuel.");
        setActiveTab("prices");
        return;
      }

      const data = await response.json();

      if (data.success) {
        const modelMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "model",
          text: data.reply,
          timestamp: new Date(),
          apiUsage: data.apiUsage,
        };

        setChatHistory((prev) => [...prev, modelMsg]);

        // Increment session billing trackers
        setSessionCostUSD((prev) => prev + data.apiUsage.estimatedCostUSD);
        setTotalTokensUsed((prev) => prev + data.apiUsage.totalTokens);
        setQueriesCount((prev) => prev + 1);

        // Record entry to admin live logs
        setApiLogs((prev) => [
          {
            id: Math.random().toString(36).substring(7),
            timestamp: new Date(),
            action: `Discussion Chat: "${text.length > 25 ? text.substring(0, 25) + "..." : text}"`,
            model: data.apiUsage.modelUsed || "Gemini 3.5 Flash",
            promptTokens: data.apiUsage.promptTokens,
            candidatesTokens: data.apiUsage.candidatesTokens,
            totalTokens: data.apiUsage.totalTokens,
            costUSD: data.apiUsage.estimatedCostUSD,
          },
          ...prev,
        ]);
      } else {
        alert(data.message || "Impossible d'obtenir une réponse de l'assistant.");
      }
    } catch (err) {
      console.error("Erreur d'appel API Chat:", err);
      alert("Erreur de connexion lors de la discussion.");
    } finally {
      setIsSendingChat(false);
    }
  };

  // Reset complete workspace session
  const resetWorkspace = () => {
    setDiagnosisResult(null);
    setApiUsage(null);
    setChatHistory([]);
  };

  const handleClearStats = () => {
    setSessionCostUSD(0);
    setTotalTokensUsed(0);
    setQueriesCount(0);
    setApiLogs([]);
    alert("Tous les compteurs de tokens, les coûts d'API et les logs ont été réinitialisés avec succès !");
  };

  const handleAddMockLog = () => {
    const mockActions = [
      "Diagnostic Panne: Peugeot 208 (2018) - Code OBD P0234",
      "Analyse Audio: Clac-clac moteur métallique à froid",
      "Analyse Photo: Voyant FAP allumé sur tableau de bord",
      "Recherche Fiche Haynes Pro: Couples de serrage injecteurs",
      "Discussion Chat: 'Où se situe le capteur de pression d'admission ?'"
    ];
    const randomAction = mockActions[Math.floor(Math.random() * mockActions.length)];
    const mockIn = Math.floor(Math.random() * 1200) + 800;
    const mockOut = Math.floor(Math.random() * 600) + 400;
    const total = mockIn + mockOut;
    // Gemini 3.5 Flash prices
    const cost = (mockIn * (0.075 / 1000000)) + (mockOut * (0.30 / 1000000));

    // Abidjan coordinates (Plateau, Cocody, Treichville, Marcory, Yopougon)
    const abidjanLocations = [
      { latitude: 5.3244, longitude: -4.0128 },
      { latitude: 5.3484, longitude: -3.9892 },
      { latitude: 5.3019, longitude: -4.0189 },
      { latitude: 5.3094, longitude: -3.9922 },
      { latitude: 5.3411, longitude: -4.0722 }
    ];
    const randomGps = abidjanLocations[Math.floor(Math.random() * abidjanLocations.length)];

    setQueriesCount(prev => prev + 1);
    setTotalTokensUsed(prev => prev + total);
    setSessionCostUSD(prev => prev + cost);

    setApiLogs(prev => [
      {
        id: Math.random().toString(36).substring(7),
        timestamp: new Date(),
        action: randomAction,
        model: "Gemini 3.5 Flash",
        promptTokens: mockIn,
        candidatesTokens: mockOut,
        totalTokens: total,
        costUSD: cost,
        gps: randomGps
      },
      ...prev
    ]);
  };

  return (
    <>
      <AnimatePresence>
        {showSplash && (
          <SplashScreen onComplete={() => setShowSplash(false)} />
        )}
      </AnimatePresence>

      {!isOnline && (
        <div className="bg-red-600 text-white px-6 py-4 flex items-center justify-between gap-4 sticky top-0 z-[100] shadow-xl border-b border-red-700 font-bold text-center justify-center flex-wrap md:flex-nowrap">
          <div className="flex items-center gap-3 justify-center w-full md:w-auto">
            <span className="p-1.5 bg-white/20 rounded-lg shrink-0">
              <AlertTriangle className="w-5 h-5 text-white animate-pulse" />
            </span>
            <span className="text-xs md:text-sm text-left">
              Attention : Connexion réseau perdue. Certains diagnostics en temps réel, analyses audio/vidéo et l'assistant de chat intelligent ne fonctionneront pas hors ligne.
            </span>
          </div>
          <button 
            onClick={() => setIsOnline(navigator.onLine)} 
            className="bg-white/20 hover:bg-white/30 text-white text-[10px] md:text-xs px-3.5 py-2 rounded-xl font-black uppercase tracking-wider transition cursor-pointer flex items-center gap-1.5 shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5 animate-spin-slow" />
            Réessayer
          </button>
        </div>
      )}

      {!showSplash && !loggedInUser ? (
        <PhoneAuth
          onLoginSuccess={(phone) => {
            setLoggedInUser(phone);
            localStorage.setItem("auth_user_phone", phone);
          }}
        />
      ) : (
        <div className="min-h-screen bg-slate-950 font-sans text-slate-100 workshop-grid pb-24 lg:pb-0 lg:flex lg:items-stretch">
          
          {/* DESKTOP SIDEBAR - Figma Pro styling */}
          <aside className="hidden lg:flex lg:flex-col lg:w-80 lg:shrink-0 bg-slate-900/95 border-r border-white/[0.08] min-h-screen sticky top-0 p-6 z-40 backdrop-blur-md justify-between select-none">
            
            <div className="space-y-8">
              {/* Sleek Logo Brand Header */}
              <div className="flex items-center gap-3.5">
                <div className="relative shrink-0">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl text-white font-bold font-display shadow-lg border border-white/10 relative overflow-hidden group scintillant-badge">
                    <div className="absolute inset-0 bg-white/15 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    ⚙️
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-base font-display font-black uppercase tracking-tight text-white leading-none">
                      DiagAssist
                    </span>
                    <span className="scintillant-badge text-[8px] font-black px-1.5 py-0.5 rounded uppercase font-mono tracking-wider border">
                      PRO
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1 font-medium tracking-wide">
                    Copilote de Diagnostic Auto IA
                  </p>
                </div>
              </div>

              {/* Vertical Tab Navigation */}
              <nav className="space-y-2">
                <button
                  onClick={() => {
                    setActiveTab("diagnose");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition duration-150 cursor-pointer ${
                    activeTab === "diagnose"
                      ? "bg-red-600 text-white shadow-lg shadow-red-600/25 border border-white/10"
                      : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Gauge className="w-4.5 h-4.5" />
                    <span>Atelier</span>
                  </div>
                  {activeTab === "diagnose" && <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                </button>

                <button
                  onClick={() => {
                    setActiveTab("live");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition duration-150 cursor-pointer relative ${
                    activeTab === "live"
                      ? isLiveActive
                        ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/25 border border-white/10"
                        : "bg-red-600 text-white shadow-lg shadow-red-600/25 border border-white/10"
                      : isLiveActive
                        ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20"
                        : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Radio className={`w-4.5 h-4.5 ${isLiveActive ? "text-emerald-400 animate-pulse" : activeTab === "live" ? "text-white animate-pulse" : "text-emerald-400 animate-pulse"}`} />
                    <span className={isLiveActive ? "text-emerald-300 font-black animate-pulse" : ""}>Vocal Live</span>
                  </div>
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab("prices");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition duration-150 cursor-pointer ${
                    activeTab === "prices"
                      ? "bg-red-600 text-white shadow-lg shadow-red-600/25 border border-white/10"
                      : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Sparkles className="w-4.5 h-4.5" />
                    <span>Abonnements</span>
                  </div>
                  {activeTab === "prices" && <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                </button>
              </nav>
            </div>

            {/* Bottom User Area */}
            <div className="space-y-4 pt-6 border-t border-white/[0.06]">
              {/* Theme Selection Box */}
              <div className="bg-slate-950/80 border border-white/[0.05] rounded-xl p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider">
                  <span className="flex items-center gap-1.5">
                    {effectiveTheme === "dark" ? <Moon className="w-3.5 h-3.5 text-amber-400" /> : <Sun className="w-3.5 h-3.5 text-amber-500" />}
                    Thème Atelier
                  </span>
                  <span className="text-[9px] text-slate-500 font-bold">
                    {theme === "system" ? "Mode System" : theme === "dark" ? "Mode Nuit" : "Mode Jour"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 bg-slate-900/90 p-1 rounded-lg border border-white/[0.06]">
                  <button
                    onClick={() => handleThemeChange("system")}
                    title="Automatique selon les préférences système"
                    className={`py-1.5 rounded-md text-[10px] font-extrabold flex items-center justify-center gap-1 transition cursor-pointer ${
                      theme === "system"
                        ? "bg-red-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Monitor className="w-3 h-3" />
                    <span>Auto</span>
                  </button>
                  <button
                    onClick={() => handleThemeChange("dark")}
                    title="Mode Sombre (Atelier Nuit)"
                    className={`py-1.5 rounded-md text-[10px] font-extrabold flex items-center justify-center gap-1 transition cursor-pointer ${
                      theme === "dark"
                        ? "bg-red-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Moon className="w-3 h-3" />
                    <span>Nuit</span>
                  </button>
                  <button
                    onClick={() => handleThemeChange("light")}
                    title="Mode Clair (Anti-éblouissement/Jour)"
                    className={`py-1.5 rounded-md text-[10px] font-extrabold flex items-center justify-center gap-1 transition cursor-pointer ${
                      theme === "light"
                        ? "bg-red-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Sun className="w-3 h-3" />
                    <span>Jour</span>
                  </button>
                </div>
              </div>

              {/* Countdown Plan Indicator */}
              {loggedInUser && (
                <div className="bg-slate-950/80 border border-white/[0.05] rounded-xl p-3 text-xs space-y-1">
                  <span className="text-slate-500 text-[9px] block uppercase tracking-wider font-extrabold font-mono">
                    {currentPlan === "free_trial" && "Essai Gratuit :"}
                    {currentPlan === "payg_active" && "Pass 24h Actif :"}
                    {currentPlan === "lite" && "Formule LITE :"}
                    {currentPlan === "premium" && "Formule PREMIUM :"}
                    {currentPlan === "free_expired" && "Abonnement :"}
                  </span>
                  <span className={`${currentPlan === "free_expired" ? "text-rose-500 font-bold animate-pulse" : "text-amber-400 font-bold"} block text-xs`}>
                    ⏱️ {remainingTimeText || "Calcul..."}
                  </span>
                </div>
              )}

              {/* Logged User Info and Logout */}
              <div className="bg-slate-950/80 border border-white/[0.05] rounded-xl p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                    <span className="text-[10px] text-slate-400 font-semibold font-mono tracking-wider truncate max-w-[140px]" title={loggedInUser || ""}>
                      {loggedInUser || "Visiteur"}
                    </span>
                  </div>
                  <span className="text-[8px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono font-extrabold px-1 py-0.5 rounded shrink-0">
                    FIREBASE
                  </span>
                </div>
                
                <button 
                  onClick={() => {
                    if (confirm("Voulez-vous vraiment vous déconnecter de votre compte DiagAssist ?")) {
                      setLoggedInUser(null);
                      localStorage.removeItem("auth_user_phone");
                      localStorage.removeItem("auth_session_token");
                    }
                  }}
                  className="w-full text-center py-1.5 bg-red-600/10 hover:bg-red-600/20 text-red-500 hover:text-red-400 border border-red-500/20 rounded-lg text-[10px] font-black uppercase tracking-wider transition"
                >
                  Déconnexion
                </button>
              </div>
            </div>
          </aside>

          {/* MOBILE NAVIGATION BAR (Sticky/Compact Top Header) */}
          <header className="lg:hidden flex items-center justify-between px-4 py-3.5 bg-slate-950/90 backdrop-blur-md border-b border-white/[0.08] sticky top-0 z-40 select-none">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm text-white font-bold font-display shadow-lg border border-white/10 scintillant-badge">
                ⚙️
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-display font-black uppercase tracking-tight text-white leading-none">
                    DiagAssist
                  </span>
                  <span className="scintillant-badge text-[8px] font-black px-1.5 py-0.5 rounded uppercase font-mono tracking-widest border">
                    PRO
                  </span>
                </div>
                <p className="text-[9px] text-slate-500">Multimédia Auto IA</p>
              </div>
            </div>

            {/* Micro Controls & Account Trigger */}
            <div className="flex items-center gap-2 relative">
              <button
                onClick={() => handleThemeChange(effectiveTheme === "dark" ? "light" : "dark")}
                title={`Thème actuel : ${effectiveTheme === 'dark' ? 'Sombre' : 'Clair'}. Cliquer pour basculer.`}
                className="p-2 bg-slate-900 border border-white/[0.08] rounded-xl hover:border-blue-500/20 active:scale-95 transition text-slate-300"
              >
                {effectiveTheme === "dark" ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-indigo-500" />}
              </button>

              <button 
                onClick={() => setShowMobileUserMenu(!showMobileUserMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 border border-white/[0.08] rounded-xl hover:border-blue-500/20 active:scale-95 transition text-[10px] font-bold text-slate-300"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span>Compte</span>
              </button>

              {showMobileUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMobileUserMenu(false)} />
                  <div className="absolute right-0 top-11 w-64 bg-slate-900 border border-white/[0.1] rounded-2xl p-4 shadow-2xl z-50 animate-fade-in space-y-4">
                    <div className="space-y-1">
                      <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block font-mono">Compte Firebase :</span>
                      <strong className="text-xs text-emerald-400 block font-mono">{loggedInUser}</strong>
                    </div>

                    {/* Theme Selector inside Mobile Menu */}
                    <div className="space-y-2 border-t border-white/[0.05] pt-3">
                      <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block font-mono">
                        Thème Atelier :
                      </span>
                      <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-white/[0.06]">
                        <button
                          onClick={() => handleThemeChange("system")}
                          className={`py-1 rounded text-[10px] font-extrabold flex items-center justify-center gap-1 transition ${
                            theme === "system" ? "bg-red-600 text-white" : "text-slate-400"
                          }`}
                        >
                          <Monitor className="w-3 h-3" />
                          <span>Auto</span>
                        </button>
                        <button
                          onClick={() => handleThemeChange("dark")}
                          className={`py-1 rounded text-[10px] font-extrabold flex items-center justify-center gap-1 transition ${
                            theme === "dark" ? "bg-red-600 text-white" : "text-slate-400"
                          }`}
                        >
                          <Moon className="w-3 h-3" />
                          <span>Nuit</span>
                        </button>
                        <button
                          onClick={() => handleThemeChange("light")}
                          className={`py-1 rounded text-[10px] font-extrabold flex items-center justify-center gap-1 transition ${
                            theme === "light" ? "bg-red-600 text-white" : "text-slate-400"
                          }`}
                        >
                          <Sun className="w-3 h-3" />
                          <span>Jour</span>
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1 border-t border-white/[0.05] pt-3">
                      <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block font-mono">
                        {currentPlan === "free_trial" && "Essai Gratuit :"}
                        {currentPlan === "payg_active" && "Pass 24h Actif :"}
                        {currentPlan === "lite" && "Formule LITE :"}
                        {currentPlan === "premium" && "Formule PREMIUM :"}
                        {currentPlan === "free_expired" && "Abonnement :"}
                      </span>
                      <strong className={`${currentPlan === "free_expired" ? "text-rose-500 font-bold animate-pulse" : "text-amber-400 font-bold"} text-xs block font-mono`}>
                        ⏱️ {remainingTimeText || "Calcul..."}
                      </strong>
                    </div>

                    <button 
                      onClick={() => {
                        setShowMobileUserMenu(false);
                        if (confirm("Voulez-vous vraiment vous déconnecter de votre compte DiagAssist ?")) {
                          setLoggedInUser(null);
                          localStorage.removeItem("auth_user_phone");
                          localStorage.removeItem("auth_session_token");
                        }
                      }}
                      className="w-full text-center py-2 bg-red-600/10 hover:bg-red-600/20 text-red-500 hover:text-red-400 border border-red-500/20 rounded-xl text-xs font-black uppercase tracking-wider transition"
                    >
                      Déconnexion
                    </button>
                  </div>
                </>
              )}
            </div>
          </header>

          {/* FLOATING MOBILE & TABLET BOTTOM NAVIGATION DOCK - Figma Pro style */}
          <nav className="lg:hidden fixed bottom-4 left-4 right-4 sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-md z-50 bg-slate-900/95 backdrop-blur-lg border border-white/[0.1] rounded-2xl p-1.5 flex items-center justify-around shadow-[0_12px_40px_rgba(0,0,0,0.85)] select-none">
            <button
              onClick={() => {
                setActiveTab("diagnose");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-1.5 px-2 min-h-[48px] rounded-xl transition duration-150 cursor-pointer ${
                activeTab === "diagnose"
                  ? "bg-slate-950 text-red-500 border border-white/[0.04]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Gauge className="w-5 h-5" />
              <span className="text-[9px] font-black uppercase tracking-wider">Atelier</span>
            </button>

            <button
              onClick={() => {
                setActiveTab("live");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-1.5 px-2 min-h-[48px] rounded-xl transition duration-150 cursor-pointer relative ${
                activeTab === "live"
                  ? isLiveActive
                    ? "bg-slate-950 text-emerald-400 border border-emerald-500/20"
                    : "bg-slate-950 text-red-500 border border-white/[0.04]"
                  : isLiveActive
                    ? "text-emerald-400 bg-emerald-500/5 animate-pulse"
                    : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Radio className={`w-5 h-5 ${activeTab === "live" || isLiveActive ? "animate-pulse" : ""}`} />
              <span className="text-[9px] font-black uppercase tracking-wider">Live</span>
              <span className="absolute top-1 right-4 flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
            </button>

            <button
              onClick={() => {
                setActiveTab("prices");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-1.5 px-2 min-h-[48px] rounded-xl transition duration-150 cursor-pointer ${
                activeTab === "prices"
                  ? "bg-slate-950 text-red-500 border border-white/[0.04]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Sparkles className="w-5 h-5" />
              <span className="text-[9px] font-black uppercase tracking-wider">Offres</span>
            </button>
          </nav>

          {/* MAIN CONTAINER PANEL */}
          <div className="flex-1 flex flex-col lg:pl-0 min-h-screen">
            {/* Main Workspace Layout Wrapper */}
            <main className="w-full max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-6 lg:py-10">
            {/* Bannières / images flottantes définies par l'admin */}
            <BannerDisplay />

            {/* TAB 1: Diagnostic Workspace */}
            {activeTab === "diagnose" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* Left side: Form Inputs */}
                <div className="lg:col-span-5 space-y-4 print:hidden">
              <DiagnosticForm onDiagnose={handleDiagnose} isLoading={isLoading} />
              
              {/* Optional Reset panel if results exist */}
              {diagnosisResult && (
                <div className="premium-glass-card border border-white/[0.05] rounded-2xl p-4 flex items-center justify-between text-xs animate-fade-in shadow-xl">
                  <div className="text-slate-400 font-bold">
                    Une autre panne à soumettre ?
                  </div>
                  <button
                    onClick={resetWorkspace}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-950/80 hover:bg-slate-900 border border-white/[0.08] hover:border-red-500/30 text-red-500 rounded-xl transition duration-150 font-black uppercase tracking-wider cursor-pointer text-[10px]"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Nouveau diagnostic
                  </button>
                </div>
              )}
            </div>

            {/* Right side: Diagnosis & Results View */}
            <div className="lg:col-span-7 space-y-4 print:col-span-12 print:w-full">
              
              {diagnosisResult ? (
                <>
                  {/* Vocal Live Promotion banner in Diagnostic Result */}
                  <div className="print:hidden bg-gradient-to-r from-red-950/20 to-slate-900 border border-red-500/20 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md animate-fade-in">
                    <div className="flex items-center gap-2.5">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      <div className="text-left">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[9px] font-mono text-emerald-400 uppercase font-black tracking-wider bg-emerald-950 px-1.5 py-0.5 rounded">LIVE CONNECTÉ</span>
                          <span className="text-xs font-bold text-white">Copilote Vocal Intelligent Disponible</span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">Parlez à DiagAssist en direct de cette panne, les mains libres dans l'atelier.</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setActiveTab("live");
                        setIsLiveActive(true);
                      }}
                      className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white text-xs md:text-sm font-black uppercase tracking-wider px-6 py-3.5 rounded-2xl flex items-center justify-center gap-2 shadow-xl shadow-emerald-950/35 transition cursor-pointer shrink-0 border border-emerald-400/15"
                    >
                      <Radio className="w-4 h-4 animate-pulse text-white" />
                      Lancer l'Appel Live
                    </button>
                  </div>

                  {/* Results Toggle Navigation (Rapport vs Chat vs Visual Assistant) */}
                  <div className="bg-slate-950 border border-white/[0.08] rounded-3xl p-1.5 flex flex-wrap sm:flex-nowrap items-center gap-2 shadow-xl shrink-0 print:hidden">
                    <button
                      onClick={() => setActiveResultTab("report")}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs md:text-sm font-black uppercase tracking-wider rounded-2xl transition duration-150 cursor-pointer ${
                        activeResultTab === "report"
                          ? "bg-slate-900 border border-white/[0.08] text-white"
                          : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
                      }`}
                    >
                      <FileText className="w-4.5 h-4.5 text-red-500" />
                      <span>Rapport</span>
                    </button>
                    <button
                      onClick={() => setActiveResultTab("visual")}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs md:text-sm font-black uppercase tracking-wider rounded-2xl transition duration-150 cursor-pointer ${
                        activeResultTab === "visual"
                          ? "bg-slate-900 border border-white/[0.08] text-white animate-pulse"
                          : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
                      }`}
                    >
                      <Wrench className="w-4.5 h-4.5 text-red-500" />
                      <span>Assistant Visuel</span>
                    </button>
                    <button
                      onClick={() => setActiveResultTab("chat")}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs md:text-sm font-black uppercase tracking-wider rounded-2xl transition duration-150 cursor-pointer ${
                        activeResultTab === "chat"
                          ? "bg-slate-900 border border-white/[0.08] text-white"
                          : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
                      }`}
                    >
                      <MessageSquare className="w-4.5 h-4.5 text-red-500" />
                      <span>Discuter ({chatHistory.length})</span>
                    </button>
                    
                    {/* Reset Button to Add a New Diagnosis */}
                    <button
                      onClick={resetWorkspace}
                      className="flex items-center justify-center gap-2 py-3 px-4 text-xs md:text-sm font-black uppercase tracking-wider rounded-2xl transition duration-150 cursor-pointer bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/20 border border-red-500/20"
                    >
                      <RefreshCw className="w-4 h-4 shrink-0" />
                      <span className="whitespace-nowrap">Nouveau</span>
                    </button>
                  </div>

                  {/* Render Tab Views */}
                  {activeResultTab === "report" ? (
                    <DiagnosisResultView 
                      diagnosis={diagnosisResult} 
                      apiUsage={apiUsage!} 
                      currentPlan={currentPlan}
                      onUpgradeClick={() => setActiveTab("prices")}
                    />
                  ) : activeResultTab === "visual" ? (
                    <VisualRepairAssistant
                      diagnosis={diagnosisResult}
                      currentPlan={currentPlan}
                      onUpgradeClick={() => setActiveTab("prices")}
                    />
                  ) : (
                    <DiagnosticChat
                      diagnosis={diagnosisResult}
                      chatHistory={chatHistory}
                      onSendMessage={handleSendChatMessage}
                      isSending={isSendingChat}
                    />
                  )}
                </>
              ) : (
                /* Dynamic Empty State Workshop Graphic */
                <div className="premium-glass-card border border-white/[0.05] rounded-3xl p-8 text-center text-slate-100 shadow-2xl min-h-[500px] flex flex-col justify-center items-center relative overflow-hidden animate-fade-in">
                  <div className="absolute top-0 right-0 w-80 h-80 bg-blue-600/[0.02] rounded-full blur-3xl pointer-events-none"></div>
                  
                  {/* Visual Blueprint Engine Frame */}
                  <div className="w-24 h-24 bg-slate-950 border border-white/[0.05] rounded-3xl flex items-center justify-center mb-6 shadow-2xl relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 to-transparent opacity-50 rounded-3xl"></div>
                    <Layers className="w-10 h-10 text-slate-600 animate-pulse" />
                  </div>

                  <div className="max-w-md space-y-4">
                    <h2 className="text-xl font-display font-black text-white uppercase tracking-tight">
                      Aucun Diagnostic en Cours
                    </h2>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Saisissez les symptômes de votre véhicule à gauche. Vous pouvez taper, enregistrer du son, charger une vidéo, ou importer une photo de voyant de tableau de bord ou de codes OBD pour recevoir un plan de réparation professionnel instantané.
                    </p>

                    {/* Quick guidance steps */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-6 text-left">
                      <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-white/[0.05]">
                        <span className="font-mono text-xs font-black text-blue-500 block mb-1">01.</span>
                        <span className="text-[11px] font-bold text-slate-300 block">Saisie</span>
                        <span className="text-[10px] text-slate-500 mt-0.5 block leading-normal">
                          Décrivez le problème mécanique rencontré.
                        </span>
                      </div>

                      <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-white/[0.05]">
                        <span className="font-mono text-xs font-black text-sky-400 block mb-1">02.</span>
                        <span className="text-[11px] font-bold text-slate-300 block">Multimédia</span>
                        <span className="text-[10px] text-slate-500 mt-0.5 block leading-normal">
                          Joignez une photo, vidéo ou enregistrement audio.
                        </span>
                      </div>

                      <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-white/[0.05]">
                        <span className="font-mono text-xs font-black text-emerald-400 block mb-1">03.</span>
                        <span className="text-[11px] font-bold text-slate-300 block">Résolution</span>
                        <span className="text-[10px] text-slate-500 mt-0.5 block leading-normal">
                          Suivez le guide pas-à-pas et le chiffrage.
                        </span>
                      </div>
                    </div>

                    {/* Interactive Live Demo Entry Button */}
                    <div className="pt-5 border-t border-white/[0.05] w-full">
                      <button
                        onClick={() => {
                          setDiagnosisResult(demoDiagnosis);
                          setApiUsage({
                            promptTokens: 1250,
                            candidatesTokens: 850,
                            totalTokens: 2100,
                            estimatedCostUSD: 0.05,
                            modelUsed: "gemini-2.5-flash"
                          });
                          setActiveResultTab("report");
                        }}
                        className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-red-600 to-red-750 hover:from-red-700 hover:to-red-800 text-white font-black text-xs uppercase tracking-wider rounded-xl transition duration-150 cursor-pointer shadow-lg shadow-red-600/20 hover:shadow-red-600/30 active:scale-[0.98] glow-btn border border-red-500/20"
                      >
                        <Sparkles className="w-4 h-4 fill-current text-white" />
                        <span>Lancer la Démo Live & Interactive en 1 Clic !</span>
                      </button>
                    </div>

                  </div>
                </div>
              )}

            </div>

          </div>
        )}

        {/* TAB 2: Dedicated Immersive Vocal Live Page */}
        <div className={`max-w-xl mx-auto space-y-6 ${activeTab === "live" ? "block animate-fade-in" : "hidden"}`}>
          <DiagAssistLiveScreen 
            diagnosis={diagnosisResult}
            chatHistory={chatHistory}
            onSendMessage={handleSendChatMessage}
            isSendingChat={isSendingChat}
            assistantName={assistantName}
            isPremiumActive={currentPlan === "free_trial" || currentPlan === "premium" || currentPlan === "payg_active"}
            onUpgradeClick={() => setActiveTab("prices")}
            isLiveActive={isLiveActive}
            setIsLiveActive={setIsLiveActive}
            onLoadDemo={() => {
              setDiagnosisResult(demoDiagnosis);
              setApiUsage({
                promptTokens: 1250,
                candidatesTokens: 850,
                totalTokens: 2100,
                estimatedCostUSD: 0.05,
                modelUsed: "gemini-2.5-flash"
              });
              const initialMsg = {
                id: "welcome-msg",
                role: "model" as const,
                text: "Bonjour, ici DiagAssist. Je suis là pour vous aider à réparer votre véhicule. Avec quel équipement de diagnostic (scanner) travaillez-vous actuellement afin que je puisse vous guider précisément dans les tests d'action ?",
                timestamp: new Date()
              };
              setChatHistory([initialMsg]);
            }}
            setActiveTab={setActiveTab}
          />
        </div>

        {/* TAB 3: Clean Public Subscription Panel */}
        {activeTab === "prices" && (
          <div className={isAdminAccount ? "max-w-6xl mx-auto space-y-8 animate-fade-in" : "max-w-3xl mx-auto space-y-8 animate-fade-in"}>
            {/* User Subscription Selection Panel (ou tableau de bord complet si admin) */}
            <SubscriptionPanel 
              currentPlan={currentPlan} 
              onPlanChange={handlePlanChange} 
              onActivatePayg={() => handlePlanChange("payg_active")}
              onRequestActivation={handleRequestActivation}
              isAdmin={isAdminAccount}
              sessionCostUSD={sessionCostUSD}
              totalTokensUsed={totalTokensUsed}
              queriesCount={queriesCount}
              apiLogs={apiLogs}
              onClearStats={handleClearStats}
              onAddMockLog={handleAddMockLog}
            />
          </div>
        )}

      </main>

      {/* Immersive technical footer */}
      <footer className="max-w-7xl mx-auto px-4 mt-16 border-t border-slate-900 pt-6 text-center text-[11px] text-slate-600 flex flex-col sm:flex-row justify-between gap-4">
        <div>
          © 2026 <strong>DiagAssist v1 (Diagnostiqueur Auto IA)</strong>. Tous droits réservés.
        </div>
        <div className="flex items-center justify-center gap-4">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Service en ligne opérationnel
          </span>
          <span className="text-slate-700">|</span>
          <span>Propulsé par IA de Diagnostic Auto</span>
        </div>
      </footer>

          </div>
        </div>
      )}

      {/* Floating Active Live Session Pill Indicator */}
      {isLiveActive && activeTab !== "live" && (
        <div className="fixed bottom-24 lg:bottom-6 right-4 left-4 lg:left-auto lg:w-96 z-50 animate-bounce-slow bg-slate-900 border-2 border-emerald-500 text-white rounded-2xl p-3.5 shadow-[0_8px_32px_rgba(16,185,129,0.25)] flex items-center justify-between gap-3 backdrop-blur-md">
          <div className="flex items-center gap-3 overflow-hidden">
            <span className="relative flex h-3.5 w-3.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
            </span>
            <div className="text-left overflow-hidden">
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 block font-mono">APPEL LIVE EN COURS</span>
              <span className="text-xs font-bold text-slate-100 truncate block">DiagAssist vous écoute à la voix...</span>
            </div>
          </div>
          <button
            onClick={() => setActiveTab("live")}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-wider rounded-lg transition duration-150 shrink-0 cursor-pointer shadow border border-emerald-400/20"
          >
            Rejoindre
          </button>
        </div>
      )}
    </>
  );
}
