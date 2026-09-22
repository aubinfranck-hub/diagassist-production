import crypto from "crypto";
import type { Express } from "express";
import type { Server } from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Type } from "@google/genai";

const sessions = new Map<string, any>();
const clients = new Map<string, Set<any>>();
const attempts = new Map<string, number>();
const PAIRING_TTL = 10 * 60 * 1000;
const SESSION_TTL = 60 * 60 * 1000;
const MAX_FRAME_BYTES = 2_500_000;
const MAX_VISION_IMAGE_BYTES = 2_500_000;
const ALLOWED = new Set(["click", "scroll", "input", "back", "request_screen"]);
const MAX_FRAME_RATE_PER_SECOND = 4;
const MAX_COMMAND_TEXT_LENGTH = 1_000;

function code() {
  return crypto.randomInt(100000, 1000000).toString();
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY non configurée.");
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });
}

export function registerScreening(
  app: Express,
  server: Server,
  deps: {
    requireAuth: any;
    getEffectivePlan: (phone: string) => string;
    sessions: Map<string, any>;
    dbQuery?: (sql: string, params?: any[]) => Promise<any>;
  }
) {
  const dbQuery = deps.dbQuery;
  const persistSession = async (s: any) => {
    if (!dbQuery) return;
    try {
      await dbQuery(
        `INSERT INTO screening_sessions
          (id, technician_phone, coach_phone, pairing_code, pairing_expires_at, coach_type, human_coach_requested, status, created_at, expires_at, frame_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           coach_phone=$3, pairing_expires_at=$5, coach_type=$6,
           human_coach_requested=$7, status=$8, expires_at=$10, frame_count=$11`,
        [s.id, s.technicianPhone, s.coachPhone || null, s.pairingCode, s.pairingExpiresAt,
         s.coachType, s.humanCoachRequested, s.status, s.createdAt, s.expiresAt, s.frameCount]
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
                human_coach_requested, status, created_at, expires_at, frame_count
         FROM screening_sessions WHERE id = $1 LIMIT 1`,
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
        lastVisionAt: 0,
      };
      if (Date.now() > s.expiresAt && s.status !== "completed") return null;
      sessions.set(id, s);
      return s;
    } catch (err: any) {
      console.error("[SCREENING][DB] récupération session échouée:", err.message);
      return null;
    }
  };

  if (dbQuery) {
    dbQuery(
      `SELECT id, technician_phone, coach_phone, pairing_code, pairing_expires_at, coach_type,
              human_coach_requested, status, created_at, expires_at, frame_count
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
          lastVisionAt: 0,
        });
      }
      console.log(`[SCREENING][DB] ${sessions.size} session(s) rechargée(s).`);
    }).catch((err: any) => console.error("[SCREENING][DB] chargement échoué:", err.message));
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES + 100_000 });

  app.post("/api/screening/sessions", deps.requireAuth, async (req: any, res) => {
    if (deps.getEffectivePlan(req.session.phone) !== "premium") {
      return res.status(403).json({
        success: false,
        message: "Le coaching temps réel est réservé au Premium.",
        requiredTier: "premium"
      });
    }

    const id = "scr_" + crypto.randomBytes(12).toString("hex");
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
                status, created_at, expires_at, frame_count
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

  // Le coach humain rejoint avec son ID de session uniquement.
  // Le code d'appairage est strictement réservé à la tablette du technicien.
  app.post("/api/screening/sessions/:id/join-coach", deps.requireAuth, async (req: any, res) => {
    const s = await getSessionAsync(req.params.id);
    if (!s) {
      console.warn("[SCREENING][JOIN] session introuvable:", normalizeSessionId(req.params.id));
      return res.status(404).json({ success: false, message: "Session introuvable. Vérifiez l’ID scr_... et utilisez une session encore valide." });
    }
    if (!s.humanCoachRequested || s.coachType !== "human") {
      return res.status(403).json({ success: false, message: "Le technicien doit d'abord demander un coach humain." });
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

    const token = url.searchParams.get("token") || "";
    const auth = deps.sessions.get(token);

    if (!auth || deps.getEffectivePlan(auth.phone) !== "premium") {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, ws => {
      (ws as any)._phone = auth.phone;
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

          const requestedRole = m.role === "coach" ? "coach" : "technician";
          const isTechnician = requestedRole === "technician" && ws._phone === s.technicianPhone;
          const isCoach = requestedRole === "coach" && s.humanCoachRequested && s.coachPhone === ws._phone;

          if (isTechnician) {
            if (Date.now() > s.pairingExpiresAt) {
              return ws.send(JSON.stringify({ type: "error", message: "Code d’appairage expiré. Créez une nouvelle session." }));
            }
            const key = s.id + ":" + ws._phone;
            if (m.pairingCode !== s.pairingCode) {
              const n = (attempts.get(key) || 0) + 1;
              attempts.set(key, n);
              if (n >= 3) return ws.send(JSON.stringify({ type: "error", message: "Trop de tentatives. Créez une nouvelle session." }));
              return ws.send(JSON.stringify({ type: "error", message: "Code incorrect." }));
            }
            const deviceId = typeof m.deviceId === "string" ? m.deviceId.trim() : "";
            if (!deviceId || deviceId.length > 200) return ws.send(JSON.stringify({ type: "error", message: "Identifiant tablette invalide." }));
            if (s.technicianDeviceId && s.technicianDeviceId !== deviceId) return ws.send(JSON.stringify({ type: "error", message: "Cette session est déjà liée à une autre tablette." }));
            s.technicianDeviceId = deviceId;
          } else if (!isCoach) {
            return ws.send(JSON.stringify({ type: "error", message: "Coach non autorisé. Utilisez l’accès coach avec l’ID de session." }));
          }

          if (!isTechnician && !isCoach) {
            return ws.send(JSON.stringify({ type: "error", message: "Rôle non autorisé pour cette session." }));
          }
          role = requestedRole;
          sid = s.id;
          paired = true;
          s.status = "active";
          if (!clients.has(sid)) clients.set(sid, new Set());
          clients.get(sid)!.add(ws);
          return ws.send(JSON.stringify({ type: "pairing", success: true, role, sessionId: sid, timestamp: Date.now() }));
        }

        if (!paired || !sid) {
          return ws.send(JSON.stringify({ type: "error", message: "Appairage requis." }));
        }

        if (m.type === "frame" && role === "technician") {
          const s = await getSessionAsync(sid);
          if (!s || s.status === "completed") return ws.send(JSON.stringify({ type: "error", message: "Session terminée." }));
          const imageData = String(m.payload?.imageData || "");
          if (!imageData.startsWith("data:image/jpeg;base64,") || imageData.length > MAX_FRAME_BYTES) {
            return ws.send(JSON.stringify({ type: "error", message: "Image de capture invalide ou trop volumineuse." }));
          }
          const now = Date.now();
          if (now - lastFrameWindowAt >= 1000) {
            lastFrameWindowAt = now;
            framesInWindow = 0;
          }
          if (++framesInWindow > MAX_FRAME_RATE_PER_SECOND) return;
          s.frameCount++;
          sendAll(sid, m);
        } else if (m.type === "command" && role === "coach") {
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
        }
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Message invalide." }));
      }
    });

    ws.on("close", () => {
      if (sid) clients.get(sid)?.delete(ws);
    });
  });
}

