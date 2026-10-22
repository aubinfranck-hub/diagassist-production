import { randomUUID } from "node:crypto";
import type { Express, RequestHandler } from "express";
import type { Pool } from "pg";
import twilio from "twilio";
import { callbackInput, callbackPhone, CALLBACK_SCHEMA, callingConfig } from "./domain";

type Dependencies = { pool: Pool | null; requireAuth: RequestHandler; requireAdminAuth: RequestHandler; limiter: RequestHandler; createProvider?: () => ReturnType<typeof twilio> };

/** No automatic outbound calls: an authenticated operator requests permission, then starts each call. */
export async function registerCallbacks(app: Express, deps: Dependencies) {
  const { pool, requireAuth, requireAdminAuth, limiter } = deps;
  if (pool) await pool.query(CALLBACK_SCHEMA);
  const available: RequestHandler = (_req, res, next) => pool ? next() : res.status(503).json({ message: "Rappels temporairement indisponibles." });
  const linkedAuth: RequestHandler = (req, res, next) => req.body?.requestId ? requireAuth(req, res, next) : next();
  app.post("/api/callbacks", limiter, available, linkedAuth, async (req: any, res) => {
    let input: ReturnType<typeof callbackInput>;
    try { input = callbackInput(req.body); } catch (e) { return res.status(400).json({ message: (e as Error).message }); }
    let label = "";
    if (input.requestId) {
      if (input.source !== "assistance") return res.status(400).json({ message: "Contexte invalide." });
      const found = await pool!.query("SELECT service FROM assistance_requests WHERE id=$1 AND client_phone=$2", [input.requestId, req.session.phone]);
      if (!found.rowCount) return res.status(404).json({ message: "Demande de dépannage introuvable." });
      label = `Dépannage ${found.rows[0].service}`;
    }
    if (input.productSlug) {
      if (input.source !== "boutique") return res.status(400).json({ message: "Contexte invalide." });
      const found = await pool!.query("SELECT name FROM shop_products WHERE slug=$1 AND is_active=true", [input.productSlug]);
      if (!found.rowCount) return res.status(404).json({ message: "Produit indisponible." });
      label = found.rows[0].name;
    }
    const db = await pool!.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`voice:${input.phone}`]);
      // Return the same generic success for duplicates: never disclose another customer's request.
      const existing = await db.query("SELECT 1 FROM voice_callbacks WHERE phone=$1 AND created_at > now()-interval '15 minutes'", [input.phone]);
      if (!existing.rowCount) await db.query(`INSERT INTO voice_callbacks (id,phone,name,source,topic,context_label,product_slug,request_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [randomUUID(), input.phone, input.name, input.source, input.topic, label, input.productSlug || null, input.requestId || null]);
      await db.query("COMMIT");
      res.status(202).json({ success: true, message: "Demande enregistrée. L’équipe vous recontactera par appel vocal WhatsApp selon ses disponibilités." });
    } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  });

  app.get("/api/admin/callbacks", requireAdminAuth, available, async (req, res) => {
    const offset = Math.max(0, Math.min(100000, Math.floor(Number(req.query.offset) || 0)));
    const source = ["boutique", "assistance"].includes(String(req.query.source)) ? String(req.query.source) : null;
    const closed = req.query.closed === "true";
    const result = await pool!.query(`SELECT c.*, (p.expires_at > now()) AS permission_valid
      FROM voice_callbacks c LEFT JOIN voice_callback_permissions p ON p.phone=c.phone
      WHERE ($1::text IS NULL OR source=$1) AND (status IN ('completed','cancelled'))=$2
      ORDER BY c.created_at DESC LIMIT 51 OFFSET $3`, [source, closed, offset]);
    res.json({ success: true, callbacks: result.rows.slice(0, 50), hasMore: result.rows.length > 50, callingReady: callingConfig().ready });
  });

  app.post("/api/admin/callbacks/:id/action", requireAdminAuth, available, async (req, res) => {
    const action = req.body?.action;
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id) || !["permission", "call", "complete", "cancel"].includes(action)) {
      return res.status(400).json({ message: "Action invalide." });
    }
    const config = callingConfig();
    if (["permission", "call"].includes(action) && !config.ready) return res.status(503).json({ message: "WhatsApp Business Calling n’est pas configuré. Le rappel reste à traiter manuellement." });
    const db = await pool!.connect();
    let row: any;
    try {
      await db.query("BEGIN");
      const identity = (await db.query("SELECT phone FROM voice_callbacks WHERE id=$1", [req.params.id])).rows[0];
      if (!identity) { await db.query("ROLLBACK"); return res.status(404).json({ message: "Rappel introuvable." }); }
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`voice:${identity.phone}`]);
      row = (await db.query("SELECT * FROM voice_callbacks WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (["completed", "cancelled"].includes(row.status)) { await db.query("ROLLBACK"); return res.status(409).json({ message: "Ce rappel est déjà clôturé." }); }
      if (["complete", "cancel"].includes(action)) {
        if (row.status === "calling") { await db.query("ROLLBACK"); return res.status(409).json({ message: "Attendez la fin de l’appel. Si le suivi est bloqué, vérifiez le journal Twilio et son webhook." }); }
        await db.query("UPDATE voice_callbacks SET status=$2,operator_note=$3,updated_at=now() WHERE id=$1", [row.id, action === "complete" ? "completed" : "cancelled", String(req.body.note || "").slice(0, 1000)]);
      } else {
        if (row.status === "calling") { await db.query("ROLLBACK"); return res.status(409).json({ message: "Un appel est déjà en cours." }); }
        const kind = action === "call" ? "call" : "permission";
        const counts = (await db.query(`SELECT count(*) FILTER (WHERE created_at > now()-interval '24 hours')::int AS day,
          count(*)::int AS week FROM voice_callback_attempts WHERE phone=$1 AND kind=$2 AND created_at>now()-interval '7 days'`, [row.phone, kind])).rows[0];
        if ((kind === "permission" && (counts.day >= 1 || counts.week >= 2)) || (kind === "call" && counts.day >= 5)) {
          await db.query("ROLLBACK"); return res.status(429).json({ message: "Limite de contact atteinte pour ce numéro. Réessayez ultérieurement." });
        }
        if (kind === "call") {
          if (row.call_sid) { await db.query("ROLLBACK"); return res.status(409).json({ message: "Un appel a déjà été effectué. Clôturez ce rappel après vérification du résultat." }); }
          const permission = await db.query("SELECT 1 FROM voice_callback_permissions WHERE phone=$1 AND expires_at>now()", [row.phone]);
          if (!permission.rowCount) { await db.query("ROLLBACK"); return res.status(409).json({ message: "Le client doit d’abord accepter l’autorisation d’appel dans WhatsApp." }); }
          const inProgress = await db.query("SELECT 1 FROM voice_callbacks WHERE phone=$1 AND status='calling'", [row.phone]);
          if (inProgress.rowCount) { await db.query("ROLLBACK"); return res.status(409).json({ message: "Un autre rappel est déjà en cours pour ce numéro." }); }
        }
        await db.query("INSERT INTO voice_callback_attempts (id,callback_id,phone,kind) VALUES ($1,$2,$3,$4)", [randomUUID(), row.id, row.phone, kind]);
        await db.query("UPDATE voice_callbacks SET status=$2,last_error=NULL,updated_at=now() WHERE id=$1", [row.id, kind === "call" ? "calling" : "permission_pending"]);
      }
      await db.query("COMMIT");
    } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }

    if (["permission", "call"].includes(action)) {
      const client = deps.createProvider?.() || twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, { autoRetry: false, timeout: 15000 });
      try {
        if (action === "permission") {
          await client.messages.create({ from: config.sender, to: `whatsapp:${row.phone}`, contentSid: process.env.WHATSAPP_CALL_PERMISSION_CONTENT_SID! });
        } else {
          const voice = new twilio.twiml.VoiceResponse();
          voice.dial({ timeout: 25 }).sip(config.sip);
          const call = await client.calls.create({ from: config.sender, to: `whatsapp:${row.phone}`, twiml: voice.toString(),
            timeout: 30, timeLimit: 900, statusCallback: `${config.base}/api/callbacks/whatsapp/status?id=${row.id}`,
            statusCallbackEvent: ["initiated", "ringing", "answered", "completed"], statusCallbackMethod: "POST" });
          await pool!.query("UPDATE voice_callbacks SET call_sid=$2,updated_at=now() WHERE id=$1 AND (call_sid IS NULL OR call_sid=$2)", [row.id, call.sid]);
        }
      } catch (e: any) {
        // A timeout can mean the provider accepted the call. Never retry automatically.
        const rejected = Number(e.status) >= 400 && Number(e.status) < 500;
        await pool!.query(`UPDATE voice_callbacks SET last_error=$2,
          status=CASE WHEN status='calling' AND $3 THEN 'review' ELSE status END,updated_at=now() WHERE id=$1`,
        [row.id, `Twilio ${e.code || "indisponible"}. Vérifier le journal fournisseur avant une nouvelle tentative.`, rejected]);
        return res.status(502).json({ message: "Le fournisseur n’a pas confirmé l’action. Vérifiez le journal Twilio avant de réessayer." });
      }
    }
    res.json({ success: true });
  });

  const signed: RequestHandler = (req, res, next) => {
    const config = callingConfig();
    const signature = String(req.headers["x-twilio-signature"] || "");
    const token = process.env.TWILIO_AUTH_TOKEN || "";
    if (!config.base || !token || !signature || req.body?.AccountSid !== process.env.TWILIO_ACCOUNT_SID ||
      !twilio.validateRequest(token, signature, `${config.base}${req.originalUrl}`, req.body || {})) {
      return res.status(403).send("Signature invalide.");
    }
    next();
  };
  const incoming: RequestHandler = async (req, res) => {
    const config = callingConfig();
    if (req.body.To !== config.sender) return res.status(400).send("Destinataire invalide.");
    let phone: string;
    try { phone = callbackPhone(String(req.body.From || "").replace(/^whatsapp:/, "")); }
    catch { return res.status(400).send("Numéro invalide."); }
    const accepted = req.body.Body === "VOICE_CALL_REQUEST" && req.body.ButtonPayload === "ACCEPTED";
    const rejected = req.body.Body === "VOICE_CALL_REQUEST" && req.body.ButtonPayload === "REJECTED";
    const stopped = /^(stop|arret|arrêt|unsubscribe)\b/i.test(String(req.body.Body || "").trim());
    if (accepted || rejected || stopped) {
      if (!/^SM[0-9a-f]{32}$/i.test(req.body.MessageSid || "")) return res.status(400).send("Message invalide.");
      const db = await pool!.connect();
      try {
        await db.query("BEGIN");
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`voice:${phone}`]);
        const event = await db.query("INSERT INTO voice_callback_events(id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id", [req.body.MessageSid]);
        if (event.rowCount) {
          // Accept only responses associated with a requested permission; unsolicited ACCEPT never enables calling.
          const pending = await db.query("SELECT 1 FROM voice_callbacks WHERE phone=$1 AND status='permission_pending' AND updated_at>now()-interval '7 days'", [phone]);
          if (!accepted || pending.rowCount) {
            // Conservative seven-day lease even if WhatsApp grants a permanent permission.
            await db.query(`INSERT INTO voice_callback_permissions(phone,expires_at) VALUES ($1,CASE WHEN $2 THEN now()+interval '7 days' ELSE now() END)
              ON CONFLICT(phone) DO UPDATE SET expires_at=EXCLUDED.expires_at,updated_at=now()`, [phone, accepted]);
            await db.query("UPDATE voice_callbacks SET status=$2,updated_at=now() WHERE phone=$1 AND status IN ('queued','permission_pending','review')", [phone, accepted ? "queued" : "cancelled"]);
          }
        }
        await db.query("COMMIT");
      } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
    }
    res.type("text/xml").send("<Response></Response>");
  };
  app.post("/api/callbacks/whatsapp/incoming", available, signed, incoming);
  // Preserve the existing commerce webhook and its commercial STOP handling.
  app.post("/api/shop/whatsapp/incoming", (req, _res, next) => {
    req.body?.Body === "VOICE_CALL_REQUEST" ? next() : next("route");
  }, available, signed, incoming);
  app.post("/api/callbacks/whatsapp/status", available, signed, async (req, res) => {
    const id = String(req.query.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || !/^CA[0-9a-f]{32}$/i.test(req.body.CallSid || "")) return res.status(400).send("Appel invalide.");
    const terminal = ["completed", "busy", "no-answer", "failed", "canceled"].includes(req.body.CallStatus);
    if (!terminal && !["queued", "initiated", "ringing", "in-progress"].includes(req.body.CallStatus)) return res.sendStatus(204);
    await pool!.query(`UPDATE voice_callbacks SET call_sid=$2,call_status=$3,status=CASE WHEN $4 THEN 'review' ELSE status END,updated_at=now()
      WHERE id=$1 AND status='calling' AND (call_sid IS NULL OR call_sid=$2) AND phone=$5 AND $6=$7`,
    [id, req.body.CallSid, req.body.CallStatus, terminal, String(req.body.To || "").replace(/^whatsapp:/, ""), req.body.From, callingConfig().sender]);
    res.sendStatus(204);
  });
}
