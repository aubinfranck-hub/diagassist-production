// Logiciel de gestion interne (personnel DiagAssist / Diagra 6) : stock par unité, ventes,
// comptes clients avec historique, échéances de licences, achats, dépenses et point comptable mensuel.
// Accès : administration DiagAssist (code admin) ou abonné (compte DiagAssist, voir subscription.ts). Montants en FCFA entiers.
import crypto from "crypto";
import { computeState, createSubscriptions, runAuth, type SubDeps } from "./subscription";

export const PRODUCT_KINDS = ["scanner", "licence", "equipement", "mise_a_jour", "service", "piece", "autre"];
const UNIT_STATUSES = ["en_stock", "vendu", "retourne", "hors_service"];

export async function initGestionSchema(pool: any) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS gestion_counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS gestion_products (
      id SERIAL PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'autre',
      name TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      reference TEXT,
      track_serial BOOLEAN NOT NULL DEFAULT true,
      sale_price_fcfa INTEGER NOT NULL DEFAULT 0,
      duration_months INTEGER,
      shop_product_id INTEGER,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS gestion_clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      city TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_gestion_clients_phone ON gestion_clients (phone)`,
    `CREATE TABLE IF NOT EXISTS gestion_purchases (
      id SERIAL PRIMARY KEY,
      supplier TEXT,
      reference TEXT,
      purchased_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      total_fcfa INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS gestion_purchase_lines (
      id SERIAL PRIMARY KEY,
      purchase_id INTEGER NOT NULL REFERENCES gestion_purchases(id),
      product_id INTEGER NOT NULL REFERENCES gestion_products(id),
      qty INTEGER NOT NULL,
      unit_cost_fcfa INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS gestion_units (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES gestion_products(id),
      serial_number TEXT,
      status TEXT NOT NULL DEFAULT 'en_stock',
      purchase_id INTEGER REFERENCES gestion_purchases(id),
      purchase_cost_fcfa INTEGER NOT NULL DEFAULT 0,
      client_id INTEGER REFERENCES gestion_clients(id),
      sale_id INTEGER,
      sold_at TIMESTAMP,
      expires_at TIMESTAMP,
      login TEXT,
      secret_enc TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_gestion_units_serial ON gestion_units (serial_number) WHERE serial_number IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_gestion_units_product_status ON gestion_units (product_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_gestion_units_client ON gestion_units (client_id)`,
    `CREATE INDEX IF NOT EXISTS idx_gestion_units_expires ON gestion_units (expires_at)`,
    `CREATE TABLE IF NOT EXISTS gestion_sales (
      id SERIAL PRIMARY KEY,
      ref TEXT NOT NULL UNIQUE,
      client_id INTEGER NOT NULL REFERENCES gestion_clients(id),
      sold_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      total_fcfa INTEGER NOT NULL DEFAULT 0,
      paid_fcfa INTEGER NOT NULL DEFAULT 0,
      payment_method TEXT,
      source TEXT NOT NULL DEFAULT 'manuel',
      notes TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS gestion_sale_lines (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES gestion_sales(id),
      product_id INTEGER NOT NULL REFERENCES gestion_products(id),
      unit_id INTEGER NOT NULL REFERENCES gestion_units(id),
      unit_price_fcfa INTEGER NOT NULL,
      cost_fcfa INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS gestion_expenses (
      id SERIAL PRIMARY KEY,
      incurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      category TEXT NOT NULL DEFAULT 'autre',
      label TEXT NOT NULL,
      amount_fcfa INTEGER NOT NULL,
      notes TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS gestion_events (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES gestion_clients(id),
      kind TEXT NOT NULL,
      message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_gestion_events_client ON gestion_events (client_id)`,
    `CREATE TABLE IF NOT EXISTS gestion_returns (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES gestion_sales(id),
      unit_id INTEGER NOT NULL REFERENCES gestion_units(id),
      client_id INTEGER REFERENCES gestion_clients(id),
      refund_fcfa INTEGER NOT NULL DEFAULT 0,
      cost_back_fcfa INTEGER NOT NULL DEFAULT 0,
      restocked BOOLEAN NOT NULL DEFAULT true,
      reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  ];
  for (const sql of statements) await pool.query(sql);
  // Abonnement : chaque abonné (garage, vendeur) a ses propres données, séparées par « owner ».
  // Les données existantes appartiennent à 'admin' (le back-office interne DiagAssist).
  for (const t of ["products", "clients", "purchases", "units", "sales", "expenses", "returns"]) {
    await pool.query(`ALTER TABLE gestion_${t} ADD COLUMN IF NOT EXISTS owner TEXT NOT NULL DEFAULT 'admin'`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gestion_${t}_owner ON gestion_${t} (owner)`);
  }
  // Un numéro de série est unique par propriétaire (et non plus globalement).
  await pool.query(`DROP INDEX IF EXISTS idx_gestion_units_serial`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_gestion_units_owner_serial ON gestion_units (owner, serial_number) WHERE serial_number IS NOT NULL`);
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS gestion_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS gestion_subscriptions (
      owner TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      trial_ends_at BIGINT,
      paid_until BIGINT,
      last_reminder_for BIGINT,
      created_at BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS gestion_payments (
      reference TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      phone TEXT NOT NULL,
      months INTEGER NOT NULL,
      amount_fcfa INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'en_attente',
      provider_ref TEXT,
      created_at BIGINT NOT NULL,
      paid_at BIGINT
    )`,
  ]) await pool.query(sql);
  await pool.query(`DO $$ BEGIN
    IF to_regclass('public.shop_orders') IS NOT NULL THEN
      ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS gestion_sale_id INTEGER;
    END IF;
  END $$`);
}

// Chiffrement des identifiants/mots de passe des équipements (AES-256-GCM).
// Clé : GESTION_SECRET_KEY si elle est définie ; sinon une clé est dérivée automatiquement d'un secret serveur
// déjà présent (ADMIN_SECRET), donc aucun réglage obligatoire. Chaque valeur porte un préfixe qui dit quelle clé
// l'a chiffrée : on peut définir GESTION_SECRET_KEY plus tard, les anciennes données restent lisibles.
function keyFor(kind: "env" | "auto"): Buffer | null {
  if (kind === "env") {
    const raw = process.env.GESTION_SECRET_KEY;
    return raw ? crypto.createHash("sha256").update(raw).digest() : null;
  }
  return crypto.createHash("sha256").update(`diagassist-gestion-auto:${process.env.ADMIN_SECRET || "diagassist"}`).digest();
}
function encryptSecret(plain: string): string {
  const kind = process.env.GESTION_SECRET_KEY ? "env" : "auto";
  const key = keyFor(kind)!;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [kind === "env" ? "k1" : "a1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), data.toString("hex")].join(":");
}
function decryptSecret(enc: string | null): string | null {
  if (!enc) return null;
  const parts = enc.split(":");
  // Ancien format sans préfixe (3 éléments) = chiffré avec GESTION_SECRET_KEY.
  const kind = parts.length === 4 ? (parts[0] === "a1" ? "auto" : "env") : "env";
  const [ivHex, tagHex, dataHex] = parts.length === 4 ? parts.slice(1) : parts;
  const key = keyFor(kind);
  if (!key) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function toInt(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

async function nextRef(client: any, prefix: string): Promise<string> {
  const { rows } = await client.query(
    "INSERT INTO gestion_counters (name, value) VALUES ($1, 1) ON CONFLICT (name) DO UPDATE SET value = gestion_counters.value + 1 RETURNING value",
    [prefix + new Date().getFullYear()]
  );
  return `${prefix}${new Date().getFullYear()}-${String(rows[0].value).padStart(5, "0")}`;
}

// La boutique (shop_products) reflète le back-office : nom, prix, disponibilité = stock réel.
async function syncShop(db: any, productId: number) {
  const { rows: t } = await db.query("SELECT to_regclass('public.shop_products') AS t");
  if (!t[0].t) return;
  const { rows } = await db.query(
    `SELECT p.*, (SELECT COUNT(*)::int FROM gestion_units u WHERE u.product_id = p.id AND u.status = 'en_stock') AS in_stock
     FROM gestion_products p WHERE p.id = $1`, [productId]);
  const p = rows[0];
  if (!p || !p.shop_product_id) return;
  const reserved = await reservedFor(db, p.shop_product_id);
  await db.query(
    "UPDATE shop_products SET name = $2, brand = $3, model = $4, price_fcfa = $5, availability = $6, is_active = $7 WHERE id = $1",
    [p.shop_product_id, p.name, p.brand, p.model, p.sale_price_fcfa, p.in_stock - reserved > 0 ? "disponible" : "rupture", p.is_active]);
}

// Quantité réservée par les commandes boutique pas encore transformées en vente (hors commandes annulées).
async function reservedFor(db: any, shopProductId: number): Promise<number> {
  const { rows: t } = await db.query("SELECT to_regclass('public.shop_orders') AS t");
  if (!t[0].t) return 0;
  const { rows } = await db.query(
    "SELECT COALESCE(SUM(quantity),0)::int AS q FROM shop_orders WHERE product_id = $1 AND gestion_sale_id IS NULL AND status <> 'annulee'", [shopProductId]);
  return rows[0].q;
}

// Resynchronise la disponibilité de tous les produits liés à la boutique (appelé à chaque commande ou changement de statut).
export async function syncAllShop(db: any) {
  const { rows } = await db.query("SELECT id FROM gestion_products WHERE shop_product_id IS NOT NULL");
  for (const r of rows) await syncShop(db, r.id);
}

// Enregistre une vente dans une transaction déjà ouverte : prend les unités, les marque vendues,
// calcule les échéances et synchronise la boutique. Utilisé par la saisie manuelle et l'import boutique.
async function recordSale(tx: any, clientId: number, b: any, source: string, owner: string) {
  const lines: any[] = Array.isArray(b.lines) ? b.lines : [];
  if (lines.length === 0) throw new Error("Ajoutez au moins une ligne de vente.");
  const ref = await nextRef(tx, "GV-");
  const { rows: s } = await tx.query(
    "INSERT INTO gestion_sales (ref, client_id, sold_at, payment_method, source, notes, owner) VALUES ($1,$2,COALESCE($3::timestamp, CURRENT_TIMESTAMP),$4,$5,$6,$7) RETURNING id, sold_at",
    [ref, clientId, b.sold_at || null, b.payment_method || null, source, b.notes || null, owner]);
  const saleId = s[0].id, soldAt = s[0].sold_at;
  let total = 0;
  const touched = new Set<number>();
  for (const line of lines) {
    const productId = toInt(line.product_id), qty = toInt(line.qty, 1), price = toInt(line.unit_price_fcfa);
    if (qty <= 0 || price < 0) throw new Error("Quantité ou prix invalide.");
    const { rows: prodRows } = await tx.query("SELECT * FROM gestion_products WHERE id = $1 AND owner = $2", [productId, owner]);
    if (prodRows.length === 0) throw new Error("Produit introuvable.");
    const product = prodRows[0];
    let unitIds: number[] = Array.isArray(line.unit_ids) ? line.unit_ids.map((x: any) => toInt(x)) : [];
    if (unitIds.length && unitIds.length !== qty) throw new Error(`${product.name} : ${qty} unité(s) demandée(s), ${unitIds.length} désignée(s).`);
    if (!unitIds.length) {
      const { rows: picked } = await tx.query(
        "SELECT id FROM gestion_units WHERE product_id = $1 AND owner = $3 AND status = 'en_stock' ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED", [productId, qty, owner]);
      unitIds = picked.map((r: any) => r.id);
    }
    if (unitIds.length < qty) throw new Error(`Stock insuffisant pour « ${product.name} » (${unitIds.length} disponible(s)).`);
    for (const unitId of unitIds) {
      const { rows: u } = await tx.query(
        "UPDATE gestion_units SET status = 'vendu', client_id = $1, sale_id = $2, sold_at = $3, expires_at = COALESCE(expires_at, CASE WHEN $4::int IS NULL THEN NULL ELSE $3::timestamp + ($4::int || ' months')::interval END) WHERE id = $5 AND status = 'en_stock' AND product_id = $6 AND owner = $7 RETURNING purchase_cost_fcfa",
        [clientId, saleId, soldAt, product.duration_months, unitId, productId, owner]);
      if (u.length === 0) throw new Error(`L'unité ${unitId} n'est plus disponible.`);
      await tx.query("INSERT INTO gestion_sale_lines (sale_id, product_id, unit_id, unit_price_fcfa, cost_fcfa) VALUES ($1,$2,$3,$4,$5)",
        [saleId, productId, unitId, price, u[0].purchase_cost_fcfa]);
    }
    total += qty * price;
    touched.add(productId);
  }
  for (const pid of touched) await syncShop(tx, pid);
  const paid = b.paid_fcfa !== undefined && b.paid_fcfa !== null && b.paid_fcfa !== "" ? toInt(b.paid_fcfa) : total;
  await tx.query("UPDATE gestion_sales SET total_fcfa = $1, paid_fcfa = $2 WHERE id = $3", [total, paid, saleId]);
  await tx.query("INSERT INTO gestion_events (client_id, kind, message) VALUES ($1,'vente',$2)", [clientId, `Vente ${ref} : ${total} FCFA (payé ${paid} FCFA)`]);
  return { id: saleId, ref, total };
}

export type GestionDeps = SubDeps & { userName?: (phone: string) => string | undefined };

export function registerGestionRoutes(app: any, pool: any, deps: GestionDeps) {
  const base = "/api/gestion";
  const requireAdminAuth = deps.requireAdminAuth;
  const subs = createSubscriptions(pool, deps);
  // Qui appelle ? L'administrateur DiagAssist (données « admin », sans abonnement) ou un abonné connecté avec son
  // compte DiagAssist (ses propres données). Sans abonnement : refus. Abonnement expiré : lecture seule.
  const access = async (req: any, res: any, next: any) => {
    try {
      if (!pool) return res.status(503).json({ success: false, message: "Base de données non configurée." });
      if (await deps.isAdmin(req)) { req.g = { owner: "admin", admin: true, label: "DiagAssist" }; return next(); }
      if (!(await runAuth(deps.requireAuth, req, res))) return;
      const owner = `u:${req.session.phone}`;
      const st = computeState(await subs.getSub(owner));
      if (st.state === "none") return res.status(402).json({ success: false, code: "NO_SUBSCRIPTION", message: "Démarrez votre essai gratuit ou abonnez-vous pour utiliser le logiciel de gestion." });
      if (st.state === "expired" && req.method !== "GET" && req.method !== "HEAD") {
        return res.status(402).json({ success: false, code: "EXPIRED", message: "Votre abonnement a expiré : le logiciel est en lecture seule (vos données sont conservées). Renouvelez pour modifier." });
      }
      req.g = { owner, admin: false, label: deps.userName?.(req.session.phone) || "votre garage", sub: st };
      next();
    } catch (err: any) {
      console.error("[gestion]", err?.message || err);
      res.status(503).json({ success: false, message: "Service momentanément indisponible. Réessayez." });
    }
  };
  if (pool) subs.register(app);
  const guard = (handler: (req: any, res: any) => Promise<any>) => async (req: any, res: any) => {
    if (!pool) return res.status(503).json({ success: false, message: "Base de données non configurée." });
    try {
      await handler(req, res);
    } catch (err: any) {
      console.error("[gestion]", err?.message || err);
      // Message clair en français pour les erreurs de base de données courantes.
      const message = err?.code === "23505" && String(err?.constraint || "").includes("serial")
        ? "Ce numéro de série existe déjà dans le stock."
        : err?.message || "Erreur";
      res.status(400).json({ success: false, message });
    }
  };

  // --- Produits ---
  app.get(`${base}/products`, access, guard(async (req: any, res: any) => {
    const { rows } = await pool.query(
      `SELECT p.*,
        COUNT(u.id) FILTER (WHERE u.status = 'en_stock') AS in_stock,
        COUNT(u.id) FILTER (WHERE u.status = 'vendu') AS sold,
        COALESCE(SUM(u.purchase_cost_fcfa) FILTER (WHERE u.status = 'en_stock'), 0) AS stock_value_fcfa
       FROM gestion_products p LEFT JOIN gestion_units u ON u.product_id = p.id
       WHERE p.is_active = true AND p.owner = $1 GROUP BY p.id ORDER BY p.kind, p.name`, [req.g.owner]
    );
    res.json({ success: true, products: rows });
  }));

  app.post(`${base}/products`, access, guard(async (req: any, res: any) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ success: false, message: "Nom requis." });
    if (b.kind && !PRODUCT_KINDS.includes(b.kind)) return res.status(400).json({ success: false, message: "Type de produit invalide." });
    const { rows } = await pool.query(
      `INSERT INTO gestion_products (kind, name, brand, model, reference, track_serial, sale_price_fcfa, duration_months, shop_product_id, owner)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [b.kind || "autre", b.name, b.brand || null, b.model || null, b.reference || null, b.track_serial !== false,
       toInt(b.sale_price_fcfa), b.duration_months ? toInt(b.duration_months) : null,
       req.g.admin && b.shop_product_id ? toInt(b.shop_product_id) : null, req.g.owner]
    );
    res.json({ success: true, id: rows[0].id });
  }));

  app.patch(`${base}/products/:id`, access, guard(async (req: any, res: any) => {
    const allowed = ["kind", "name", "brand", "model", "reference", "track_serial", "sale_price_fcfa", "duration_months", "shop_product_id", "is_active"];
    const sets: string[] = [];
    const values: any[] = [];
    for (const key of allowed) {
      if (req.body?.[key] === undefined) continue;
      if (key === "shop_product_id" && !req.g.admin) continue; // le lien boutique est réservé à DiagAssist
      if (key === "kind" && !PRODUCT_KINDS.includes(req.body.kind)) throw new Error("Type de produit invalide.");
      values.push(req.body[key]);
      sets.push(`${key} = $${values.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ success: false, message: "Rien à mettre à jour." });
    values.push(toInt(req.params.id), req.g.owner);
    const upd = await pool.query(`UPDATE gestion_products SET ${sets.join(", ")} WHERE id = $${values.length - 1} AND owner = $${values.length}`, values);
    if (!upd.rowCount) return res.status(404).json({ success: false, message: "Produit introuvable." });
    await syncShop(pool, toInt(req.params.id));
    res.json({ success: true });
  }));

  // --- Achats (entrée en stock : une unité par pièce, avec numéro de série si le produit en a) ---
  app.post(`${base}/purchases`, access, guard(async (req: any, res: any) => {
    const b = req.body || {};
    const lines: any[] = Array.isArray(b.lines) ? b.lines : [];
    if (lines.length === 0) return res.status(400).json({ success: false, message: "Ajoutez au moins une ligne d'achat." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let total = 0;
      const touched = new Set<number>();
      const { rows: p } = await client.query(
        "INSERT INTO gestion_purchases (supplier, reference, purchased_at, notes, owner) VALUES ($1,$2,COALESCE($3::timestamp, CURRENT_TIMESTAMP),$4,$5) RETURNING id",
        [b.supplier || null, b.reference || null, b.purchased_at || null, b.notes || null, req.g.owner]
      );
      const purchaseId = p[0].id;
      for (const line of lines) {
        const productId = toInt(line.product_id), qty = toInt(line.qty), cost = toInt(line.unit_cost_fcfa);
        if (qty <= 0 || cost < 0) throw new Error("Quantité ou coût invalide.");
        const { rows: prod } = await client.query("SELECT track_serial FROM gestion_products WHERE id = $1 AND owner = $2", [productId, req.g.owner]);
        if (prod.length === 0) throw new Error("Produit introuvable.");
        const serials: string[] = Array.isArray(line.serials) ? line.serials.map((s: string) => String(s).trim()).filter(Boolean) : [];
        if (prod[0].track_serial && serials.length !== qty) throw new Error(`Ce produit demande ${qty} numéro(s) de série (reçu ${serials.length}).`);
        if (new Set(serials).size !== serials.length) throw new Error("Numéros de série en double dans l'achat.");
        await client.query("INSERT INTO gestion_purchase_lines (purchase_id, product_id, qty, unit_cost_fcfa) VALUES ($1,$2,$3,$4)", [purchaseId, productId, qty, cost]);
        // Accès optionnels par numéro de série : [{ serial, login, password }]
        const accesses: any[] = Array.isArray(line.accesses) ? line.accesses : [];
        for (let i = 0; i < qty; i++) {
          const { rows: unit } = await client.query(
            "INSERT INTO gestion_units (product_id, serial_number, purchase_id, purchase_cost_fcfa, owner) VALUES ($1,$2,$3,$4,$5) RETURNING id",
            [productId, serials[i] || null, purchaseId, cost, req.g.owner]
          );
          const access = accesses.find((a: any) => serials[i] && String(a.serial).trim() === serials[i]);
          if (access && (access.login || access.password)) {
            await client.query("UPDATE gestion_units SET login = $1, secret_enc = $2 WHERE id = $3", [
              access.login || null,
              access.password ? encryptSecret(String(access.password)) : null,
              unit[0].id,
            ]);
          }
        }
        total += qty * cost;
        touched.add(productId);
      }
      await client.query("UPDATE gestion_purchases SET total_fcfa = $1 WHERE id = $2", [total, purchaseId]);
      await client.query("COMMIT");
      for (const pid of touched) await syncShop(pool, pid);
      res.json({ success: true, id: purchaseId, total_fcfa: total });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }));

  app.get(`${base}/purchases`, access, guard(async (req: any, res: any) => {
    const { rows } = await pool.query(
      `SELECT pu.*, COALESCE(string_agg(p.name || ' × ' || l.qty, ', ' ORDER BY l.id), '') AS lines_label
       FROM gestion_purchases pu
       LEFT JOIN gestion_purchase_lines l ON l.purchase_id = pu.id
       LEFT JOIN gestion_products p ON p.id = l.product_id
       WHERE pu.owner = $1
       GROUP BY pu.id ORDER BY pu.purchased_at DESC LIMIT 200`, [req.g.owner]);
    res.json({ success: true, purchases: rows });
  }));

  // --- Unités (équipements individuels) ---
  app.get(`${base}/units`, access, guard(async (req: any, res: any) => {
    const values: any[] = [req.g.owner];
    const where: string[] = ["u.owner = $1"];
    if (req.query.product_id) { values.push(toInt(req.query.product_id)); where.push(`u.product_id = $${values.length}`); }
    if (req.query.status && UNIT_STATUSES.includes(String(req.query.status))) { values.push(req.query.status); where.push(`u.status = $${values.length}`); }
    if (req.query.search) { values.push(`%${req.query.search}%`); where.push(`(u.serial_number ILIKE $${values.length} OR u.login ILIKE $${values.length})`); }
    const { rows } = await pool.query(
      `SELECT u.id, u.product_id, u.serial_number, u.status, u.purchase_cost_fcfa, u.client_id, u.sale_id, u.sold_at, u.expires_at, u.login, u.notes,
              (u.secret_enc IS NOT NULL) AS has_secret, p.name AS product_name, p.kind, c.name AS client_name
       FROM gestion_units u JOIN gestion_products p ON p.id = u.product_id LEFT JOIN gestion_clients c ON c.id = u.client_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY u.id DESC LIMIT 500`,
      values
    );
    res.json({ success: true, units: rows });
  }));

  // Modifie identifiants, date d'échéance, statut (retour SAV, hors service) d'une unité.
  app.patch(`${base}/units/:id`, access, guard(async (req: any, res: any) => {
    const b = req.body || {};
    const sets: string[] = [];
    const values: any[] = [];
    if (b.status !== undefined) {
      if (!UNIT_STATUSES.includes(b.status)) throw new Error("Statut invalide.");
      values.push(b.status); sets.push(`status = $${values.length}`);
    }
    if (b.login !== undefined) { values.push(b.login || null); sets.push(`login = $${values.length}`); }
    if (b.password) { values.push(encryptSecret(String(b.password))); sets.push(`secret_enc = $${values.length}`); }
    if (b.expires_at !== undefined) { values.push(b.expires_at || null); sets.push(`expires_at = $${values.length}`); }
    if (b.notes !== undefined) { values.push(b.notes || null); sets.push(`notes = $${values.length}`); }
    if (sets.length === 0) return res.status(400).json({ success: false, message: "Rien à mettre à jour." });
    values.push(toInt(req.params.id), req.g.owner);
    const { rows: upd } = await pool.query(`UPDATE gestion_units SET ${sets.join(", ")} WHERE id = $${values.length - 1} AND owner = $${values.length} RETURNING product_id`, values);
    if (!upd.length) return res.status(404).json({ success: false, message: "Unité introuvable." });
    await syncShop(pool, upd[0].product_id);
    res.json({ success: true });
  }));

  // Affiche le mot de passe d'un équipement (action explicite, tracée dans l'historique du client).
  app.get(`${base}/units/:id/secret`, access, guard(async (req: any, res: any) => {
    const { rows } = await pool.query("SELECT secret_enc, client_id FROM gestion_units WHERE id = $1 AND owner = $2", [toInt(req.params.id), req.g.owner]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Unité introuvable." });
    if (rows[0].client_id) {
      await pool.query("INSERT INTO gestion_events (client_id, kind, message) VALUES ($1,'consultation_secret',$2)", [rows[0].client_id, `Mot de passe consulté (unité ${req.params.id})`]);
    }
    res.json({ success: true, password: decryptSecret(rows[0].secret_enc) });
  }));

  // --- Clients (compte client = historique complet) ---
  app.get(`${base}/clients`, access, guard(async (req: any, res: any) => {
    const search = req.query.search ? `%${req.query.search}%` : "%";
    const owner = req.g.owner;
    const { rows } = await pool.query(
      `SELECT c.*, COUNT(DISTINCT s.id) AS sales_count, COALESCE(SUM(s.total_fcfa), 0) AS total_spent_fcfa
       FROM gestion_clients c LEFT JOIN gestion_sales s ON s.client_id = c.id
       WHERE c.owner = $2 AND (c.name ILIKE $1 OR c.phone ILIKE $1) GROUP BY c.id ORDER BY c.name LIMIT 300`,
      [search, owner]
    );
    res.json({ success: true, clients: rows });
  }));

  app.post(`${base}/clients`, access, guard(async (req: any, res: any) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ success: false, message: "Nom du client requis." });
    const { rows } = await pool.query(
      "INSERT INTO gestion_clients (name, phone, email, city, notes, owner) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [b.name, b.phone || null, b.email || null, b.city || null, b.notes || null, req.g.owner]
    );
    res.json({ success: true, id: rows[0].id });
  }));

  app.get(`${base}/clients/:id`, access, guard(async (req: any, res: any) => {
    const id = toInt(req.params.id);
    const [client, sales, units, events] = await Promise.all([
      pool.query("SELECT * FROM gestion_clients WHERE id = $1 AND owner = $2", [id, req.g.owner]),
      pool.query(
        `SELECT s.*, COALESCE(json_agg(json_build_object('product', p.name, 'serial', u.serial_number, 'price', l.unit_price_fcfa, 'unit_id', u.id))
                FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
         FROM gestion_sales s LEFT JOIN gestion_sale_lines l ON l.sale_id = s.id
         LEFT JOIN gestion_products p ON p.id = l.product_id LEFT JOIN gestion_units u ON u.id = l.unit_id
         WHERE s.client_id = $1 GROUP BY s.id ORDER BY s.sold_at DESC`, [id]),
      pool.query(
        `SELECT u.id, u.serial_number, u.login, u.status, u.expires_at, u.sold_at, u.sale_id, (u.secret_enc IS NOT NULL) AS has_secret, p.name AS product_name, p.kind
         FROM gestion_units u JOIN gestion_products p ON p.id = u.product_id WHERE u.client_id = $1 ORDER BY u.sold_at DESC`, [id]),
      pool.query("SELECT * FROM gestion_events WHERE client_id = $1 ORDER BY created_at DESC LIMIT 300", [id]),
    ]);
    if (client.rows.length === 0) return res.status(404).json({ success: false, message: "Client introuvable." });
    res.json({ success: true, client: client.rows[0], sales: sales.rows, units: units.rows, events: events.rows });
  }));

  app.patch(`${base}/clients/:id`, access, guard(async (req: any, res: any) => {
    const allowed = ["name", "phone", "email", "city", "notes"];
    const sets: string[] = [];
    const values: any[] = [];
    for (const key of allowed) {
      if (req.body?.[key] === undefined) continue;
      values.push(req.body[key] || null); sets.push(`${key} = $${values.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ success: false, message: "Rien à mettre à jour." });
    values.push(toInt(req.params.id), req.g.owner);
    const upd = await pool.query(`UPDATE gestion_clients SET ${sets.join(", ")} WHERE id = $${values.length - 1} AND owner = $${values.length}`, values);
    if (!upd.rowCount) return res.status(404).json({ success: false, message: "Client introuvable." });
    res.json({ success: true });
  }));

  app.post(`${base}/clients/:id/events`, access, guard(async (req: any, res: any) => {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ success: false, message: "Note vide." });
    const ins = await pool.query(
      "INSERT INTO gestion_events (client_id, kind, message) SELECT id,'note',$2 FROM gestion_clients WHERE id = $1 AND owner = $3",
      [toInt(req.params.id), message, req.g.owner]);
    if (!ins.rowCount) return res.status(404).json({ success: false, message: "Client introuvable." });
    res.json({ success: true });
  }));

  // --- Ventes ---
  // Chaque ligne prend des unités en stock (ou celles désignées par unit_ids). L'unité passe « vendu »,
  // reçoit le client et la date d'échéance (durée du produit). Si le produit est lié à la boutique et
  // qu'il n'en reste plus, la boutique passe en rupture automatiquement.
  app.post(`${base}/sales`, access, guard(async (req: any, res: any) => {
    const b = req.body || {};
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      let clientId = toInt(b.client_id, 0);
      if (clientId) {
        const { rows: own } = await tx.query("SELECT id FROM gestion_clients WHERE id = $1 AND owner = $2", [clientId, req.g.owner]);
        if (own.length === 0) throw new Error("Client introuvable.");
      } else {
        if (!b.client_name) throw new Error("Choisissez un client ou saisissez son nom.");
        const { rows } = await tx.query("INSERT INTO gestion_clients (name, phone, city, owner) VALUES ($1,$2,$3,$4) RETURNING id", [b.client_name, b.client_phone || null, b.client_city || null, req.g.owner]);
        clientId = rows[0].id;
      }
      const sale = await recordSale(tx, clientId, b, "manuel", req.g.owner);
      await tx.query("COMMIT");
      res.json({ success: true, id: sale.id, ref: sale.ref, total_fcfa: sale.total });
    } catch (err) {
      await tx.query("ROLLBACK");
      throw err;
    } finally {
      tx.release();
    }
  }));

  app.get(`${base}/sales`, access, guard(async (req: any, res: any) => {
    const { rows } = await pool.query("SELECT s.*, c.name AS client_name FROM gestion_sales s JOIN gestion_clients c ON c.id = s.client_id WHERE s.owner = $1 ORDER BY s.sold_at DESC LIMIT 200", [req.g.owner]);
    res.json({ success: true, sales: rows });
  }));

  // --- Échéances : unités vendues qui arrivent à échéance ---
  app.get(`${base}/expiring`, access, guard(async (req: any, res: any) => {
    const days = toInt(req.query.days, 60);
    const { rows } = await pool.query(
      `SELECT u.id, u.serial_number, u.login, u.expires_at, u.client_id, p.name AS product_name, p.kind, c.name AS client_name, c.phone,
              (u.expires_at <= CURRENT_TIMESTAMP) AS expired
       FROM gestion_units u JOIN gestion_products p ON p.id = u.product_id JOIN gestion_clients c ON c.id = u.client_id
       WHERE u.owner = $2 AND u.status = 'vendu' AND u.expires_at IS NOT NULL AND u.expires_at <= CURRENT_TIMESTAMP + ($1::int || ' days')::interval
       ORDER BY u.expires_at ASC`, [days, req.g.owner]);
    res.json({ success: true, items: rows });
  }));

  // Enregistre une relance dans l'historique du client et renvoie un lien WhatsApp prérempli (envoi manuel).
  app.post(`${base}/units/:id/relance`, access, guard(async (req: any, res: any) => {
    const { rows } = await pool.query(
      `SELECT u.client_id, u.expires_at, p.name AS product_name, c.name AS client_name, c.phone
       FROM gestion_units u JOIN gestion_products p ON p.id = u.product_id JOIN gestion_clients c ON c.id = u.client_id WHERE u.id = $1 AND u.owner = $2`, [toInt(req.params.id), req.g.owner]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Unité introuvable." });
    const r = rows[0];
    const when = r.expires_at ? new Date(r.expires_at).toLocaleDateString("fr-FR") : "";
    const message = `Bonjour ${r.client_name}, ici ${req.g.label}. Votre ${r.product_name} arrive à échéance le ${when}. Souhaitez-vous le renouveler ?`;
    await pool.query("INSERT INTO gestion_events (client_id, kind, message) VALUES ($1,'relance',$2)", [r.client_id, message]);
    const digits = String(r.phone || "").replace(/\D/g, "");
    const link = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null;
    res.json({ success: true, message, link });
  }));

  // --- Boutique (front) : publication d'un produit et commandes à traiter ---
  app.post(`${base}/products/:id/publish`, requireAdminAuth, guard(async (req: any, res: any) => {
    const id = toInt(req.params.id);
    const { rows } = await pool.query("SELECT * FROM gestion_products WHERE id = $1 AND owner = 'admin'", [id]);
    if (rows.length === 0) throw new Error("Produit introuvable.");
    const p = rows[0];
    if (!p.shop_product_id) {
      const slug = p.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Date.now().toString(36);
      const { rows: created } = await pool.query(
        "INSERT INTO shop_products (name, slug, brand, model, price_fcfa, availability, is_active) VALUES ($1,$2,$3,$4,$5,'rupture',true) RETURNING id",
        [p.name, slug, p.brand, p.model, p.sale_price_fcfa]);
      await pool.query("UPDATE gestion_products SET shop_product_id = $1 WHERE id = $2", [created[0].id, id]);
    }
    await syncShop(pool, id);
    res.json({ success: true });
  }));

  app.get(`${base}/shop-orders`, requireAdminAuth, guard(async (_req: any, res: any) => {
    const { rows: t } = await pool.query("SELECT to_regclass('public.shop_orders') AS t");
    if (!t[0].t) return res.json({ success: true, orders: [] });
    const { rows } = await pool.query(
      `SELECT o.id, o.order_ref, o.customer_phone, o.product_id, o.product_name_snapshot, o.unit_price_snapshot, o.quantity, o.status, o.created_at,
              c.name AS customer_name, gp.id AS gestion_product_id,
              (SELECT COUNT(*)::int FROM gestion_units u WHERE u.product_id = gp.id AND u.status = 'en_stock') AS in_stock,
              (SELECT COALESCE(SUM(o2.quantity),0)::int FROM shop_orders o2 WHERE o2.product_id = o.product_id AND o2.gestion_sale_id IS NULL AND o2.status <> 'annulee') AS reserved
       FROM shop_orders o
       LEFT JOIN shop_customers c ON c.phone = o.customer_phone
       LEFT JOIN gestion_products gp ON gp.shop_product_id = o.product_id AND gp.owner = 'admin'
       WHERE o.gestion_sale_id IS NULL AND o.status <> 'annulee'
       ORDER BY o.created_at ASC LIMIT 200`);
    res.json({ success: true, orders: rows });
  }));

  // Transforme une commande boutique en vente back-office : client retrouvé par téléphone (sinon créé),
  // stock décrémenté, échéances calculées.
  app.post(`${base}/shop-orders/:id/import`, requireAdminAuth, guard(async (req: any, res: any) => {
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      const { rows: os } = await tx.query("SELECT * FROM shop_orders WHERE id = $1 FOR UPDATE", [toInt(req.params.id)]);
      if (os.length === 0) throw new Error("Commande introuvable.");
      const o = os[0];
      if (o.gestion_sale_id) throw new Error("Cette commande est déjà importée.");
      const { rows: gp } = await tx.query("SELECT id FROM gestion_products WHERE shop_product_id = $1 AND owner = 'admin'", [o.product_id]);
      if (gp.length === 0) throw new Error("Ce produit boutique n'est pas lié à un produit du back-office. Publiez-le ou liez-le d'abord.");
      const { rows: cust } = await tx.query("SELECT name FROM shop_customers WHERE phone = $1", [o.customer_phone]);
      let clientId: number;
      const { rows: existing } = await tx.query("SELECT id FROM gestion_clients WHERE phone = $1 AND owner = 'admin' LIMIT 1", [o.customer_phone]);
      if (existing.length) clientId = existing[0].id;
      else {
        const { rows: created } = await tx.query("INSERT INTO gestion_clients (name, phone, owner) VALUES ($1,$2,'admin') RETURNING id",
          [cust[0]?.name || o.customer_phone, o.customer_phone]);
        clientId = created[0].id;
      }
      const sale = await recordSale(tx, clientId, {
        lines: [{ product_id: gp[0].id, qty: o.quantity || 1, unit_price_fcfa: o.unit_price_snapshot || 0 }],
        payment_method: "boutique", notes: `Commande boutique ${o.order_ref || o.id}`,
      }, "boutique", "admin");
      await tx.query("UPDATE shop_orders SET gestion_sale_id = $1 WHERE id = $2", [sale.id, o.id]);
      await tx.query("COMMIT");
      res.json({ success: true, ref: sale.ref, total_fcfa: sale.total });
    } catch (err) {
      await tx.query("ROLLBACK");
      throw err;
    } finally {
      tx.release();
    }
  }));

  // --- Dépenses ---
  app.get(`${base}/expenses`, access, guard(async (req: any, res: any) => {
    const { rows } = await pool.query("SELECT * FROM gestion_expenses WHERE owner = $1 ORDER BY incurred_at DESC LIMIT 300", [req.g.owner]);
    res.json({ success: true, expenses: rows });
  }));

  app.post(`${base}/expenses`, access, guard(async (req: any, res: any) => {
    const b = req.body || {};
    if (!b.label || !Number.isFinite(Number(b.amount_fcfa)) || Number(b.amount_fcfa) < 0) throw new Error("Libellé et montant requis.");
    const { rows } = await pool.query(
      "INSERT INTO gestion_expenses (incurred_at, category, label, amount_fcfa, notes, owner) VALUES (COALESCE($1::timestamp, CURRENT_TIMESTAMP),$2,$3,$4,$5,$6) RETURNING id",
      [b.incurred_at || null, b.category || "autre", b.label, toInt(b.amount_fcfa), b.notes || null, req.g.owner]);
    res.json({ success: true, id: rows[0].id });
  }));

  app.patch(`${base}/expenses/:id`, access, guard(async (req: any, res: any) => {
    const b = req.body || {};
    if (!b.label || !Number.isFinite(Number(b.amount_fcfa)) || Number(b.amount_fcfa) < 0) throw new Error("Libellé et montant requis.");
    const r = await pool.query(
      "UPDATE gestion_expenses SET incurred_at = COALESCE($2::timestamp, incurred_at), category = $3, label = $4, amount_fcfa = $5, notes = $6 WHERE id = $1 AND owner = $7",
      [toInt(req.params.id), b.incurred_at || null, b.category || "autre", b.label, toInt(b.amount_fcfa), b.notes || null, req.g.owner]);
    if (!r.rowCount) return res.status(404).json({ success: false, message: "Dépense introuvable." });
    res.json({ success: true });
  }));

  app.delete(`${base}/expenses/:id`, access, guard(async (req: any, res: any) => {
    await pool.query("DELETE FROM gestion_expenses WHERE id = $1 AND owner = $2", [toInt(req.params.id), req.g.owner]);
    res.json({ success: true });
  }));

  // --- Retours : le client rend un article vendu (remboursement total ou partiel, remise en stock ou non) ---
  app.post(`${base}/units/:id/return`, access, guard(async (req: any, res: any) => {
    const b = req.body || {};
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      const { rows: l } = await tx.query(
        `SELECT l.sale_id, l.unit_price_fcfa, l.cost_fcfa, u.status, u.client_id, u.product_id, p.name
         FROM gestion_units u JOIN gestion_sale_lines l ON l.unit_id = u.id JOIN gestion_products p ON p.id = u.product_id
         WHERE u.id = $1 AND u.owner = $2 ORDER BY l.id DESC LIMIT 1 FOR UPDATE OF u`, [toInt(req.params.id), req.g.owner]);
      if (l.length === 0) throw new Error("Unité introuvable ou jamais vendue.");
      const line = l[0];
      if (line.status !== "vendu") throw new Error("Cet article n'est pas actuellement chez un client.");
      const refund = b.refund_fcfa === undefined || b.refund_fcfa === "" ? line.unit_price_fcfa : toInt(b.refund_fcfa);
      if (refund < 0 || refund > line.unit_price_fcfa) throw new Error(`Remboursement invalide (maximum ${line.unit_price_fcfa} FCFA).`);
      const restock = b.restock !== false;
      await tx.query(
        "INSERT INTO gestion_returns (sale_id, unit_id, client_id, refund_fcfa, cost_back_fcfa, restocked, reason, owner) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [line.sale_id, toInt(req.params.id), line.client_id, refund, restock ? line.cost_fcfa : 0, restock, b.reason || null, req.g.owner]);
      // Remis en stock : l'article redevient vendable, sans client ni accès. Sinon : marqué « retourné » (SAV, pas revendable).
      await tx.query(
        restock
          ? "UPDATE gestion_units SET status = 'en_stock', client_id = NULL, sale_id = NULL, sold_at = NULL, expires_at = NULL, login = NULL, secret_enc = NULL WHERE id = $1"
          : "UPDATE gestion_units SET status = 'retourne' WHERE id = $1", [toInt(req.params.id)]);
      if (line.client_id) {
        await tx.query("INSERT INTO gestion_events (client_id, kind, message) VALUES ($1,'retour',$2)",
          [line.client_id, `Retour de « ${line.name} » : remboursé ${refund} FCFA${restock ? ", remis en stock" : ", non remis en stock"}${b.reason ? ` (${b.reason})` : ""}`]);
      }
      await tx.query("COMMIT");
      await syncShop(pool, line.product_id);
      res.json({ success: true, refund_fcfa: refund });
    } catch (err) {
      await tx.query("ROLLBACK");
      throw err;
    } finally {
      tx.release();
    }
  }));

  // --- Export CSV (ouvrable dans Excel : séparateur « ; », accents conservés) ---
  const csvCell = (v: any) => {
    let t = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    // Évite l'exécution de formules dans Excel (sauf numéros de téléphone et montants négatifs).
    if (/^[=@]/.test(t) || (/^[+-]/.test(t) && !/^[+-]?\d[\d\s.,]*$/.test(t))) t = "'" + t;
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  app.get(`${base}/export/:what`, access, guard(async (req: any, res: any) => {
    const queries: Record<string, { sql: string; head: string[] }> = {
      ventes: {
        head: ["Référence", "Date", "Client", "Téléphone", "Produit", "N° de série", "Prix", "Coût d'achat", "Payé (total vente)", "Mode de paiement", "Source"],
        sql: `SELECT s.ref, s.sold_at, c.name, c.phone, p.name AS product, u.serial_number, l.unit_price_fcfa, l.cost_fcfa, s.paid_fcfa, s.payment_method, s.source
              FROM gestion_sales s JOIN gestion_clients c ON c.id = s.client_id JOIN gestion_sale_lines l ON l.sale_id = s.id
              JOIN gestion_products p ON p.id = l.product_id JOIN gestion_units u ON u.id = l.unit_id WHERE s.owner = $1 ORDER BY s.sold_at DESC, l.id`,
      },
      stock: {
        head: ["Produit", "Type", "N° de série", "Statut", "Coût d'achat", "Client", "Vendu le", "Échéance"],
        sql: `SELECT p.name, p.kind, u.serial_number, u.status, u.purchase_cost_fcfa, c.name AS client, u.sold_at, u.expires_at
              FROM gestion_units u JOIN gestion_products p ON p.id = u.product_id LEFT JOIN gestion_clients c ON c.id = u.client_id WHERE u.owner = $1 ORDER BY p.name, u.id`,
      },
      depenses: {
        head: ["Date", "Catégorie", "Libellé", "Montant", "Notes"],
        sql: "SELECT incurred_at, category, label, amount_fcfa, notes FROM gestion_expenses WHERE owner = $1 ORDER BY incurred_at DESC",
      },
      clients: {
        head: ["Nom", "Téléphone", "Ville", "Email", "Nombre de ventes", "Total dépensé"],
        sql: `SELECT c.name, c.phone, c.city, c.email, COUNT(DISTINCT s.id) AS n, COALESCE(SUM(s.total_fcfa),0) AS total
              FROM gestion_clients c LEFT JOIN gestion_sales s ON s.client_id = c.id WHERE c.owner = $1 GROUP BY c.id ORDER BY c.name`,
      },
    };
    const q = queries[String(req.params.what)];
    if (!q) return res.status(404).json({ success: false, message: "Export inconnu." });
    const { rows } = await pool.query(q.sql, [req.g.owner]);
    const lines = [q.head.join(";"), ...rows.map((r: any) => Object.values(r).map(csvCell).join(";"))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.what}.csv"`);
    res.send("\uFEFF" + lines.join("\r\n"));
  }));

  // --- Point comptable mensuel ---
  app.get(`${base}/accounting`, access, guard(async (req: any, res: any) => {
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || "")) ? String(req.query.month) : new Date().toISOString().slice(0, 7);
    const start = `${month}-01`;
    const owner = req.g.owner;
    const [sales, cogs, expenses, purchases, stock, refunds] = await Promise.all([
      pool.query("SELECT COALESCE(SUM(total_fcfa),0)::int AS revenue, COALESCE(SUM(paid_fcfa),0)::int AS paid, COUNT(*)::int AS count FROM gestion_sales WHERE owner = $2 AND date_trunc('month', sold_at) = $1::date", [start, owner]),
      pool.query("SELECT COALESCE(SUM(l.cost_fcfa),0)::int AS cogs FROM gestion_sale_lines l JOIN gestion_sales s ON s.id = l.sale_id WHERE s.owner = $2 AND date_trunc('month', s.sold_at) = $1::date", [start, owner]),
      pool.query("SELECT category, COALESCE(SUM(amount_fcfa),0)::int AS total FROM gestion_expenses WHERE owner = $2 AND date_trunc('month', incurred_at) = $1::date GROUP BY category ORDER BY total DESC", [start, owner]),
      pool.query("SELECT COALESCE(SUM(total_fcfa),0)::int AS total FROM gestion_purchases WHERE owner = $2 AND date_trunc('month', purchased_at) = $1::date", [start, owner]),
      pool.query("SELECT COALESCE(SUM(purchase_cost_fcfa),0)::int AS value, COUNT(*)::int AS units FROM gestion_units WHERE owner = $1 AND status = 'en_stock'", [owner]),
      pool.query("SELECT COALESCE(SUM(refund_fcfa),0)::int AS refunds, COALESCE(SUM(cost_back_fcfa),0)::int AS cost_back FROM gestion_returns WHERE owner = $2 AND date_trunc('month', created_at) = $1::date", [start, owner]),
    ]);
    // Les retours du mois diminuent le chiffre d'affaires ; le coût des articles remis en stock est récupéré.
    const revenue = sales.rows[0].revenue - refunds.rows[0].refunds, costOfGoods = cogs.rows[0].cogs - refunds.rows[0].cost_back;
    const expenseTotal = expenses.rows.reduce((a: number, r: any) => a + r.total, 0);
    res.json({
      success: true, month,
      revenue_fcfa: revenue,
      encaisse_fcfa: sales.rows[0].paid - refunds.rows[0].refunds,
      refunds_fcfa: refunds.rows[0].refunds,
      sales_count: sales.rows[0].count,
      cost_of_goods_fcfa: costOfGoods,
      gross_margin_fcfa: revenue - costOfGoods,
      expenses_by_category: expenses.rows,
      expenses_fcfa: expenseTotal,
      net_result_fcfa: revenue - costOfGoods - expenseTotal,
      purchases_fcfa: purchases.rows[0].total,
      stock_value_fcfa: stock.rows[0].value,
      stock_units: stock.rows[0].units,
    });
  }));

  return subs;
}
