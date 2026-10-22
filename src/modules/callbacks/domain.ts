export function callbackPhone(value: unknown): string {
  if (typeof value !== "string") throw new Error("Indiquez votre numéro WhatsApp.");
  let phone = value.replace(/[\s().-]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  else if (/^\d{10}$/.test(phone)) phone = `+225${phone}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Utilisez 10 chiffres en Côte d’Ivoire, ou un numéro avec indicatif +pays.");
  return phone;
}

export function callbackInput(body: any) {
  if (body?.consent !== true) throw new Error("Votre accord pour un rappel vocal est nécessaire.");
  if (!["boutique", "assistance"].includes(body.source)) throw new Error("Service invalide.");
  const clean = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";
  return {
    phone: callbackPhone(body.phone), source: body.source as "boutique" | "assistance",
    name: clean(body.name, 100), topic: clean(body.topic, 500),
    productSlug: clean(body.productSlug, 200), requestId: clean(body.requestId, 100),
  };
}

export const CALLBACK_SCHEMA = `
CREATE TABLE IF NOT EXISTS voice_callbacks (
  id UUID PRIMARY KEY, phone TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('boutique','assistance')),
  topic TEXT NOT NULL DEFAULT '', context_label TEXT NOT NULL DEFAULT '',
  product_slug TEXT, request_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','permission_pending','calling','review','completed','cancelled')),
  consent_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), call_sid TEXT UNIQUE, call_status TEXT,
  last_error TEXT, operator_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS voice_callbacks_queue ON voice_callbacks (status, created_at DESC);
CREATE TABLE IF NOT EXISTS voice_callback_permissions (
  phone TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS voice_callback_events (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS voice_callback_attempts (
  id UUID PRIMARY KEY, callback_id UUID NOT NULL REFERENCES voice_callbacks(id), phone TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('permission','call')), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voice_callback_attempts_phone ON voice_callback_attempts (phone, kind, created_at);
`;

export function callingConfig(env: NodeJS.ProcessEnv = process.env) {
  const base = (env.WHATSAPP_CALLBACK_PUBLIC_URL || "").replace(/\/$/, "");
  const sender = env.TWILIO_WHATSAPP_NUMBER || "";
  const sip = env.WHATSAPP_CALLBACK_SIP || "";
  const ready = env.WHATSAPP_CALLING_ENABLED === "true" && /^https:\/\/[^/?#]+$/.test(base)
    && /^whatsapp:\+\d{8,15}$/.test(sender) && sender !== "whatsapp:+14155238886"
    && /^sips?:[^\s<>]+$/.test(sip) && /^HX[0-9a-f]{32}$/i.test(env.WHATSAPP_CALL_PERMISSION_CONTENT_SID || "")
    && !!env.TWILIO_ACCOUNT_SID && !!env.TWILIO_AUTH_TOKEN;
  return { ready, base, sender, sip };
}
