export type LivePlannerPriority = "identification" | "historique" | "symptome" | "securite" | "inspection" | "scan" | "test" | "validation" | "conclusion";

export interface LivePlannerState {
  vehicle: string;
  symptom: string;
  dtcs: string[];
  evidence: string[];
  hypotheses: string[];
  contradictions: string[];
  currentTest: string | null;
  repaired: boolean;
  concluded: boolean;
  phase: string;
}

export interface LiveDiagnosticPlan {
  priorite: LivePlannerPriority;
  action: string;
  raison: string;
  attendu: string;
}

/**
 * Planification locale et déterministe.
 * Aucun appel réseau/IA : le Live reste aussi réactif qu'avant.
 */
export function planLiveDiagnostic(state: LivePlannerState): LiveDiagnosticPlan {
  const vehicleText = String(state.vehicle || "").toLowerCase();
  const contextText = [
    state.vehicle,
    state.symptom,
    ...(state.evidence || []),
  ].join(" ").toLowerCase();

  const hybridOrEv = /hybride|hybrid|électri|electri|bev|phev|hev/.test(contextText);

  if (state.concluded) {
    return {
      priorite: "conclusion",
      action: "Clôturer le diagnostic.",
      raison: "Le diagnostic est déjà marqué comme conclu.",
      attendu: "Récapitulatif final et contrôle post-réparation.",
    };
  }

  if (!state.vehicle) {
    return {
      priorite: "identification",
      action: "Demander marque, modèle, année et motorisation.",
      raison: "Le véhicule exact conditionne les valeurs et procédures.",
      attendu: "Identification exploitable du véhicule.",
    };
  }

  if (hybridOrEv && !/hybride|hybrid|électri|electri/.test(vehicleText)) {
    return {
      priorite: "securite",
      action: "Confirmer précisément la motorisation avant toute intervention.",
      raison: "Les procédures haute tension dépendent du véhicule.",
      attendu: "Motorisation confirmée avant manipulation.",
    };
  }

  if (state.phase === "historique") {
    return {
      priorite: "historique",
      action: "Demander l'intervention récente ou l'événement déclencheur.",
      raison: "Une intervention récente peut expliquer directement le défaut.",
      attendu: "Historique utile ou absence d'intervention récente.",
    };
  }

  if (state.phase === "symptome") {
    return {
      priorite: "symptome",
      action: "Faire reproduire et caractériser le symptôme.",
      raison: "Il faut relier le défaut aux conditions réelles.",
      attendu: "Conditions d'apparition clairement décrites.",
    };
  }

  if (state.phase === "inspection") {
    return {
      priorite: "inspection",
      action: "Faire une inspection visuelle rapide avant démontage.",
      raison: "Les défauts visibles sont simples à vérifier et souvent discriminants.",
      attendu: "Observation objective ou absence d'anomalie.",
    };
  }

  if (state.phase === "outils") {
    return {
      priorite: "scan",
      action: state.dtcs?.length
        ? "Relever les DTC et les données figées utiles."
        : "Effectuer un scan et relever les données disponibles.",
      raison: "Le scanner fournit le contexte électronique avant le test physique.",
      attendu: "Résultat de scan exploitable.",
    };
  }

  if (state.phase === "tests") {
    if (state.currentTest) {
      return {
        priorite: "test",
        action: `Obtenir le résultat du test en cours : ${state.currentTest}.`,
        raison: "Un seul test à la fois évite de mélanger les résultats.",
        attendu: "Résultat mesuré ou observation clairement positive/négative.",
      };
    }

    return {
      priorite: "test",
      action: "Choisir un seul test qui départage les hypothèses principales.",
      raison: state.contradictions?.length
        ? "Une contradiction récente impose de vérifier l'hypothèse."
        : "Le prochain test doit réduire l'incertitude.",
      attendu: "Preuve objective permettant de confirmer ou d'écarter une hypothèse.",
    };
  }

  if (state.phase === "validation") {
    return {
      priorite: "validation",
      action: state.repaired
        ? "Faire l'essai final puis rescanner."
        : "Confirmer la cause par une mesure ou un test avant réparation.",
      raison: state.repaired
        ? "Une réparation doit être validée par le comportement réel et le scan."
        : "Une hypothèse ne suffit pas pour condamner une pièce.",
      attendu: state.repaired
        ? "Symptôme absent et aucun nouveau DTC."
        : "Preuve objective de la cause.",
    };
  }

  return {
    priorite: "conclusion",
    action: "Préparer le diagnostic final.",
    raison: "Les étapes structurantes ont été parcourues.",
    attendu: "Cause confirmée ou clairement probable, preuve et action.",
  };
}
