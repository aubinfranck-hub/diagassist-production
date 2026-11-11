// Recherche floue des produits de la boutique (Fuse.js, Apache-2.0), partagée entre le catalogue
// (navigateur) et l'outil vocal « vérifier la disponibilité d'une pièce » (serveur).
// - Tous les mots de la recherche doivent être retrouvés (« bougie peugeot 406 »), chacun dans
//   n'importe quel champ (nom, marque, modèle, compatibilité, catégorie, description).
// - Fautes de frappe tolérées sur les mots (« bougi », « amortiseur »), accents ignorés.
// - Nombres et références (406, 0242235666, BKR6E) recherchés tels quels, sans approximation :
//   « 406 » ne doit pas renvoyer une pièce de 407.
import Fuse from "fuse.js";

export type SearchableProduct = {
  name: string;
  brand?: string | null;
  model?: string | null;
  compatibility?: string | null;
  category_name?: string | null;
  description?: string | null;
  specs?: string | null;
};

const KEYS = [
  { name: "name", weight: 3 },
  { name: "brand", weight: 2 },
  { name: "model", weight: 2 },
  { name: "compatibility", weight: 1.5 },
  { name: "category_name", weight: 1 },
  { name: "description", weight: 0.5 },
  { name: "specs", weight: 0.3 },
];

// Mots vides et terminaisons du pluriel retirés pour que « bougies pour Peugeot » ≈ « bougie peugeot ».
const STOP = new Set(["pour", "les", "des", "une", "avec", "sur", "dans", "de", "du", "la", "le", "et", "un"]);

export function searchTokens(query: string): string[] {
  return String(query || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t))
    .map((t) => (t.length > 4 && /[sx]$/.test(t) && !/\d/.test(t) ? t.slice(0, -1) : t))
    .slice(0, 6);
}

export function createProductSearch<T extends SearchableProduct>(items: T[]) {
  const fuse = new Fuse(items, {
    keys: KEYS,
    includeScore: true,
    ignoreLocation: true,
    ignoreDiacritics: true,
    threshold: 0.3,
    minMatchCharLength: 2,
    useExtendedSearch: true,
  });
  return (query: string, limit = 200): T[] => {
    const tokens = searchTokens(query);
    if (tokens.length === 0) return [];
    // Syntaxe étendue Fuse : « 'mot » = contient exactement ; mot seul = approximatif.
    const term = (t: string) => (/\d/.test(t) || t.length <= 4 ? `'${t}` : t);
    const expr = { $and: tokens.map((t) => ({ $or: KEYS.map((k) => ({ [k.name]: term(t) })) })) };
    return fuse.search(expr as any, { limit }).map((r) => r.item);
  };
}
