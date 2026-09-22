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

function code() {
  return crypto.randomInt(100000, 1000000).toString();
}

function getSession(id: string) {
  const s = sessions.get(id);
  if (!s || Date.now() > s.expiresAt) {
    if (s) sessions.delete(id);
    return null;
  }
  return s;
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
  }
) {
  const wss = new WebSocketServer({ noServer: true });

  app.post("/api/screening/sessions", deps.requireAuth, (req: any, res) => {
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
    res.json({
      success: true,
      sessionId: id,
      pairingCode: s.pairingCode,
      expiresIn: PAIRING_TTL
    });
  });

  app.get("/api/screening/sessions/:id", deps.requireAuth, (req: any, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ success: false, message: "Session introuvable." });

    if (req.session.phone !== s.technicianPhone && req.session.phone !== s.coachPhone) {
      return res.status(403).json({ success: false, message: "Accès refusé." });
    }

    const safe = { ...s };
    if (req.session.phone !== s.technicianPhone) delete safe.pairingCode;
    res.json({ success: true, session: safe });
  });

  app.post("/api/screening/sessions/:id/request-human-coach", deps.requireAuth, (req: any, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ success: false, message: "Session introuvable." });
    if (req.session.phone !== s.technicianPhone) {
      return res.status(403).json({ success: false, message: "Seul le technicien peut demander un coach humain." });
    }
    s.humanCoachRequested = true;
    s.coachType = "human";
    sendAll(s.id, { type: "human_coach_requested", sessionId: s.id, timestamp: Date.now() });
    res.json({ success: true, coachType: "human", message: "Coach humain demandé." });
  });

  app.post("/api/screening/sessions/:id/end", deps.requireAuth, (req: any, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ success: false, message: "Session introuvable." });

    if (req.session.phone !== s.technicianPhone && req.session.phone !== s.coachPhone) {
      return res.status(403).json({ success: false, message: "Accès refusé." });
    }

    s.status = "completed";
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
      const s = getSession(sessionId);

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

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", "http://localhost");
    if (url.pathname !== "/api/screening/stream") return;

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

    ws.on("message", (raw: Buffer) => {
      try {
        const m = JSON.parse(raw.toString());

        if (m.type === "pairing") {
          const s = getSession(String(m.sessionId));
          if (!s) {
            return ws.send(JSON.stringify({ type: "error", message: "Session expirée." }));
          }

          const key = s.id + ":" + ws._phone;
          const n = (attempts.get(key) || 0) + 1;
          attempts.set(key, n);

          if (n > 3) {
            return ws.send(JSON.stringify({ type: "error", message: "Trop de tentatives." }));
          }

          if (s.status === "completed") {
            return ws.send(JSON.stringify({ type: "error", message: "Session terminée." }));
          }

          if (Date.now() > s.pairingExpiresAt) {
            return ws.send(JSON.stringify({
              type: "error",
              message: "Code d’appairage expiré. Créez une nouvelle session."
            }));
          }

          if (m.pairingCode !== s.pairingCode) {
            return ws.send(JSON.stringify({ type: "error", message: "Code incorrect." }));
          }

          role = ws._phone === s.technicianPhone ? "technician" : "coach";

          if (role === "coach" && !s.humanCoachRequested) {
            return ws.send(JSON.stringify({ type: "error", message: "Gemini est le coach par défaut. Le technicien doit confirmer l’appel d’un coach humain." }));
          }

          if (role === "coach") {
            if (s.coachPhone && s.coachPhone !== ws._phone) {
              return ws.send(JSON.stringify({ type: "error", message: "Coach non autorisé." }));
            }
            s.coachPhone = ws._phone;
          }

          sid = s.id;
          paired = true;
          s.status = "active";

          if (!clients.has(sid)) clients.set(sid, new Set());
          clients.get(sid)!.add(ws);

          return ws.send(JSON.stringify({
            type: "pairing",
            success: true,
            role,
            sessionId: sid,
            timestamp: Date.now()
          }));
        }

        if (!paired || !sid) {
          return ws.send(JSON.stringify({ type: "error", message: "Appairage requis." }));
        }

        if (m.type === "frame" && role === "technician") {
          const s = getSession(sid);
          if (!s || s.status === "completed") return ws.send(JSON.stringify({ type: "error", message: "Session terminée." }));
          const imageData = String(m.payload?.imageData || "");
          if (s && imageData.length <= MAX_FRAME_BYTES) {
            s.frameCount++;
            sendAll(sid, m);
          }
        } else if (m.type === "command" && role === "coach") {
          const s = getSession(sid);
          if (!s || s.status === "completed") return ws.send(JSON.stringify({ type: "error", message: "Session terminée." }));
          if (!m.payload || typeof m.payload !== "object" || !ALLOWED.has(m.payload.action)) {
            return ws.send(JSON.stringify({ type: "error", message: "Commande non autorisée." }));
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
