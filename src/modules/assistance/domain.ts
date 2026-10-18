// Règles métier pures de l'Assistance automobile (sans accès base ni réseau) : états, transitions,
// géométrie, validation. Isolées pour être testables sans serveur.

export const REQUEST_STATUSES = [
  "brouillon", "recherche", "affectee", "en_route", "sur_place", "en_intervention",
  "terminee", "sans_disponibilite", "annulee",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const QUOTE_STATUSES = ["aucun", "propose", "accepte", "refuse"] as const;
export const PAYMENT_STATUSES = ["aucun", "en_attente", "especes_a_confirmer", "paye", "echoue"] as const;
export const PRO_STATUSES = ["en_attente", "valide", "suspendu", "refuse"] as const;

export const SERVICE_SEED: { code: string; label: string; description: string; sort: number }[] = [
  { code: "mecanique", label: "Mécanique", description: "Panne moteur, freins, courroie, fuite…", sort: 1 },
  { code: "electricite", label: "Électricité automobile", description: "Câblage, alternateur, démarreur, voyants…", sort: 2 },
  { code: "diagnostic", label: "Diagnostic sur place", description: "Un mécanicien vient lire et analyser la panne.", sort: 3 },
  { code: "batterie", label: "Batterie et démarrage", description: "Voiture qui ne démarre pas, batterie à plat.", sort: 4 },
  { code: "pneumatiques", label: "Pneumatiques", description: "Pneu crevé, éclaté ou à changer.", sort: 5 },
  { code: "remorquage", label: "Remorquage", description: "Évacuation du véhicule vers un garage.", sort: 6 },
  { code: "vidange", label: "Vidange sur rendez-vous", description: "Vidange et entretien courant.", sort: 7 },
];
export const SERVICE_CODES = SERVICE_SEED.map((s) => s.code);

// Transitions autorisées. L'acteur précis (client, pro, admin, système) est contrôlé par les routes.
const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  brouillon: ["recherche", "annulee"],
  recherche: ["affectee", "sans_disponibilite", "annulee"],
  sans_disponibilite: ["recherche", "annulee"],
  affectee: ["en_route", "recherche", "annulee"],
  en_route: ["sur_place", "recherche", "annulee"],
  sur_place: ["en_intervention", "recherche", "annulee"],
  en_intervention: ["terminee", "annulee"],
  terminee: [],
  annulee: [],
};
export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
export const ACTIVE_MISSION_STATUSES: RequestStatus[] = ["affectee", "en_route", "sur_place", "en_intervention"];
export const OPEN_STATUSES: RequestStatus[] = ["brouillon", "recherche", "sans_disponibilite", ...ACTIVE_MISSION_STATUSES];
// Le client peut annuler tant que le travail n'a pas commencé ; ensuite seul l'admin le peut.
export const CLIENT_CANCELLABLE: RequestStatus[] = ["brouillon", "recherche", "sans_disponibilite", "affectee", "en_route", "sur_place"];

export const STATUS_LABELS: Record<RequestStatus, string> = {
  brouillon: "Brouillon",
  recherche: "Recherche d'un mécanicien",
  affectee: "Mécanicien trouvé",
  en_route: "Mécanicien en route",
  sur_place: "Mécanicien arrivé",
  en_intervention: "Intervention en cours",
  terminee: "Intervention terminée",
  sans_disponibilite: "Aucun mécanicien disponible",
  annulee: "Annulée",
};

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function validCoords(lat: unknown, lng: unknown): boolean {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}

// Position approximative montrée au mécanicien AVANT acceptation (~1,1 km de grille).
export function approxPosition(lat: number, lng: number): { lat: number; lng: number; radiusM: number } {
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, radiusM: 1000 };
}

// ETA indicatif à partir de la distance à vol d'oiseau majorée (détour urbain) et d'une vitesse
// moyenne configurable. Toujours présenté comme approximatif.
export function estimateEtaMinutes(distanceKm: number, avgSpeedKmh: number): number {
  const detour = 1.4;
  const speed = avgSpeedKmh > 0 ? avgSpeedKmh : 25;
  return Math.max(1, Math.round(((distanceKm * detour) / speed) * 60));
}

export type QuoteLine = { kind: "deplacement" | "diagnostic" | "main_oeuvre" | "pieces"; label: string; amount: number };
const LINE_KINDS = new Set(["deplacement", "diagnostic", "main_oeuvre", "pieces"]);

export function parseQuoteLines(raw: unknown): { ok: true; lines: QuoteLine[]; total: number } | { ok: false; message: string } {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return { ok: false, message: "Le devis doit contenir entre 1 et 20 lignes." };
  const lines: QuoteLine[] = [];
  let total = 0;
  for (const l of raw) {
    const kind = String(l?.kind || "");
    const amount = Number(l?.amount);
    const label = String(l?.label || "").trim().slice(0, 120);
    if (!LINE_KINDS.has(kind)) return { ok: false, message: "Type de ligne de devis invalide." };
    if (!Number.isInteger(amount) || amount < 0 || amount > 50_000_000) return { ok: false, message: "Montant de ligne invalide (entier en F CFA)." };
    lines.push({ kind: kind as QuoteLine["kind"], label: label || defaultLineLabel(kind), amount });
    total += amount;
  }
  if (total <= 0) return { ok: false, message: "Le total du devis doit être supérieur à 0." };
  return { ok: true, lines, total };
}
function defaultLineLabel(kind: string): string {
  return ({ deplacement: "Déplacement", diagnostic: "Diagnostic", main_oeuvre: "Main-d'œuvre", pieces: "Pièces" } as Record<string, string>)[kind] || kind;
}

export const MEDIA_RULES: { prefix: string; kind: "image" | "video" | "audio"; mimes: string[]; maxBytes: number }[] = [
  { prefix: "image/", kind: "image", mimes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 5 * 1024 * 1024 },
  { prefix: "video/", kind: "video", mimes: ["video/mp4", "video/webm", "video/quicktime"], maxBytes: 8 * 1024 * 1024 },
  { prefix: "audio/", kind: "audio", mimes: ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a"], maxBytes: 5 * 1024 * 1024 },
];
export const DOC_MIMES = ["application/pdf", "image/jpeg", "image/png"];
export const DOC_MAX_BYTES = 4 * 1024 * 1024;

export function mediaRuleFor(mime: string) {
  const base = mime.split(";")[0].trim().toLowerCase();
  const rule = MEDIA_RULES.find((r) => r.mimes.includes(base));
  return rule ? { rule, base } : null;
}

// Vérifie que les premiers octets correspondent bien au type annoncé (le MIME déclaré par le
// client ne suffit pas).
export function magicMatches(base: string, buf: Buffer): boolean {
  const hex = buf.subarray(0, 12).toString("hex");
  const ascii = buf.subarray(0, 12).toString("latin1");
  switch (base) {
    case "image/jpeg": return hex.startsWith("ffd8ff");
    case "image/png": return hex.startsWith("89504e47");
    case "image/webp": return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
    case "application/pdf": return ascii.startsWith("%PDF");
    case "video/mp4": case "video/quicktime": case "audio/mp4": case "audio/x-m4a": return ascii.slice(4, 8) === "ftyp";
    case "video/webm": case "audio/webm": return hex.startsWith("1a45dfa3");
    case "audio/ogg": return ascii.startsWith("OggS");
    case "audio/mpeg": return hex.startsWith("494433") || hex.startsWith("fff") ;
    case "audio/wav": return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE";
    default: return false;
  }
}

export function normalizePhone(p: string): string {
  return String(p || "").replace(/\D/g, "");
}

export function clean(s: unknown, max: number): string {
  return String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}
