import { useCallback, useEffect, useRef, useState } from "react";
import { api, AssistanceError, RequestSummary } from "./api";

// File d'attente locale des demandes créées sans réseau (100 % navigateur).
// Clé localStorage : assistance_pending_requests (3 demandes au plus).

const KEY = "assistance_pending_requests";
const LOCK_KEY = "assistance_pending_lock";
const EVENT = "assistance-pending-changed";
export const MAX_PENDING = 3;
/** Un média n'est gardé hors ligne que s'il pèse moins de 1 Mo. */
export const MAX_OFFLINE_MEDIA_BYTES = 1024 * 1024;

export interface PendingMedia { mime: string; name: string; dataBase64: string }

export interface PendingRequest {
  id: string;
  createdAt: number;
  /** Corps complet de POST /requests (sans submit:true, ajouté au rejeu). */
  body: Record<string, any>;
  media: PendingMedia[];
  /** Nombre de médias trop lourds, à rajouter depuis le suivi. */
  mediaDropped: number;
}

const notify = () => { try { window.dispatchEvent(new Event(EVENT)); } catch { /* ignore */ } };

export function readPending(): PendingRequest[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => x && typeof x.id === "string" && x.body) : [];
  } catch { return []; }
}

function writePending(list: PendingRequest[]): boolean {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
    notify();
    return true;
  } catch { return false; }
}

export function removePending(id: string) {
  writePending(readPending().filter((x) => x.id !== id));
}

/** Vrai si l'échec vient de l'absence de réseau (et non d'un refus du serveur). */
export function isOfflineError(e: unknown): boolean {
  if (e instanceof AssistanceError) return e.offline;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return false;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("lecture"));
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.readAsDataURL(blob);
  });
}

export type EnqueueResult =
  | { ok: true; mediaDropped: number }
  | { ok: false; reason: "full" | "storage" };

/**
 * Garde la demande pour plus tard. `attachments` = médias PAS encore envoyés au serveur ;
 * ceux de plus de 1 Mo sont écartés (le client en est averti).
 */
export async function enqueueRequest(
  body: Record<string, any>,
  attachments: { blob: Blob; name: string; mime: string }[]
): Promise<EnqueueResult> {
  const list = readPending();
  if (list.length >= MAX_PENDING) return { ok: false, reason: "full" };
  const media: PendingMedia[] = [];
  let dropped = 0;
  for (const a of attachments) {
    if (a.blob.size >= MAX_OFFLINE_MEDIA_BYTES) { dropped++; continue; }
    try { media.push({ mime: a.mime, name: a.name, dataBase64: await blobToBase64(a.blob) }); }
    catch { dropped++; }
  }
  const clean = { ...body };
  delete clean.submit;
  const item: PendingRequest = {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(), body: clean, media, mediaDropped: dropped,
  };
  if (writePending([...list, item])) return { ok: true, mediaDropped: dropped };
  // Espace insuffisant : on retente sans média.
  const bare = { ...item, media: [], mediaDropped: dropped + media.length };
  if (writePending([...list, bare])) return { ok: true, mediaDropped: bare.mediaDropped };
  return { ok: false, reason: "storage" };
}

// ---------------------------------------------------------------------------
// Rejeu
// ---------------------------------------------------------------------------

let replaying = false;

function takeLock(): boolean {
  if (replaying) return false;
  try {
    const t = Number(localStorage.getItem(LOCK_KEY) || 0);
    if (t && Date.now() - t < 60000) return false; // autre onglet en cours
    localStorage.setItem(LOCK_KEY, String(Date.now()));
  } catch { /* sans stockage : le verrou mémoire suffit */ }
  replaying = true;
  return true;
}
function releaseLock() {
  replaying = false;
  try { localStorage.removeItem(LOCK_KEY); } catch { /* ignore */ }
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

export interface ReplayOutcome {
  created: string[];
  /** Messages à afficher (échecs définitifs, médias non envoyés…). */
  notices: string[];
}

/** Rejoue la file. Sans effet si le réseau manque ou si un rejeu est déjà en cours. */
export async function replayPending(): Promise<ReplayOutcome> {
  const out: ReplayOutcome = { created: [], notices: [] };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return out;
  if (!readPending().length || !takeLock()) return out;
  try {
    // Demandes récentes côté serveur : évite les doublons si un envoi précédent a abouti sans réponse.
    let existing: RequestSummary[] = [];
    try { existing = (await api<{ requests: RequestSummary[] }>("/requests")).requests || []; }
    catch (e) { if (isOfflineError(e)) return out; }

    for (const item of readPending()) {
      const symptoms = norm(item.body.symptoms);
      const dup = existing.find((r) =>
        ["brouillon", "recherche", "affectee", "en_route", "sur_place", "en_intervention"].includes(r.status) &&
        norm(r.symptoms) === symptoms && (r.createdAt || 0) >= item.createdAt - 10 * 60000
      );
      if (dup) { removePending(item.id); out.created.push(dup.id); continue; }

      try {
        const body: Record<string, any> = { ...item.body };
        // Keep the location confirmed by the client: the phone may have moved
        // while the immobilised vehicle remained at the original location.
        const ids: string[] = Array.isArray(body.mediaIds) ? [...body.mediaIds] : [];
        for (const m of item.media) {
          try {
            const r = await api<{ media: { id: string } }>("/media", { body: { mime: m.mime, dataBase64: m.dataBase64, name: m.name } });
            ids.push(r.media.id);
          } catch (e) {
            if (isOfflineError(e)) throw e;
            out.notices.push(`Un fichier (« ${m.name} ») n'a pas pu être envoyé : ajoutez-le depuis le suivi.`);
          }
        }
        body.mediaIds = ids.length ? ids : undefined;
        body.submit = true;
        const r = await api<{ request: { id: string } }>("/requests", { body });
        removePending(item.id);
        out.created.push(r.request.id);
        if (item.mediaDropped > 0) out.notices.push("Pensez à rajouter vos photos ou vidéos trop lourdes depuis le suivi.");
      } catch (e) {
        if (isOfflineError(e)) break; // on réessaiera au retour du réseau
        const status = e instanceof AssistanceError ? e.status : 0;
        const retryable = status === 0 || status === 401 || status === 408 || status === 429 || status >= 500;
        if (retryable) {
          out.notices.push(e instanceof AssistanceError ? e.message : "Envoi impossible pour l'instant, nous réessaierons.");
          break;
        }
        removePending(item.id);
        out.notices.push(`Votre demande en attente n'a pas pu être envoyée : ${e instanceof AssistanceError ? e.message : "demande refusée"}. Merci de la refaire.`);
      }
    }
  } finally {
    releaseLock();
  }
  return out;
}

/**
 * Hook de l'accueil : liste des demandes en attente + rejeu au chargement, à l'ouverture
 * de l'accueil (`active`) et au retour du réseau.
 */
export function usePendingRequests(active: boolean, onCreated: (id: string) => void) {
  const [items, setItems] = useState<PendingRequest[]>(() => readPending());
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const cb = useRef(onCreated);
  cb.current = onCreated;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const sync = () => setItems(readPending());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);

  const run = useCallback(async () => {
    if (!activeRef.current || !readPending().length) return;
    setBusy(true);
    try {
      const r = await replayPending();
      if (r.notices.length) setNotices(r.notices);
      if (r.created.length) cb.current(r.created[r.created.length - 1]);
    } finally { setBusy(false); setItems(readPending()); }
  }, []);

  useEffect(() => { if (active) void run(); }, [active, run]);
  useEffect(() => {
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [run]);

  return {
    items, busy, notices,
    dismissNotices: () => setNotices([]),
    cancel: (id: string) => removePending(id),
    retry: run,
  };
}
