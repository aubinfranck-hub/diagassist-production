// Base de connaissances locale des codes défauts (OBD-II / EOBD + codes constructeur).
// Fichier généré par scripts/build-dtc-kb.py — sources et licences : docs/DATA_SOURCES.md.
// Aucun appel réseau : chargée une fois (paresseusement) depuis src/modules/dtc/data/dtc-kb.json.gz.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

type GenericEntry = {
  t: string; d?: string; cat?: string;
  c?: [string, string][]; s?: string[]; rel?: string[];
  r?: { diff?: string; diy?: boolean; eur?: [number, number]; h?: [number, number] };
  f?: string[]; src: string;
};
type MdbCode = { make: string; t: string; d: string };
type MdbFix = { make: string; rank: number; t: string; diff: string; usd: [number | null, number | null]; h: number | null; steps: string[] };
type KB = {
  version: string;
  sources: Record<string, { rev: string; license: string; url: string }>;
  generic: Record<string, GenericEntry>;
  oem: Record<string, [string, string][]>;
  mechanicdb: { codes: Record<string, MdbCode[]>; fixes: Record<string, MdbFix[]> };
};

export type DtcInfo = {
  code: string;
  generic: GenericEntry | null;
  oem: { brand: string; description: string }[];
  mechanicdb: MdbCode[];
  fixes: MdbFix[];
  matchedBrand: string | null;
};

let kb: KB | null = null;
let loadError: string | null = null;

export function dtcKbPath(): string {
  return process.env.DTC_KB_PATH || path.join(process.cwd(), "src", "modules", "dtc", "data", "dtc-kb.json.gz");
}

function load(): KB | null {
  if (kb || loadError) return kb;
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(dtcKbPath()));
    kb = JSON.parse(raw.toString("utf-8")) as KB;
    console.log(`[DTC KB] Base chargée (${Object.keys(kb.generic).length} codes génériques, ${Object.keys(kb.oem).length} codes constructeur, version ${kb.version}).`);
  } catch (err: any) {
    loadError = err?.message || String(err);
    console.error("[DTC KB] Impossible de charger la base de codes défauts :", loadError);
  }
  return kb;
}

export function dtcKbStats() {
  const k = load();
  if (!k) return { loaded: false, error: loadError };
  return {
    loaded: true,
    version: k.version,
    genericCodes: Object.keys(k.generic).length,
    oemCodes: Object.keys(k.oem).length,
    oemDefinitions: Object.values(k.oem).reduce((n, v) => n + v.length, 0),
    repairProcedures: Object.values(k.mechanicdb.fixes).reduce((n, v) => n + v.length, 0),
    sources: k.sources,
  };
}

// Codes au format SAE : P/C/B/U + 4 caractères hexadécimaux (ex. P0301, C112A, B3A2B, U0100).
// Les suffixes constructeur type "C112A:77" ou "P0301-00" sont tolérés (on garde la base).
const DTC_RE = /\b([PBCU][0-9][0-9A-F]{3})(?:[:\-][0-9A-F]{1,4})?\b/gi;

export function normalizeDtcCode(code: string): string | null {
  const m = String(code || "").trim().toUpperCase().match(/^([PBCU][0-9][0-9A-F]{3})/);
  return m ? m[1] : null;
}

export function extractDtcCodes(text: string, max = 8): string[] {
  const out: string[] = [];
  for (const m of String(text || "").matchAll(DTC_RE)) {
    const c = m[1].toUpperCase();
    if (!out.includes(c)) out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

// SAE J2012 : P0, P2, P34–P39, B0, C0, U0, U3 = génériques ; P1, P30–P33, B1/B2, C1/C2, U1/U2 = constructeur.
export function isGenericDtc(code: string): boolean {
  const c = normalizeDtcCode(code);
  if (!c) return false;
  const [sys, d1, d2] = [c[0], c[1], c[2]];
  if (d1 === "0") return true;
  if (sys === "P" && d1 === "2") return true;
  if (sys === "P" && d1 === "3") return /[4-9A-F]/.test(d2);
  if (sys === "U" && d1 === "3") return true;
  return false;
}

// Familles de marques : un code constructeur Toyota vaut en général aussi pour Lexus, etc.
const BRAND_GROUPS: string[][] = [
  ["Toyota", "Lexus", "Scion"],
  ["Nissan", "Infiniti", "Datsun"],
  ["Honda", "Acura"],
  ["Hyundai", "Kia", "Genesis"],
  ["Chevrolet", "GM", "GMC", "Buick", "Cadillac", "Saturn", "Oldsmobile", "Pontiac", "Geo", "Opel", "Vauxhall"],
  ["Ford", "Lincoln", "Mercury"],
  ["Chrysler", "Dodge", "Jeep", "Plymouth", "Ram"],
  ["Volkswagen", "Audi", "Seat", "Skoda"],
  ["Mercedes-Benz", "Mercedes", "Smart"],
  ["BMW", "Mini"],
  ["Mazda"], ["Subaru"], ["Mitsubishi"], ["Suzuki"], ["Jaguar", "Land Rover"],
];

function canonBrand(b: string): string {
  const s = String(b || "").trim().toLowerCase().replace(/[^a-z]/g, "");
  const alias: Record<string, string> = { vw: "volkswagen", chevy: "chevrolet", mercedesbenz: "mercedes", benz: "mercedes", landrover: "landrover" };
  return alias[s] || s;
}

function brandFamily(b: string): Set<string> {
  const c = canonBrand(b);
  if (!c) return new Set();
  const group = BRAND_GROUPS.find(g => g.some(x => canonBrand(x) === c));
  return new Set((group || [b]).map(canonBrand));
}

export function lookupDtc(code: string, brand?: string | null): DtcInfo | null {
  const k = load();
  const c = normalizeDtcCode(code);
  if (!k || !c) return null;
  const generic = k.generic[c] || null;
  let oem = (k.oem[c] || []).map(([b, d]) => ({ brand: b, description: d }));
  let mdb = k.mechanicdb.codes[c] || [];
  let fixes = k.mechanicdb.fixes[c] || [];
  let matchedBrand: string | null = null;
  if (brand && String(brand).trim()) {
    const fam = brandFamily(String(brand));
    const own = oem.filter(o => fam.has(canonBrand(o.brand)));
    if (own.length > 0) { oem = own; matchedBrand = own[0].brand; }
    const ownMdb = mdb.filter(m => !m.make || fam.has(canonBrand(m.make)));
    if (ownMdb.length > 0) mdb = ownMdb;
    const ownFix = fixes.filter(f => !f.make || fam.has(canonBrand(f.make)));
    if (ownFix.length > 0) fixes = ownFix;
  }
  if (!generic && oem.length === 0 && mdb.length === 0) return null;
  return { code: c, generic, oem, mechanicdb: mdb, fixes, matchedBrand };
}

const LIKELIHOOD_FR: Record<string, string> = { high: "fréquente", medium: "possible", low: "rare" };
const DIFF_FR: Record<string, string> = { easy: "facile", moderate: "moyenne", medium: "moyenne", hard: "difficile", expert: "expert" };

function clip(s: string, n: number): string {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

// Fiche texte d'un code pour le prompt Gemini (données en anglais : Gemini répond en français).
export function formatDtcInfo(info: DtcInfo, opts: { maxCauses?: number; maxSymptoms?: number; maxOem?: number; maxDesc?: number; includeFixes?: boolean } = {}): string {
  const { maxCauses = 6, maxSymptoms = 4, maxOem = 4, maxDesc = 700, includeFixes = true } = opts;
  const g = info.generic;
  const lines: string[] = [];
  const kind = isGenericDtc(info.code) ? "code générique SAE/EOBD" : "code pouvant être spécifique constructeur";
  lines.push(`${info.code} (${kind})${g?.t ? ` — ${g.t}` : ""}`);
  if (g?.d) lines.push(`  Fonctionnement : ${clip(g.d, maxDesc)}`);
  if (g?.c?.length) {
    lines.push("  Causes connues (par fréquence) : " + g.c.slice(0, maxCauses).map(([l, label]) => `${label}${LIKELIHOOD_FR[l] ? ` [${LIKELIHOOD_FR[l]}]` : ""}`).join(" ; "));
  }
  if (g?.s?.length) lines.push("  Symptômes : " + g.s.slice(0, maxSymptoms).join(" ; "));
  if (g?.r) {
    const r = g.r;
    const bits: string[] = [];
    if (r.diff) bits.push(`difficulté ${DIFF_FR[r.diff] || r.diff}`);
    if (r.h) bits.push(`${r.h[0]}–${r.h[1]} h de main-d'œuvre`);
    if (r.eur) bits.push(`ordre de grandeur pièces+MO en Europe ${r.eur[0]}–${r.eur[1]} €`);
    if (bits.length) lines.push("  Réparation : " + bits.join(", ") + " (estimation hors Côte d'Ivoire, à ne pas annoncer comme prix local)");
  }
  if (g?.f?.length) {
    const fr: Record<string, string> = { mil: "allume le voyant moteur", emissions_relevant: "lié aux émissions", limp_mode_possible: "mode dégradé possible", drive_cycle_required: "cycle de conduite requis pour l'effacement définitif" };
    lines.push("  Particularités : " + g.f.map(x => fr[x] || x).join(", "));
  }
  if (info.oem.length) {
    const shown = info.oem.slice(0, maxOem).map(o => `${o.brand} : ${clip(o.description, 160)}`);
    const more = info.oem.length > maxOem ? ` (+${info.oem.length - maxOem} autres marques)` : "";
    lines.push(`  Définition${info.matchedBrand ? " constructeur pour cette marque" : "s constructeur (selon la marque)"} : ${shown.join(" | ")}${more}`);
  }
  for (const m of info.mechanicdb.slice(0, 1)) {
    if (!g?.d && m.d) lines.push(`  Explication${m.make ? ` (${m.make})` : ""} : ${clip(m.d, maxDesc)}`);
  }
  if (includeFixes && info.fixes.length) {
    lines.push("  Procédures de contrôle classées (MechanicDB) : " + info.fixes.slice(0, 3).map(f => `${f.rank}. ${f.t}${f.steps.length ? ` (${f.steps.slice(0, 4).join(" → ")})` : ""}`).join(" ; "));
  }
  if (g?.rel?.length) lines.push("  Codes souvent associés : " + g.rel.slice(0, 6).join(", "));
  return lines.join("\n");
}

// Bloc complet à injecter dans un prompt quand des codes sont connus.
export function buildDtcReference(codes: string[], brand?: string | null, opts?: Parameters<typeof formatDtcInfo>[1]): { text: string; found: string[]; missing: string[] } {
  const found: string[] = [];
  const missing: string[] = [];
  const blocks: string[] = [];
  for (const raw of codes) {
    const info = lookupDtc(raw, brand);
    const c = normalizeDtcCode(raw) || raw;
    if (info) { found.push(info.code); blocks.push(formatDtcInfo(info, opts)); } else missing.push(c);
  }
  if (blocks.length === 0) return { text: "", found, missing };
  const text = `FICHES DE LA BASE DE CODES DÉFAUTS DIAGASSIST (base locale hors ligne, sources ouvertes : OBDex, dtc-database, MechanicDB — données en anglais, réponds en français) :
"""
${blocks.join("\n\n")}
"""
Utilise ces fiches comme référence fiable pour la définition du code et la hiérarchie des causes. Une fiche générique ne remplace pas la documentation du constructeur : adapte au véhicule réel, et rappelle qu'un code est un indice à confirmer par un test.${missing.length ? `\nCodes absents de la base locale : ${missing.join(", ")}.` : ""}`;
  return { text, found, missing };
}

// Version courte pour la voix (outil Live rechercher_code_obd).
export function dtcVoiceSummary(code: string, brand?: string | null): string | null {
  const info = lookupDtc(code, brand);
  if (!info) return null;
  return formatDtcInfo(info, { maxCauses: 4, maxSymptoms: 2, maxOem: 2, maxDesc: 300, includeFixes: true });
}
