import type { VehicleContext, VehicleDataGateway, VehicleSearchQuery } from "./vehicleContext";

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: VehicleContext[] }>();

function keyOf(q: VehicleSearchQuery): string {
  return JSON.stringify({
    vin: q.vin?.trim().toUpperCase() || "",
    make: q.make?.trim().toLowerCase() || "",
    model: q.model?.trim().toLowerCase() || "",
    year: String(q.year || ""),
    engine: q.engine?.trim().toLowerCase() || "",
    q: q.q?.trim().toLowerCase() || "",
  });
}

function cleanQuery(q: VehicleSearchQuery): VehicleSearchQuery {
  const out: VehicleSearchQuery = {};
  for (const [k, v] of Object.entries(q)) {
    if (typeof v === "string" && v.trim()) (out as any)[k] = v.trim();
    else if (typeof v === "number") (out as any)[k] = v;
  }
  return out;
}

export class HpWebGateway implements VehicleDataGateway {
  async lookup(query: VehicleSearchQuery): Promise<VehicleContext[]> {
    const cleaned = cleanQuery(query);
    const key = keyOf(cleaned);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const base = process.env.HP_WEB_GATEWAY_URL?.replace(/\/$/, "");
    if (!base) {
      throw new Error("HP-Web n'est pas configuré côté serveur (HP_WEB_GATEWAY_URL).");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(base + "/vehicle/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.HP_WEB_GATEWAY_API_KEY
            ? { "X-API-Key": process.env.HP_WEB_GATEWAY_API_KEY }
            : {}),
        },
        body: JSON.stringify(cleaned),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HP-Web gateway HTTP ${response.status}`);
      }

      const body = await response.json() as { results?: VehicleContext[] };
      const results = Array.isArray(body.results) ? body.results : [];
      cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value: results });
      return results;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const hpWebGateway = new HpWebGateway();

export async function searchHpWeb(query: VehicleSearchQuery): Promise<VehicleContext[]> {
  return hpWebGateway.lookup(query);
}
