import type { Pool } from "pg";

// Import du catalogue d'un fournisseur revendeur (Ivoirelite) depuis ses pages catégories publiques.
// Volume faible (pauses entre requêtes, plafond de pages), domaine verrouillé, aucune écriture chez le fournisseur.

const SUPPLIER = "ivoirelite";
const ALLOWED_HOST = /(^|\.)ivoirelite\.net$/i;
const USER_AGENT = "DiagAssist-Revendeur/1.0 (mise a jour catalogue revendeur)";
const REQUEST_DELAY_MS = 800;
const MAX_PAGES_PER_CATEGORY = 15;

export interface SupplierItem {
  ref: string;
  name: string;
  url: string;
  priceFcfa: number | null;
  brand: string | null;
  sku: string | null;
  image: string | null;
  description: string | null;
}

const decode = (s: string) =>
  s.replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export function parseIvoireliteListing(html: string): SupplierItem[] {
  const start = html.indexOf('id="js-product-list"');
  if (start < 0) return [];
  const end = html.indexOf("</section>", start);
  const section = html.slice(start, end < 0 ? undefined : end);
  const items: SupplierItem[] = [];
  for (const m of section.matchAll(/<article[^>]*js-product-miniature[^>]*data-id-product="(\d+)"[\s\S]*?<\/article>/g)) {
    const block = m[0];
    const title = block.match(/product-title"[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)/);
    if (!title) continue;
    const priceText = block.match(/<span class="price">([^<]+)</)?.[1] ?? "";
    const digits = priceText.replace(/[^\d]/g, "");
    items.push({
      ref: m[1],
      name: decode(title[2]),
      url: title[1],
      priceFcfa: digits ? Number(digits) : null,
      brand: block.match(/pl_manufacturer[\s\S]*?<strong>([^<]+)</)?.[1]?.trim() ?? null,
      sku: block.match(/pl_reference[\s\S]*?<strong>([^<]+)</)?.[1]?.trim() ?? null,
      image: block.match(/data-full-size-image-url\s*=\s*"([^"]+)"/)?.[1] ?? null,
      description: decode(block.match(/product-desc">\s*([\s\S]*?)\s*<\/p>/)?.[1] ?? "") || null,
    });
  }
  return items;
}

function assertAllowedUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:" || !ALLOWED_HOST.test(u.hostname)) throw new Error("URL non autorisée : seul ivoirelite.net est accepté.");
  return u;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "fr" }, signal: controller.signal });
    if (!res.ok) throw new Error(`Ivoirelite HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCategory(rawUrl: string): Promise<SupplierItem[]> {
  const base = assertAllowedUrl(rawUrl);
  const seen = new Map<string, SupplierItem>();
  for (let page = 1; page <= MAX_PAGES_PER_CATEGORY; page++) {
    const u = new URL(base.toString());
    if (page > 1) u.searchParams.set("page", String(page));
    const items = parseIvoireliteListing(await fetchHtml(u.toString()));
    const fresh = items.filter((i) => !seen.has(i.ref));
    if (!fresh.length) break; // page vide ou déjà vue : fin de la catégorie
    for (const i of fresh) seen.set(i.ref, i);
    await sleep(REQUEST_DELAY_MS);
  }
  return [...seen.values()];
}

const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export interface ImportResult { category: string; found: number; created: number; updated: number; deactivated: number }

export async function importCategory(
  pool: Pool,
  opts: { url: string; name: string; markupPct?: number },
): Promise<ImportResult> {
  const items = await fetchCategory(opts.url);
  const markup = Number.isFinite(opts.markupPct) ? Number(opts.markupPct) : 0;

  const catSlug = "ivl-" + slugify(opts.name);
  const cat = await pool.query(
    `INSERT INTO shop_categories (name, slug, type) VALUES ($1, $2, 'piece')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [opts.name, catSlug],
  );
  const categoryId = cat.rows[0].id as number;

  let created = 0, updated = 0;
  for (const it of items) {
    const price = it.priceFcfa === null ? null : Math.round(it.priceFcfa * (1 + markup / 100));
    const slug = `ivl-${it.ref}-${slugify(it.name)}`.slice(0, 90);
    // Le prix, le nom, la photo et l'activation suivent le fournisseur ; la description et les
    // champs édités à la main dans l'admin ne sont jamais écrasés.
    const r = await pool.query(
      `INSERT INTO shop_products (category_id, name, slug, brand, price_fcfa, description, availability, photos, is_active, supplier, supplier_ref, supplier_url)
       VALUES ($1,$2,$3,$4,$5,$6,'disponible',$7,true,$8,$9,$10)
       ON CONFLICT (supplier, supplier_ref) WHERE supplier IS NOT NULL DO UPDATE
         SET name = EXCLUDED.name, price_fcfa = EXCLUDED.price_fcfa, brand = COALESCE(EXCLUDED.brand, shop_products.brand),
             supplier_url = EXCLUDED.supplier_url, is_active = true,
             photos = CASE WHEN jsonb_array_length(shop_products.photos) = 0 THEN EXCLUDED.photos ELSE shop_products.photos END
       RETURNING (xmax = 0) AS inserted`,
      [categoryId, it.name, slug, it.brand, price, it.description, JSON.stringify(it.image ? [it.image] : []), SUPPLIER, it.ref, it.url],
    );
    if (r.rows[0]?.inserted) created++; else updated++;
  }

  // Produits de cette catégorie retirés du catalogue fournisseur : masqués, pas supprimés.
  let deactivated = 0;
  if (items.length) {
    const d = await pool.query(
      `UPDATE shop_products SET is_active = false
        WHERE supplier = $1 AND category_id = $2 AND is_active = true AND NOT (supplier_ref = ANY($3::text[]))`,
      [SUPPLIER, categoryId, items.map((i) => i.ref)],
    );
    deactivated = d.rowCount ?? 0;
  }
  return { category: opts.name, found: items.length, created, updated, deactivated };
}
