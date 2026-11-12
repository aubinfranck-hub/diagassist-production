export interface CartItem { product_id: number; name: string; price_fcfa: number | null; photo: string | null; quantity: number; }

export function readCart(read: () => string | null): CartItem[] {
  try {
    const rows: unknown = JSON.parse(read() ?? "[]");
    if (!Array.isArray(rows)) return [];
    const items: CartItem[] = [];
    const seen = new Set<number>();
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const id = numeric(row.product_id);
      const qty = numeric(row.quantity);
      const price = row.price_fcfa == null ? null : numeric(row.price_fcfa);
      if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id) ||
          !Number.isSafeInteger(qty) || qty < 1 || typeof row.name !== "string" || !row.name.trim() ||
          (price !== null && (!Number.isFinite(price) || price < 0))) continue;
      seen.add(id);
      items.push({ product_id: id, name: row.name, quantity: qty, price_fcfa: price,
        photo: typeof row.photo === "string" ? row.photo : null });
    }
    return items;
  } catch {
    return [];
  }
}

function numeric(value: unknown): number {
  if (typeof value === "number") return value;
  return typeof value === "string" && value.trim() ? Number(value) : NaN;
}

export function saveCart(items: CartItem[], write: (value: string) => void): boolean {
  try {
    write(JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}
