import crypto from 'node:crypto';
import type { Express } from 'express';
import type { Pool } from 'pg';
import rateLimit from 'express-rate-limit';
import PDFDocument from 'pdfkit';
import { DiagnosticService, OFFERS, fail, offer, slotTimes, text } from './core';

const METHODS = ['wave','orange','mtn','moov'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ready = () => !!(process.env.JEKO_API_KEY && process.env.JEKO_API_KEY_ID && process.env.JEKO_STORE_ID && (process.env.JEKO_WEBHOOK_SECRETS || process.env.JEKO_WEBHOOK_SECRET));
async function provider(path: string, body?: any) {
  return fetch('https://api.jeko.africa/partner_api/payment_requests' + path, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': process.env.JEKO_API_KEY!, 'X-API-KEY-ID': process.env.JEKO_API_KEY_ID! },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
export async function makeDiagnosticPdf(b: any, kind: 'diagnostic' | 'entretien' | 'receipt', payments: any[] = []): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `DiagAssist - ${kind} - ${b.reference}` } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => { doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  // Standard PDF Helvetica covers French; strip unsupported emoji from user-entered text.
  const clean = (v: any) => String(v ?? '').replace(/[^\x09\x0A\x0D\x20-\xFF]/g, ' ');
  doc.fillColor('#df2635').fontSize(25).text('DiagAssist');
  doc.fillColor('#17202d').fontSize(18).text(kind === 'receipt' ? 'Reçu de paiement' : kind === 'entretien' ? 'Rapport d’entretien' : 'Rapport de diagnostic');
  doc.moveDown().fontSize(10).text(`Référence : ${b.reference}`);
  doc.text(clean(`Client : ${b.customer.name} - ${b.phone}`));
  doc.text(clean(`Véhicule : ${b.vehicle.brand} ${b.vehicle.model} (${b.vehicle.year}) - ${b.vehicle.registration || 'Immatriculation non renseignée'}`));
  doc.text(clean(`Kilométrage : ${b.vehicle.mileage || 'Non renseigné'}`));
  doc.text(`Rendez-vous : ${new Date(b.starts_at).toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' })} (Abidjan)`);
  doc.text(clean(`Technicien : ${b.technician}`));
  doc.moveDown();
  const section = (title: string, value: any) => {
    if (doc.y > 690) doc.addPage();
    doc.fontSize(12).fillColor('#df2635').text(title); doc.fontSize(10).fillColor('#17202d').text(clean(value || 'Non renseigné'), { lineGap: 3 }); doc.moveDown();
  };
  if (kind === 'receipt') {
    section('Prestation', OFFERS[b.kind as keyof typeof OFFERS].label);
    section('Montants en F CFA', `Prix : ${b.price} F\nReçu : ${b.paid} F\nSolde : ${Math.max(0, b.price - b.paid)} F`);
    payments.filter(p => p.status === 'success').forEach(p => section(p.reference, `${p.amount} F - ${new Date(p.confirmed_at).toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' })}`));
    section('Statut de la réservation', b.state === 'review' ? 'Paiement reçu, intervention à régulariser avec l’équipe.' : b.state);
  } else {
    section('Motif de la demande', b.symptoms);
    if (kind === 'diagnostic') {
      section('Contrôles réalisés', b.report.controls); section('Codes défaut relevés', b.report.codes || 'Aucun code renseigné');
      section('Mesures et observations', b.report.measurements); section('Conclusion du technicien', b.report.conclusion); section('Recommandations', b.report.recommendations);
    } else { section('Entretien effectué / état constaté', b.report.maintenanceDone || 'Aucune opération d’entretien déclarée.'); section('Entretien recommandé et échéances', b.report.maintenanceNext); }
    section('Traçabilité', `Rapport version ${b.report_version}, publié le ${new Date(b.published_at).toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' })}.\nLes conclusions portent sur les contrôles effectivement réalisés et indiqués dans ce rapport.`);
  }
  doc.fontSize(8).fillColor('#64748b').text('Propulsé par NTIC STRATEGY • DiagAssist'); doc.end(); return result;
}

export async function registerDiagnostic(app: Express, deps: { pool: Pool | null; requireAuth: any; requireAdminAuth: any; isAdmin: (phone: string) => boolean }) {
  const base = '/api/diagnostic';
  const limiter = rateLimit({ windowMs: 60000, limit: 90, standardHeaders: true, legacyHeaders: false });
  app.use(base, limiter, (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  if (!deps.pool) {
    app.use(base, (_req, res) => res.status(503).json({ success: false, message: 'Le service de réservation nécessite une connexion à la base de données.' }));
    return undefined;
  }
  const svc = new DiagnosticService(deps.pool); await svc.init();
  app.use(base, (req, _res, next) => {
    const id = req.path.match(/\/(?:bookings|slots|files)\/([^/]+)/)?.[1];
    if (id && !UUID.test(id)) return next(Object.assign(new Error('Identifiant invalide.'), { status: 400 })); next();
  });
  const staff = [deps.requireAuth, async (req: any, _res: any, next: any) => {
    try { req.diagnosticAdmin = deps.isAdmin(req.session.phone); if (!req.diagnosticAdmin && !await svc.isStaff(req.session.phone)) fail(403, 'Accès réservé à l’équipe diagnostic.'); next(); } catch (e) { next(e); }
  }];
  const staffBooking = async (req: any) => { const b = await svc.booking(req.params.id); if (!req.diagnosticAdmin && b.staff_phone !== req.session.phone) fail(403, 'Cette intervention ne vous est pas affectée.'); return b; };
  const paymentList = async (id: string) => (await svc.pool.query('SELECT reference,amount,status,confirmed_at,created_at FROM diagnostic_payments WHERE booking_id=$1 ORDER BY created_at DESC', [id])).rows;
  app.get(base + '/config', async (_req, res) => { res.json({ success: true, config: await svc.config(), offers: OFFERS, paymentsReady: ready() }); });
  app.get(base + '/slots', async (req, res) => { res.json({ success: true, slots: await svc.slots(offer(req.query.kind), String(req.query.date || '')) }); });
  app.get(base + '/me', deps.requireAuth, async (req: any, res) => { res.json({ success: true, phone: req.session.phone, admin: deps.isAdmin(req.session.phone), staff: await svc.isStaff(req.session.phone) }); });
  app.post(base + '/bookings', deps.requireAuth, async (req: any, res) => {
    if (!ready()) fail(503, 'Le paiement en ligne n’est pas disponible actuellement.');
    res.status(201).json({ success: true, ...await svc.reserve(req.session.phone, req.body) });
  });
  app.get(base + '/bookings', deps.requireAuth, async (req: any, res) => { res.json({ success: true, bookings: (await svc.list(req.session.phone)).map(b => svc.publicBooking(b)) }); });
  app.get(base + '/bookings/:id', deps.requireAuth, async (req: any, res) => {
    await svc.tx(q => svc.expire(q)); const b = await svc.clientBooking(req.params.id, req.session.phone);
    res.json({ success: true, booking: svc.publicBooking(b), payments: await paymentList(b.id), files: svc.canReadReport(b) ? (await svc.pool.query('SELECT id,name,mime FROM diagnostic_files WHERE booking_id=$1', [b.id])).rows : [] });
  });
  app.post(base + '/bookings/:id/cancel', deps.requireAuth, async (req: any, res) => { await svc.cancel(req.params.id, req.session.phone); res.json({ success: true }); });

  app.post(base + '/bookings/:id/pay', deps.requireAuth, async (req: any, res) => {
    if (!ready()) fail(503, 'Paiement indisponible.');
    const method = String(req.body.method || ''); if (!METHODS.includes(method)) fail(400, 'Choisissez un moyen de paiement.');
    if (!['deposit','full'].includes(req.body.mode)) fail(400, 'Choisissez acompte ou totalité.');
    const p = await svc.paymentStart(req.params.id, req.session.phone, req.body.mode);
    if (p.existing) {
      if (p.redirect_url && p.status === 'pending') return res.json({ success: true, reference: p.reference, redirectUrl: p.redirect_url });
      fail(409, 'Un paiement est en cours de vérification. Actualisez son statut avant de recommencer.');
    }
    const origin = (process.env.DIAGNOSTIC_PUBLIC_URL || 'https://www.diagassist.app/diagnostic').replace(/\/$/, '');
    const returnUrl = `${origin}?booking=${p.booking_id}&payment=${p.reference}`;
    try {
      const response = await provider('', { storeId: process.env.JEKO_STORE_ID, amountCents: p.amount * 100, currency: 'XOF', reference: p.reference,
        paymentDetails: { type: 'redirect', data: { paymentMethod: method, successUrl: returnUrl, errorUrl: returnUrl } } });
      if (!response.ok) {
        // A definitive 4xx refusal may be retried; uncertain 5xx/network outcomes require reconciliation.
        await svc.pool.query('UPDATE diagnostic_payments SET status=$2 WHERE reference=$1 AND status=\'creating\'', [p.reference, response.status < 500 ? 'failed' : 'unknown']);
        fail(502, 'Le prestataire de paiement n’a pas pu ouvrir la demande. Vérifiez son statut avant de réessayer.');
      }
      const data: any = await response.json();
      if (!data.id || !data.redirectUrl || new URL(data.redirectUrl).protocol !== 'https:') fail(502, 'Réponse du prestataire de paiement invalide.');
      await svc.pool.query("UPDATE diagnostic_payments SET provider_id=$2,redirect_url=$3,status=CASE WHEN status='creating' THEN 'pending' ELSE status END WHERE reference=$1", [p.reference, data.id, data.redirectUrl]);
      res.json({ success: true, reference: p.reference, redirectUrl: data.redirectUrl });
    } catch (e) {
      await svc.pool.query("UPDATE diagnostic_payments SET status='unknown' WHERE reference=$1 AND status='creating'", [p.reference]); throw e;
    }
  });
  async function reconcile(reference: string) {
    const p = (await svc.pool.query('SELECT * FROM diagnostic_payments WHERE reference=$1', [reference])).rows[0];
    if (!p || p.status === 'success' || !p.provider_id || !ready()) return;
    // Reserve the polling window in DB, including across instances. Webhooks are not throttled.
    const claimed = await svc.pool.query("UPDATE diagnostic_payments SET checked_at=now() WHERE reference=$1 AND (checked_at IS NULL OR checked_at<now()-interval '60 seconds') RETURNING reference", [reference]);
    if (!claimed.rowCount) return;
    const response = await provider('/' + encodeURIComponent(p.provider_id)); if (!response.ok) return;
    const data: any = await response.json();
    if (data.id !== p.provider_id || data.reference !== p.reference || data.storeId !== process.env.JEKO_STORE_ID) return;
    const state = String(data.status).toLowerCase();
    if (['success','completed'].includes(state) && Number(data.transaction?.amount?.amount) === p.amount * 100 && data.transaction?.amount?.currency === 'XOF') await svc.settle(reference, true);
    else if (['failed','error','cancelled','canceled'].includes(state)) await svc.settle(reference, false);
  }
  app.post(base + '/bookings/:id/reconcile', deps.requireAuth, async (req: any, res) => {
    await svc.clientBooking(req.params.id, req.session.phone);
    const pending = (await svc.pool.query("SELECT reference FROM diagnostic_payments WHERE booking_id=$1 AND status<>'success' ORDER BY created_at DESC LIMIT 5", [req.params.id])).rows;
    for (const p of pending) await reconcile(p.reference);
    res.json({ success: true });
  });
  app.get(base + '/bookings/:id/pdf/:kind', deps.requireAuth, async (req: any, res) => {
    const b = await svc.clientBooking(req.params.id, req.session.phone), kind = req.params.kind;
    if (!['diagnostic','entretien','receipt'].includes(kind)) fail(404, 'Document inconnu.');
    if (kind !== 'receipt' && !svc.canReadReport(b)) fail(402, 'Le rapport sera accessible après publication et confirmation du paiement intégral.');
    if (kind === 'receipt' && !b.paid) fail(409, 'Aucun paiement confirmé.');
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${b.reference}-${kind}.pdf"`);
    res.send(await makeDiagnosticPdf(b, kind, await paymentList(b.id)));
  });
  app.get(base + '/bookings/:id/files/:fileId', deps.requireAuth, async (req: any, res) => {
    const b = await svc.clientBooking(req.params.id, req.session.phone);
    if (!svc.canReadReport(b)) fail(402, 'Résultats verrouillés jusqu’au paiement intégral et à leur publication.');
    if (!UUID.test(req.params.fileId)) fail(400, 'Document invalide.');
    const f = (await svc.pool.query('SELECT * FROM diagnostic_files WHERE id=$1 AND booking_id=$2', [req.params.fileId, b.id])).rows[0];
    if (!f) fail(404, 'Document introuvable.');
    res.setHeader('Content-Type', f.mime); res.setHeader('Content-Disposition', `attachment; filename="scanner-${f.id}.${f.mime === 'application/pdf' ? 'pdf' : f.mime === 'image/png' ? 'png' : 'jpg'}"`); res.send(f.content);
  });

  app.get(base + '/team/bookings', ...staff, async (req: any, res) => { res.json({ success: true, bookings: await svc.list(undefined, req.diagnosticAdmin ? undefined : req.session.phone) }); });
  app.post(base + '/team/bookings/:id/start', ...staff, async (req: any, res) => {
    await staffBooking(req);
    await svc.tx(async q => {
      const changed = await q.query("UPDATE diagnostic_bookings SET state='in_progress' WHERE id=$1 AND state='reserved' AND paid>=minimum RETURNING id", [req.params.id]);
      if (!changed.rowCount) fail(409, 'La réservation doit être confirmée par paiement avant de démarrer.');
      await svc.event(q, req.params.id, req.session.phone, 'intervention_started');
    }); res.json({ success: true });
  });
  app.post(base + '/team/bookings/:id/report', ...staff, async (req: any, res) => { await staffBooking(req); await svc.saveReport(req.params.id, req.session.phone, req.body); res.json({ success: true }); });
  app.post(base + '/team/bookings/:id/files', ...staff, async (req: any, res) => {
    await staffBooking(req);
    const name = text(req.body.name, 120), mime = text(req.body.mime, 50), encoded = text(req.body.data, 1400000);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail(400, 'Fichier invalide.');
    const data = Buffer.from(encoded, 'base64');
    const good = mime === 'application/pdf' ? data.subarray(0, 5).toString() === '%PDF-' : mime === 'image/jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255 : mime === 'image/png' && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if (!good || data.length > 1024 * 1024) fail(400, 'Joignez un PDF, JPEG ou PNG de moins de 1 Mo.');
    await svc.tx(async q => {
      const b = (await q.query('SELECT state,published_at FROM diagnostic_bookings WHERE id=$1', [req.params.id])).rows[0];
      if (!b || b.state !== 'in_progress' || b.published_at) fail(409, 'Ajoutez les pièces avant de publier le rapport.');
      if (Number((await q.query('SELECT count(*) AS n FROM diagnostic_files WHERE booking_id=$1', [req.params.id])).rows[0].n) >= 8) fail(400, 'Huit pièces jointes maximum.');
      await q.query('INSERT INTO diagnostic_files(id,booking_id,name,mime,content) VALUES($1,$2,$3,$4,$5)', [crypto.randomUUID(), req.params.id, name, mime, data]);
      await svc.event(q, req.params.id, req.session.phone, 'scanner_file_added', { name });
    }); res.json({ success: true });
  });

  app.get(base + '/admin/setup', deps.requireAdminAuth, async (_req, res) => {
    res.json({ success: true, config: await svc.config(), staff: (await svc.pool.query('SELECT * FROM diagnostic_staff ORDER BY name')).rows,
      slots: (await svc.pool.query('SELECT * FROM diagnostic_slots WHERE starts_at>now()-interval \'7 days\' ORDER BY starts_at LIMIT 500')).rows });
  });
  app.post(base + '/admin/config', deps.requireAdminAuth, async (req, res) => {
    const data = { enabled: req.body.enabled === true, immediateEnabled: req.body.immediateEnabled === true,
      centreAddress: text(req.body.centreAddress, 700, false), supportPhone: text(req.body.supportPhone, 30, false), terms: text(req.body.terms, 10000, false) };
    if (data.supportPhone && !/^\+225\d{10}$/.test(data.supportPhone)) fail(400, 'Contact attendu au format +225 suivi de 10 chiffres.');
    if (data.enabled && (!data.supportPhone || !data.terms || !ready())) fail(400, 'Renseignez le contact, les conditions et configurez Jèko avant d’ouvrir les réservations.');
    await svc.tx(async q => { await q.query('UPDATE diagnostic_config SET data=$1 WHERE id=1', [JSON.stringify(data)]); await svc.event(q, null, 'admin', 'config_updated'); }); res.json({ success: true });
  });
  app.post(base + '/admin/staff', deps.requireAdminAuth, async (req, res) => {
    const phone = text(req.body.phone, 30), name = text(req.body.name, 100);
    if (!/^\+225\d{10}$/.test(phone)) fail(400, 'Numéro attendu au format +225 suivi de 10 chiffres.');
    if (!(await svc.pool.query('SELECT phone FROM accounts WHERE phone=$1', [phone])).rowCount) fail(400, 'Ce technicien doit d’abord créer son compte DiagAssist.');
    await svc.tx(async q => { await q.query('INSERT INTO diagnostic_staff(phone,name,active) VALUES($1,$2,$3) ON CONFLICT(phone) DO UPDATE SET name=$2,active=$3', [phone, name, req.body.active !== false]); await svc.event(q, null, 'admin', 'staff_updated', { phone }); }); res.json({ success: true });
  });
  app.post(base + '/admin/slots', deps.requireAdminAuth, async (req, res) => {
    const kind = offer(req.body.kind), [start, end] = slotTimes(req.body.start, req.body.end), phone = text(req.body.phone, 30);
    await svc.tx(async q => {
      if (!(await q.query('SELECT phone FROM diagnostic_staff WHERE phone=$1 AND active', [phone])).rowCount) fail(400, 'Technicien indisponible.');
      if ((await q.query('SELECT id FROM diagnostic_slots WHERE staff_phone=$1 AND enabled AND starts_at<$3 AND ends_at>$2', [phone, start, end])).rowCount) fail(409, 'Ce technicien a déjà un créneau sur cette période. Incluez le déplacement dans la durée.');
      await q.query('INSERT INTO diagnostic_slots(id,staff_phone,kind,starts_at,ends_at) VALUES($1,$2,$3,$4,$5)', [crypto.randomUUID(), phone, kind, start, end]); await svc.event(q, null, 'admin', 'slot_created', { phone, start, end });
    }); res.json({ success: true });
  });
  app.post(base + '/admin/slots/:id/close', deps.requireAdminAuth, async (req, res) => {
    await svc.tx(async q => { await svc.expire(q); if ((await q.query("SELECT id FROM diagnostic_bookings WHERE slot_id=$1 AND state IN ('held','reserved','in_progress','cancel_requested')", [req.params.id])).rowCount) fail(409, 'Traitez la réservation avant de fermer ce créneau.'); await q.query('UPDATE diagnostic_slots SET enabled=false WHERE id=$1', [req.params.id]); }); res.json({ success: true });
  });
  app.post(base + '/admin/bookings/:id/cancel', deps.requireAdminAuth, async (req, res) => {
    const reason = text(req.body.reason, 500);
    await svc.tx(async q => {
      const b = (await q.query('SELECT * FROM diagnostic_bookings WHERE id=$1', [req.params.id])).rows[0];
      if (!b || ['completed','refund_due','cancelled'].includes(b.state)) fail(409, 'Annulation non disponible.');
      await q.query("UPDATE diagnostic_bookings SET state=CASE WHEN paid>0 THEN 'refund_due' ELSE 'cancelled' END,payment_review=paid>0 WHERE id=$1", [b.id]);
      await svc.event(q, b.id, 'admin', 'booking_cancelled', { reason });
    }); res.json({ success: true });
  });
  app.get(base + '/admin/bookings/:id/events', deps.requireAdminAuth, async (req, res) => { res.json({ success: true, events: (await svc.pool.query('SELECT actor,action,detail,created_at FROM diagnostic_events WHERE booking_id=$1 ORDER BY id', [req.params.id])).rows }); });
  // Called only after the existing Jèko endpoint has verified the HMAC over the raw body.
  return {
    async webhook(body: any) {
      const reference = String(body?.transactionDetails?.reference || body?.reference || '');
      if (!reference.startsWith('dgdi-')) return false;
      const p = (await svc.pool.query('SELECT * FROM diagnostic_payments WHERE reference=$1', [reference])).rows[0];
      if (!p) fail(503, 'Paiement non encore enregistré.');
      if (body.transactionType !== 'PaymentRequest' || Number(body?.amount?.amount) !== p.amount * 100 || body?.amount?.currency !== 'XOF' || !body.transactionDetails?.id || (p.provider_id && body.transactionDetails.id !== p.provider_id)) fail(400, 'Notification de paiement incohérente.');
      const status = String(body.status || '').toLowerCase();
      await svc.pool.query('UPDATE diagnostic_payments SET provider_id=COALESCE(provider_id,$2) WHERE reference=$1', [reference, body.transactionDetails.id]);
      if (['success','completed'].includes(status)) await svc.settle(reference, true);
      else if (['error','failed','cancelled','canceled'].includes(status)) await svc.settle(reference, false);
      return true;
    },
  };
}
