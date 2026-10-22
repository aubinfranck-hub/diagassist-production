import Fuse from "fuse.js";

export function catalogIndex<T>(products: T[]) {
  return new Fuse(products, { ignoreLocation: true, ignoreDiacritics: true, threshold: 0.32,
    keys: [{ name: "name", weight: 4 }, { name: "brand", weight: 3 }, { name: "model", weight: 3 },
      { name: "compatibility", weight: 2 }, { name: "description", weight: 1 }] });
}

/** Unknown/quotation-only prices always remain last in either direction. */
export function compareCatalogPrices(a: { price_fcfa: number | null }, b: { price_fcfa: number | null }, descending = false) {
  const valid = (n: unknown) => n !== null && n !== undefined && Number.isFinite(Number(n)) && Number(n) > 0;
  if (!valid(a.price_fcfa)) return valid(b.price_fcfa) ? 1 : 0;
  if (!valid(b.price_fcfa)) return -1;
  return (Number(a.price_fcfa) - Number(b.price_fcfa)) * (descending ? -1 : 1);
}
