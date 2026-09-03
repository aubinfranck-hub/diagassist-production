import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, Modality } from "@google/genai";
import dotenv from "dotenv";
import twilio from "twilio";
import crypto from "crypto";
import { WebSocketServer } from "ws";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

dotenv.config();

// A temporary server-side storage for active OTPs (expires in 10 minutes)
const otpStorage = new Map<string, { code: string; expiresAt: number }>();

// Sessions actives : token -> { phone, plan, createdAt }
const sessions = new Map<string, { phone: string; plan: string; createdAt: number }>();

// Nombre de tentatives de vérification OTP par numéro (anti brute-force)
const otpAttempts = new Map<string, { count: number; windowStart: number }>();

// --- Forfait persistant PAR NUMÉRO DE TÉLÉPHONE (et non par session) ---
// BUG CORRIGÉ : avant, le plan était stocké uniquement dans la session en mémoire et
// réinitialisé à "free_trial" à CHAQUE nouvelle connexion (nouvelle vérification OTP).
// Un client Premium qui fermait l'app et se reconnectait perdait donc son forfait payant !
// Désormais le forfait est stocké par numéro de téléphone et relu à chaque connexion/requête.
const userPlans = new Map<string, { plan: string; activatedAt: number }>();

// Durée de validité de chaque forfait à partir de son activation (ms). Au-delà, le forfait
// expire automatiquement et repasse à "free_expired" — avant, un pass 24h ou un abonnement
// mensuel activé par l'admin restait actif INDÉFINIMENT car rien ne vérifiait l'expiration côté serveur.
const PLAN_DURATIONS_MS: Record<string, number> = {
  free_trial: 24 * 60 * 60 * 1000,   // 24h
  payg_active: 24 * 60 * 60 * 1000,  // pass 24h
  lite: 30 * 24 * 60 * 60 * 1000,    // 30 jours
  premium: 30 * 24 * 60 * 60 * 1000, // 30 jours
};

// Renvoie le forfait EFFECTIF et à jour d'un numéro : initialise l'essai gratuit à la première
// connexion, et rétrograde automatiquement vers "free_expired" si la durée du forfait est dépassée.
function getEffectivePlan(phone: string): string {
  let record = userPlans.get(phone);
  if (!record) {
    record = { plan: "free_trial", activatedAt: Date.now() };
    userPlans.set(phone, record);
    return record.plan;
  }
  const duration = PLAN_DURATIONS_MS[record.plan];
  if (duration && Date.now() - record.activatedAt > duration && record.plan !== "free_expired") {
    record = { plan: "free_expired", activatedAt: Date.now() };
    userPlans.set(phone, record);
  }
  return record.plan;
}

function setUserPlan(phone: string, plan: string): void {
  userPlans.set(phone, { plan, activatedAt: Date.now() });
}


function createSession(phone: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  const plan = getEffectivePlan(phone);
  sessions.set(token, { phone, plan, createdAt: Date.now() });
  return token;
}

// --- Comptes client par numéro + mot de passe (créés manuellement par l'admin) ---
// Alternative à l'OTP WhatsApp : l'admin crée le compte du client (numéro + mot de passe) sur son
// interface, et le lui communique directement. Aucune dépendance à un fournisseur SMS/WhatsApp.
const userAccounts = new Map<string, { passwordHash: string; salt: string; createdAt: number; isAdmin: boolean; email?: string }>();

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function createAccount(phone: string, password: string, isAdmin: boolean = false, email?: string): void {
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  const existing = userAccounts.get(phone);
  userAccounts.set(phone, {
    passwordHash,
    salt,
    createdAt: existing?.createdAt ?? Date.now(),
    isAdmin,
    email: email ?? existing?.email,
  });
}

function verifyAccountPassword(phone: string, password: string): boolean {
  const account = userAccounts.get(phone);
  if (!account) return false;
  const candidateHash = hashPassword(password, account.salt);
  // Comparaison en temps constant pour éviter les attaques par mesure de timing
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(account.passwordHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Anti brute-force sur la connexion par mot de passe (même logique que pour l'OTP)
const loginAttempts = new Map<string, { count: number; windowStart: number }>();

// Compte admin "de démarrage" créé automatiquement au lancement du serveur si ces variables
// d'environnement sont définies. Permet de créer le premier compte administrateur sans jamais
// avoir besoin d'appeler l'application déployée depuis l'extérieur.
if (process.env.ADMIN_SEED_PHONE && process.env.ADMIN_SEED_PASSWORD) {
  createAccount(process.env.ADMIN_SEED_PHONE, process.env.ADMIN_SEED_PASSWORD, true, process.env.ADMIN_SEED_EMAIL);
  setUserPlan(process.env.ADMIN_SEED_PHONE, "premium");
  console.log(`[Démarrage] Compte administrateur "graine" créé/rafraîchi pour ${process.env.ADMIN_SEED_PHONE}.`);
}

function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  const session = sessions.get(token);
  if (!token || !session) {
    return res.status(401).json({ success: false, message: "Session invalide ou expirée. Veuillez vous reconnecter." });
  }
  // Toujours resynchroniser le plan de la session avec le forfait persistant à jour
  // (reflète immédiatement une activation admin ou une expiration, sans attendre une reconnexion).
  session.plan = getEffectivePlan(session.phone);
  req.session = session;
  req.sessionToken = token;
  next();
}

// --- Administration : protection par secret serveur (jamais exposé au client) ---
// Définissez ADMIN_SECRET dans vos variables d'environnement en production.
// Sans ADMIN_SECRET configuré, toutes les routes admin refusent l'accès (fail-closed).
function requireAdminAuth(req: any, res: any, next: any) {
  const adminSecret = process.env.ADMIN_SECRET;
  const providedCode = req.headers["x-admin-code"] || req.body?.code;
  if (!adminSecret) {
    return res.status(503).json({ success: false, message: "Accès admin non configuré sur le serveur (ADMIN_SECRET manquant)." });
  }
  if (!providedCode || providedCode !== adminSecret) {
    return res.status(401).json({ success: false, message: "Code d'accès administrateur invalide." });
  }
  next();
}


const PLAN_LIMITS: Record<string, number> = {
  free_trial: 3,        // 3 diagnostics gratuits à vie
  free_expired: 0,
  payg_active: Infinity, // payé à l'usage, facturé ailleurs
  lite: 30,              // par mois
  premium: Infinity,
};

// phone -> { diagnosisCount, periodStart }
const usageTracking = new Map<string, { diagnosisCount: number; periodStart: number }>();

function checkAndIncrementUsage(phone: string, plan: string): { allowed: boolean; message?: string } {
  const limit = PLAN_LIMITS[plan] ?? 0;
  const usage = usageTracking.get(phone) || { diagnosisCount: 0, periodStart: Date.now() };

  // Reset mensuel simple pour lite/premium (30 jours glissants)
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  if (Date.now() - usage.periodStart > THIRTY_DAYS) {
    usage.diagnosisCount = 0;
    usage.periodStart = Date.now();
  }

  if (usage.diagnosisCount >= limit) {
    return { allowed: false, message: "Quota atteint pour votre forfait actuel. Veuillez passer à un forfait supérieur." };
  }

  usage.diagnosisCount += 1;
  usageTracking.set(phone, usage);
  return { allowed: true };
}

// Lazy-initialize the GoogleGenAI client with key and telemetry header
let aiInstance: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("La clé API Gemini (GEMINI_API_KEY) n'est pas configurée. Veuillez l'ajouter dans les Paramètres d'AI Studio pour activer le diagnostic IA.");
  }
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiInstance;
}

/**
 * Retry helper with exponential backoff for transient errors
 */
async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3, initialDelayMs = 1000): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      const isTransient = 
        !error.status || // standard network errors
        error.status === 503 || 
        error.status === 429 || 
        error.status === 504 ||
        error.status === 500 ||
        error.message?.includes("503") ||
        error.message?.includes("429") ||
        error.message?.includes("UNAVAILABLE") ||
        error.message?.includes("high demand") ||
        error.message?.includes("overloaded");
      
      if (!isTransient || attempt >= maxRetries) {
        throw error;
      }
      const delay = initialDelayMs * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4);
      console.warn(`[Gemini API] Transient error (attempt ${attempt}/${maxRetries}). Retrying in ${Math.round(delay)}ms... Error:`, error.message || error);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Executes a generateContent call with automatic fallback models and retries
 */
async function generateContentWithFallbackAndRetry(
  contents: any,
  config: any,
  primaryModel: string = "gemini-3.5-flash"
): Promise<any> {
  const modelsToTry = [primaryModel, "gemini-3.1-flash-lite", "gemini-flash-latest"];
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    try {
      console.log(`[Gemini API] Attempting generation with model: ${modelName}`);
      const result: any = await retryWithBackoff(async () => {
        return await getAIClient().models.generateContent({
          model: modelName,
          contents,
          config,
        });
      }, 3, 1000);
      
      if (result) {
        result.modelUsedForGeneration = modelName;
      }
      return result;
    } catch (error: any) {
      console.error(`[Gemini API] Failed with model ${modelName}:`, error.message || error);
      lastError = error;
      // If it's 400 Bad Request or 401/403, do not try other models as it's a client configuration/syntax error
      if (error.status === 400 || error.status === 401 || error.status === 403) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // BUG CORRIGÉ (détecté en déploiement réel sur Render) : sans ce réglage, Express ne fait pas
  // confiance à l'en-tête X-Forwarded-For envoyé par le proxy de l'hébergeur (Render, ou tout
  // reverse-proxy comme Nginx). Résultat : express-rate-limit ne peut pas identifier correctement
  // l'IP réelle du client, ce qui casse la protection anti brute-force sur les routes d'authentification.
  // "1" = fait confiance au premier proxy en amont (configuration standard derrière Render/Nginx).
  app.set("trust proxy", 1);

  // Sécurité HTTP standard (headers)
  app.use(helmet({
    contentSecurityPolicy: false, // désactivé pour ne pas casser Vite en dev ; à durcir en prod si besoin
    crossOriginEmbedderPolicy: false,
  }));

  // Configure high payload limit for base64 images, videos, and audios
  // FAILLE CORRIGÉE : cette limite de 50 Mo s'appliquait à TOUTES les routes, y compris celles
  // non authentifiées (OTP, admin, statut...). Un attaquant pouvait saturer la bande passante et
  // la mémoire du serveur en envoyant des requêtes volumineuses en boucle à ces routes légères,
  // avant même toute vérification d'authentification. Seules les routes qui traitent réellement
  // des médias (photos/vidéos/audio en base64) ont maintenant droit à des payloads volumineux ;
  // toutes les autres sont plafonnées à 2 Mo.
  const LARGE_PAYLOAD_PATHS = new Set([
    "/api/diagnose",
    "/api/diagnostic/loop/start",
    "/api/diagnostic/loop/step",
  ]);
  const SMALL_PAYLOAD_LIMIT_BYTES = 2 * 1024 * 1024; // 2MB
  app.use((req, res, next) => {
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    if (!LARGE_PAYLOAD_PATHS.has(req.path) && contentLength > SMALL_PAYLOAD_LIMIT_BYTES) {
      return res.status(413).json({ success: false, message: "Requête trop volumineuse pour cette route." });
    }
    next();
  });
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Anti-abus : limite le nombre de requêtes sur les routes sensibles (SMS/OTP coûtent de l'argent, auth = cible de brute-force)
  const otpSendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Trop de demandes de code. Veuillez réessayer dans quelques minutes." },
  });
  const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Trop de tentatives. Veuillez réessayer dans quelques minutes." },
  });
  const diagnoseLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Trop de requêtes de diagnostic. Ralentissez un peu." },
  });
  const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Trop de tentatives d'accès administrateur." },
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Trop de tentatives de connexion. Veuillez réessayer dans quelques minutes." },
  });

  // API Route: Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // API Route: Diagnose vehicle issue
  app.post("/api/diagnose", diagnoseLimiter, requireAuth, async (req: any, res) => {
    try {
      const { phone, plan } = req.session;
      const check = checkAndIncrementUsage(phone, plan);
      if (!check.allowed) {
        return res.status(403).json({ success: false, message: check.message });
      }

      const {
        vehicleBrand,
        vehicleModel,
        vehicleYear,
        vehicleEngine,
        textDescription,
        file,        // Base64-encoded file contents
        mimeType,    // MIME type (e.g., image/jpeg, audio/wav, etc.)
      } = req.body;

      // Construct parts array for Gemini 3.5 Flash
      const parts: any[] = [];

      // Add file attachment if present
      if (file && mimeType) {
        parts.push({
          inlineData: {
            data: file,
            mimeType: mimeType,
          },
        });
      }

      // Construct detailed textual prompt
      let promptText = `Analyse cette demande de diagnostic de panne de véhicule.
Informations sur le véhicule :
- Marque/Modèle/Année : ${vehicleBrand || "Inconnu"} ${vehicleModel || ""} ${vehicleYear || ""}
- Motorisation : ${vehicleEngine || "Inconnue"}

Description du problème par l'utilisateur :
"${textDescription || "Aucune description textuelle fournie par l'utilisateur."}"
`;

      if (file && mimeType) {
        promptText += `\nUn fichier multimédia de type (${mimeType}) a été joint par l'utilisateur (image du tableau de bord ou de codes OBD, enregistrement audio d'un bruit suspect, ou vidéo).
Analyse-le attentivement pour y repérer des voyants, des codes d'erreur DTC textuels (comme EPB C112A, C2006, etc.), des bruits moteurs anormaux ou des indices de pannes visuels afin d'établir un diagnostic d'expert.`;
      }

      parts.push({ text: promptText });

      const systemInstruction = `Tu es DiagAssist, un technicien automobile expérimenté qui accompagne un mécanicien ou un particulier étape par étape dans un diagnostic réel, avec des outils simples et accessibles en Afrique francophone (Côte d'Ivoire / Abidjan). Tu ne réponds jamais comme un dictionnaire de codes défauts. Tu mènes une enquête.

COURTOISIE ET TON OBLIGATOIRES (EN TOUTE CIRCONSTANCE) :
- Tu commences toujours la première interaction par une salutation chaleureuse et professionnelle : "Bonjour, je suis DiagAssist, votre assistant de diagnostic. Je vais vous accompagner étape par étape pour trouver la cause de votre problème."
- Tu vouvoies TOUJOURS l'utilisateur avec respect et bienveillance, même s'il est bref, impatient ou frustré.
- Ton calme, professionnel et bienveillant (sans pour autant remercier à chaque phrase).

RÈGLE D'OR (NON NÉGOCIABLE) :
NE JAMAIS SAUTER DIRECTEMENT D'UN CODE DÉFAUT OU D'UN SYMPTÔME À UNE PIÈCE À REMPLACER.
Séquence obligatoire : historique → symptôme → outils disponibles → codes → hiérarchisation → prérequis → test guidé → résultat → nouvelle étape → confirmation → diagnostic final.
Un code défaut est un indice, jamais une conclusion. Une pièce n'est condamnée qu'après un test qui le démontre.

ÉTAPES DU MOTEUR DE DIAGNOSTIC :

RÈGLE D'ACHAT DE PIÈCES DÉFECTUEUSES (OBLIGATOIRE) :
À chaque fois qu'une pièce est identifiée ou confirmée comme défectueuse ou à remplacer (dans le résumé, les causes, les recommandations immédiates, ou les étapes du guide de réparation), recommande SYSTÉMATIQUEMENT à l'utilisateur de nous contacter pour l'achat et la commande de pièces de rechange d'origine et garanties au numéro direct : 0141116026.

ÉTAPE 0 — HISTORIQUE (OBLIGATOIRE, TOUJOURS EN PREMIER) :
Si l'historique d'intervention récente n'est pas renseigné, demande systématiquement : "Avant de commencer, dites-moi : avez-vous (ou un autre mécanicien) déjà touché à ce véhicule récemment ? Changement de pièce, batterie, fils débranchés ou coupés, réparation en cours, nettoyage moteur ? Si oui, quoi exactement et quand ?"
Si une intervention récente a eu lieu, demande si les codes ou symptômes sont apparus avant ou après, et traite les éléments liés à cette intervention comme suspects prioritaires.

ÉTAPE 1 — IDENTIFICATION DU VÉHICULE :
Analyse la marque, le modèle, l'année, la motorisation, le kilométrage et la boîte. Vérifie la cohérence.

ÉTAPE 2 — DESCRIPTION DU SYMPTÔME :
Analyse le problème, les conditions (à froid/chaud, au démarrage/en roulant), la régularité, les bruits, odeurs ou fumées. Pour un calage ("démarre puis cale"), vérifie si le délai est fixe (antidémarrage) ou variable (carburant/compression).

ÉTAPE 3 — INVENTAIRE DES OUTILS DISPONIBLES :
Ne présume JAMAIS que l'utilisateur a un multimètre. Demande quels outils simples il possède (lampe témoin 12V, compressiomètre, jauge de pression carburant, tournevis/tige métallique en stéthoscope).
Si un outil nécessaire manque, intègre UNE SEULE FOIS par outil manquant l'invitation d'achat structurée TOUJOURS APRÈS l'explication du rôle du test :
"Je comprends que vous n'ayez pas de [nom de l'outil] sous la main. Cet outil est précieux ici car il va nous permettre de [rappel très bref de ce que ce test va révéler]. Si vous souhaitez vous en procurer un rapidement, nous pouvons vous le fournir : il vous suffit de contacter le 0141116026. Sinon, dites-le-moi et je verrai avec vous s'il existe une autre façon de procéder."

ÉTAPE 4 — LECTURE DES CODES :
Distingue codes génériques EOBD/OBD (P0xxx) et codes constructeur. Regroupe les codes par cause électrique ou mécanique commune en amont.

ÉTAPE 5 — HIÉRARCHISATION ET PRÉREQUIS :
Classe les pistes : 🔴 Critique, 🟠 Prioritaire, 🟡 À contrôler, 🟢 Confirmé, ⚪ Inconnu.
Ne propose jamais de remplacement de pièce sur une piste 🟡 ou ⚪ tant qu'une piste 🔴 n'est pas validée ou écartée.

ÉTAPE 6 — TEST GUIDÉ (UN SEUL À LA FOIS) :
Dans tes recommandations et étapes de réparation, propose toujours un seul test précis à la fois au format :
TEST [N] — [nom]
Pourquoi ce test : [explication 1-2 phrases simples]
Outil nécessaire : [outil simple]
Comment faire : [étapes 1, 2, 3]
Ce qu'il faut observer : [résultat attendu]
Propose toujours aussi deux options : "Je ne sais pas faire ce test" et "Mon résultat ne correspond à rien de prévu".

ÉTAPE 7 — INTERPRÉTATION ET NON-CONDAMNATION PRÉMATURÉE :
Vérifie toujours alimentation, masse, câblage, mécanique de base avant d'annoncer une pièce défaillante.

STRUCTURE DE SUIVI D'ÉTAT (SESSION STATE JSON) :
Maintiens mentalement et dans ton raisonnement la structure d'état de la session :
{ vehicule, historique_intervention, symptome, outils_disponibles, outils_invitation_envoyee, codes_releves, hypotheses, prerequisites, current_test, tests_done, hypotheses_ecartees, diagnostic_final }.

RÈGLES DE FORMATAGE VOCAL ET DE TON (CRUCIAL) :
- Identité : Tu es DiagAssist. Si demandé qui tu es : "Bonjour, je suis DiagAssist, votre assistant de diagnostic. Je vous écoute."
- Vouvoiement constant, langage professionnel, bienveillant et fluide.
- FORMATAGE SANS MARKDOWN DANS 'explanationText' ET LES CHAMPS VOCAUX : Ne génère AUCUN caractère markdown (pas d'astérisques, pas de gras, pas de hashtags, pas de puces avec tirets). Écris en phrases fluides et naturelles directement lisibles à haute voix.`;

      // Call Gemini 3.5 Flash with JSON schema constraint (with fallback and retries)
      const response = await generateContentWithFallbackAndRetry(
        { parts },
        {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              brandModelInfo: {
                type: Type.STRING,
                description: "La marque, le modèle et l'année identifiés ou confirmés du véhicule.",
              },
              dtcCodesDetected: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    code: { type: Type.STRING, description: "Le code d'erreur OBD / DTC (ex: C112A, P0300)." },
                    description: { type: Type.STRING, description: "La description claire du défaut en français." },
                  },
                  required: ["code", "description"],
                },
                description: "La liste des codes de défaut DTC identifiés dans la description ou l'image.",
              },
              severity: {
                type: Type.STRING,
                description: "Le niveau de gravité de la panne : 'Faible', 'Moyen', 'Élevé' ou 'Critique'.",
              },
              severityDescription: {
                type: Type.STRING,
                description: "Une explication rapide de pourquoi ce niveau de gravité a été choisi et s'il est sûr de rouler.",
              },
              probableCauses: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Les causes probables à l'origine de ce problème.",
              },
              immediateRecommendations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Actions recommandées immédiatement pour la sécurité de l'utilisateur.",
              },
              repairGuideSteps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    stepNumber: { type: Type.INTEGER },
                    title: { type: Type.STRING, description: "Nom ou action principale de l'étape." },
                    description: { type: Type.STRING, description: "Détails pas-à-pas sur la façon d'opérer." },
                    estimatedTime: { type: Type.STRING, description: "Le temps estimé pour cette étape (ex: '30 min', '2 heures')." },
                  },
                  required: ["stepNumber", "title", "description", "estimatedTime"],
                },
                description: "Le guide de réparation étape par étape conseillé pour résoudre cette panne.",
              },
              estimatedCosts: {
                type: Type.OBJECT,
                properties: {
                  partsMin: { type: Type.NUMBER, description: "Prix minimum estimé des pièces de rechange (€)." },
                  partsMax: { type: Type.NUMBER, description: "Prix maximum estimé des pièces de rechange (€)." },
                  laborMin: { type: Type.NUMBER, description: "Coût minimum estimé de la main d'œuvre en garage (€)." },
                  laborMax: { type: Type.NUMBER, description: "Coût maximum estimé de la main d'œuvre en garage (€)." },
                  currency: { type: Type.STRING, description: "La devise utilisée, toujours 'EUR'." },
                },
                required: ["partsMin", "partsMax", "laborMin", "laborMax", "currency"],
              },
              explanationText: {
                type: Type.STRING,
                description: "Un résumé global explicatif, rassurant et professionnel rédigé pour l'utilisateur en français.",
              },
            },
            required: [
              "brandModelInfo",
              "dtcCodesDetected",
              "severity",
              "severityDescription",
              "probableCauses",
              "immediateRecommendations",
              "repairGuideSteps",
              "estimatedCosts",
              "explanationText",
            ],
          },
        }
      );

      // Extract generated text
      const responseText = response.text;
      if (!responseText) {
        throw new Error("Gemini n'a renvoyé aucune réponse.");
      }

      // Extract real token usage metadata
      const promptTokens = response.usageMetadata?.promptTokenCount || 0;
      const candidatesTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const totalTokens = response.usageMetadata?.totalTokenCount || 0;

      // Gemini 3.5 Flash pricing details:
      // Input tokens: $0.075 per 1,000,000 tokens ($0.000000075 / token)
      // Output tokens: $0.30 per 1,000,000 tokens ($0.000000300 / token)
      const inputCost = promptTokens * 0.000000075;
      const outputCost = candidatesTokens * 0.000000300;
      const totalCostUSD = inputCost + outputCost;

      // Parse JSON payload returned by Gemini
      const diagnosisData = JSON.parse(responseText.trim());

      // Add actual API usage metadata to the response
      res.json({
        success: true,
        diagnosis: diagnosisData,
        apiUsage: {
          promptTokens,
          candidatesTokens,
          totalTokens,
          estimatedCostUSD: parseFloat(totalCostUSD.toFixed(7)),
          modelUsed: response.modelUsedForGeneration || "gemini-3.5-flash",
        },
      });
    } catch (error: any) {
      // FUITE D'INFORMATION CORRIGÉE : le détail technique brut de l'erreur (potentiellement
      // des informations d'infrastructure interne) n'est plus renvoyé au client, seulement loggé.
      console.error("Error during diagnosis:", error);
      res.status(500).json({
        success: false,
        message: "Une erreur est survenue lors de l'analyse avec l'IA. Veuillez réessayer dans un instant.",
      });
    }
  });

  // API Route: Contextual follow-up chat
  app.post("/api/chat", requireAuth, async (req: any, res) => {
    try {
      const { message, history, diagnosticContext } = req.body;

      if (!message) {
        return res.status(400).json({ success: false, message: "Le message est requis." });
      }

      // BUG CORRIGÉ : cette route n'imposait aucune vérification de forfait — un compte
      // "free_expired" (0 diagnostic autorisé) pouvait quand même discuter indéfiniment
      // avec l'IA gratuitement via le chat de suivi, en contournant totalement le quota.
      const { plan } = req.session;
      if ((PLAN_LIMITS[plan] ?? 0) <= 0) {
        return res.status(403).json({ success: false, message: "Votre forfait actuel ne permet pas d'utiliser le chat de suivi. Veuillez souscrire à une formule." });
      }

      const systemInstruction = `Tu es DiagAssist, un technicien automobile expérimenté qui accompagne un mécanicien ou un particulier étape par étape dans un diagnostic réel, avec des outils simples et accessibles en Afrique francophone (Côte d'Ivoire / Abidjan). Tu ne réponds jamais comme un dictionnaire de codes défauts. Tu mènes une enquête.

COURTOISIE ET TON OBLIGATOIRES (EN TOUTE CIRCONSTANCE) :
- Tu commences toujours par une salutation chaleureuse et professionnelle lors des premiers échanges : "Bonjour, je suis DiagAssist, votre assistant de diagnostic. Je vais vous accompagner étape par étape pour trouver la cause de votre problème."
- Tu vouvoies TOUJOURS l'utilisateur avec respect et bienveillance, même s'il est bref, impatient ou frustré.
- Ton calme, professionnel et bienveillant (sans pour autant remercier à chaque message).

RÈGLE D'OR (NON NÉGOCIABLE) :
NE JAMAIS SAUTER DIRECTEMENT D'UN CODE DÉFAUT OU D'UN SYMPTÔME À UNE PIÈCE À REMPLACER.
Séquence obligatoire : historique → symptôme → outils disponibles → codes → hiérarchisation → prérequis → test guidé → résultat → nouvelle étape → confirmation → diagnostic final.
Un code défaut est un indice, jamais une conclusion. Une pièce n'est condamnée qu'après un test qui le démontre.

ÉTAPES DE DIAGNOSTIC À APPLIQUER DANS LA CONVERSATION :
0. RÈGLE D'ACHAT DE PIÈCES DÉFECTUEUSES : À chaque fois qu'une pièce défectueuse ou à remplacer est mentionnée ou confirmée dans la conversation, recommande systématiquement à l'utilisateur de nous contacter directement pour l'achat de sa pièce de rechange garantie au 0141116026.
1. HISTORIQUE (Étape 0) : Si non connu, demande d'abord : "Avant de commencer, dites-moi : avez-vous (or un autre mécanicien) déjà touché à ce véhicule récemment ? Changement de pièce, batterie, fils débranchés ou coupés, réparation en cours, nettoyage moteur ? Si oui, quoi exactement et quand ?"
2. SYMPTÔME (Étape 2) : Pour un calage ("démarre puis cale"), demande si le délai avant calage est le même à chaque essai (antidémarrage/allumage) ou variable (carburant/compression).
3. OUTILS DISPONIBLES (Étape 3) : Ne présume jamais qu'il a un multimètre. Privilégie les outils simples (lampe témoin 12V, compressiomètre, jauge de pression carburant, tournevis/tige métallique en stéthoscope).
   Si un outil manque, intègre UNE SEULE FOIS par outil manquant l'invitation d'achat structurée TOUJOURS APRÈS l'explication du rôle du test :
   "Je comprends que vous n'ayez pas de [nom de l'outil] sous la main. Cet outil est précieux ici car il va nous permettre de [rappel très bref de ce que ce test va révéler]. Si vous souhaitez vous en procurer un rapidement, nous pouvons vous le fournir : il vous suffit de contacter le 0141116026. Sinon, dites-le-moi et je verrai avec vous s'il existe une autre façon de procéder."
4. TEST GUIDÉ (Étape 6) : Propose UN SEUL TEST À LA FOIS au format :
   TEST [N] — [nom]
   Pourquoi ce test : [explication simple]
   Outil nécessaire : [nom]
   Comment faire : 1. ... 2. ...
   Ce qu'il faut observer : ...
   Propose aussi les options : "Je ne sais pas faire ce test" et "Mon résultat ne correspond à rien de prévu".
5. HIÉRARCHISATION : 🔴 Critique, 🟠 Prioritaire, 🟡 À contrôler, 🟢 Confirmé, ⚪ Inconnu. Ne propose aucun remplacement pour 🟡 ou ⚪ sans avoir validé/écarté 🔴.

GESTION ET RELECTURE DES MÉDIAS DE SESSION (PHOTOS / VIDÉOS / AUDIO) :
L'utilisateur peut transmettre une photo, vidéo ou enregistrement audio À TOUT MOMENT de la conversation.
1. Analyse chaque média immédiatement (photo d'un multimètre affichant la tension, lampe témoin, voyant tableau de bord, fusible, enregistrement du son moteur, vidéo).
2. Mets à jour et conserve dans l'état de la session le registre des médias :
"medias_session": [
  {
    "id": "m1",
    "type": "photo | video | audio",
    "horodatage": "ISO",
    "etape_liee": "Test ou symptôme concerné",
    "resume_analyse": "Description de l'observation visuelle ou sonore",
    "url_stockage": ""
  }
]
3. RÈGLE CRITIQUE DE RELECTURE : Avant de poser une question ("Entrez votre résultat") ou de demander un test, consulte TOUJOURS "medias_session" et les médias joints. Si un média déjà reçu répond au test (ex: photo montrant l'affichage du multimètre à 12.6V ou 0V), VALIDE LE RÉSULTAT DU TEST IMMÉDIATEMENT sans redemander la valeur en texte au mécanicien.

STRUCTURE DE SUIVI D'ÉTAT (SESSION STATE JSON) :
Maintiens l'état de la session : { vehicule, historique_intervention, symptome, outils_disponibles, outils_invitation_envoyee, codes_releves, hypotheses, prerequisites, current_test, tests_done, hypotheses_ecartees, medias_session, diagnostic_final }.

CONTEXTE TECHNIQUE DU VÉHICULE ACTUEL :
${JSON.stringify(diagnosticContext || {})}

FORMATAGE CRITIQUE POUR LA VOIX :
Tes réponses sont lues directement à haute voix. Tu ne dois JAMAIS utiliser de caractères de formatage markdown comme des astérisques (pas de gras, pas d'italique), pas de hashtags, pas de puces avec tirets. Rédige uniquement de simples phrases fluides et naturelles.`;

      // Format history into the standard contents parameter structure
      const contentsPayload: any[] = [];

      // Append historical messages if any, including media parts
      if (Array.isArray(history)) {
        for (const msg of history) {
          const parts: any[] = [{ text: msg.text || "" }];
          if (msg.file && msg.mimeType) {
            parts.push({
              inlineData: {
                data: msg.file,
                mimeType: msg.mimeType,
              },
            });
          }
          contentsPayload.push({
            role: msg.role === "user" ? "user" : "model",
            parts: parts,
          });
        }
      }

      // Append the latest user message with optional media data
      const userParts: any[] = [{ text: message }];
      if (req.body.file && req.body.mimeType) {
        userParts.push({
          inlineData: {
            data: req.body.file,
            mimeType: req.body.mimeType,
          },
        });
      }

      contentsPayload.push({
        role: "user",
        parts: userParts,
      });

      // Query Gemini 3.5 Flash for conversational feedback (with fallback and retries)
      const response = await generateContentWithFallbackAndRetry(
        contentsPayload,
        {
          systemInstruction,
        }
      );

      const responseText = response.text || "Je n'ai pas pu générer de réponse.";
      const promptTokens = response.usageMetadata?.promptTokenCount || 0;
      const candidatesTokens = response.usageMetadata?.candidatesTokenCount || 0;
      
      const inputCost = promptTokens * 0.000000075;
      const outputCost = candidatesTokens * 0.000000300;
      const totalCostUSD = inputCost + outputCost;

      res.json({
        success: true,
        reply: responseText,
        apiUsage: {
          promptTokens,
          candidatesTokens,
          totalTokens: promptTokens + candidatesTokens,
          estimatedCostUSD: parseFloat(totalCostUSD.toFixed(7)),
          modelUsed: response.modelUsedForGeneration || "gemini-3.5-flash",
        },
      });
    } catch (error: any) {
      console.error("Error in follow-up chat:", error);
      res.status(500).json({
        success: false,
        message: "Une erreur est survenue lors de la discussion avec l'IA. Veuillez réessayer dans un instant.",
      });
    }
  });

  // API Route: Text-to-Speech proxy to Google Cloud TTS or ElevenLabs for high-quality voices
  // FAILLE CORRIGÉE : cette route n'exigeait aucune authentification (coût API illimité pour
  // n'importe qui), et utilisait en secours une VRAIE clé API ElevenLabs codée en dur dans le
  // code source. Cette clé doit être révoquée/régénérée dans votre compte ElevenLabs sans délai.
  app.post("/api/tts", requireAuth, async (req: any, res) => {
    try {
      const { text, voiceName } = req.body;
      if (!text) {
        return res.status(400).json({ success: false, message: "Le texte est requis." });
      }
      if ((PLAN_LIMITS[req.session.plan] ?? 0) <= 0) {
        return res.status(403).json({ success: false, message: "Votre forfait actuel ne permet pas la synthèse vocale. Veuillez souscrire à une formule." });
      }

      const requestedVoice = voiceName || "fr-FR-Neural2-B";

      // If ElevenLabs voice is requested
      if (requestedVoice.startsWith("eleven-")) {
        const elevenApiKey = (process.env.ELEVENLABS_API_KEY || "").trim();
        if (!elevenApiKey) {
          return res.status(503).json({ success: false, message: "La synthèse vocale ElevenLabs n'est pas configurée sur ce serveur." });
        }

        let voiceId = "ErXwobaYiN019PkySvjV"; // Antoni (Multilingual Male) - standard pre-made voice (works on Free plan!)
        if (requestedVoice === "eleven-french-female") {
          voiceId = "EXAVITQu4vr4xnSDTEMa"; // Bella (Multilingual Female)
        } else if (requestedVoice === "eleven-french-rachel") {
          voiceId = "21m00Tcm4TlvDq8ikWAM"; // Rachel
        } else if (requestedVoice === "eleven-french-adrien" || requestedVoice.includes("adrien")) {
          voiceId = "ErXwobaYiN019PkySvjV"; // Antoni (Male) - standard pre-made voice (works on Free plan!)
        } else if (requestedVoice === "eleven-french-christophe" || requestedVoice.includes("pCFUI8NKdn1YbzEjbkkM") || requestedVoice.includes("ErXwobaYiN019PkySvjV")) {
          voiceId = "ErXwobaYiN019PkySvjV"; // Antoni (Male) - standard pre-made voice (works on Free plan!)
        } else if (process.env.ELEVENLABS_VOICE_ID) {
          voiceId = process.env.ELEVENLABS_VOICE_ID;
        }

        const elevenLabsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
        const response = await fetch(elevenLabsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": elevenApiKey,
            "accept": "audio/mpeg"
          },
          body: JSON.stringify({
            text: text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75
            }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`ElevenLabs API Error (${response.status}): ${errText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const base64Audio = Buffer.from(arrayBuffer).toString("base64");

        return res.json({
          success: true,
          audioContent: base64Audio,
          modelUsed: `ElevenLabs - ${voiceId}`
        });
      }

      // Google Cloud TTS route - fallback to GEMINI_API_KEY if GOOGLE_CLOUD_API_KEY is not set
      const apiKey = process.env.GOOGLE_CLOUD_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ 
          success: false, 
          message: "La clé API de synthèse vocale n'est pas configurée dans les variables d'environnement. Utilisation de la synthèse vocale locale gratuite." 
        });
      }

      const googleTtsUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
      const payload = {
        input: { text },
        voice: {
          languageCode: "fr-FR",
          name: requestedVoice
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: 1.1,
          sampleRateHertz: 24000
        }
      };

      const response = await fetch(googleTtsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "aistudio-build-tts"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Google Cloud TTS API Error (${response.status}): ${errText}`);
      }

      const data: any = await response.json();
      if (!data.audioContent) {
        throw new Error("L'API Google Cloud TTS n'a pas renvoyé d'audio.");
      }

      res.json({
        success: true,
        audioContent: data.audioContent,
        modelUsed: requestedVoice
      });
    } catch (error: any) {
      console.log("TTS Generation Fallback - Local or client voice synthesis will be used.", error.message);
      res.status(500).json({
        success: false,
        message: "Impossible de générer la voix de synthèse haute qualité pour le moment.",
      });
    }
  });

  // API Route: Send WhatsApp OTP (canal unique)
  app.post("/api/auth/send-otp", otpSendLimiter, async (req, res) => {
    try {
      const { phoneNumber, countryCode } = req.body;
      if (!phoneNumber) {
        return res.status(400).json({ success: false, message: "Numéro de téléphone requis." });
      }

      const activeChannel = "whatsapp" as const;

      // Clean the number
      const cleanPhone = phoneNumber.replace(/\s+/g, "");
      const fullPhone = `${countryCode || "+225"}${cleanPhone}`;

      // En production, Twilio DOIT être configuré : sinon le code ne serait ni envoyé ni révélé,
      // ce qui bloquerait silencieusement toute connexion. On préfère un message d'erreur clair.
      if (process.env.NODE_ENV === "production" && !(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)) {
        console.error("[send-otp] TWILIO non configuré en production — impossible d'envoyer un code réel.");
        return res.status(503).json({ success: false, message: "Le service d'envoi de code par WhatsApp est temporairement indisponible. Merci de réessayer plus tard." });
      }

      // Generate random 6-digit OTP code
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

      // Store in memory with a 10 minutes expiry limit
      otpStorage.set(fullPhone, {
        code: otpCode,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      let sentRealMessage = false;
      let errorDetails = null;

      const hasTwilioConfig = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN;

      if (hasTwilioConfig) {
        try {
          const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

          const sandboxNumber = "whatsapp:+14155238886";
          const sender = process.env.TWILIO_WHATSAPP_NUMBER || sandboxNumber;
          const fromNumber = sender.startsWith("whatsapp:") ? sender : `whatsapp:${sender}`;
          const toNumber = `whatsapp:${fullPhone}`;

          await client.messages.create({
            body: `Votre code de validation de sécurité DiagAssist est : ${otpCode}. Ne le partagez jamais.`,
            from: fromNumber,
            to: toNumber,
          });
          sentRealMessage = true;
          console.log(`[Twilio WhatsApp] Code OTP réel ${otpCode} envoyé à ${toNumber} avec succès depuis ${fromNumber} !`);
        } catch (twilioErr: any) {
          console.error(`Erreur d'envoi Twilio (${activeChannel}) :`, twilioErr);
          errorDetails = twilioErr.message;
        }
      } else {
        console.log(`[OTP Mode Simulation] Code de sécurité généré pour ${fullPhone} (${activeChannel}) : ${otpCode} (Renseignez vos clés Twilio dans les secrets pour envoyer de vrais messages).`);
      }

      // Sécurité : ne JAMAIS renvoyer le code OTP au client en production, même en mode simulation
      // (sinon n'importe qui peut se connecter à n'importe quel numéro sans recevoir le SMS).
      const isProd = process.env.NODE_ENV === "production";
      const canRevealCode = !sentRealMessage && !isProd;

      res.json({
        success: true,
        sentRealSMS: sentRealMessage, // keep backwards compatibility in state names or return both
        sentRealMessage,
        activeChannel,
        otpCode: canRevealCode ? otpCode : undefined,
        isSimulated: !sentRealMessage,
        message: sentRealMessage
          ? "Un code de validation réel vient d'être envoyé sur votre compte WhatsApp."
          : "Mode simulation actif (WhatsApp). Utilisez le code fourni ci-dessous ou configurez Twilio.",
        errorDetails,
      });
    } catch (err: any) {
      console.error("Erreur dans send-otp:", err);
      res.status(500).json({ success: false, message: "Erreur serveur de communication OTP." });
    }
  });

  // API Route: Verify SMS OTP
  app.post("/api/auth/verify-otp", otpVerifyLimiter, async (req, res) => {
    try {
      const { phoneNumber, countryCode, code } = req.body;
      if (!phoneNumber || !code) {
        return res.status(400).json({ success: false, message: "Données manquantes pour la validation." });
      }

      const cleanPhone = phoneNumber.replace(/\s+/g, "");
      const fullPhone = `${countryCode || "+225"}${cleanPhone}`;

      // Anti brute-force par numéro : max 8 tentatives / 15 min, indépendamment du rate-limit global par IP
      const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
      const MAX_ATTEMPTS_PER_PHONE = 8;
      const attempts = otpAttempts.get(fullPhone) || { count: 0, windowStart: Date.now() };
      if (Date.now() - attempts.windowStart > ATTEMPT_WINDOW_MS) {
        attempts.count = 0;
        attempts.windowStart = Date.now();
      }
      if (attempts.count >= MAX_ATTEMPTS_PER_PHONE) {
        return res.status(429).json({ success: false, message: "Trop de tentatives pour ce numéro. Veuillez réessayer plus tard." });
      }

      // Dev master OTP check (never active in production unless DEV_MASTER_OTP is explicitly set)
      const DEV_MASTER_OTP = process.env.DEV_MASTER_OTP;
      if (process.env.NODE_ENV !== "production" && DEV_MASTER_OTP && code === DEV_MASTER_OTP) {
        const token = createSession(fullPhone);
        return res.json({
          success: true,
          message: "Connexion test (dev uniquement).",
          sessionToken: token,
        });
      }
 
      const stored = otpStorage.get(fullPhone);
      if (!stored) {
        attempts.count += 1;
        otpAttempts.set(fullPhone, attempts);
        return res.status(400).json({ success: false, message: "Aucun code n'a été demandé pour ce numéro." });
      }
 
      if (Date.now() > stored.expiresAt) {
        otpStorage.delete(fullPhone);
        return res.status(400).json({ success: false, message: "Le code a expiré. Veuillez en demander un nouveau." });
      }
 
      if (stored.code !== code) {
        attempts.count += 1;
        otpAttempts.set(fullPhone, attempts);
        return res.status(400).json({ success: false, message: "Code de validation incorrect." });
      }
 
      // Consume OTP
      otpStorage.delete(fullPhone);
      otpAttempts.delete(fullPhone);
 
      const token = createSession(fullPhone);
      res.json({
        success: true,
        message: "Numéro de téléphone validé et authentifié avec succès.",
        sessionToken: token,
      });
    } catch (err: any) {
      console.error("Erreur dans verify-otp:", err);
      res.status(500).json({ success: false, message: "Erreur de validation." });
    }
  });

  // API Route: Get real user status (quota and subscription plan)
  app.get("/api/user/status", requireAuth, (req: any, res) => {
    const { phone, plan } = req.session;
    const usage = usageTracking.get(phone) || { diagnosisCount: 0 };
    const limit = PLAN_LIMITS[plan] ?? 0;
    const planRecord = userPlans.get(phone);
    const duration = planRecord ? PLAN_DURATIONS_MS[planRecord.plan] : undefined;
    // expiresAt calculé côté serveur (source de vérité) — le client ne doit plus deviner
    // une échéance à partir d'une horloge locale non fiable (bug corrigé).
    const expiresAt = planRecord && duration ? planRecord.activatedAt + duration : null;
    const isAdmin = userAccounts.get(phone)?.isAdmin ?? false;
    res.json({
      success: true,
      plan,
      phone,
      diagnosisCount: usage.diagnosisCount,
      limit: limit === Infinity ? null : limit,
      remaining: limit === Infinity ? null : Math.max(0, limit - usage.diagnosisCount),
      expiresAt,
      isAdmin,
    });
  });

  // API Route: Demande d'activation de forfait après paiement Wave (validation MANUELLE par l'admin)
  // Le client ne peut plus s'auto-attribuer un plan : il signale seulement qu'il a payé,
  // et c'est l'admin qui active réellement le forfait via /api/admin/activate-plan après vérification du paiement Wave.
  const pendingActivations = new Map<string, { phone: string; plan: string; amount?: number; note?: string; requestedAt: number }>();

  app.post("/api/user/request-plan", requireAuth, (req: any, res) => {
    const { plan, amount, note } = req.body;
    if (!plan) {
      return res.status(400).json({ success: false, message: "Le plan est requis." });
    }
    const { phone } = req.session;
    const requestId = crypto.randomBytes(8).toString("hex");
    pendingActivations.set(requestId, { phone, plan, amount, note, requestedAt: Date.now() });
    console.log(`[Activation en attente] ${phone} demande le forfait "${plan}" (réf: ${requestId}). À valider manuellement après vérification du paiement Wave.`);
    res.json({
      success: true,
      message: "Votre demande a bien été enregistrée. Votre forfait sera activé dès la vérification manuelle de votre paiement Wave (généralement sous quelques minutes).",
      requestId,
    });
  });

  // API Route (ADMIN UNIQUEMENT) : liste des demandes d'activation en attente
  app.get("/api/admin/pending-activations", adminLimiter, requireAdminAuth, (req, res) => {
    const list = Array.from(pendingActivations.entries()).map(([id, v]) => ({ id, ...v }));
    res.json({ success: true, pending: list });
  });

  // API Route (ADMIN UNIQUEMENT) : active réellement un forfait pour un numéro, après vérification manuelle du paiement Wave
  app.post("/api/admin/activate-plan", adminLimiter, requireAdminAuth, (req, res) => {
    const { phone, plan, requestId } = req.body;
    if (!phone || !plan) {
      return res.status(400).json({ success: false, message: "phone et plan sont requis." });
    }
    if (!(plan in PLAN_LIMITS)) {
      return res.status(400).json({ success: false, message: `Plan inconnu : "${plan}".` });
    }
    // Persisté par numéro : reste actif même si l'utilisateur se déconnecte/reconnecte,
    // et expirera automatiquement selon PLAN_DURATIONS_MS (voir getEffectivePlan).
    setUserPlan(phone, plan);
    // BUG CORRIGÉ : le compteur d'usage n'était jamais remis à zéro lors d'une nouvelle activation —
    // un client qui se réabonnait après expiration héritait de son ancien quota déjà consommé.
    usageTracking.set(phone, { diagnosisCount: 0, periodStart: Date.now() });

    let updated = 0;
    for (const [, session] of sessions) {
      if (session.phone === phone) {
        session.plan = plan;
        updated += 1;
      }
    }
    if (requestId) {
      pendingActivations.delete(requestId);
    }
    console.log(`[Admin] Forfait "${plan}" activé pour ${phone} (${updated} session(s) active(s) mise(s) à jour).`);
    res.json({ success: true, message: `Forfait "${plan}" activé pour ${phone}.`, sessionsUpdated: updated });
  });

  // API Route (ADMIN UNIQUEMENT) : crée ou met à jour le compte d'un client (numéro + mot de passe).
  // Vous communiquez ensuite ces identifiants directement au client (téléphone, en personne, etc.).
  app.post("/api/admin/create-account", adminLimiter, requireAdminAuth, (req, res) => {
    const { phone, password, plan, isAdmin, email } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ success: false, message: "phone et password sont requis." });
    }
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ success: false, message: "Le mot de passe doit faire au moins 6 caractères." });
    }
    createAccount(phone, password, Boolean(isAdmin), email);
    if (plan) {
      if (!(plan in PLAN_LIMITS)) {
        return res.status(400).json({ success: false, message: `Plan inconnu : "${plan}".` });
      }
      setUserPlan(phone, plan);
      usageTracking.set(phone, { diagnosisCount: 0, periodStart: Date.now() });
    }
    console.log(`[Admin] Compte créé/mis à jour pour ${phone}${plan ? ` avec le forfait "${plan}"` : ""}${isAdmin ? " (admin)" : ""}.`);
    res.json({ success: true, message: `Compte créé pour ${phone}. Communiquez-lui le mot de passe directement.` });
  });

  // API Route: l'utilisateur connecté change lui-même son mot de passe
  app.post("/api/user/change-password", authLimiter, requireAuth, (req: any, res) => {
    const { currentPassword, newPassword } = req.body;
    const { phone } = req.session;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Mot de passe actuel et nouveau mot de passe requis." });
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "Le nouveau mot de passe doit faire au moins 6 caractères." });
    }
    if (!verifyAccountPassword(phone, currentPassword)) {
      return res.status(401).json({ success: false, message: "Mot de passe actuel incorrect." });
    }
    const existing = userAccounts.get(phone);
    createAccount(phone, newPassword, existing?.isAdmin ?? false, existing?.email);
    res.json({ success: true, message: "Mot de passe mis à jour." });
  });

  // API Route (ADMIN UNIQUEMENT) : liste les comptes clients existants (sans les mots de passe)
  app.get("/api/admin/accounts", adminLimiter, requireAdminAuth, (req, res) => {
    const accounts = Array.from(userAccounts.entries()).map(([phone, acc]) => ({
      phone,
      createdAt: acc.createdAt,
      plan: userPlans.get(phone)?.plan || "free_trial",
      isAdmin: acc.isAdmin,
      email: acc.email || null,
    }));
    res.json({ success: true, accounts });
  });

  // API Route : connexion par numéro de téléphone + mot de passe (compte créé par l'admin)
  app.post("/api/auth/login", authLimiter, (req, res) => {
    const { phoneNumber, countryCode, password } = req.body;
    if (!phoneNumber || !password) {
      return res.status(400).json({ success: false, message: "Numéro de téléphone et mot de passe requis." });
    }
    const cleanPhone = phoneNumber.replace(/\s+/g, "");
    const fullPhone = `${countryCode || "+225"}${cleanPhone}`;

    // Anti brute-force par numéro (indépendant du rate-limit global par IP)
    const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
    const MAX_ATTEMPTS_PER_PHONE = 8;
    const attempts = loginAttempts.get(fullPhone) || { count: 0, windowStart: Date.now() };
    if (Date.now() - attempts.windowStart > ATTEMPT_WINDOW_MS) {
      attempts.count = 0;
      attempts.windowStart = Date.now();
    }
    if (attempts.count >= MAX_ATTEMPTS_PER_PHONE) {
      return res.status(429).json({ success: false, message: "Trop de tentatives pour ce numéro. Veuillez réessayer plus tard." });
    }

    if (!userAccounts.has(fullPhone) || !verifyAccountPassword(fullPhone, password)) {
      attempts.count += 1;
      loginAttempts.set(fullPhone, attempts);
      return res.status(401).json({ success: false, message: "Numéro ou mot de passe incorrect." });
    }

    loginAttempts.delete(fullPhone);
    const token = createSession(fullPhone);
    res.json({ success: true, message: "Connexion réussie.", sessionToken: token });
  });


  // API Route (ADMIN UNIQUEMENT) : vérifie un code d'accès admin sans jamais exposer le secret au client
  app.post("/api/admin/verify-code", adminLimiter, (req, res) => {
    const adminSecret = process.env.ADMIN_SECRET;
    const { code } = req.body;
    if (!adminSecret) {
      return res.status(503).json({ success: false, message: "Accès admin non configuré sur le serveur." });
    }
    if (code !== adminSecret) {
      return res.status(401).json({ success: false, message: "Code invalide." });
    }
    res.json({ success: true });
  });


  // ---------------------------------------------------------------------------
  // DIAGNOSTIC AUTO-QUESTIONING LOOP ENDPOINTS (/api/diagnostic/loop)
  // ---------------------------------------------------------------------------

  const loopStateStore = new Map<string, any>();

  // BUG CORRIGÉ : ni les sessions de diagnostic (loopStateStore, qui peuvent contenir des photos/
  // vidéos en base64), ni les codes OTP en attente, ni les compteurs anti brute-force n'étaient
  // jamais purgés — fuite mémoire qui finit par ralentir puis planter le serveur en production.
  const LOOP_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2h d'inactivité
  setInterval(() => {
    const now = Date.now();
    for (const [id, state] of loopStateStore) {
      if (now - (state._lastActivity || 0) > LOOP_SESSION_MAX_AGE_MS) {
        loopStateStore.delete(id);
      }
    }
    for (const [phone, entry] of otpStorage) {
      if (now > entry.expiresAt) {
        otpStorage.delete(phone);
      }
    }
    for (const [phone, entry] of otpAttempts) {
      if (now - entry.windowStart > 60 * 60 * 1000) {
        otpAttempts.delete(phone);
      }
    }
  }, 15 * 60 * 1000); // toutes les 15 minutes


  const loopResponseSchema = {
    type: Type.OBJECT,
    properties: {
      hypotheses: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            cause: { type: Type.STRING },
            confiance: { type: Type.INTEGER },
            type: { type: Type.STRING },
            lien_avec_dtc: { type: Type.STRING },
          },
          required: ["cause", "confiance", "type", "lien_avec_dtc"],
        },
      },
      incoherence_detectee: { type: Type.STRING, nullable: true },
      phase: { type: Type.STRING },
      next_question: { type: Type.STRING },
      test_protocole: {
        type: Type.OBJECT,
        properties: {
          outil: { type: Type.STRING, nullable: true },
          emplacement_exact: { type: Type.STRING, nullable: true },
          etat_vehicule: { type: Type.STRING, nullable: true },
          etat_thermique: { type: Type.STRING, nullable: true },
          valeur_reference_normale: { type: Type.STRING, nullable: true },
          niveau_invasivite: { type: Type.STRING, nullable: true },
          alerte_securite: { type: Type.STRING, nullable: true },
        },
      },
      type_reponse_attendue: { type: Type.STRING },
      preuve_photo_demandee: { type: Type.BOOLEAN },
      scanner_action: {
        type: Type.OBJECT,
        properties: {
          necessaire: { type: Type.BOOLEAN },
          demande: { type: Type.STRING, nullable: true },
        },
      },
      stop: { type: Type.BOOLEAN },
    },
    required: [
      "hypotheses",
      "phase",
      "next_question",
      "type_reponse_attendue",
      "preuve_photo_demandee",
      "stop",
    ],
  };

  const LOOP_SYSTEM_INSTRUCTION = `Tu es le système de diagnostic automobile de DiagAssist. À chaque tour :

1. Analyse tout l'historique fourni (symptôme, codes DTC, véhicule, 
   preuves initiales groupées, preuves accumulées, réponses précédentes).
   Ne redemande JAMAIS un test déjà présent dans les preuves initiales 
   ou déjà rapporté.

2. Respecte l'ordre de priorité :
   PHASE 1 (obligatoire avant toute question technique) : ce qui a été 
   fait sur le véhicule juste avant ou autour de l'apparition du code 
   (entretien, pièce changée, manipulation, débranchement), et les 
   circonstances précises d'apparition. Ne jamais ouvrir par "depuis 
   quand" — cible l'action/l'événement déclencheur, pas la durée.
   PHASE 2 : questions techniques SOUS FORME DE TEST GUIDÉ PAS À PAS, 
   dans l'ordre du moins invasif au plus invasif (visuel → mesure 
   simple → lecture scanner → démontage). Chaque test précise : outil, 
   emplacement exact (broche/couleur de fil si schéma disponible via 
   hp-web.in), état du véhicule requis (contact ON/moteur tournant/
   moteur éteint, à froid/à chaud), valeur de référence normale 
   attendue, et demande une photo du résultat plutôt qu'une valeur 
   tapée quand c'est pertinent (écran multimètre, écran scanner). 
   Ajoute une alerte sécurité avant tout test sur circuit haute 
   pression carburant, haute tension, ou airbag. Une seule action de 
   test par question.
   PHASE VALIDATION : une fois la réparation indiquée comme faite, 
   vérifie absence du symptôme après redémarrage et absence de retour 
   du code après effacement/cycle de conduite avant de clore.
   RÈGLE ACHAT PIÈCES DÉFECTUEUSES : Dès qu'une pièce est confirmée défectueuse 
   ou à remplacer, recommande systématiquement de nous contacter pour 
   l'achat de la pièce au 0141116026.

3. Règle anti-piège DTC : un code est un symptôme électrique détecté, 
   pas forcément la cause racine. Cherche toujours si le code peut 
   être une conséquence d'un problème amont. Signale toute incohérence 
   entre le symptôme décrit et la définition littérale du code.

4. Formule next_question en français oral simple, jargon mécanicien 
   Côte d'Ivoire (voir lexique ci-dessous), une seule idée par question, 
   en précisant toujours l'état moteur et l'état thermique si pertinent.

   LEXIQUE JARGON TERRAIN CÔTE D'IVOIRE (OBLIGATOIRE) :
   - Calculateur moteur (ECU) -> Boîte noire / cerveau de la voiture
   - Capteur position vilebrequin/came -> Le capteur qui donne l'info au moteur
   - Batterie auxiliaire -> La petite batterie / batterie de secours
   - Moteur tournant -> Moteur allumé / moteur en marche
   - Moteur éteint, contact mis -> Contact seulement / clé sur ON sans démarrer
   - À chaud -> Après roulage / moteur chaud
   - À froid -> Premier démarrage matin / à froid
   - Immobilisateur/EZS -> Le système anti-vol / le blocage démarrage
   - Faisceau électrique -> Le câblage / les fils
   - Ralenti instable -> Le moteur qui broute / qui tremble au ralenti
   - Calage moteur -> La voiture qui meurt / qui cale
   - Voyant Check Engine (MIL) -> Voyant check moteur

5. Si une mesure/lecture scanner est nécessaire et qu'aucun scanner 
   n'est identifié en session : demande le modèle, puis une photo si 
   besoin. Une fois identifié, utilise les informations pour donner le chemin 
   de menu exact et à jour.

6. Mets à jour les hypothèses avec un score de confiance (0-100). 
   Passe stop=true si confiance max ≥ 85% ET validation post-réparation 
   effectuée (ou hypothèse non actionnable actuellement), ou si 
   tour_actuel = tour_max, ou si tu allais reposer une question déjà 
   posée. Si le symptôme/code persiste après réparation, rouvre la 
   boucle sur les hypothèses restantes au lieu de conclure.

7. Réponds UNIQUEMENT en JSON selon le schéma fourni, aucun texte hors JSON.`;

  // Start a new Diagnostic Loop (Tour 0)
  app.post("/api/diagnostic/loop/start", requireAuth, async (req: any, res) => {
    try {
      const { phone, plan } = req.session;
      const check = checkAndIncrementUsage(phone, plan);
      if (!check.allowed) {
        return res.status(403).json({ success: false, message: check.message });
      }

      const {
        vehicule,
        symptome,
        codesDtc,
        preuvesInitiales,
        file,
        mimeType,
      } = req.body;

      const sessionId = `loop_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      const dtcArray = Array.isArray(codesDtc)
        ? codesDtc
        : (codesDtc ? String(codesDtc).split(/[\s,]+/).filter(Boolean) : []);

      const state = {
        session_id: sessionId,
        _lastActivity: Date.now(),
        _ownerPhone: phone, // Propriétaire de la session — vérifié sur les routes step/session pour empêcher qu'un autre utilisateur y accède (faille IDOR corrigée)
        vehicule: {
          marque: vehicule?.marque || "Inconnu",
          modele: vehicule?.modele || "",
          moteur: vehicule?.moteur || "",
          kilometrage: Number(vehicule?.kilometrage) || 0,
        },
        symptome_initial: symptome || "Dysfonctionnement mécanique / voyant allumé",
        codes_dtc: dtcArray,
        preuves_initiales: Array.isArray(preuvesInitiales) ? preuvesInitiales : [],
        preuves: [],
        hypotheses: [],
        incoherence_detectee: null,
        scanner: {
          identifie: null,
          methode_identification: null,
          recherches_effectuees: 0,
          recherches_max: 2,
        },
        phase_actuelle: "action_avant_dtc",
        questions_posees: [],
        tour_actuel: 0,
        tour_max: 6,
        stop: false,
      };

      const parts: any[] = [];
      if (file && mimeType) {
        parts.push({
          inlineData: { data: file, mimeType },
        });
      }

      let promptText = `Tour 0 (Initialisation de la boucle de diagnostic auto-questionnante) :
Véhicule : ${state.vehicule.marque} ${state.vehicule.modele} ${state.vehicule.moteur} (${state.vehicule.kilometrage} km)
Symptôme initial : "${state.symptome_initial}"
Codes DTC transmis : ${state.codes_dtc.length > 0 ? state.codes_dtc.join(", ") : "Aucun code DTC pour le moment"}
Preuves initiales apportées par le mécanicien : ${JSON.stringify(state.preuves_initiales)}

Instructions Tour 0 :
1. Intègre immédiatement toutes les preuves initiales (ne redemande JAMAIS une vérification déjà rapportée).
2. Ouvre la Phase 1 (Action avant DTC) : pose la première question prioritaire sur ce qui a été fait sur le véhicule juste avant ou autour de l'apparition du code/symptôme.
3. Propose les premières hypothèses avec leurs scores de confiance initiaux.`;

      parts.push({ text: promptText });

      const geminiResult = await retryWithBackoff(async () => {
        return await getAIClient().models.generateContent({
          model: "gemini-3.5-flash",
          contents: parts,
          config: {
            systemInstruction: LOOP_SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            responseSchema: loopResponseSchema,
            temperature: 0.2,
          },
        });
      });

      const parsedResponse = JSON.parse(geminiResult.text);

      state.hypotheses = parsedResponse.hypotheses || [];
      state.incoherence_detectee = parsedResponse.incoherence_detectee || null;
      state.phase_actuelle = parsedResponse.phase || "action_avant_dtc";
      if (parsedResponse.next_question) {
        state.questions_posees.push(parsedResponse.next_question);
      }
      state.stop = Boolean(parsedResponse.stop);

      loopStateStore.set(sessionId, state);

      return res.json({
        success: true,
        sessionId,
        state,
        response: parsedResponse,
      });
    } catch (error: any) {
      console.error("Erreur lors de l'initialisation de la boucle de diagnostic:", error);
      res.status(500).json({ success: false, message: "Erreur serveur lors du diagnostic. Veuillez réessayer." });
    }
  });

  // Next Turn in Diagnostic Loop (Tour 1 to N)
  app.post("/api/diagnostic/loop/step", requireAuth, async (req: any, res) => {
    try {
      const {
        sessionId,
        userResponse,
        responseType,
        file,
        mimeType,
        isPostRepairConfirmed,
        scannerModel,
      } = req.body;

      if (!sessionId || !loopStateStore.has(sessionId)) {
        return res.status(404).json({ success: false, message: "Session de diagnostic introuvable ou expirée." });
      }

      const state = loopStateStore.get(sessionId);
      // Faille IDOR corrigée : vérifie que la session appartient bien à l'utilisateur authentifié
      // avant de la lire ou d'y ajouter des réponses.
      if (state._ownerPhone && state._ownerPhone !== req.session.phone) {
        return res.status(404).json({ success: false, message: "Session de diagnostic introuvable ou expirée." });
      }
      state._lastActivity = Date.now();

      // Increment turn
      state.tour_actuel += 1;

      // Update scanner if model provided directly
      if (scannerModel) {
        state.scanner.identifie = scannerModel;
        state.scanner.methode_identification = "nom";
      }

      // Add user proof
      const proofEntry = {
        tour: state.tour_actuel,
        type: responseType || "texte",
        contenu: userResponse || "Élément fourni par le mécanicien",
      };
      state.preuves.push(proofEntry);

      // Perform Google Search Grounding for scanner menu path if scanner identified and quota remains
      let groundedMenuPath: string | null = null;
      if (
        state.scanner.identifie &&
        state.scanner.recherches_effectuees < state.scanner.recherches_max
      ) {
        try {
          console.log(`[Scanner Grounding] Searching menu path for scanner: ${state.scanner.identifie}`);
          const searchQuery = `Comment accéder au menu lecture codes DTC et données en direct sur le scanner automobile ${state.scanner.identifie} pour un véhicule ${state.vehicule.marque}`;
          const searchResult = await getAIClient().models.generateContent({
            model: "gemini-3.5-flash",
            contents: searchQuery,
            config: {
              tools: [{ googleSearch: {} }],
            },
          });
          groundedMenuPath = searchResult.text || null;
          state.scanner.recherches_effectuees += 1;
        } catch (searchErr) {
          console.warn("[Scanner Grounding] Erreur de recherche:", searchErr);
        }
      }

      const parts: any[] = [];
      if (file && mimeType) {
        parts.push({
          inlineData: { data: file, mimeType },
        });
      }

      let promptText = `Tour ${state.tour_actuel} / ${state.tour_max} (Boucle de diagnostic auto-questionnante) :
État actuel de la session :
${JSON.stringify(state, null, 2)}

Nouvelle réponse / preuve transmise par le mécanicien au Tour ${state.tour_actuel} :
- Réponse texte / mesure : "${userResponse || 'Aucun texte'}"
- Type : ${responseType || 'texte'}
${file ? "- Un fichier image/audio a été joint." : ""}
${isPostRepairConfirmed ? "ATTENTION : Le mécanicien confirme avoir effectué la réparation ! Passe immédiatement en PHASE DE VALIDATION POST-RÉPARATION." : ""}
${groundedMenuPath ? `\nINFORMATIONS DE MENU SCANNER GROUNDED (recherche web) : "${groundedMenuPath}"` : ""}

Directives pour ce tour :
1. Réévalue toutes les hypothèses avec leur niveau de confiance (0-100%).
2. Si le mécanicien a soumis une photo de mesure (multimètre) ou d'écran scanner, analyse la valeur réelle affichée.
3. Ne repose JAMAIS une question déjà présente dans questions_posees : ${JSON.stringify(state.questions_posees)}.
4. Si la confiance max atteint >= 85% ET que la validation post-réparation est faite (ou si le problème persiste après réparation), conclus ou rouvre la boucle selon les règles.
5. Formule la question suivante en jargon mécanicien Côte d'Ivoire.`;

      parts.push({ text: promptText });

      const geminiResult = await retryWithBackoff(async () => {
        return await getAIClient().models.generateContent({
          model: "gemini-3.5-flash",
          contents: parts,
          config: {
            systemInstruction: LOOP_SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            responseSchema: loopResponseSchema,
            temperature: 0.2,
          },
        });
      });

      const parsedResponse = JSON.parse(geminiResult.text);

      // Check for duplicate question loop detection
      if (
        parsedResponse.next_question &&
        state.questions_posees.includes(parsedResponse.next_question) &&
        parsedResponse.phase !== "conclusion"
      ) {
        console.warn("[Diagnostic Loop] Question déjà posée détectée ! Passage forcé en conclusion.");
        parsedResponse.stop = true;
        parsedResponse.phase = "conclusion";
      }

      // Check for max turn limit
      if (state.tour_actuel >= state.tour_max) {
        parsedResponse.stop = true;
        parsedResponse.phase = "conclusion";
      }

      state.hypotheses = parsedResponse.hypotheses || state.hypotheses;
      state.incoherence_detectee = parsedResponse.incoherence_detectee || null;
      state.phase_actuelle = parsedResponse.phase || state.phase_actuelle;
      state.stop = Boolean(parsedResponse.stop);

      if (parsedResponse.next_question) {
        state.questions_posees.push(parsedResponse.next_question);
      }

      if (groundedMenuPath) {
        parsedResponse.groundedMenuPath = groundedMenuPath;
      }

      loopStateStore.set(sessionId, state);

      return res.json({
        success: true,
        state,
        response: parsedResponse,
      });
    } catch (error: any) {
      console.error("Erreur étape boucle diagnostic:", error);
      res.status(500).json({ success: false, message: "Erreur serveur lors de la boucle de diagnostic. Veuillez réessayer." });
    }
  });

  // Get current diagnostic loop state
  app.get("/api/diagnostic/loop/session/:id", requireAuth, (req: any, res) => {
    const sessionId = req.params.id;
    if (!sessionId || !loopStateStore.has(sessionId)) {
      return res.status(404).json({ success: false, message: "Session introuvable." });
    }
    const state = loopStateStore.get(sessionId);
    // Faille IDOR corrigée : idem, un utilisateur ne peut lire que ses propres sessions.
    if (state._ownerPhone && state._ownerPhone !== req.session.phone) {
      return res.status(404).json({ success: false, message: "Session introuvable." });
    }
    return res.json({ success: true, state });
  });




  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Create standard WebSocketServer for low-latency live audio streaming
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const { pathname, searchParams } = new URL(request.url || "", `http://${request.headers.host}`);
    if (pathname === "/api/live-ws") {
      // FAILLE CORRIGÉE : ce endpoint WebSocket (assistant vocal live via Gemini) n'exigeait
      // aucune authentification — n'importe qui pouvait s'y connecter directement et consommer
      // l'API Gemini à volonté, sans compte, sans forfait, sans limite, aux frais de l'opérateur.
      const token = searchParams.get("token") || "";
      const session = sessions.get(token);
      if (!token || !session) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const effectivePlan = getEffectivePlan(session.phone);
      if ((PLAN_LIMITS[effectivePlan] ?? 0) <= 0) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        (ws as any)._authPhone = session.phone;
        wss.emit("connection", ws, request);
      });
    } else {
      // Allow other upgrades like Vite HMR to pass unimpeded
    }
  });

  wss.on("connection", (clientWs) => {
    console.log("[WebSocket] Client connected to real-time voice bridge.");
    let geminiSession: any = null;
    let isClosed = false;

    clientWs.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === "start") {
          console.log("[WebSocket] Starting Gemini Live Session with context...");
          const systemInstruction = `Tu es DiagAssist, un technicien automobile expérimenté qui accompagne un mécanicien ou un particulier étape par étape dans un diagnostic réel, avec des outils simples et accessibles en Afrique francophone (Côte d'Ivoire / Abidjan). Tu ne réponds jamais comme un dictionnaire de codes défauts. Tu mènes une enquête.

RÈGLE D'IDENTITÉ & NOM :
- Ton nom est DiagAssist. Si on te demande qui tu es, réponds : "DiagAssist, je t'écoute."

MODULE PUBLICITAIRE VOCAL & DEUX IDENTITÉS VOCALES (RÈGLE STRICTE) :
1. VOIX DE DIAGNOSTIC (Par défaut) :
   - Ton : Calme, technique, pédagogique, rassurant, professionnel.
   - Utilisée pour : l'accueil, les questions, l'analyse DTC, l'explication des pannes, le guidage des tests, l'analyse des photos et le rapport.
2. VOIX PUBLICITAIRE (Annonces commerciales) :
   - Ton : Commercial, dynamique, professionnel, premium, confiant et court.
   - Lorsque tu reçois une instruction publicitaire vocale [INSTRUCTION VOCALE PUBLICITAIRE], adopte immédiatement ce style vocal publicitaire dynamique pour prononcer l'offre (ex: scanner sans tablette à partir de 80 000 FCFA ou scanner avec tablette à partir de 100 000 FCFA).
   - Dès l'annonce terminée, bascule à nouveau immédiatement vers ta voix de diagnostic calme et technique.
   - Ne réinitialise jamais le contexte du diagnostic (véhicule, VIN, DTC, symptômes, photos).

COURTOISIE ET TON OBLIGATOIRES EN LIVE VOCAL :
- Salue l'utilisateur au début de l'échange : "Bonjour, je suis DiagAssist, votre assistant de diagnostic. Je vais vous accompagner étape par étape pour trouver la cause de votre problème."
- Tu vouvoies TOUJOURS l'utilisateur avec respect, calme et bienveillance.
- Réponses courtes (1 à 2 phrases max) pour un échange vocal dynamique.

RÈGLE D'OR (NON NÉGOCIABLE) :
NE JAMAIS SAUTER DIRECTEMENT D'UN CODE DÉFAUT OU D'UN SYMPTÔME À UNE PIÈCE À REMPLACER.
Séquence obligatoire : historique → symptôme → outils disponibles → codes → hiérarchisation → prérequis → test guidé → résultat → nouvelle étape → confirmation → diagnostic final.

ÉTAPES CLÉS DE TON ENQUÊTE :
- Règle Pièces Défectueuses : Dès qu'une pièce est identifiée comme défectueuse ou à changer, recommande systématiquement au mécanicien de nous contacter pour l'achat de la pièce au 0141116026.
- Étape 0 (Historique) : Demande si le véhicule a fait l'objet d'une intervention récente (batterie, pièce, fils, nettoyage).
- Étape 3 (Outils) : Privilégie la lampe témoin 12V, le compressiomètre, la jauge carburant, le stéthoscope tournevis.
  Si un outil manque, intègre UNE SEULE FOIS l'invitation d'achat structurée : "Je comprends que vous n'ayez pas de [nom de l'outil] sous la main. Cet outil est précieux ici car il va nous permettre de [rappel très bref de ce que ce test va révéler]. Si vous souhaitez vous en procurer un rapidement, nous pouvons vous le fournir : il vous suffit de contacter le 0141116026. Sinon, dites-le-moi et je verrai avec vous s'il existe une autre façon de procéder."
- Étape 6 (Test unique) : Propose UN SEUL TEST à la fois avec sa justification et la façon simple de le réaliser.

FICHE TECHNIQUE ET DIAGNOSTIC ACTUEL DU VÉHICULE :
${message.diagnosticContext}

FORMATAGE VOCAL STRICT : Ne génère AUCUN caractère markdown (pas d'astérisques, pas de hashtags, pas de puces). Rédige uniquement de simples phrases fluides et naturelles.`;

          try {
            geminiSession = await getAIClient().live.connect({
              model: "gemini-3.1-flash-live-preview",
              config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } }, // 'Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'
                },
                systemInstruction: systemInstruction,
                outputAudioTranscription: {},
                inputAudioTranscription: {},
              },
              callbacks: {
                onmessage: (msg: any) => {
                  if (isClosed) return;

                  // Handle Model Output Turn (audio & transcription)
                  const modelParts = msg.serverContent?.modelTurn?.parts;
                  if (modelParts && Array.isArray(modelParts)) {
                    for (const part of modelParts) {
                      const audio = part.inlineData?.data;
                      if (audio) {
                        clientWs.send(JSON.stringify({ type: "audio", audio }));
                      }
                      const text = part.text;
                      if (text) {
                        clientWs.send(JSON.stringify({ type: "text", text }));
                      }
                    }
                  }

                  // Handle User Input Turn (transcription of user speech)
                  const userParts = msg.serverContent?.userTurn?.parts;
                  if (userParts && Array.isArray(userParts)) {
                    for (const part of userParts) {
                      const text = part.text;
                      if (text) {
                        clientWs.send(JSON.stringify({ type: "userTranscript", text }));
                      }
                    }
                  }

                  // Handle Interruption
                  if (msg.serverContent?.interrupted) {
                    clientWs.send(JSON.stringify({ type: "interrupted" }));
                  }

                  // Handle Turn Complete (end of AI output turn)
                  if (msg.serverContent?.turnComplete) {
                    clientWs.send(JSON.stringify({ type: "turnComplete" }));
                  }
                },
                onclose: () => {
                  console.log("[WebSocket] Gemini Live session closed.");
                  if (!isClosed) {
                    clientWs.send(JSON.stringify({ type: "closed" }));
                    clientWs.close();
                  }
                },
                onerror: (err: any) => {
                  console.error("[WebSocket] Gemini Live error:", err);
                  if (!isClosed) {
                    clientWs.send(JSON.stringify({ type: "error", message: "Erreur de connexion vocale avec l'IA." }));
                  }
                }
              }
            });

            console.log("[WebSocket] Gemini Live session connected successfully.");
            clientWs.send(JSON.stringify({ type: "connected" }));

            // Send an initial prompt to make the agent speak immediately!
            geminiSession.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [
                    {
                      text: "DiagAssist, signale ta présence immédiatement pour confirmer la connexion en direct en disant : 'DiagAssist, je t'écoute.' puis rappelle brièvement le symptôme majeur ou code défaut de ce véhicule."
                    }
                  ]
                }
              ]
            });

          } catch (err: any) {
            console.error("[WebSocket] Failed to connect to Gemini Live:", err);
            clientWs.send(JSON.stringify({ type: "error", message: "Impossible de démarrer la session vocale Gemini Live: " + err.message }));
            clientWs.close();
          }
        } else if (message.type === "audio") {
          if (geminiSession) {
            geminiSession.sendRealtimeInput({
              audio: { data: message.audio, mimeType: "audio/pcm;rate=16000" }
            });
          }
        } else if (message.type === "image" || message.type === "video" || message.type === "media") {
          if (geminiSession) {
            console.log("[WebSocket] Sending realtime media/image input to Gemini Live session via sendRealtimeInput...");
            try {
              geminiSession.sendRealtimeInput({
                video: { data: message.data || message.image, mimeType: message.mimeType || "image/jpeg" }
              });
              clientWs.send(JSON.stringify({ type: "mediaAck", status: "ok", message: "Photo transmise à Gemini Live." }));
            } catch (err: any) {
              console.error("[WebSocket] Failed to send realtime image to Gemini Live:", err);
              clientWs.send(JSON.stringify({ type: "error", message: "Impossible d'envoyer la photo à Gemini Live: " + err.message }));
            }
          } else {
            clientWs.send(JSON.stringify({ type: "error", message: "Session Gemini Live non active sur le serveur." }));
          }
        } else if (message.type === "triggerVocalAd") {
          if (geminiSession) {
            console.log("[WebSocket] Delivering 100% vocal ad instruction to Gemini Live...");
            const adPrompt = message.adVoicePrompt || `[INSTRUCTION VOCALE PUBLICITAIRE] Adopte un ton commercial, dynamique et professionnel (voix publicitaire) pour prononcer l'annonce suivante : "${message.offerScript || 'Si vous souhaitez vous équiper pour vos prochains diagnostics, découvrez nos scanners automobiles sans tablette à partir de 80 000 FCFA.'}" Puis reprends immédiatement ta voix de diagnostic calme et technique.`;
            geminiSession.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [
                    { text: adPrompt }
                  ]
                }
              ]
            });
          }
        } else if (message.type === "text") {
          if (geminiSession) {
            geminiSession.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [
                    { text: message.text }
                  ]
                }
              ]
            });
          }
        }
      } catch (err: any) {
        console.error("[WebSocket] Error processing message:", err);
      }
    });

    clientWs.on("close", () => {
      console.log("[WebSocket] Client disconnected from real-time voice bridge.");
      isClosed = true;
      if (geminiSession) {
        try {
          geminiSession.close();
        } catch (e) {}
      }
    });
  });
}

startServer();
