import crypto from "crypto";

// Comparaison en temps constant (évite de deviner le secret caractère par caractère).
export function safeEqual(provided: unknown, expected: string | undefined): boolean {
  if (typeof provided !== "string" || !expected) return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Limiteur d'ÉCHECS du code admin, par adresse IP : 10 échecs / 15 min, puis blocage.
// Un succès remet le compteur à zéro. Partagé par toutes les routes admin.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; start: number }>();

export function adminAttemptsBlocked(ip: string): boolean {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.start > WINDOW_MS) { failures.delete(ip); return false; }
  return f.count >= MAX_FAILURES;
}
export function adminAttemptFailed(ip: string): void {
  const now = Date.now();
  const f = failures.get(ip);
  if (!f || now - f.start > WINDOW_MS) failures.set(ip, { count: 1, start: now });
  else f.count += 1;
  if (failures.size > 5000) for (const [k, v] of failures) if (now - v.start > WINDOW_MS) failures.delete(k);
}
export function adminAttemptOk(ip: string): void { failures.delete(ip); }

export function isAdminCode(provided: unknown, ip: string): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || typeof provided !== "string" || !provided) return false;
  if (adminAttemptsBlocked(ip)) return false;
  if (safeEqual(provided, secret)) { adminAttemptOk(ip); return true; }
  adminAttemptFailed(ip);
  return false;
}

// Jeton admin temporaire et signé (HMAC), délivré après vérification du code. Le navigateur ne garde
// que ce jeton (8 h), jamais le secret ADMIN_SECRET. Changer ADMIN_SECRET invalide tous les jetons.
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const tokenKey = () => crypto.createHash("sha256").update("diagassist-admin-token:" + (process.env.ADMIN_SECRET || "")).digest();
export function issueAdminToken(): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const sig = crypto.createHmac("sha256", tokenKey()).update(String(expiresAt)).digest("hex");
  return { token: `${expiresAt}.${sig}`, expiresAt };
}
export function isAdminToken(provided: unknown): boolean {
  if (!process.env.ADMIN_SECRET || typeof provided !== "string") return false;
  const [exp, sig] = provided.split(".");
  const expiresAt = Number(exp);
  if (!sig || !Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = crypto.createHmac("sha256", tokenKey()).update(String(expiresAt)).digest("hex");
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
