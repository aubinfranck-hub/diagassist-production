import crypto from "crypto";
import type { Express } from "express";
import type { Server } from "http";
import { WebSocketServer } from "ws";
import rateLimit from "express-rate-limit";
import { GoogleGenAI, Type } from "@google/genai";
import { getGeminiKeys } from "../../utils/geminiKeys";

const sessions = new Map<string, any>();
const clients = new Map<string, Set<any>>();
// Essais d'appairage par code (publics) : plafond global par code et par IP, indépendant du deviceId
// (un attaquant pouvait contourner la limite en changeant d'identifiant de tablette).
const pairFailsByCode = new Map<string, { n: number; resetAt: number }>();
const MAX_PAIR_FAILS_PER_CODE = 10;
const PAIR_FAIL_WINDOW_MS = 15 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pairFailsByCode) if (now > v.resetAt) pairFailsByCode.delete(k);
}, 15 * 60 * 1000).unref();
const pairByCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Trop de tentatives d'appairage. Réessayez dans quelques minutes." },
});
const PAIRING_TTL = 30 * 60 * 1000;
const SESSION_TTL = 60 * 60 * 1000;
const MAX_FRAME_BYTES = 2_500_000;
const MAX_VISION_IMAGE_BYTES = 2_500_000;
const ALLOWED = new Set(["click", "scroll", "input", "back", "request_screen"]);
const MAX_FRAME_RATE_PER_SECOND = 4;
const MAX_COMMAND_TEXT_LENGTH = 1_000;
const VOICE_MESSAGE_TYPES = new Set(["voice_start","voice_signal","voice_end"]);
const MAX_PILOT_STEPS = 30;
const PILOT_MIN_INTERVAL_MS = 3000;

function code() {
  return crypto.randomInt(100000, 1000000).toString();
}

function sessionCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[crypto.randomInt(0, alphabet.length)];
  return out;
}

function normalizeSessionId(id: string) {
  return String(id || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toLowerCase();
}

function getSession(id: string) {
  const s = sessions.get(id);
  if (!s || Date.now() > s.expiresAt) {
    if (s) sessions.delete(id);
    return null;
  }
  return s;
}

function isSafeOrigin(origin: string | undefined, host: string | undefined): boolean {
  // Android WebSocket clients do not send Origin. Browsers do, and must only use this service's
  // public origin (or APP_URL when a custom domain is configured).
  if (!origin) return true;
  try {
    const expected = process.env.APP_URL ? new URL(process.env.APP_URL).origin : "";
    return origin === expected || new URL(origin).host === host;
  } catch {
    return false;
  }
}

function sendAll(id: string, msg: any, except?: any) {
  for (const ws of clients.get(id) || []) {
    if (ws !== except && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }
}

function getVisionClient(): GoogleGenAI {
  const keys = getGeminiKeys();
  if (keys.length === 0) throw new Error("GEMINI_API_KEY non configurée.");
  const apiKey = keys[Math.floor(Math.random() * keys.length)];
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });
}

async function runAutoPilotStep(
  s: any,
  imageData: string,
  sid: string,
  clients: Map<string, Set<any>>,
  sendAll: (id: string, msg: any, except?: any) => void,
  scannerResults?: Map<string, { dtcs: string[]; summary: string; completedAt: number }>
): Promise<void> {
  const now = Date.now();
  if (!s.autoPilotActive) return;
  if (now - (s.lastPilotAt || 0) < PILOT_MIN_INTERVAL_MS) return;
  if ((s.pilotSteps || 0) >= MAX_PILOT_STEPS) {
    s.autoPilotActive = false;
    sendAll(sid, { type: "pilot_done", reason: "max_steps", summary: "Limite de 30 actions atteinte.", dtcs: s.pilotDtcs || [] });
    return;
  }

  const keys = getGeminiKeys();
  if (keys.length === 0) return;
  const apiKey = keys[Math.floor(Math.random() * keys.length)];
  s.lastPilotAt = now;
  s.pilotSteps = (s.pilotSteps || 0) + 1;

  const history: string[] = s.pilotHistory || [];
  const historyText = history.length > 0
    ? "Actions précédentes (récentes en dernier) :\n" + history.slice(-8).join("\n")
    : "Première action — aucune action précédente.";

  const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { "User-Agent": "aistudio-build" } } });
  const base64 = imageData.replace(/^data:image\/[^;]+;base64,/, "");

  let fc: any = null;
  try {
    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [
          { inlineData: { data: base64, mimeType: "image/jpeg" } },
          { text: `Tu es DiagAssist Autopilot — agent IA qui pilote une tablette de valise OBD.
Objectifs dans l'ordre :
1. Ouvrir l'application de diagnostic si pas encore ouverte.
2. Sélectionner marque/modèle si demandé.
3. Lancer la lecture des codes défauts (DTC).
4. Lire et noter tous les codes affichés, naviguer dans les détails.
5. Appeler done quand diagnostic complet ou si l'écran ne permet pas d'avancer.
Règles : appuie uniquement sur des éléments VISIBLES. Ne répète pas deux fois la même action. Si bloqué 3 fois sur le même écran, appelle back. Confirme les boîtes de dialogue Android.

${historyText}

Regarde l'écran et choisis la prochaine action. Utilise exactement un des outils disponibles.` }
        ]
      }],
      config: {
        tools: [{
          functionDeclarations: [
            { name: "click", description: "Appuie sur un élément visible à la position x,y en pixels", parameters: { type: "OBJECT", properties: { x: { type: "NUMBER" }, y: { type: "NUMBER" }, reason: { type: "STRING" } }, required: ["x","y","reason"] } },
            { name: "scroll", description: "Fait défiler l'écran. direction = 'up' ou 'down'", parameters: { type: "OBJECT", properties: { direction: { type: "STRING" }, reason: { type: "STRING" } }, required: ["direction","reason"] } },
            { name: "input", description: "Saisit du texte dans un champ de saisie actif", parameters: { type: "OBJECT", properties: { text: { type: "STRING" }, reason: { type: "STRING" } }, required: ["text","reason"] } },
            { name: "back", description: "Appuie sur le bouton retour Android", parameters: { type: "OBJECT", properties: { reason: { type: "STRING" } }, required: ["reason"] } },
            { name: "wait", description: "Attend sans agir (chargement, animation en cours)", parameters: { type: "OBJECT", properties: { reason: { type: "STRING" } }, required: ["reason"] } },
            { name: "done", description: "Diagnostic terminé — arrête le pilotage et résume les trouvailles", parameters: { type: "OBJECT", properties: { summary: { type: "STRING" }, dtcs: { type: "ARRAY", items: { type: "STRING" } } }, required: ["summary"] } }
          ]
        }],
        toolConfig: { functionCallingConfig: { mode: "ANY" } }
      }
    });
    const candidate = resp.candidates?.[0];
    fc = candidate?.content?.parts?.find((p: any) => p.functionCall)?.functionCall || null;
  } catch (err: any) {
    console.error("[PILOT] Gemini error:", err?.message || err);
    return;
  }

  if (!fc) return;

  const toolName: string = fc.name || "";
  const args: any = fc.args || {};
  const reason: string = args.reason || "";

  const logEntry = `[${s.pilotSteps}] ${toolName}(${JSON.stringify({ ...args, reason: undefined })}) — ${reason}`;
  history.push(logEntry);
  s.pilotHistory = history;

  sendAll(sid, { type: "pilot_action", step: s.pilotSteps, tool: toolName, args, reason, log: logEntry });

  if (toolName === "done") {
    s.autoPilotActive = false;
    const doneDtcs: string[] = args.dtcs || [];
    const doneSummary: string = args.summary || "";
    sendAll(sid, { type: "pilot_done", reason: "done", summary: doneSummary, dtcs: doneDtcs });
    if (scannerResults && s.technicianPhone) {
      scannerResults.set(s.technicianPhone, { dtcs: doneDtcs, summary: doneSummary, completedAt: Date.now() });
    }
    return;
  }

  if (toolName === "wait") return;

  const commandAction = toolName === "click" ? "click"
    : toolName === "scroll" ? "scroll"
    : toolName === "input" ? "input"
    : toolName === "back" ? "back"
    : null;

  if (commandAction) {
    const payload: any = { action: commandAction };
    if (toolName === "click") { payload.x = Math.round(Number(args.x)); payload.y = Math.round(Number(args.y)); }
    if (toolName === "scroll") { payload.direction = args.direction === "up" ? "up" : "down"; }
    if (toolName === "input") { payload.text = String(args.text || "").slice(0, MAX_COMMAND_TEXT_LENGTH); }
    sendAll(sid, { type: "command", sessionId: sid, payload });
  }
}

export function registerScreening(
  app: Express,
  server: Server,
  deps: {
    requireAuth: any;
    getEffectivePlan: (phone: string) => string;
    sessions: Map<string, any>;
    dbQuery?: (sql: string, params?: any[]) => Promise<any>;
    scannerResults?: Map<string, { dtcs: string[]; summary: string; completedAt: number }>;
  }
) {
  const dbQuery = deps.dbQuery;
  const persistSession = async (s: any) => {
    if (!dbQuery) return;
    try {
      await dbQuery(
        `INSERT INTO screening_sessions
          (id, technician_phone, coach_phone, pairing_code, pairing_expires_at, coach_type, human_coach_requested, status, created_at, expires_at, frame_count, technician_device_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           coach_phone=$3, pairing_expires_at=$5, coach_type=$6,
           human_coach_requested=$7, status=$8, expires_at=$10, frame_count=$11, technician_device_id=COALESCE($12, screening_sessions.technician_device_id)`,
        [s.id, s.technicianPhone, s.coachPhone || null, s.pairingCode, s.pairingExpiresAt,
         s.coachType, s.humanCoachRequested, s.status, s.createdAt, s.expiresAt, s.frameCount, s.technicianDeviceId || null]
      );
    } catch (err: any) {
      console.error("[SCREENING][DB] sauvegarde session échouée:", err.message);
      throw err;
    }
  };

  const getSessionAsync = async (id: string) => {
    id = normalizeSessionId(id);
    const cached = getSession(id);
    if (cached) return cached;
    if (!dbQuery) return null;
    try {
      const result = await dbQuery(
        `SELECT id, technician_phone, coach_phone, pairing_code, pairing_expires_at, coach_type,
                human_coach_requested, status, created_at, expires_at, frame_count, technician_device_id
         FROM screening_sessions WHERE lower(trim(id)) = lower(trim($1)) LIMIT 1`,
        [id]
      );
      const row = result.rows?.[0];
      if (!row) return null;
      const s = {
        id: row.id,
        technicianPhone: row.technician_phone,
        coachPhone: row.coach_phone || undefined,
        pairingCode: row.pairing_code,
        pairingExpiresAt: Number(row.pairing_expires_at),
        coachType: row.coach_type === "human" ? "human" : "gemini",
        humanCoachRequested: Boolean(row.human_coach_requested),
        status: row.status === "active" ? "active" : row.status === "completed" ? "completed" : "pending",
        createdAt: Number(row.created_at),
        expiresAt: Number(row.expires_at),
        frameCount: Number(row.frame_count || 0),
        technicianDeviceId: row.technician_device_id || undefined,
        lastVisionAt: 0,
      };
      if (Date.now() > s.expiresAt && s.status !== "completed") return null;
      sessions.set(id, s);
      return s;
    } catch (err: any) {
      console.error("[SCREENING][DB] récupération session échouée:", err.message);
      throw err;
    }
  };

  if (dbQuery) {
    dbQuery(
      `SELECT id, technician_phone, coach_phone, pairing_code, pairing_expires_at, coach_type,
              human_coach_requested, status, created_at, expires_at, frame_count, technician_device_id
       FROM screening_sessions
       WHERE expires_at > $1 OR status = 'completed'
       ORDER BY created_at DESC
       LIMIT 200`,
      [Date.now() - 24 * 60 * 60 * 1000]
    ).then((result: any) => {
      for (const row of result.rows || []) {
        if (row.status !== "completed" && Number(row.expires_at) <= Date.now()) continue;
        sessions.set(row.id, {
          id: row.id,
          technicianPhone: row.technician_phone,
          coachPhone: row.coach_phone || undefined,
          pairingCode: row.pairing_code,
          pairingExpiresAt: Number(row.pairing_expires_at),
          coachType: row.coach_type === "human" ? "human" : "gemini",
          humanCoachRequested: Boolean(row.human_coach_requested),
          status: row.status === "active" ? "active" : row.status === "completed" ? "completed" : "pending",
          createdAt: Number(row.created_at),
          expiresAt: Number(row.expires_at),
          frameCount: Number(row.frame_count || 0),
          technicianDeviceId: row.technician_device_id || undefined,
          lastVisionAt: 0,
        });
      }
      console.log(`[SCREENING][DB] ${sessions.size} session(s) rechargée(s).`);
    }).catch((err: any) => console.error("[SCREENING][DB] chargement échoué:", err.message));
  }
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES + 100_000,
    // Le token de session voyage dans le sous-protocole "auth.<token>" (jamais dans l'URL).
    handleProtocols: (protocols: Set<string>) => {
      for (const p of protocols) if (p.startsWith("auth.")) return p;
      return false;
    },
  });
  // Purge des sessions expirées (la Map ne se vidait que sur accès).
  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) if (now > s.expiresAt) { sessions.delete(id); clients.delete(id); }
  }, 10 * 60 * 1000).unref();

  app.post("/api/screening/sessions", deps.requireAuth, async (req: any, res) => {
    if (deps.getEffectivePlan(req.session.phone) !== "premium") {
      return res.status(403).json({
        success: false,
        message: "Le coaching temps réel est réservé au Premium.",
        requiredTier: "premium"
      });
    }

    const id = sessionCode();
    const now = Date.now();
    const s = {
      id,
      technicianPhone: req.session.phone,
      pairingCode: code(),
      pairingExpiresAt: now + PAIRING_TTL,
      coachType: "gemini",
      humanCoachRequested: false,
      status: "pending",
      createdAt: now,
      expiresAt: now + SESSION_TTL,
      frameCount: 0,
      lastVisionAt: 0,
    };

    sessions.set(id, s);
    try {
      await persistSession(s);
    } catch {
      sessions.delete(id);
      return res.status(503).json({
        success: false,
        message: "Impossible d'enregistrer la session. Réessayez.",
      });
    }
    res.json({
      success: true,
      sessionId: id,
      pairingCode: s.pairingCode,
      expiresIn: PAIRING_TTL
    });
  });

  app.post("/api/screening/pair-by-code", pairByCodeLimiter, async (req: any, res) => {
    const pairingCode = String(req.body?.pairingCode || "").replace(/\D/g, "");
    if (!/^\d{6}$/.test(pairingCode)) {
      return res.status(400).json({ success: false, message: "Code de connexion invalide." });
    }
    let candidates = Array.from(sessions.values()).filter((s: any) =>
      s.pairingCode === pairingCode &&
      Date.now() <= s.pairingExpiresAt &&
      s.status !== "completed" &&
      Date.now() <= s.expiresAt
    );

    // Fallback DB : le service Render peut redémarrer entre la création de la session
    // et l'appairage de la tablette. La session persistée doit alors rester utilisable.
    if (candidates.length === 0 && dbQuery) {
      try {
        const result = await dbQuery(
          `SELECT id, technician_phone, coach_phone, pairing_code, pairing_expires_at,
                  coach_type, human_coach_requested, status, created_at, expires_at, frame_count, technician_device_id
           FROM screening_sessions
           WHERE pairing_code = $1
             AND pairing_expires_at > $2
             AND expires_at > $2
             AND status <> 'completed'
           ORDER BY created_at DESC
           LIMIT 2`,
          [pairingCode, Date.now()]
        );
        candidates = (result.rows || []).map((row: any) => ({
          id: row.id,
          technicianPhone: row.technician_phone,
          coachPhone: row.coach_phone || undefined,
          pairingCode: row.pairing_code,
          pairingExpiresAt: Number(row.pairing_expires_at),
          coachType: row.coach_type === "human" ? "human" : "gemini",
          humanCoachRequested: Boolean(row.human_coach_requested),
          status: row.status === "active" ? "active" : "pending",
          createdAt: Number(row.created_at),
          expiresAt: Number(row.expires_at),
          frameCount: Number(row.frame_count || 0),
          technicianDeviceId: row.technician_device_id || undefined,
          lastVisionAt: 0,
        }));
        if (candidates.length === 1) sessions.set(candidates[0].id, candidates[0]);
      } catch (err: any) {
        console.error("[SCREENING][PAIR] récupération DB échouée:", err?.message || err);
      }
    }

    if (candidates.length !== 1) {
      return res.status(404).json({ success: false, message: "Code introuvable ou expiré. Vérifiez le code affiché sur DiagAssist." });
    }
    const s = candidates[0];
    res.json({
      success: true,
      sessionId: s.id,
      pairingCode: s.pairingCode,
      wsUrl: process.env.APP_URL || "https://diagassist-production.onrender.com",
      expiresIn: Math.max(0, s.pairingExpiresAt - Date.now()),
    });
  });

  app.get("/api/screening/sessions/:id", deps.requireAuth, async (req: any, res) => {
    const s = await getSessionAsync(req.params.id);
    if (!s) return res.status(404).json({ success: false, message: "Session introuvable." });

    if (req.session.phone !== s.technicianPhone && req.session.phone !== s.coachPhone) {
      return res.status(403).json({ success: false, message: "Accès refusé." });
    }

    const safe = { ...s };
    if (req.session.phone !== s.technicianPhone) delete safe.pairingCode;
    res.json({ success: true, session: safe });
  });

  app.get("/api/screening/history", deps.requireAuth, async (req: any, res) => {
    if (!dbQuery) {
      return res.json({ success: true, sessions: [] });
    }
    try {
      const result = await dbQuery(
        `SELECT id, technician_phone, coach_phone, coach_type, human_coach_requested,
                status, created_at, expires_at, frame_count, technician_device_id
         FROM screening_sessions
         WHERE technician_phone = $1 OR coach_phone = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [req.session.phone]
      );
      res.json({ success: true, sessions: result.rows });
    } catch (err: any) {
      console.error("[SCREENING][DB] historique échoué:", err.message);
      res.status(500).json({ success: false, message: "Historique indisponible." });
    }
  });

  app.post("/api/screening/sessions/:id/request-human-coach", deps.requireAuth, async (req: any, res) => {
    const s = await getSessionAsync(req.params.id);
    if (!s) return res.status(404).json({ success: false, message: "Session introuvable." });
    if (req.session.phone !== s.technicianPhone) {
      return res.status(403).json({ success: false, message: "Seul le technicien peut demander un coach humain." });
    }
const previousRequested = s.humanCoachRequested;
    const previousCoachType = s.coachType;
    s.humanCoachRequested = true;
    s.coachType = "human";
    try {
      await persistSession(s);
    } catch {
      s.humanCoachRequested = previousRequested;
      s.coachType = previousCoachType;
      return res.status(503).json({ success: false, message: "Impossible d'enregistrer la demande de coach. Réessayez." });
    }
    sendAll(s.id, { type: "human_coach_requested", sessionId: s.id, timestamp: Date.now() });
    res.json({ success: true, coachType: "human", message: "Coach humain demandé." });
  });

  app.post("/api/screening/sessions/:id/end", deps.requireAuth, async (req: any, res) => {
    const s = await getSessionAsync(req.params.id);
    if (!s) return res.status(404).json({ success: false, message: "Session introuvable." });

    if (req.session.phone !== s.technicianPhone && req.session.phone !== s.coachPhone) {
      return res.status(403).json({ success: false, message: "Accès refusé." });
    }

const previousStatus = s.status;
    s.status = "completed";
    try {
      await persistSession(s);
    } catch {
      s.status = previousStatus;
      return res.status(503).json({ success: false, message: "Impossible d'enregistrer la fin de session. Réessayez." });
    }
    sendAll(s.id, { type: "session_ended", sessionId: s.id, timestamp: Date.now() });
    for (const ws of clients.get(s.id) || []) { try { ws.close(1000, "Session terminée"); } catch {} }
    clients.delete(s.id);
    res.json({ success: true, frameCount: s.frameCount });
  });

  // Analyse explicite d'une capture d'écran par Gemini Vision.
  // On ne lance pas d'analyse automatique à chaque frame afin de maîtriser coût et latence.
  app.post("/api/screening/analyze-frame", deps.requireAuth, async (req: any, res) => {
    try {
      if (deps.getEffectivePlan(req.session.phone) !== "premium") {
        return res.status(403).json({ success: false, message: "L'analyse Vision est réservée au Premium." });
      }

      const sessionId = String(req.body?.sessionId || "");
      const imageData = String(req.body?.imageData || "");
      const s = await getSessionAsync(sessionId);

      if (!s) return res.status(404).json({ success: false, message: "Session introuvable." });
      if (req.session.phone !== s.technicianPhone && req.session.phone !== s.coachPhone) {
        return res.status(403).json({ success: false, message: "Accès refusé." });
      }
      if (!imageData) return res.status(400).json({ success: false, message: "Capture d'écran requise." });
      if (imageData.length > MAX_VISION_IMAGE_BYTES) {
        return res.status(413).json({ success: false, message: "Capture trop volumineuse." });
      }

      // Protection simple contre les appels Vision trop rapprochés sur une même session.
      if (Date.now() - (s.lastVisionAt || 0) < 4000) {
        return res.status(429).json({ success: false, message: "Analyse trop rapprochée. Patientez quelques secondes." });
      }
      s.lastVisionAt = Date.now();

      const base64 = imageData.replace(/^data:image\/[^;]+;base64,/, "");
      const response = await getVisionClient().models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          role: "user",
          parts: [
            {
              inlineData: {
                data: base64,
                mimeType: "image/jpeg",
              },
            },
            {
              text: `Tu es DiagAssist Vision, assistant de coaching pour un mécanicien automobile.
Analyse UNIQUEMENT ce qui est réellement visible sur cette capture d'écran de tablette/valise/application automobile.
Objectifs :
1. Lire les codes défauts DTC visibles, sans les inventer.
2. Identifier les paramètres, voyants, menus ou résultats de test visibles.
3. Expliquer ce que l'écran indique et ce qu'il ne permet pas de conclure.
4. Proposer la prochaine vérification utile, une seule à la fois.
5. Signaler immédiatement tout risque de sécurité visible.
6. Si le texte est illisible ou si l'écran ne permet pas de conclure, le dire clairement.

Règle essentielle : un code défaut est un indice, pas une condamnation de pièce. Ne recommande jamais de remplacer une pièce uniquement à partir d'un code.

Réponds en français sous forme JSON avec exactement ces champs :
summary: résumé court de ce qui est visible ;
observations: tableau des éléments réellement observés ;
probableCodes: tableau des codes DTC lisibles, avec code et description, vide si aucun ;
checks: tableau des contrôles à effectuer ensuite ;
nextActions: tableau d'actions immédiates pour le coach ;
safety: niveau "normal", "attention" ou "critique" + raison ;
confidence: nombre de 0 à 1 ;
uncertainty: limites ou éléments impossibles à lire/confirmer.
Ne fabrique aucune donnée absente de l'image.`,
            },
          ],
        }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              observations: { type: Type.ARRAY, items: { type: Type.STRING } },
              probableCodes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    code: { type: Type.STRING },
                    description: { type: Type.STRING },
                  },
                  required: ["code", "description"],
                },
              },
              checks: { type: Type.ARRAY, items: { type: Type.STRING } },
              nextActions: { type: Type.ARRAY, items: { type: Type.STRING } },
              safety: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              uncertainty: { type: Type.STRING },
            },
            required: ["summary", "observations", "probableCodes", "checks", "nextActions", "safety", "confidence", "uncertainty"],
          },
        },
      });

      const text = response.text?.trim();
      if (!text) throw new Error("Gemini n'a renvoyé aucune analyse.");
      const analysis = JSON.parse(text);

      res.json({
        success: true,
        sessionId,
        analysis,
        modelUsed: "gemini-2.5-flash",
        analyzedAt: Date.now(),
        warning: "Analyse d'assistance : confirmer tout diagnostic par les mesures et procédures constructeur appropriées.",
      });
    } catch (error: any) {
      console.error("[Screening Vision] Erreur:", error?.message || error);
      res.status(500).json({
        success: false,
        message: "Impossible d'analyser cette capture pour le moment.",
      });
    }
  });

  app.post("/api/screening/sessions/:id/autopilot", deps.requireAuth, async (req: any, res) => {
    const s = await getSessionAsync(req.params.id);
    if (!s) return res.status(404).json({ success: false, message: "Session introuvable." });
    if (req.session.phone !== s.technicianPhone && req.session.phone !== s.coachPhone) {
      return res.status(403).json({ success: false, message: "Accès refusé." });
    }
    const enable = req.body?.enable !== false;
    s.autoPilotActive = enable;
    if (enable) {
      s.pilotHistory = [];
      s.pilotSteps = 0;
      s.pilotDtcs = [];
      s.lastPilotAt = 0;
    }
    sendAll(s.id, { type: "pilot_status", active: s.autoPilotActive });
    res.json({ success: true, autoPilot: s.autoPilotActive });
  });

  // Le coach humain rejoint avec son ID de session uniquement.
  // Le code d'appairage est strictement réservé à la tablette du technicien.
  app.post("/api/screening/sessions/:id/join-coach", deps.requireAuth, async (req: any, res) => {
    let s: any;
    try {
      s = await getSessionAsync(req.params.id);
    } catch (err: any) {
      console.error("[SCREENING][JOIN][DB] récupération impossible:", err?.message || err);
      return res.status(503).json({ success: false, message: "Le service de sessions est momentanément indisponible. Réessayez dans quelques secondes." });
    }
    if (!s) {
      console.warn("[SCREENING][JOIN] session introuvable:", normalizeSessionId(req.params.id));
      return res.status(404).json({ success: false, message: "Session introuvable. Vérifiez le code session à 6 caractères." });
    }
    if (!s.humanCoachRequested || s.coachType !== "human") {
      s.humanCoachRequested = true;
      s.coachType = "human";
    }
    if (s.coachPhone && s.coachPhone !== req.session.phone) {
      return res.status(409).json({ success: false, message: "Un coach est déjà connecté à cette session." });
    }
    const previousCoachPhone = s.coachPhone;
    const previousStatus = s.status;
    s.coachPhone = req.session.phone;
    s.status = "active";
    try {
      await persistSession(s);
    } catch {
      s.coachPhone = previousCoachPhone;
      s.status = previousStatus;
      return res.status(503).json({ success: false, message: "Impossible d'enregistrer le coach. Réessayez." });
    }
    sendAll(s.id, { type: "human_coach_requested", sessionId: s.id, timestamp: Date.now() });
    sendAll(s.id, { type: "command", sessionId: s.id, payload: { action: "request_screen" } });
    res.json({ success: true, sessionId: s.id, role: "coach" });
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", "http://localhost");
    if (url.pathname !== "/api/screening/stream") return;

    if (!isSafeOrigin(request.headers.origin, request.headers.host)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    const protoToken = String(request.headers["sec-websocket-protocol"] || "")
      .split(",").map((x) => x.trim()).find((x) => x.startsWith("auth."))?.slice(5) || "";
    const auth = protoToken ? deps.sessions.get(protoToken) : undefined;

    // Controller/coach connections use the normal authenticated session token.
    // Technician tablets may connect without a bearer token because the QR carries only
    // the short-lived session ID + pairing code. The pairing handler below is the gate.
    if (auth && deps.getEffectivePlan(auth.phone) !== "premium") {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, ws => {
      (ws as any)._phone = auth?.phone || null;
      wss.emit("connection", ws);
    });
  });

  wss.on("connection", (ws: any) => {
    let paired = false;
    let role: string | null = null;
    let sid: string | null = null;
    let lastFrameWindowAt = Date.now();
    let framesInWindow = 0;

    ws.on("message", async (raw: Buffer) => {
      try {
        const m = JSON.parse(raw.toString());

        if (m.type === "pairing") {
          const s = await getSessionAsync(String(m.sessionId));
          if (!s) return ws.send(JSON.stringify({ type: "error", message: "Session expirée." }));
          if (s.status === "completed") return ws.send(JSON.stringify({ type: "error", message: "Session terminée." }));

          const requestedRole = typeof m.role === "string" ? m.role : "";
          if (!["technician", "controller", "coach"].includes(requestedRole)) {
            return ws.send(JSON.stringify({ type: "error", message: "Rôle de connexion invalide. La connexion doit préciser technician, controller ou coach." }));
          }
          // Le scanner peut être un APK Android ou le module Web/Chrome.
          // Une connexion technicien sans bearer token est autorisée uniquement après
          // preuve de possession du code d'appairage court et liaison à un deviceId.
          const isTechnicianSocket = requestedRole === "technician" && !ws._phone;
          const isAuthenticatedTechnician = requestedRole === "technician" && ws._phone === s.technicianPhone;
          const isTechnician = isTechnicianSocket || isAuthenticatedTechnician;
          const isController = requestedRole === "controller" && ws._phone === s.technicianPhone;
          const isCoach = requestedRole === "coach" && s.humanCoachRequested && s.coachPhone === ws._phone;

          if (isTechnician) {
            const deviceId = typeof m.deviceId === "string" ? m.deviceId.trim() : "";
            const isReconnect = m.reconnect === true;
            if (isReconnect) {
              if (!s.technicianDeviceId || s.technicianDeviceId !== deviceId || s.status === "completed") {
                return ws.send(JSON.stringify({ type: "error", message: "Reconnexion refusée. Cette tablette n’est pas liée à la session." }));
              }
            } else if (Date.now() > s.pairingExpiresAt) {
              return ws.send(JSON.stringify({ type: "error", message: "Code d’appairage expiré. Créez une nouvelle session." }));
            }
            if (!deviceId || deviceId.length > 200) return ws.send(JSON.stringify({ type: "error", message: "Identifiant tablette invalide." }));
            // Plafond par SESSION (et non par deviceId) : changer d'identifiant ne remet pas le compteur à zéro.
            const key = s.id;
            const nowTs = Date.now();
            const fails = pairFailsByCode.get(key);
            if (fails && nowTs <= fails.resetAt && fails.n >= MAX_PAIR_FAILS_PER_CODE) {
              return ws.send(JSON.stringify({ type: "error", message: "Trop de tentatives. Créez une nouvelle session." }));
            }
            const providedCode = typeof m.pairingCode === "string" ? m.pairingCode : "";
            const expectedBuf = Buffer.from(String(s.pairingCode));
            const providedBuf = Buffer.from(providedCode);
            if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
              const cur = fails && nowTs <= fails.resetAt ? fails : { n: 0, resetAt: nowTs + PAIR_FAIL_WINDOW_MS };
              cur.n += 1;
              pairFailsByCode.set(key, cur);
              return ws.send(JSON.stringify({ type: "error", message: "Code incorrect." }));
            }
            if (s.technicianDeviceId && s.technicianDeviceId !== deviceId) return ws.send(JSON.stringify({ type: "error", message: "Cette session est déjà liée à une autre tablette." }));
            if (s.technicianDeviceId !== deviceId) {
              s.technicianDeviceId = deviceId;
              try { await persistSession(s); } catch { return ws.send(JSON.stringify({ type: "error", message: "Impossible d’enregistrer la tablette." })); }
            }
          } else if (!isController && !isCoach) {
            return ws.send(JSON.stringify({ type: "error", message: "Contrôleur non autorisé pour cette session." }));
          }

          if (!isTechnician && !isController && !isCoach) {
            return ws.send(JSON.stringify({ type: "error", message: "Rôle non autorisé pour cette session." }));
          }
          role = requestedRole;
          sid = s.id;
          paired = true;
          s.status = "active";
          try {
            await persistSession(s);
          } catch {
            paired = false;
            return ws.send(JSON.stringify({ type: "error", message: "Impossible d’enregistrer l’état de la session." }));
          }
          if (!clients.has(sid)) clients.set(sid, new Set());
          clients.get(sid)!.add(ws);
          if ((role === "coach" || role === "controller") && s.lastFrame) {
            try { ws.send(JSON.stringify(s.lastFrame)); } catch {}
          }
          return ws.send(JSON.stringify({ type: "pairing", success: true, role, sessionId: sid, timestamp: Date.now() }));
        }

        if (!paired || !sid) {
          return ws.send(JSON.stringify({ type: "error", message: "Appairage requis." }));
        }

        if (m.type === "ping") {
          return ws.send(JSON.stringify({ type: "pong" }));
        }

        if (m.type === "frame" && role === "technician") {
          const s = await getSessionAsync(sid);
          if (!s || s.status === "completed") return ws.send(JSON.stringify({ type: "error", message: "Session terminée." }));
          const imageData = String(m.payload?.imageData || "");
          if (!imageData.startsWith("data:image/jpeg;base64,") || imageData.length > MAX_FRAME_BYTES) {
            // Non fatal : une capture trop lourde ne doit pas couper tout le partage d'écran,
            // seulement cette image (le prochain frame sera tenté normalement).
            return ws.send(JSON.stringify({ type: "error", message: "Image de capture invalide ou trop volumineuse.", fatal: false }));
          }
          const now = Date.now();
          if (now - lastFrameWindowAt >= 1000) {
            lastFrameWindowAt = now;
            framesInWindow = 0;
          }
          if (++framesInWindow > MAX_FRAME_RATE_PER_SECOND) return;
          s.frameCount++;
          s.lastFrame = m;
          sendAll(sid, m);
          if (s.autoPilotActive) {
            runAutoPilotStep(s, imageData, sid, clients, sendAll, deps.scannerResults).catch((err: any) =>
              console.error("[PILOT] step error:", err?.message || err)
            );
          }
        } else if (m.type === "command" && (role === "controller" || role === "coach")) {
          const s = getSession(sid);
          if (!s || s.status === "completed") return ws.send(JSON.stringify({ type: "error", message: "Session terminée." }));
          if (!m.payload || typeof m.payload !== "object" || !ALLOWED.has(m.payload.action)) {
            return ws.send(JSON.stringify({ type: "error", message: "Commande non autorisée." }));
          }
          if (m.payload.action === "input" && (typeof m.payload.text !== "string" || m.payload.text.length > MAX_COMMAND_TEXT_LENGTH)) {
            return ws.send(JSON.stringify({ type: "error", message: "Texte de commande invalide." }));
          }
          sendAll(sid, m);
        } else if (m.type === "command_result" && role === "technician") {
          sendAll(sid, m, ws);
        } else if (VOICE_MESSAGE_TYPES.has(m.type) && (role === "technician" || role === "coach")) {
          const s = await getSessionAsync(sid);
          if (!s || s.status === "completed") return ws.send(JSON.stringify({ type: "error", message: "Session terminée." }));
          if (m.type === "voice_signal") {
            const signal = m.payload;
            if (!signal || typeof signal !== "object" || !["offer","answer","ice"].includes(signal.kind)) {
              return ws.send(JSON.stringify({ type: "error", message: "Signal vocal invalide." }));
            }
          }
          sendAll(sid, { type: m.type, payload: m.payload || {}, from: role }, ws);
        }
      } catch {
        // Non fatal : un message mal formé ne doit pas couper toute la session en cours.
        ws.send(JSON.stringify({ type: "error", message: "Message invalide.", fatal: false }));
      }
    });

    ws.on("close", () => {
      if (sid) clients.get(sid)?.delete(ws);
    });
  });
}

