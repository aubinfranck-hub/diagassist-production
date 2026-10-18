type Query = (sql: string, params?: any[]) => Promise<any>;

// One row per account and budget; conditional UPSERT enforces limits across concurrent requests/instances.
export class UsageStore {
  private memory = new Map<string, { period: number; used: number }>();
  constructor(private query?: Query) {}

  async used(phone: string, bucket: string, period: number): Promise<number> {
    if (this.query) {
      const result = await this.query("SELECT used FROM usage_counters WHERE phone=$1 AND bucket=$2 AND period_start=$3", [phone, bucket, period]);
      return Number(result.rows[0]?.used || 0);
    }
    const row = this.memory.get(`${phone}:${bucket}`);
    return row?.period === period ? row.used : 0;
  }

  async consume(phone: string, bucket: string, period: number, amount: number, limit: number): Promise<boolean> {
    if (!Number.isFinite(amount) || amount <= 0 || amount > limit) return false;
    const ceiling = Number.isFinite(limit) ? limit : Number.MAX_SAFE_INTEGER;
    if (this.query) {
      const result = await this.query(
        `INSERT INTO usage_counters (phone,bucket,period_start,used) VALUES ($1,$2,$3,$4)
         ON CONFLICT (phone,bucket) DO UPDATE SET
           used=CASE WHEN usage_counters.period_start=$3 THEN usage_counters.used+$4 ELSE $4 END,
           period_start=$3
         WHERE usage_counters.period_start<$3 OR (usage_counters.period_start=$3 AND usage_counters.used+$4 <= $5)
         RETURNING used`, [phone, bucket, period, amount, ceiling]);
      return result.rows.length === 1;
    }
    const used = await this.used(phone, bucket, period);
    // No await between read and write in memory mode (single process development/tests).
    const row = this.memory.get(`${phone}:${bucket}`);
    if (row && row.period > period) return false;
    const current = row?.period === period ? row.used : used;
    if (current + amount > ceiling) return false;
    this.memory.set(`${phone}:${bucket}`, { period, used: current + amount });
    return true;
  }

  async refund(phone: string, bucket: string, period: number, amount: number): Promise<void> {
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (this.query) {
      await this.query("UPDATE usage_counters SET used=GREATEST(0,used-$4) WHERE phone=$1 AND bucket=$2 AND period_start=$3", [phone, bucket, period, amount]);
    } else {
      const row = this.memory.get(`${phone}:${bucket}`);
      if (row?.period === period) row.used = Math.max(0, row.used - amount);
    }
  }
}
