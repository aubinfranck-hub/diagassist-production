import type { Express } from "express";

export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function sessionIsValid(session: { createdAt: number } | undefined, now = Date.now()): boolean {
  return !!session && Number.isFinite(session.createdAt) && now - session.createdAt < SESSION_MAX_AGE_MS;
}

export function normalizePhone(phone: unknown, countryCode: unknown = "+225"): string {
  const invalid = () => Object.assign(new Error("Numéro de téléphone invalide."), { status: 400 });
  if (typeof phone !== "string" || typeof countryCode !== "string") throw invalid();
  const digits = phone.replace(/[\s().-]/g, "");
  const prefix = countryCode.replace(/[\s+]/g, "");
  const full = digits.startsWith("+") ? digits : `+${prefix}${digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(full)) throw invalid();
  return full;
}

// Express 4 does not forward rejected async handlers to error middleware.
// Wrap route handlers at registration, including middleware arrays, without changing app.get(setting).
export function catchAsyncRoutes(app: Express): void {
  const wrap = (handler: any): any => Array.isArray(handler) ? handler.map(wrap) :
    typeof handler !== "function" ? handler : function(req: any, res: any, next: any) {
      try { Promise.resolve(handler(req, res, next)).catch(next); } catch (error) { next(error); }
    };
  for (const method of ["get", "post", "put", "patch", "delete", "options"] as const) {
    const register = (app[method] as any).bind(app);
    (app as any)[method] = (path: any, ...handlers: any[]) =>
      handlers.length ? register(path, ...handlers.map(wrap)) : register(path);
  }
}
