import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export const OFFERS = {
  centre: { label: 'Au point diagnostic', price: 3000, minimum: 1000 },
  domicile: { label: 'Chez vous, sur rendez-vous', price: 5000, minimum: 2000 },
  immediat: { label: 'Intervention immédiate', price: 7000, minimum: 7000 },
} as const;
export type Offer = keyof typeof OFFERS;
export const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
export function text(value: unknown, max: number, required = true): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if ((required && !s) || s.length > max) fail(400, 'Un champ est manquant ou trop long.');
  return s;
}
export function offer(value: unknown): Offer {
  if (typeof value !== 'string' || !Object.hasOwn(OFFERS, value)) fail(400, 'Formule invalide.');
  return value as Offer;
}
export function slotTimes(start: string, end: string, now = Date.now()) {
  const a = new Date(start), b = new Date(end), duration = b.getTime() - a.getTime();
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()) || a.getTime() <= now || a.getTime() > now + 120 * 86400000 ||
    a.toISOString().slice(0, 10) !== b.toISOString().slice(0, 10) || a.getUTCHours() < 8 || b.getUTCHours() > 18 ||
    (b.getUTCHours() === 18 && (b.getUTCMinutes() || b.getUTCSeconds())) || duration < 30 * 60000 || duration > 4 * 3600000) {
    fail(400, 'Choisissez un créneau futur de 30 minutes à 4 heures, entre 8 h et 18 h (Abidjan).');
  }
  return [a.toISOString(), b.toISOString()];
}
export const REPORT_FIELDS = ['controls', 'codes', 'measurements', 'conclusion', 'recommendations', 'maintenanceDone', 'maintenanceNext'] as const;
export function reportData(body: any) {
  const r = Object.fromEntries(REPORT_FIELDS.map(k => [k, text(body?.[k], 8000, ['controls', 'conclusion', 'recommendations', 'maintenanceNext'].includes(k))]));
  return r;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS diagnostic_config (id INTEGER PRIMARY KEY CHECK(id=1), data JSONB NOT NULL);
INSERT INTO diagnostic_config VALUES (1, '{"enabled":false,"centreAddress":"","supportPhone":"","terms":"","immediateEnabled":false}') ON CONFLICT DO NOTHING;
-- Initial contact details supplied by the operator; preserve existing administrative edits.
UPDATE diagnostic_config SET data = data || jsonb_build_object(
 'centreAddress', COALESCE(NULLIF(data->>'centreAddress',''),'Cocody L100,118 — rond-point Allocodrome, Abidjan'),
 'supportPhone', COALESCE(NULLIF(data->>'supportPhone',''),'+2250141116026'),
 'supportWhatsApp', '+2250707312797'
) WHERE id=1 AND NOT (data ? 'supportWhatsApp');
CREATE TABLE IF NOT EXISTS diagnostic_staff (phone TEXT PRIMARY KEY, name TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS diagnostic_slots (
 id UUID PRIMARY KEY, staff_phone TEXT NOT NULL REFERENCES diagnostic_staff(phone), kind TEXT NOT NULL CHECK(kind IN ('centre','domicile','immediat')),
 starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true, CHECK(ends_at>starts_at));
CREATE INDEX IF NOT EXISTS diagnostic_slots_date ON diagnostic_slots(starts_at);
CREATE TABLE IF NOT EXISTS diagnostic_bookings (
 id UUID PRIMARY KEY, reference TEXT UNIQUE NOT NULL, phone TEXT NOT NULL, request_key UUID NOT NULL,
 slot_id UUID NOT NULL REFERENCES diagnostic_slots(id), kind TEXT NOT NULL, price INTEGER NOT NULL, minimum INTEGER NOT NULL,
 paid INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'held', expires_at TIMESTAMPTZ NOT NULL,
 customer JSONB NOT NULL, vehicle JSONB NOT NULL, address TEXT NOT NULL, symptoms TEXT NOT NULL,
 terms_snapshot TEXT NOT NULL, centre_snapshot TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 report JSONB, published_at TIMESTAMPTZ, report_version INTEGER NOT NULL DEFAULT 0,
 payment_review BOOLEAN NOT NULL DEFAULT false, UNIQUE(phone,request_key));
CREATE INDEX IF NOT EXISTS diagnostic_bookings_phone ON diagnostic_bookings(phone);
CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_slot_occupied ON diagnostic_bookings(slot_id) WHERE state IN ('held','reserved','in_progress','completed','cancel_requested');
CREATE TABLE IF NOT EXISTS diagnostic_payments (
 reference TEXT PRIMARY KEY, booking_id UUID NOT NULL REFERENCES diagnostic_bookings(id), amount INTEGER NOT NULL CHECK(amount>0),
 status TEXT NOT NULL DEFAULT 'creating', provider_id TEXT, redirect_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), confirmed_at TIMESTAMPTZ, checked_at TIMESTAMPTZ);
CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_one_payment ON diagnostic_payments(booking_id) WHERE status IN ('creating','pending','unknown');
CREATE TABLE IF NOT EXISTS diagnostic_files (
 id UUID PRIMARY KEY, booking_id UUID NOT NULL REFERENCES diagnostic_bookings(id), name TEXT NOT NULL, mime TEXT NOT NULL, content BYTEA NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS diagnostic_events (
 id BIGSERIAL PRIMARY KEY, booking_id UUID REFERENCES diagnostic_bookings(id), actor TEXT NOT NULL, action TEXT NOT NULL,
 detail JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
`;
const occupied = "('held','reserved','in_progress','completed','cancel_requested')";
export class DiagnosticService {
  constructor(public pool: Pool) {}
  async init() { await this.pool.query(SCHEMA); }
  async tx<T>(work: (q: PoolClient) => Promise<T>): Promise<T> {
    const q = await this.pool.connect();
    try {
      await q.query('BEGIN');
      // One cross-process lock: booking, cancellation, payment and slot edits share a consistent lock order.
      await q.query("SELECT pg_advisory_xact_lock(hashtext('diagassist-diagnostic-bookings'))");
      const value = await work(q); await q.query('COMMIT'); return value;
    } catch (e) { await q.query('ROLLBACK'); throw e; } finally { q.release(); }
  }
  async config() { return (await this.pool.query('SELECT data FROM diagnostic_config WHERE id=1')).rows[0].data; }
  async event(q: PoolClient, id: string | null, actor: string, action: string, detail = {}) {
    await q.query('INSERT INTO diagnostic_events(booking_id,actor,action,detail) VALUES($1,$2,$3,$4)', [id, actor, action, JSON.stringify(detail)]);
  }
  async expire(q: PoolClient) {
    await q.query("UPDATE diagnostic_bookings SET state='expired' WHERE state='held' AND expires_at<now()");
  }
  async slots(kind: Offer, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'Date invalide.');
    await this.tx(q => this.expire(q));
    return (await this.pool.query(`SELECT s.id,s.starts_at,s.ends_at FROM diagnostic_slots s JOIN diagnostic_staff t ON t.phone=s.staff_phone
      WHERE s.kind=$1 AND s.enabled AND t.active AND s.starts_at>now() AND (s.starts_at AT TIME ZONE 'UTC')::date=$2::date
      AND ($1<>'immediat' OR s.starts_at<=now()+interval '60 minutes')
      AND NOT EXISTS(SELECT 1 FROM diagnostic_bookings b WHERE b.slot_id=s.id AND b.state IN ${occupied}) ORDER BY s.starts_at`, [kind, date])).rows;
  }
  async reserve(phone: string, body: any) {
    const kind = offer(body.kind), key = text(body.requestKey, 36);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) fail(400, 'Identifiant de demande invalide.');
    const customer = { name: text(body.name, 100) };
    const vehicle = { brand: text(body.brand, 60), model: text(body.model, 80), year: Number(body.year), registration: text(body.registration, 30, false), mileage: text(body.mileage, 20, false) };
    if (!Number.isInteger(vehicle.year) || vehicle.year < 1950 || vehicle.year > new Date().getUTCFullYear() + 1) fail(400, 'Année du véhicule invalide.');
    const address = text(body.address, 700, kind !== 'centre'), symptoms = text(body.symptoms, 2000);
    if (body.acceptTerms !== true) fail(400, 'Veuillez lire et accepter les conditions de réservation.');
    return this.tx(async q => {
      await this.expire(q);
      const old = (await q.query('SELECT id FROM diagnostic_bookings WHERE phone=$1 AND request_key=$2', [phone, key])).rows[0];
      if (old) return old;
      const cfg = (await q.query('SELECT data FROM diagnostic_config WHERE id=1')).rows[0].data;
      if (!cfg.enabled || !cfg.terms || !cfg.supportPhone || (kind === 'centre' && !cfg.centreAddress) || (kind === 'immediat' && !cfg.immediateEnabled)) fail(409, 'Cette formule n’est pas encore ouverte à la réservation.');
      const s = (await q.query(`SELECT s.* FROM diagnostic_slots s JOIN diagnostic_staff t ON t.phone=s.staff_phone WHERE s.id=$1 AND s.enabled AND t.active AND s.starts_at>now()`, [text(body.slotId, 36)])).rows[0];
      if (!s || s.kind !== kind || (kind === 'immediat' && new Date(s.starts_at).getTime() > Date.now() + 3600000)) fail(409, 'Ce créneau n’est plus disponible.');
      if ((await q.query(`SELECT id FROM diagnostic_bookings WHERE slot_id=$1 AND state IN ${occupied}`, [s.id])).rowCount) fail(409, 'Ce créneau vient d’être réservé. Choisissez-en un autre.');
      if ((await q.query("SELECT id FROM diagnostic_bookings WHERE phone=$1 AND state='held'", [phone])).rowCount) fail(409, 'Finalisez ou annulez votre réservation en attente avant d’en créer une autre.');
      const id = crypto.randomUUID(), reference = `DIAG-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      await q.query(`INSERT INTO diagnostic_bookings(id,reference,phone,request_key,slot_id,kind,price,minimum,expires_at,customer,vehicle,address,symptoms,terms_snapshot,centre_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,LEAST(now()+interval '30 minutes',$9::timestamptz),$10,$11,$12,$13,$14,$15)`,
        [id, reference, phone, key, s.id, kind, OFFERS[kind].price, OFFERS[kind].minimum, s.starts_at, JSON.stringify(customer), JSON.stringify(vehicle), address, symptoms, cfg.terms, cfg.centreAddress]);
      await this.event(q, id, phone, 'reservation_created');
      return { id };
    });
  }
  async booking(id: string) {
    const r = (await this.pool.query(`SELECT b.*,s.starts_at,s.ends_at,s.staff_phone,t.name AS technician FROM diagnostic_bookings b
      JOIN diagnostic_slots s ON s.id=b.slot_id JOIN diagnostic_staff t ON t.phone=s.staff_phone WHERE b.id=$1`, [id])).rows[0];
    if (!r) fail(404, 'Réservation introuvable.'); return r;
  }
  async isStaff(phone: string) { return !!(await this.pool.query('SELECT phone FROM diagnostic_staff WHERE phone=$1 AND active', [phone])).rowCount; }
  async clientBooking(id: string, phone: string) { const b = await this.booking(id); if (b.phone !== phone) fail(404, 'Réservation introuvable.'); return b; }
  canReadReport(b: any) { return b.paid >= b.price && !!b.published_at && b.state === 'completed'; }
  publicBooking(b: any) {
    const { report, staff_phone, ...safe } = b;
    return { ...safe, report: this.canReadReport(b) ? report : null, reportsUnlocked: this.canReadReport(b), balance: Math.max(0, b.price - b.paid) };
  }
  async list(phone?: string, staff?: string) {
    await this.tx(q => this.expire(q));
    return (await this.pool.query(`SELECT b.*,s.starts_at,s.ends_at,s.staff_phone,t.name AS technician FROM diagnostic_bookings b
      JOIN diagnostic_slots s ON s.id=b.slot_id JOIN diagnostic_staff t ON t.phone=s.staff_phone
      WHERE ($1::text IS NULL OR b.phone=$1) AND ($2::text IS NULL OR s.staff_phone=$2) ORDER BY b.created_at DESC LIMIT 200`, [phone || null, staff || null])).rows;
  }
  async paymentStart(id: string, phone: string, mode: string) {
    return this.tx(async q => {
      await this.expire(q);
      const b = (await q.query('SELECT * FROM diagnostic_bookings WHERE id=$1 AND phone=$2', [id, phone])).rows[0];
      if (!b) fail(404, 'Réservation introuvable.');
      if (!['held', 'reserved', 'in_progress', 'completed'].includes(b.state)) fail(409, 'Cette réservation ne peut plus recevoir de paiement. Contactez l’équipe.');
      const existing = (await q.query("SELECT * FROM diagnostic_payments WHERE booking_id=$1 AND status IN ('creating','pending','unknown')", [id])).rows[0];
      if (existing) return { ...existing, existing: true };
      const due = b.price - b.paid;
      const amount = mode === 'deposit' && b.paid < b.minimum ? b.minimum - b.paid : due;
      if (amount <= 0) fail(409, 'Le montant demandé est déjà réglé.');
      const reference = `dgdi-${crypto.randomUUID()}`;
      await q.query('INSERT INTO diagnostic_payments(reference,booking_id,amount) VALUES($1,$2,$3)', [reference, id, amount]);
      await this.event(q, id, phone, 'payment_created', { reference, amount });
      return { reference, booking_id: id, amount, existing: false };
    });
  }
  async settle(reference: string, succeeded: boolean) {
    return this.tx(async q => {
      const p = (await q.query('SELECT * FROM diagnostic_payments WHERE reference=$1', [reference])).rows[0];
      if (!p || p.status === 'success') return;
      if (!succeeded) { await q.query("UPDATE diagnostic_payments SET status='failed' WHERE reference=$1 AND status<>'success'", [reference]); return; }
      const b = (await q.query('SELECT * FROM diagnostic_bookings WHERE id=$1', [p.booking_id])).rows[0];
      const total = Number(b.paid) + Number(p.amount);
      const late = ['expired','cancelled','cancel_requested','refund_due','review'].includes(b.state) || (b.state === 'held' && new Date(b.expires_at).getTime() <= Date.now());
      const state = late ? 'review' : b.state === 'held' && total >= b.minimum ? 'reserved' : b.state;
      await q.query("UPDATE diagnostic_payments SET status='success',confirmed_at=now() WHERE reference=$1", [reference]);
      await q.query('UPDATE diagnostic_bookings SET paid=$2,state=$3,payment_review=payment_review OR $4 WHERE id=$1', [b.id, total, state, late || total > b.price]);
      await this.event(q, b.id, 'jeko', 'payment_confirmed', { reference, amount: p.amount, review: late || total > b.price });
    });
  }
  async cancel(id: string, phone: string) {
    return this.tx(async q => {
      const b = (await q.query('SELECT * FROM diagnostic_bookings WHERE id=$1 AND phone=$2', [id, phone])).rows[0];
      if (!b) fail(404, 'Réservation introuvable.');
      if (!['held','reserved'].includes(b.state)) fail(409, 'Contactez l’équipe pour modifier cette intervention.');
      await q.query('UPDATE diagnostic_bookings SET state=$2 WHERE id=$1', [id, b.paid > 0 ? 'cancel_requested' : 'cancelled']);
      await this.event(q, id, phone, 'cancellation_requested');
    });
  }
  async saveReport(id: string, actor: string, body: any) {
    const report = reportData(body);
    return this.tx(async q => {
      const b = (await q.query('SELECT * FROM diagnostic_bookings WHERE id=$1', [id])).rows[0];
      if (!b || !['in_progress','completed'].includes(b.state)) fail(409, 'Démarrez l’intervention avant de saisir le rapport.');
      if (b.published_at) fail(409, 'Le rapport publié est conservé. Contactez l’administration pour un rectificatif.');
      await q.query(`UPDATE diagnostic_bookings SET report=$2,report_version=report_version+1,
        published_at=CASE WHEN $3 THEN now() ELSE NULL END,state=CASE WHEN $3 THEN 'completed' ELSE state END WHERE id=$1`, [id, JSON.stringify(report), body.publish === true]);
      await this.event(q, id, actor, body.publish ? 'report_published' : 'report_draft_saved');
    });
  }
}
