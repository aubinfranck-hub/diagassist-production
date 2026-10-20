import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { Pool } from 'pg';
import { DiagnosticService, OFFERS, slotTimes } from '../src/modules/diagnostic/core';
import { registerDiagnostic, makeDiagnosticPdf } from '../src/modules/diagnostic/routes';
import { registerJekoPayments } from '../src/modules/payments/jeko.routes';
import { catchAsyncRoutes } from '../src/modules/security/runtime';

test('diagnostic deposits are rounded up, hours include Sunday, reports require full payment', () => {
  assert.equal(OFFERS.centre.minimum, 1000); assert.equal(OFFERS.domicile.minimum, 2000); assert.equal(OFFERS.immediat.minimum, 7000);
  const now = Date.parse('2026-10-19T00:00:00Z');
  assert.equal(slotTimes('2026-10-25T08:00Z', '2026-10-25T09:00Z', now)[0], '2026-10-25T08:00:00.000Z');
  for (const [a,b] of [['07:59','09:00'],['17:30','18:01'],['10:00','10:15']]) assert.throws(()=>slotTimes(`2026-10-25T${a}Z`,`2026-10-25T${b}Z`,now));
  const svc = new DiagnosticService(null as any);
  const b = {price:5000,paid:2000,state:'completed',published_at:new Date(),report:{conclusion:'private'},staff_phone:'private'};
  assert.equal(svc.publicBooking(b).report,null); assert.equal('staff_phone' in svc.publicBooking(b),false);
  assert.equal(svc.canReadReport({...b,paid:5000}),true);
  assert.equal(svc.canReadReport({...b,paid:5000,published_at:null}),false);
});

test('diagnostic PostgreSQL: booking race, verified deposit, balance, report access and late payments', {skip:!process.env.TEST_DATABASE_URL}, async()=>{
  Object.assign(process.env,{NODE_ENV:'test',JEKO_API_KEY:'test',JEKO_API_KEY_ID:'test',JEKO_STORE_ID:'test',JEKO_WEBHOOK_SECRET:'test-secret',JEKO_WEBHOOK_SECRETS:''});
  const root = new Pool({connectionString:process.env.TEST_DATABASE_URL});
  await root.query('DROP SCHEMA IF EXISTS diagnostic_tests CASCADE; CREATE SCHEMA diagnostic_tests');
  const pool = new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path=diagnostic_tests'});
  const svc = new DiagnosticService(pool);
  const app = express(); catchAsyncRoutes(app); app.use(express.json({verify:(req:any,_res,b)=>{req.rawBody=b;}}));
  const auth=(req:any,res:any,next:any)=>{if(!req.headers['x-test-phone'])return res.sendStatus(401); req.session={phone:req.headers['x-test-phone']}; next();};
  const admin=(req:any,res:any,next:any)=> req.headers['x-test-phone']==='admin'?next():res.sendStatus(403);
  const diagnostic=await registerDiagnostic(app,{pool,requireAuth:auth,requireAdminAuth:admin,isAdmin:p=>p==='admin'});
  registerJekoPayments(app,{requireAuth:auth,requireAdminAuth:admin,diagnosticWebhook:diagnostic!.webhook,setUserPlan:()=>{throw new Error('wrong payment handler');},onPlanActivated:()=>{}});
  app.use((e:any,_req:any,res:any,_next:any)=>res.status(e.status||503).json({message:e.message}));
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as any).port}`,nativeFetch=globalThis.fetch;
  const providerRequests:any[]=[];
  globalThis.fetch=(async(input:any,init:any)=>{
    if(String(input).startsWith('https://api.jeko.africa/')) {const body=JSON.parse(init.body);providerRequests.push(body);return new Response(JSON.stringify({id:body.reference,redirectUrl:'https://example.invalid/pay'}));}
    return nativeFetch(input,init);
  }) as typeof fetch;
  const request=(path:string,body?:any,phone='client')=>nativeFetch(url+'/api/diagnostic'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-test-phone':phone},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const webhook=(p:any,amount=p.amount,badSignature=false)=>{
    const body=JSON.stringify({reference:p.reference,status:'success',transactionType:'PaymentRequest',transactionDetails:{id:p.reference},amount:{amount:amount*100,currency:'XOF'}});
    const signature=crypto.createHmac('sha256','test-secret').update(body).digest('hex');
    return nativeFetch(url+'/api/payments/jeko/webhook',{method:'POST',headers:{'Content-Type':'application/json','jeko-signature':badSignature?'invalid':signature},body});
  };
  try {
    await pool.query(`UPDATE diagnostic_config SET data='{"enabled":true,"terms":"Test conditions","supportPhone":"+2250000000001","centreAddress":"Test centre","immediateEnabled":true}'`);
    await pool.query("INSERT INTO diagnostic_staff(phone,name) VALUES('tech','Test technician'),('other','Other technician')");
    const slot=crypto.randomUUID(),date=new Date();date.setUTCDate(date.getUTCDate()+2);date.setUTCHours(9,0,0,0);
    await pool.query("INSERT INTO diagnostic_slots VALUES($1,'tech','domicile',$2,$3,true)",[slot,date,new Date(+date+3600000)]);
    const body={kind:'domicile',requestKey:crypto.randomUUID(),slotId:slot,name:'Test client',brand:'Toyota',model:'Corolla',year:2020,address:'Test address',symptoms:'Test warning light',acceptTerms:true,price:1,minimum:1};
    const race=await Promise.all([request('/bookings',body),request('/bookings',{...body,requestKey:crypto.randomUUID()},'second')]);
    assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
    const winner=race[0].status===201?'client':'second',id=(await race.find(r=>r.status===201)!.json()).id;
    assert.equal((await request(`/bookings/${id}`,undefined,'stranger')).status,404);
    assert.equal((await request(`/team/bookings/${id}/start`,{},'other')).status,403);
    assert.equal((await request(`/team/bookings/${id}/start`,{},'tech')).status,409);
    const created=await request(`/bookings/${id}/pay`,{mode:'deposit',method:'wave',amount:1},winner);assert.equal(created.status,200);
    const p=(await pool.query('SELECT * FROM diagnostic_payments WHERE booking_id=$1',[id])).rows[0];
    assert.equal(p.amount,2000);assert.equal(providerRequests[0].amountCents,200000);
    assert.equal((await request(`/bookings/${id}/pay`,{mode:'deposit',method:'wave'},winner)).status,200);assert.equal(providerRequests.length,1);
    assert.equal((await webhook(p,2000,true)).status,401);assert.equal((await webhook(p,1)).status,400);
    const duplicate=await Promise.all([webhook(p),webhook(p),webhook(p)]);assert.ok(duplicate.every(r=>r.status===200));
    assert.equal((await svc.booking(id)).paid,2000);assert.equal((await svc.booking(id)).state,'reserved');
    assert.equal((await request(`/team/bookings/${id}/start`,{},'tech')).status,200);
    const report={controls:'Scan réalisé',conclusion:'Contrôle nécessaire',recommendations:'Vérifier le circuit',maintenanceNext:'Vidange à prévoir',publish:true};
    assert.equal((await request(`/team/bookings/${id}/report`,report,'tech')).status,200);
    assert.equal((await request(`/bookings/${id}`,undefined,winner).then(r=>r.json())).booking.report,null);
    assert.equal((await request(`/bookings/${id}/pdf/diagnostic`,undefined,winner)).status,402);
    assert.equal((await request(`/bookings/${id}/files/${crypto.randomUUID()}`,undefined,winner)).status,402);
    assert.equal((await request(`/bookings/${id}/pay`,{mode:'full',method:'wave'},winner)).status,200);
    const balance=(await pool.query('SELECT * FROM diagnostic_payments WHERE booking_id=$1 AND status<>\'success\'',[id])).rows[0];assert.equal(balance.amount,3000);
    assert.equal((await webhook(balance)).status,200);
    const visible=await request(`/bookings/${id}`,undefined,winner).then(r=>r.json());assert.equal(visible.booking.report.conclusion,report.conclusion);
    for(const kind of ['diagnostic','entretien','receipt']) {const pdf=await request(`/bookings/${id}/pdf/${kind}`,undefined,winner);assert.equal(pdf.status,200);assert.ok(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).equals(Buffer.from('%PDF-')));}
    assert.equal((await request(`/team/bookings/${id}/report`,report,'tech')).status,409);
    const lateSlot=crypto.randomUUID();await pool.query("INSERT INTO diagnostic_slots VALUES($1,'tech','domicile',$2,$3,true)",[lateSlot,new Date(+date+7200000),new Date(+date+10800000)]);
    const late=await svc.reserve('late',{...body,slotId:lateSlot,requestKey:crypto.randomUUID()});const latePay=await svc.paymentStart(late.id,'late','deposit');
    await pool.query("UPDATE diagnostic_bookings SET expires_at=now()-interval '1 minute' WHERE id=$1",[late.id]);
    await svc.reserve('replacement',{...body,slotId:lateSlot,requestKey:crypto.randomUUID()});await svc.settle(latePay.reference,true);
    assert.equal((await svc.booking(late.id)).state,'review');assert.equal((await svc.booking(late.id)).payment_review,true);
  } finally {globalThis.fetch=nativeFetch;server.closeAllConnections();server.close();await pool.end();await root.end();}
});
