import { Type } from "@google/genai";
import type { GuideContent, GuideRequest } from "./guideTypes";

type Generate = (contents: any, config: any) => Promise<any>;

const rowSchema = {
  type: Type.OBJECT,
  properties: {
    col1: { type: Type.STRING },
    col2: { type: Type.STRING },
    col3: { type: Type.STRING },
  },
  required: ["col1", "col2", "col3"],
};

const stepSchema = {
  type: Type.OBJECT,
  properties: { title: { type: Type.STRING }, text: { type: Type.STRING } },
  required: ["title", "text"],
};

const guideSchema = {
  type: Type.OBJECT,
  properties: {
    subtitle: { type: Type.STRING, description: "Ex : CODAGE & APPAIRAGE, en majuscules." },
    goldenRule: { type: Type.STRING, description: "Règle d'or de sécurité (stabilisation de tension, etc.), 2 phrases max." },
    section1Title: { type: Type.STRING },
    section1Intro: { type: Type.STRING },
    capabilities: { type: Type.ARRAY, items: rowSchema, description: "3 lignes : appairage/changement, calibrations/réglages, flash constructeur. col2 = OUI, NON ou PARTIEL." },
    connectionSteps: { type: Type.ARRAY, items: stepSchema, description: "3 étapes de préparation et connexion." },
    procedureTitle: { type: Type.STRING },
    procedureIntro: { type: Type.STRING },
    procedureSteps: { type: Type.ARRAY, items: stepSchema, description: "4 étapes guidées." },
    relearn: { type: Type.ARRAY, items: rowSchema, description: "3 réapprentissages après opération." },
    summary: { type: Type.STRING },
  },
  required: [
    "subtitle", "goldenRule", "section1Title", "section1Intro", "capabilities", "connectionSteps",
    "procedureTitle", "procedureIntro", "procedureSteps", "relearn", "summary",
  ],
};

const cache = new Map<string, { at: number; content: GuideContent }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function guideCacheKey(r: GuideRequest): string {
  return [r.equipment, r.make, r.model, r.year || "", r.topic || ""].join("|").toLowerCase();
}

/** Retire le markdown : le texte du guide est aussi lu par la synthèse vocale. */
function clean(s: unknown): string {
  return String(s ?? "")
    .replace(/[*#`_]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(raw: any): GuideContent {
  const rows = (a: any) =>
    (Array.isArray(a) ? a : []).slice(0, 8).map((r: any) => ({ col1: clean(r?.col1), col2: clean(r?.col2), col3: clean(r?.col3) }));
  const steps = (a: any) =>
    (Array.isArray(a) ? a : []).slice(0, 8).map((s: any) => ({ title: clean(s?.title), text: clean(s?.text) }));
  return {
    subtitle: clean(raw?.subtitle).toUpperCase(),
    goldenRule: clean(raw?.goldenRule),
    section1Title: clean(raw?.section1Title),
    section1Intro: clean(raw?.section1Intro),
    capabilities: rows(raw?.capabilities),
    connectionSteps: steps(raw?.connectionSteps),
    procedureTitle: clean(raw?.procedureTitle),
    procedureIntro: clean(raw?.procedureIntro),
    procedureSteps: steps(raw?.procedureSteps),
    relearn: rows(raw?.relearn),
    summary: clean(raw?.summary),
  };
}

export async function buildGuideContent(r: GuideRequest, generate: Generate): Promise<GuideContent> {
  const key = guideCacheKey(r);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.content;

  const vehicle = `${r.make} ${r.model}${r.year ? ` (${r.year})` : ""}`;
  const prompt = `Tu rédiges un guide technique d'atelier de 2 pages A4 pour un mécanicien professionnel (Côte d'Ivoire), sur l'équipement de diagnostic "${r.equipment}" appliqué au véhicule : ${vehicle}.${r.topic ? ` Sujet demandé : ${r.topic}.` : " Sujet : codage et appairage (remplacement de calculateur, clés, réapprentissages)."}

Structure imposée (mêmes sections pour tous les modèles) : règle d'or de sécurité, ce qui est faisable ou non avec ${r.equipment} (appairage/changement, calibrations/réglages, flash logiciel constructeur), préparation et connexion, procédure guidée de remplacement et appairage, réapprentissages obligatoires, résumé.

Règles : français, vocabulaire de garage, phrases courtes et précises, aucun Markdown (pas d'astérisques, pas de dièses, pas de puces). Ne jamais inventer un chemin de menu, un code ou une valeur dont tu n'es pas sûr : écris alors "à vérifier dans le menu de la valise". Indique l'emplacement de la prise OBD2 et la procédure de mise du contact seulement s'ils sont connus pour ce modèle. Si ${r.equipment} ne couvre pas une opération sur ce modèle, mets NON ou PARTIEL et indique l'alternative (ex : interface J2534 PassThru).`;

  const resp = await generate(prompt, {
    responseMimeType: "application/json",
    responseSchema: guideSchema,
    temperature: 0.2,
  });
  const content = normalize(JSON.parse((resp.text || "{}").trim()));
  if (!content.procedureSteps.length || !content.capabilities.length) {
    throw new Error("Contenu de guide incomplet");
  }
  cache.set(key, { at: Date.now(), content });
  return content;
}
