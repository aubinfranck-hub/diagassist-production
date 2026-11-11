// Décodage VIN hors ligne avec Corgi (@cardog/corgi, licence ISC — données NHTSA vPIC).
// Corgi embarque sa base SQLite compressée (~25 Mo). On la décompresse une seule fois dans le
// dossier temporaire et on la lit avec le module SQLite intégré à Node (node:sqlite) via
// l'adaptateur « D1 » de Corgi : aucune dépendance native (better-sqlite3 est remplacé par un
// stub, voir vendor/better-sqlite3-stub) et peu de mémoire (base lue sur disque, pas en RAM).
// Couverture : très bonne pour les véhicules du marché américain (nombreux imports en Côte
// d'Ivoire : Toyota, Hyundai, Honda, Ford...), partielle pour les VIN européens.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";

export type VinSummary = {
  vin: string;
  valid: boolean;
  checkDigitValid: boolean | null;
  make: string | null;
  model: string | null;
  year: number | null;
  series: string | null;
  trim: string | null;
  bodyStyle: string | null;
  driveType: string | null;
  fuel: string | null;
  engine: string | null;
  engineDisplacementL: string | null;
  cylinders: string | null;
  powerHp: string | null;
  transmission: string | null;
  manufacturer: string | null;
  country: string | null;
  errors: string[];
};

const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;

export function normalizeVin(v: string): string | null {
  const s = String(v || "").toUpperCase().replace(/[\s-]/g, "");
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(s) && /\d/.test(s) && /[A-Z]/.test(s) ? s : null;
}

export function extractVin(text: string): string | null {
  for (const m of String(text || "").matchAll(VIN_RE)) {
    const v = normalizeVin(m[0]);
    if (v) return v;
  }
  return null;
}

let decoderPromise: Promise<any> | null = null;
let lastInitError: string | null = null;

async function initDecoder(): Promise<any> {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const sqlite: any = await import("node:sqlite");
  const corgi: any = await import("@cardog/corgi");
  const gzPath = path.join(path.dirname(require.resolve("@cardog/corgi")), "db", "vpic.lite.db.gz");
  const version = (() => { try { return require("@cardog/corgi/package.json").version; } catch { return "x"; } })();
  const dbPath = path.join(os.tmpdir(), `diagassist-vpic-${version}.db`);
  if (!fs.existsSync(dbPath)) {
    const tmp = `${dbPath}.${process.pid}.part`;
    await pipeline(fs.createReadStream(gzPath), zlib.createGunzip(), fs.createWriteStream(tmp));
    fs.renameSync(tmp, dbPath);
  }
  const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  const toSql = (v: any) => (typeof v === "boolean" ? (v ? 1 : 0) : v);
  const d1 = {
    prepare(sql: string) {
      const st = db.prepare(sql);
      return { bind: (...p: any[]) => ({ all: async () => ({ results: st.all(...p.map(toSql)) }) }) };
    },
  };
  corgi.initD1Adapter(d1);
  return corgi.createDecoder({ databasePath: "D1" });
}

function getDecoder(): Promise<any> {
  if (!decoderPromise) {
    decoderPromise = initDecoder().catch((err) => {
      lastInitError = err?.message || String(err);
      console.error("[VIN] Décodeur indisponible :", lastInitError);
      decoderPromise = null; // nouvelle tentative au prochain appel
      throw err;
    });
  }
  return decoderPromise;
}

export function vinDecoderStatus() {
  return { ready: Boolean(decoderPromise) && !lastInitError, lastError: lastInitError };
}

const s = (v: any): string | null => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());

export async function decodeVin(rawVin: string): Promise<VinSummary> {
  const vin = normalizeVin(rawVin);
  if (!vin) {
    return { vin: String(rawVin || "").toUpperCase(), valid: false, checkDigitValid: null, make: null, model: null, year: null, series: null, trim: null, bodyStyle: null, driveType: null, fuel: null, engine: null, engineDisplacementL: null, cylinders: null, powerHp: null, transmission: null, manufacturer: null, country: null, errors: ["Format VIN invalide : 17 caractères attendus, sans I, O ni Q."] };
  }
  const decoder = await getDecoder();
  const r: any = await decoder.decode(vin);
  const veh = r?.components?.vehicle || {};
  const eng = r?.components?.engine || {};
  const wmi = r?.components?.wmi || {};
  const plant = r?.components?.plant || {};
  const errors = (r?.errors || []).map((e: any) => String(e?.message || e?.code || e)).filter(Boolean);
  return {
    vin,
    valid: Boolean(r?.valid),
    checkDigitValid: typeof r?.components?.checkDigit?.isValid === "boolean" ? r.components.checkDigit.isValid : null,
    make: s(veh.make) || s(wmi.make),
    model: s(veh.model),
    year: Number(veh.year) || Number(r?.components?.modelYear?.year) || null,
    series: s(veh.series),
    trim: s(veh.trim),
    bodyStyle: s(veh.bodyStyle),
    driveType: s(veh.driveType),
    fuel: s(eng.fuel) || s(veh.fuelType),
    engine: s(eng.model),
    engineDisplacementL: s(eng.displacement),
    cylinders: s(eng.cylinders),
    powerHp: s(eng.power),
    transmission: s(veh.transmission) || s(r?.components?.transmission?.type),
    manufacturer: s(wmi.manufacturer),
    country: s(plant.country) || s(wmi.country),
    errors,
  };
}

// Phrase de contexte pour les prompts Gemini.
export function formatVinForPrompt(v: VinSummary): string {
  if (!v.valid || !v.make) return `VIN ${v.vin} fourni, mais non décodé par la base hors ligne (fréquent pour les VIN européens) : demande la carte grise si l'identification est nécessaire.`;
  const parts = [
    `${v.make}${v.model ? " " + v.model : ""}${v.year ? " " + v.year : ""}`,
    v.series || v.trim ? `finition ${[v.series, v.trim].filter(Boolean).join(" ")}` : "",
    v.engine || v.engineDisplacementL ? `moteur ${[v.engine, v.engineDisplacementL ? v.engineDisplacementL + " L" : "", v.cylinders ? v.cylinders + " cyl." : "", v.powerHp ? v.powerHp + " ch" : ""].filter(Boolean).join(" ")}` : "",
    v.fuel ? `carburant ${v.fuel}` : "",
    v.transmission ? `boîte ${v.transmission}` : "",
    v.driveType ? `transmission ${v.driveType}` : "",
    v.country ? `assemblé : ${v.country}` : "",
  ].filter(Boolean);
  return `VÉHICULE IDENTIFIÉ PAR LE VIN ${v.vin} (base NHTSA vPIC hors ligne, fiable surtout pour les véhicules du marché américain) : ${parts.join(", ")}.${v.checkDigitValid === false ? " Attention : chiffre de contrôle du VIN incohérent (VIN mal recopié, ou véhicule hors marché américain)." : ""}`;
}
