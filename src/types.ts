export type SubscriptionPlan = 'free_trial' | 'free_expired' | 'payg_active' | 'lite' | 'premium';

export interface DtcCode {
  code: string;
  description: string;
}

export interface RepairStep {
  stepNumber: number;
  title: string;
  description: string;
  estimatedTime: string;
}

export interface EstimatedCosts {
  partsMin: number;
  partsMax: number;
  laborMin: number;
  laborMax: number;
  currency: string;
}

export interface Diagnosis {
  brandModelInfo: string;
  dtcCodesDetected: DtcCode[];
  severity: "Faible" | "Moyen" | "Élevé" | "Critique";
  severityDescription: string;
  probableCauses: string[];
  immediateRecommendations: string[];
  repairGuideSteps: RepairStep[];
  estimatedCosts: EstimatedCosts;
  explanationText: string;
  clarifyingQuestions?: string[];
  groundedInSources?: boolean;
}

export interface ApiUsage {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
  modelUsed: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: Date;
  apiUsage?: ApiUsage;
  file?: string;
  mimeType?: string;
  fileName?: string;
}

export interface DiagnosisResponse {
  success: boolean;
  diagnosis: Diagnosis;
  apiUsage: ApiUsage;
}

export interface ChatResponse {
  success: boolean;
  reply: string;
  apiUsage: ApiUsage;
}

// ---------------------------------------------------------------------------
// AD MANAGER & SPONSORED PRODUCTS TYPES
// ---------------------------------------------------------------------------

export type AdType = "BANNER" | "FULLSCREEN" | "SPONSORED_PRODUCT" | "SPONSORED_SERVICE" | "RECOMMENDED_PRODUCT";

export type AdSessionState = "idle" | "connecting" | "live" | "analyzing" | "waiting_user" | "testing" | "completed" | "error";

export interface Advertiser {
  id: string;
  name: string;
  logo?: string;
  phone?: string;
  website?: string;
  active: boolean;
}

export interface AdCampaign {
  id: string;
  advertiserId: string;
  name: string;
  startDate: string;
  endDate: string;
  budget: number;
  active: boolean;
  targetCategories: string[];
}

export interface Ad {
  id: string;
  campaignId: string;
  advertiserId: string;
  advertiserName: string;
  type: AdType;
  title: string;
  description: string;
  imageUrl?: string;
  priceTag?: string;
  callToAction: string;
  targetUrl: string;
  categories: string[];
  active: boolean;
  badgeText?: string;
}

export interface AdConfig {
  enabled: boolean;
  maxAdsPerSession: number;
  minIntervalBetweenAds: number; // milliseconds
  showBeforeSession: boolean;
  showDuringLive: boolean;
  showAfterDiagnosis: boolean;
  allowFullscreen: boolean;
  allowBanner: boolean;
  allowSponsoredContent: boolean;
}

export interface AdEventTrack {
  id: string;
  adId: string;
  campaignId: string;
  event: "impression" | "click" | "close";
  timestamp: Date;
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// DIAGNOSTIC AUTO-QUESTIONING LOOP TYPES
// ---------------------------------------------------------------------------

export type LoopPhase = "action_avant_dtc" | "verification_technique" | "validation_post_reparation" | "conclusion";

export interface DiagnosticHypothesis {
  cause: string;
  confiance: number; // 0-100
  type: "cause_racine_probable" | "cause_directe_du_code";
  lien_avec_dtc: string;
}

export interface TestProtocole {
  outil?: string | null;
  emplacement_exact?: string | null;
  etat_vehicule?: "contact_on" | "moteur_tournant" | "moteur_eteint" | null;
  etat_thermique?: "froid" | "chaud" | null;
  valeur_reference_normale?: string | null;
  niveau_invasivite?: "visuel" | "mesure_simple" | "lecture_scanner" | "demontage" | null;
  alerte_securite?: string | null;
}

export interface DiagnosticProof {
  tour: number;
  type: "texte" | "photo" | "audio" | "mesure" | "observation";
  contenu: string;
}

export interface InitialProof {
  type: "mesure" | "observation";
  test?: string;
  valeur?: string;
  contenu?: string;
}

export interface DiagnosticLoopState {
  session_id: string;
  vehicule: {
    marque: string;
    modele: string;
    moteur: string;
    kilometrage: number;
  };
  symptome_initial: string;
  codes_dtc: string[];
  preuves_initiales?: InitialProof[];
  preuves: DiagnosticProof[];
  hypotheses: DiagnosticHypothesis[];
  incoherence_detectee: string | null;
  scanner: {
    identifie: string | null;
    methode_identification: "nom" | "photo" | null;
    recherches_effectuees: number;
    recherches_max: number;
  };
  phase_actuelle: LoopPhase;
  questions_posees: string[];
  tour_actuel: number;
  tour_max: number;
  stop: boolean;
}

export interface GeminiLoopTurnResponse {
  hypotheses: DiagnosticHypothesis[];
  incoherence_detectee: string | null;
  phase: LoopPhase;
  next_question: string;
  test_protocole?: TestProtocole;
  type_reponse_attendue: "texte" | "photo" | "audio" | "choix";
  preuve_photo_demandee: boolean;
  scanner_action?: {
    necessaire: boolean;
    demande?: "nom" | "photo" | null;
  };
  stop: boolean;
  groundedMenuPath?: string | null;
}


