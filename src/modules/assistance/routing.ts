// Distances et durées routières via OSRM (Open Source Routing Machine, BSD-2), optionnel.
// Sans OSRM_URL, rien ne change : on garde l'estimation à vol d'oiseau × détour / vitesse moyenne.
// OSRM_URL : adresse d'un serveur OSRM auto-hébergé avec la carte de Côte d'Ivoire (voir
// docs/OSRM.md), ex. http://127.0.0.1:5000. Le serveur public de démonstration n'est pas fait
// pour un usage en production.
// OSRM calcule des durées « routes libres » : OSRM_DURATION_FACTOR (défaut 1) permet de les
// majorer pour tenir compte de la circulation d'Abidjan, à régler d'après les trajets observés.
type Pt = { lat: number; lng: number };
export type RouteLeg = { km: number; minutes: number };

const cache = new Map<string, { at: number; v: RouteLeg | null }>();
const CACHE_MS = 120000;

export function routingEnabled(): boolean {
  return Boolean((process.env.OSRM_URL || "").trim());
}

function base(): string {
  return (process.env.OSRM_URL || "").trim().replace(/\/+$/, "");
}

function factor(): number {
  const f = Number(process.env.OSRM_DURATION_FACTOR);
  return Number.isFinite(f) && f >= 0.5 && f <= 4 ? f : 1;
}

const key = (a: Pt, b: Pt) => `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
const coord = (p: Pt) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;

async function getJson(url: string, timeoutMs: number): Promise<any | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const j: any = await r.json();
    return j?.code === "Ok" ? j : null;
  } catch (e: any) {
    console.warn("[OSRM] Indisponible :", e?.message || e);
    return null;
  }
}

/** Trajet routier de `from` vers `to`, ou null (OSRM absent, injoignable ou sans itinéraire). */
export async function routeLeg(from: Pt, to: Pt, timeoutMs = 2500): Promise<RouteLeg | null> {
  if (!routingEnabled()) return null;
  const k = key(from, to);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
  const j = await getJson(`${base()}/route/v1/driving/${coord(from)};${coord(to)}?overview=false&alternatives=false&steps=false`, timeoutMs);
  const r = j?.routes?.[0];
  const v = r && Number.isFinite(r.distance) && Number.isFinite(r.duration)
    ? { km: r.distance / 1000, minutes: Math.max(1, Math.round((r.duration / 60) * factor())) }
    : null;
  cache.set(k, { at: Date.now(), v });
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  return v;
}

/** Trajets de chaque origine vers une même destination, en un seul appel (service table d'OSRM). */
export async function routeManyTo(origins: Pt[], to: Pt, timeoutMs = 2500): Promise<(RouteLeg | null)[]> {
  if (!routingEnabled() || origins.length === 0) return origins.map(() => null);
  const coords = [...origins, to].map(coord).join(";");
  const dest = origins.length;
  const j = await getJson(`${base()}/table/v1/driving/${coords}?destinations=${dest}&annotations=duration,distance`, timeoutMs);
  if (!j) return origins.map(() => null);
  return origins.map((_, i) => {
    const d = j.durations?.[i]?.[0];
    const m = j.distances?.[i]?.[0];
    return Number.isFinite(d) && Number.isFinite(m) && d !== null && m !== null
      ? { km: m / 1000, minutes: Math.max(1, Math.round((d / 60) * factor())) }
      : null;
  });
}
