// Notifications Web Push (bibliothèque web-push, MPL-2.0) : alerte le mécanicien d'une nouvelle
// demande et le client d'une offre ou d'un changement de statut, même quand DiagAssist n'est pas
// ouvert au premier plan. Complète les notifications internes et WhatsApp existantes.
// Configuration : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:… ou https://…).
// Sans ces variables, la fonction est désactivée proprement (aucune erreur, bouton masqué).
import type { Express } from "express";
import type { Pool } from "pg";
import webpush from "web-push";

export type PushMessage = { title: string; body: string; url?: string; tag?: string };

let configured: boolean | null = null;

export function pushConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = (process.env.VAPID_PUBLIC_KEY || "").trim();
  const priv = (process.env.VAPID_PRIVATE_KEY || "").trim();
  if (!pub || !priv) return (configured = false);
  try {
    webpush.setVapidDetails((process.env.VAPID_SUBJECT || "").trim() || "mailto:contact@diagassist.app", pub, priv);
    configured = true;
  } catch (e: any) {
    console.error("[PUSH] Clés VAPID invalides :", e?.message || e);
    configured = false;
  }
  return configured;
}

export const PUSH_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at BIGINT NOT NULL,
    last_ok_at BIGINT
  );
  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_phone ON push_subscriptions (phone);
`;

export function createPushService(pool: Pool | null) {
  async function sendToPhone(phone: string, msg: PushMessage): Promise<number> {
    if (!pool || !phone || !pushConfigured()) return 0;
    const { rows } = await pool.query("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE phone = $1", [phone]);
    let sent = 0;
    const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url || "/", tag: msg.tag || undefined });
    await Promise.all(rows.map(async (r: any) => {
      try {
        await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload, { TTL: 3600, urgency: "high" });
        sent++;
        await pool.query("UPDATE push_subscriptions SET last_ok_at = $2 WHERE endpoint = $1", [r.endpoint, Date.now()]);
      } catch (e: any) {
        // 404/410 : abonnement expiré ou révoqué par l'utilisateur → on l'oublie.
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [r.endpoint]).catch(() => {});
        } else {
          console.warn("[PUSH] Envoi échoué :", e?.statusCode || "", e?.body || e?.message || e);
        }
      }
    }));
    return sent;
  }

  function registerRoutes(app: Express, requireAuth: any) {
    app.get("/api/push/public-key", (_req, res) => {
      res.json({ success: true, enabled: Boolean(pool) && pushConfigured(), publicKey: pushConfigured() ? (process.env.VAPID_PUBLIC_KEY || "").trim() : null });
    });

    app.post("/api/push/subscribe", requireAuth, async (req: any, res) => {
      if (!pool || !pushConfigured()) return res.status(503).json({ success: false, message: "Notifications push non configurées." });
      const sub = req.body?.subscription;
      const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
      const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh : "";
      const auth = typeof sub?.keys?.auth === "string" ? sub.keys.auth : "";
      if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || p256dh.length > 200 || !auth || auth.length > 100) {
        return res.status(400).json({ success: false, message: "Abonnement invalide." });
      }
      const phone = req.session.phone;
      await pool.query(
        `INSERT INTO push_subscriptions (endpoint, phone, p256dh, auth, user_agent, created_at) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (endpoint) DO UPDATE SET phone = EXCLUDED.phone, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
        [endpoint, phone, p256dh, auth, String(req.headers["user-agent"] || "").slice(0, 300), Date.now()]
      );
      // Au plus 5 appareils par compte : on garde les plus récents.
      await pool.query(
        `DELETE FROM push_subscriptions WHERE phone = $1 AND endpoint NOT IN
           (SELECT endpoint FROM push_subscriptions WHERE phone = $1 ORDER BY created_at DESC LIMIT 5)`,
        [phone]
      );
      res.json({ success: true });
    });

    app.post("/api/push/unsubscribe", requireAuth, async (req: any, res) => {
      if (!pool) return res.json({ success: true });
      const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
      if (endpoint) await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND phone = $2", [endpoint, req.session.phone]);
      res.json({ success: true });
    });

    // Test depuis l'appli : envoie une notification à ses propres appareils.
    app.post("/api/push/test", requireAuth, async (req: any, res) => {
      const sent = await sendToPhone(req.session.phone, { title: "DiagAssist", body: "Les notifications sont activées sur cet appareil.", url: "/", tag: "test" });
      res.json({ success: sent > 0, sent, message: sent > 0 ? "Notification envoyée." : "Aucun appareil abonné ou notifications non configurées." });
    });
  }

  return { sendToPhone, registerRoutes };
}
