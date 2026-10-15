export interface GuideRequest {
  make: string;
  model: string;
  year?: string;
  /** Équipement de diagnostic visé (valise). Défaut : Diagzone. */
  equipment: string;
  /** Contexte libre facultatif (ex : "remplacement calculateur moteur"). */
  topic?: string;
}

export interface GuideStep {
  title: string;
  text: string;
}

export interface GuideTableRow {
  col1: string;
  col2: string;
  col3: string;
}

export interface GuideContent {
  subtitle: string;
  goldenRule: string;
  section1Title: string;
  section1Intro: string;
  /** Opération / Faisable ? (OUI, NON, PARTIEL) / Détail et méthode. */
  capabilities: GuideTableRow[];
  connectionSteps: GuideStep[];
  procedureTitle: string;
  procedureIntro: string;
  procedureSteps: GuideStep[];
  /** Fonction à réapprendre / Chemin dans l'outil / Consigne d'exécution. */
  relearn: GuideTableRow[];
  summary: string;
}
