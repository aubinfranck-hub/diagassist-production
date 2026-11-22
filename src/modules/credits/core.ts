// Crédits de diagnostics IA : quelques diagnostics gratuits par compte, puis des packs payants.
// Tout le décompte se fait ICI, côté serveur, de façon atomique (jamais d'après un chiffre envoyé
// par l'application). Sans base de données (développement), une mémoire locale prend le relais.
type Query = (sql: string, params?: any[]) => Promise<any>;

export type CreditPack = { id: string; label: string; credits: number; priceXof: number; active: boolean };
export type CreditSettings = { freeCount: number; packs: CreditPack[] };

export const DEFAULT_CREDIT_SETTINGS: CreditSettings = {
  freeCount: 3,
  packs: [
    { id: "pack-5", label: "Pack Découverte", credits: 5, priceXof: 1000, active: true },
    { id: "pack-15", label: "Pack Habitué", credits: 15, priceXof: 2500, active: true },
    { id: "pack-40", label: "Pack Pro", credits: 40, priceXof: 5000, active: true },
  ],
};

const MAX_PACKS = 8;

/** Valide ce que l'admin envoie : nombres entiers, prix en F CFA, au plus 8 packs. Lève une Error en français. */
export function sanitizeCreditSettings(input: any): CreditSettings {
  const freeCount = Number(input?.freeCount);
  if (!Number.isInteger(freeCount) || freeCount < 0 || freeCount > 100) throw new Error("Le nombre de diagnostics gratuits doit être un entier entre 0 et 100.");
  if (!Array.isArray(input?.packs) || input.packs.length > MAX_PACKS) throw new Error(`Au plus ${MAX_PACKS} packs.`);
  const seen = new Set<string>();
  const packs = input.packs.map((raw: any, i: number): CreditPack => {
    const credits = Number(raw?.credits);
    const priceXof = Number(raw?.priceXof);
    const label = String(raw?.label ?? "").trim().slice(0, 40);
    if (!label) throw new Error(`Pack ${i + 1} : le nom est obligatoire.`);
    if (!Number.isInteger(credits) || credits < 1 || credits > 1000) throw new Error(`Pack « ${label} » : le nombre de diagnostics doit être un entier entre 1 et 1000.`);
    if (!Number.isInteger(priceXof) || priceXof < 100 || priceXof > 500000) throw new Error(`Pack « ${label} » : le prix doit être entre 100 et 500 000 F CFA.`);
    let id = String(raw?.id ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 30);
    if (!id || seen.has(id)) id = `pack-${Date.now().toString(36)}${i}`;
    seen.add(id);
    return { id, label, credits, priceXof, active: raw?.active !== false };
  });
  return { freeCount, packs };
}

export type CreditSource = "free" | "paid";
export type PurchaseStatus = "en_attente" | "paye" | "echoue";
export type Purchase = {
  reference: string; phone: string; packId: string; packLabel: string; credits: number; amountXof: number;
  method: string; status: PurchaseStatus; providerRef: string | null; redirectUrl: string | null; createdAt: number;
};

export class CreditStore {
  private settings: CreditSettings | null = null;
  private memBalances = new Map<string, { freeUsed: number; paid: number; lastDiagAt: number }>();
  private memPurchases = new Map<string, Purchase>();
  constructor(private query?: Query) {}

  async init() {
    if (!this.query) return;
    await this.query(`
      CREATE TABLE IF NOT EXISTS diag_credit_balances (
        phone TEXT PRIMARY KEY, free_used INTEGER NOT NULL DEFAULT 0, paid_balance INTEGER NOT NULL DEFAULT 0,
        last_diag_at BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS diag_credit_purchases (
        reference TEXT PRIMARY KEY, phone TEXT NOT NULL, pack_id TEXT NOT NULL, pack_label TEXT NOT NULL,
        credits INTEGER NOT NULL, amount_xof INTEGER NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL,
        provider_ref TEXT, redirect_url TEXT, created_at BIGINT NOT NULL, credited_at BIGINT
      );
      CREATE INDEX IF NOT EXISTS idx_diag_credit_purchases_phone ON diag_credit_purchases (phone);
      CREATE TABLE IF NOT EXISTS diag_credit_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  async getSettings(): Promise<CreditSettings> {
    if (this.query) {
      const r = await this.query("SELECT value FROM diag_credit_settings WHERE key='settings'");
      if (r.rows[0]) { try { return sanitizeCreditSettings(JSON.parse(r.rows[0].value)); } catch { /* valeur abîmée : on retombe sur les défauts */ } }
      return DEFAULT_CREDIT_SETTINGS;
    }
    return this.settings || DEFAULT_CREDIT_SETTINGS;
  }

  async saveSettings(s: CreditSettings) {
    if (this.query) {
      await this.query("INSERT INTO diag_credit_settings (key,value) VALUES ('settings',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(s)]);
    } else this.settings = s;
  }

  async balance(phone: string, freeCount: number) {
    let freeUsed = 0, paid = 0, lastDiagAt = 0;
    if (this.query) {
      const r = (await this.query("SELECT free_used, paid_balance, last_diag_at FROM diag_credit_balances WHERE phone=$1", [phone])).rows[0];
      if (r) { freeUsed = Number(r.free_used); paid = Number(r.paid_balance); lastDiagAt = Number(r.last_diag_at); }
    } else {
      const m = this.memBalances.get(phone);
      if (m) ({ freeUsed, paid, lastDiagAt } = { freeUsed: m.freeUsed, paid: m.paid, lastDiagAt: m.lastDiagAt });
    }
    const freeRemaining = Math.max(0, freeCount - freeUsed);
    return { freeTotal: freeCount, freeRemaining, paidBalance: paid, total: freeRemaining + paid, lastDiagAt };
  }

  /** Retire UN diagnostic, d'abord un gratuit puis un acheté. Atomique : deux requêtes simultanées ne peuvent pas dépasser le solde. */
  async consume(phone: string, freeCount: number): Promise<CreditSource | null> {
    const now = Date.now();
    if (this.query) {
      await this.query("INSERT INTO diag_credit_balances (phone,updated_at) VALUES ($1,$2) ON CONFLICT (phone) DO NOTHING", [phone, now]);
      const free = await this.query("UPDATE diag_credit_balances SET free_used=free_used+1, last_diag_at=$2, updated_at=$2 WHERE phone=$1 AND free_used<$3 RETURNING phone", [phone, now, freeCount]);
      if (free.rows.length) return "free";
      const paid = await this.query("UPDATE diag_credit_balances SET paid_balance=paid_balance-1, last_diag_at=$2, updated_at=$2 WHERE phone=$1 AND paid_balance>0 RETURNING phone", [phone, now]);
      return paid.rows.length ? "paid" : null;
    }
    // Mémoire : aucun await entre la lecture et l'écriture, donc pas de course possible.
    const m = this.memBalances.get(phone) || { freeUsed: 0, paid: 0, lastDiagAt: 0 };
    this.memBalances.set(phone, m);
    if (m.freeUsed < freeCount) { m.freeUsed++; m.lastDiagAt = now; return "free"; }
    if (m.paid > 0) { m.paid--; m.lastDiagAt = now; return "paid"; }
    return null;
  }

  /** Rend le diagnostic retiré quand l'analyse n'a pas pu aboutir (panne technique : l'utilisateur ne paie pas). */
  async refund(phone: string, source: CreditSource) {
    if (this.query) {
      const col = source === "free" ? "free_used=GREATEST(0,free_used-1)" : "paid_balance=paid_balance+1";
      await this.query(`UPDATE diag_credit_balances SET ${col}, updated_at=$2 WHERE phone=$1`, [phone, Date.now()]);
      return;
    }
    const m = this.memBalances.get(phone);
    if (!m) return;
    if (source === "free") m.freeUsed = Math.max(0, m.freeUsed - 1); else m.paid++;
  }

  async addPaid(phone: string, credits: number) {
    if (this.query) {
      await this.query(`INSERT INTO diag_credit_balances (phone,paid_balance,updated_at) VALUES ($1,$2,$3)
        ON CONFLICT (phone) DO UPDATE SET paid_balance=diag_credit_balances.paid_balance+EXCLUDED.paid_balance, updated_at=EXCLUDED.updated_at`, [phone, credits, Date.now()]);
      return;
    }
    const m = this.memBalances.get(phone) || { freeUsed: 0, paid: 0, lastDiagAt: 0 };
    m.paid += credits; this.memBalances.set(phone, m);
  }

  async createPurchase(p: Purchase) {
    if (this.query) {
      await this.query(`INSERT INTO diag_credit_purchases (reference,phone,pack_id,pack_label,credits,amount_xof,method,status,provider_ref,redirect_url,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [p.reference, p.phone, p.packId, p.packLabel, p.credits, p.amountXof, p.method, p.status, p.providerRef, p.redirectUrl, p.createdAt]);
    } else this.memPurchases.set(p.reference, { ...p });
  }

  async getPurchase(reference: string): Promise<Purchase | null> {
    if (this.query) {
      const r = (await this.query("SELECT * FROM diag_credit_purchases WHERE reference=$1", [reference])).rows[0];
      return r ? {
        reference: r.reference, phone: r.phone, packId: r.pack_id, packLabel: r.pack_label, credits: Number(r.credits), amountXof: Number(r.amount_xof),
        method: r.method, status: r.status, providerRef: r.provider_ref, redirectUrl: r.redirect_url, createdAt: Number(r.created_at),
      } : null;
    }
    const p = this.memPurchases.get(reference);
    return p ? { ...p } : null;
  }

  /** Marque l'achat payé ET ajoute les diagnostics, en une seule instruction : un webhook rejoué ne crédite jamais deux fois. Renvoie true si c'est ce passage qui a crédité. */
  async markPaid(reference: string): Promise<boolean> {
    const now = Date.now();
    if (this.query) {
      const r = await this.query(`
        WITH done AS (UPDATE diag_credit_purchases SET status='paye', credited_at=$2 WHERE reference=$1 AND status<>'paye' RETURNING phone, credits)
        INSERT INTO diag_credit_balances (phone, paid_balance, updated_at) SELECT phone, credits, $2 FROM done
        ON CONFLICT (phone) DO UPDATE SET paid_balance=diag_credit_balances.paid_balance+EXCLUDED.paid_balance, updated_at=EXCLUDED.updated_at
        RETURNING phone`, [reference, now]);
      return r.rows.length > 0;
    }
    const p = this.memPurchases.get(reference);
    if (!p || p.status === "paye") return false;
    p.status = "paye";
    await this.addPaid(p.phone, p.credits);
    return true;
  }

  async markFailed(reference: string) {
    if (this.query) await this.query("UPDATE diag_credit_purchases SET status='echoue' WHERE reference=$1 AND status='en_attente'", [reference]);
    else { const p = this.memPurchases.get(reference); if (p && p.status === "en_attente") p.status = "echoue"; }
  }

  async stats() {
    if (this.query) {
      const r = (await this.query(`SELECT COUNT(*) FILTER (WHERE status='paye') AS paid_count, COALESCE(SUM(amount_xof) FILTER (WHERE status='paye'),0) AS revenue,
        COALESCE(SUM(credits) FILTER (WHERE status='paye'),0) AS credits_sold FROM diag_credit_purchases`)).rows[0];
      const b = (await this.query("SELECT COALESCE(SUM(free_used),0) AS free_used, COUNT(*) AS users FROM diag_credit_balances")).rows[0];
      return { paidCount: Number(r.paid_count), revenueXof: Number(r.revenue), creditsSold: Number(r.credits_sold), freeUsed: Number(b.free_used), users: Number(b.users) };
    }
    const paid = [...this.memPurchases.values()].filter(p => p.status === "paye");
    return {
      paidCount: paid.length, revenueXof: paid.reduce((s, p) => s + p.amountXof, 0), creditsSold: paid.reduce((s, p) => s + p.credits, 0),
      freeUsed: [...this.memBalances.values()].reduce((s, m) => s + m.freeUsed, 0), users: this.memBalances.size,
    };
  }
}
