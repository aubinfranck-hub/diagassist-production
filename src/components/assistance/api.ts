import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types du contrat docs/assistance-api.md (champs facultatifs par prudence)
// ---------------------------------------------------------------------------

export type ServiceCode =
  | "mecanique" | "electricite" | "diagnostic" | "batterie" | "pneumatiques" | "remorquage" | "vidange";

export type RequestStatus =
  | "brouillon" | "recherche" | "affectee" | "en_route" | "sur_place"
  | "en_intervention" | "terminee" | "sans_disponibilite" | "annulee";

export type QuoteStatus = "aucun" | "propose" | "accepte" | "refuse";

export type PayMethod = "wave" | "orange" | "mtn" | "moov";
export type AssistanceMode = "depannage" | "atelier";
export type VisitStatus = "aucune" | "proposee" | "confirmee" | "refusee";
export type PaymentStatus = "aucun" | "en_attente" | "paye" | "echoue";

export interface ProEarnings {
  paid: number;
  toReceive: number;
  received: number;
  commissionPct: number;
  payments: {
    reference: string;
    requestId: string;
    service: string;
    serviceLabel: string;
    method: PayMethod | string;
    status: string;
    grossAmount: number;
    amount: number;
    commissionAmount: number;
    proAmount: number;
    payoutStatus: "a_reverser" | "reverse" | string;
    payoutAt?: number | null;
    createdAt: number;
  }[];
}

export interface PaymentInfo {
  reference: string;
  method: PayMethod | string;
  amount: number;
  status: string;
  redirectUrl?: string | null;
  updatedAt?: number;
  commissionAmount?: number;
  proAmount?: number;
  payoutStatus?: string;
  payoutAt?: number | null;
}

export interface ServiceInfo {
  code: ServiceCode | string;
  label: string;
  description?: string;
  available: boolean;
  proCount?: number;
  availableNow?: number | boolean;
  atelierAvailable?: boolean;
  atelierProCount?: number;
  atelierAvailableNow?: number | boolean;
  tariff?: number | null;
  indicativeAmount?: number | null;
}

export interface AssistanceStatus {
  enabled: boolean;
  dbConfigured: boolean;
  paymentConfigured?: boolean;
  paymentMethods?: PayMethod[];
  whatsappConfigured: boolean;
  services: ServiceInfo[];
  zones: { id: number; name: string }[];
}

export interface VehicleInfo {
  brand?: string;
  model?: string;
  year?: string | number;
  engine?: string;
  source?: "catalogue" | "saisie";
}

export interface QuoteLine {
  kind: "deplacement" | "diagnostic" | "main_oeuvre" | "pieces";
  label?: string;
  amount: number;
}

export interface Quote {
  id: string;
  kind?: "initial" | "supplementaire";
  status?: QuoteStatus;
  lines: QuoteLine[];
  total?: number;
  note?: string;
  createdAt?: number;
}

export interface ChatMsg { id: number | string; fromRole: "client" | "pro"; body: string; at: number }

export interface MediaItem { id: string; kind?: string; mime?: string; size?: number }

export interface RequestSummary {
  id: string;
  service?: string;
  serviceLabel?: string;
  status: RequestStatus;
  quoteStatus?: QuoteStatus;
  mode?: AssistanceMode;
  immobilised?: boolean;
  visitStatus?: VisitStatus;
  tariff?: number | null;
  paymentStatus?: PaymentStatus;
  statusLabel?: string;
  vehicle?: VehicleInfo | string | null;
  symptoms?: string;
  proName?: string | null;
  proDisplayName?: string | null;
  diagnosisText?: string | null;
  works?: string | null;
  total?: number | null;
  amount?: number | null;
  amountAgreed?: number | null;
  aiAnalysis?: string | null;
  createdAt?: number;
  [k: string]: unknown;
}

export interface ProPublic {
  displayName?: string;
  garageName?: string;
  specialties?: string[];
  rating?: { avg: number; count: number } | null;
  phone?: string;
  trainings?: { title: string; issuer?: string }[];
  location?: { lat: number; lng: number; updatedAt: number } | null;
  eta?: { minutes: number; distanceKm: number; approximate: true } | null;
}

export interface RequestDetail {
  request: RequestSummary & {
    faultCodes?: string[] | string;
    description?: string;
    position?: { lat: number; lng: number; address?: string; landmark?: string; accuracy?: number };
    contactPhone?: string;
  };
  pro: ProPublic | null;
  quotes: Quote[];
  payment?: PaymentInfo | null;
  timeline: { at: number; label: string; status: string }[];
  media: MediaItem[];
  review: { rating: number; comment?: string } | null;
  allowed: {
    cancel?: boolean; retry?: boolean; manual?: boolean;
    review?: boolean; claim?: boolean; decideQuote?: boolean;
    pay?: boolean; confirmVisit?: boolean; leaving?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export class AssistanceError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
  get unavailable() { return this.code === "ASSISTANCE_DB_MISSING" || this.status === 503; }
  get offline() { return this.code === "OFFLINE"; }
}

export const MSG_UNAVAILABLE =
  "Le service d'assistance n'est pas encore ouvert. Merci de réessayer plus tard.";

export function authToken(): string {
  try { return localStorage.getItem("auth_session_token") || ""; } catch { return ""; }
}

export function knownPhone(): string {
  try { return localStorage.getItem("auth_user_phone") || ""; } catch { return ""; }
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  const token = authToken();
  let res: Response;
  try {
    res = await fetch(`/api/assistance${path}`, {
      method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    throw new AssistanceError(
      "Pas de connexion. Vérifiez votre réseau, nous réessayons automatiquement.", 0, "OFFLINE"
    );
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* corps vide */ }
  if (res.status === 503 || data?.code === "ASSISTANCE_DB_MISSING") {
    throw new AssistanceError(MSG_UNAVAILABLE, 503, "ASSISTANCE_DB_MISSING");
  }
  if (res.status === 401) {
    throw new AssistanceError("Votre session a expiré. Reconnectez-vous pour continuer.", 401, "UNAUTHORIZED");
  }
  if (!res.ok || (data && data.success === false)) {
    throw new AssistanceError(
      data?.message || "Une erreur est survenue. Réessayez dans un instant.", res.status, data?.code
    );
  }
  return (data ?? {}) as T;
}

/** URL d'un média (le jeton passe en query car <img>/<video> ne peut pas envoyer d'en-tête). */
export function mediaUrl(id: string): string {
  return `/api/assistance/media/${encodeURIComponent(id)}?token=${encodeURIComponent(authToken())}`;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

/**
 * Appelle `fn` tout de suite puis toutes les `ms` ms. Se met en pause quand l'onglet est caché
 * et reprend (avec un appel immédiat) au retour de la visibilité ou du réseau.
 * `fn` est relu à chaque tick : pas besoin de la mémoriser.
 */
export function usePolling(fn: () => Promise<void> | void, ms: number, enabled = true, key: unknown = null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: number | undefined;
    const run = async () => {
      if (stopped) return;
      if (!document.hidden && navigator.onLine) {
        try { await ref.current(); } catch { /* géré par l'appelant */ }
      }
      if (!stopped) timer = window.setTimeout(run, ms);
    };
    const wake = () => {
      if (document.hidden) return;
      window.clearTimeout(timer);
      void run();
    };
    void run();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [ms, enabled, key]);
}

// ---------------------------------------------------------------------------
// Libellés en français simple
// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<string, string> = {
  brouillon: "Demande non envoyée",
  recherche: "Nous contactons les mécaniciens près de vous",
  affectee: "Mécanicien trouvé",
  en_route: "En route",
  sur_place: "Arrivé",
  en_intervention: "Intervention en cours",
  terminee: "Terminée",
  sans_disponibilite: "Aucun mécanicien disponible pour le moment",
  annulee: "Demande annulée",
};

export const STATUS_SHORT: Record<string, string> = {
  brouillon: "Brouillon", recherche: "Recherche en cours", affectee: "Mécanicien trouvé",
  en_route: "En route", sur_place: "Arrivé", en_intervention: "Intervention en cours",
  terminee: "Terminée", sans_disponibilite: "Sans mécanicien", annulee: "Annulée",
};

export const SERVICE_FALLBACK_LABEL: Record<string, string> = {
  mecanique: "Mécanique", electricite: "Électricité", diagnostic: "Diagnostic", batterie: "Batterie",
  pneumatiques: "Pneus", remorquage: "Remorquage", vidange: "Vidange",
};

export const LINE_LABEL: Record<string, string> = {
  deplacement: "Déplacement", diagnostic: "Diagnostic", main_oeuvre: "Main-d'œuvre", pieces: "Pièces",
};
export const LINE_ORDER: QuoteLine["kind"][] = ["deplacement", "diagnostic", "main_oeuvre", "pieces"];

export const MSG_SUBSCRIPTION =
  "Votre abonnement DiagAssist n'est plus à jour : renouvelez-le pour recevoir des assistances.";
export const MSG_ALREADY_TAKEN = "Un autre mécanicien a déjà pris cette mission.";
export const MSG_AI_TITLE = "Analyse DiagAssist — pistes à vérifier";

/** Texte du montant indicatif (jamais un prix inventé : null = à convenir). */
export function indicativeText(n?: number | null): string {
  return typeof n === "number" && n > 0
    ? `Montant indicatif : ${formatXOF(n)} (à confirmer avec le mécanicien)`
    : "Montant à convenir avec le mécanicien";
}

export const isFinalStatus = (s?: string) => s === "terminee" || s === "annulee";

export function formatXOF(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n).toLocaleString("fr-FR").replace(/ /g, " ")} FCFA`;
}

export function quoteTotal(q: Quote): number {
  if (typeof q.total === "number") return q.total;
  return (q.lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
}

export function formatDate(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function vehicleLabel(v: VehicleInfo | string | null | undefined): string {
  if (!v) return "Véhicule non précisé";
  if (typeof v === "string") return v;
  const s = [v.brand, v.model, v.year].filter(Boolean).join(" ");
  return s || "Véhicule non précisé";
}

export function faultCodesList(c: string[] | string | undefined): string[] {
  if (!c) return [];
  if (Array.isArray(c)) return c.filter(Boolean);
  return c.split(/[\s,;]+/).filter(Boolean);
}

export function digitsPhone(p?: string): string {
  const d = (p || "").replace(/\D/g, "");
  if (d.length === 10) return `225${d}`; // numéro ivoirien à 10 chiffres
  return d;
}
export const telHref = (p?: string) => `tel:+${digitsPhone(p)}`;
export const whatsappHref = (p?: string, text = "") =>
  `https://wa.me/${digitsPhone(p)}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

export const mapsDirections = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

// ---------------------------------------------------------------------------
// Fichiers : compression image côté client, base64
// ---------------------------------------------------------------------------

export function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Lecture du fichier impossible."));
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.readAsDataURL(blob);
  });
}

/** Réduit une photo (1280 px max, JPEG 0,72) pour économiser la connexion mobile. */
export async function compressImage(file: File, maxSide = 1280, quality = 0.72): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export const MAX_BYTES = { image: 5 * 1024 * 1024, video: 8 * 1024 * 1024, audio: 5 * 1024 * 1024 };
