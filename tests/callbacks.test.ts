import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import twilio from "twilio";
import { PGlite } from "@electric-sql/pglite";
import { registerCallbacks } from "../src/modules/callbacks/routes";
import { catchAsyncRoutes } from "../src/modules/security/runtime";

test("callback workflow protects context, permissions, replay and outbound actions", async () => {
  const config = { WHATSAPP_CALLING_ENABLED:"true", WHATSAPP_CALLBACK_PUBLIC_URL:"https://example.test", TWILIO_WHATSAPP_NUMBER:"whatsapp:+2250700000009", WHATSAPP_CALLBACK_SIP:"sip:agent@example.test", WHATSAPP_CALL_PERMISSION_CONTENT_SID:`HX${"a".repeat(32)}`, TWILIO_ACCOUNT_SID:`AC${"a".repeat(32)}`, TWILIO_AUTH_TOKEN:"test-only-token" };
  const previous = Object.fromEntries(Object.keys(config).map(k => [k,process.env[k]]));
  Object.assign(process.env,config);
  const db = new PGlite();
  await db.exec("CREATE TABLE shop_products(slug TEXT,name TEXT,is_active BOOLEAN); INSERT INTO shop_products VALUES ('batterie','Batterie',true); CREATE TABLE assistance_requests(id TEXT,client_phone TEXT,service TEXT); INSERT INTO assistance_requests VALUES ('dossier-prive','owner','batterie');");
  const query = async (sql: string, params?: any[]) => {
    if (sql.includes("CREATE TABLE IF NOT EXISTS")) { await db.exec(sql); return { rows:[], rowCount:0 }; }
    const result = await db.query<any>(sql,params);
    return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
  };
  const pool: any = { query, connect: async () => ({ query, release() {} }) };
  const sent: any[] = [], calls: any[] = [];
  const sid = `CA${"b".repeat(32)}`;
  const app = express(); catchAsyncRoutes(app); app.use(express.json()); app.use(express.urlencoded({ extended:false }));
  await registerCallbacks(app, { pool, limiter: (_req,_res,next)=>next(),
    requireAuth: (req:any,res,next) => { if (req.headers.authorization !== "Bearer owner") return res.sendStatus(401); req.session={phone:"owner"}; next(); },
    requireAdminAuth: (req,res,next)=>req.headers.authorization === "Bearer admin" ? next() : res.sendStatus(403),
    createProvider: () => ({ messages:{ create:async (body:any)=>{sent.push(body);return {sid:"SMtest"};} },calls:{ create:async(body:any)=>{calls.push(body);return {sid};} } } as any),
  });
  app.post("/api/shop/whatsapp/incoming", (_req,res)=>res.json({ legacy:true }));
  app.use((error:any,_req:any,res:any,_next:any)=>res.status(500).json({message:error.message}));
  const server = app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (path:string, body?:any, auth?:string) => fetch(origin+path,{method:body ? "POST":"GET",headers:{"Content-Type":"application/json",...(auth?{Authorization:`Bearer ${auth}`}:{})},body:body?JSON.stringify(body):undefined});
  const webhook = (path:string, body:Record<string,string>, valid=true) => fetch(origin+path,{method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded","X-Twilio-Signature":valid?twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN, config.WHATSAPP_CALLBACK_PUBLIC_URL+path,body):"invalid"},body:new URLSearchParams(body)});
  const input = {source:"boutique",phone:"0700000001",consent:true,productSlug:"batterie"};
  try {
    assert.equal((await request("/api/admin/callbacks")).status,403);
    assert.equal((await request("/api/callbacks",{...input,consent:false})).status,400);
    assert.equal((await request("/api/callbacks",{...input,source:"assistance",productSlug:undefined,requestId:"dossier-prive"})).status,401);
    assert.equal((await request("/api/callbacks",{...input,productSlug:"inconnu"})).status,404);
    assert.equal((await request("/api/callbacks",input)).status,202);
    assert.equal((await request("/api/callbacks",input)).status,202);
    const list = await (await request("/api/admin/callbacks",undefined,"admin")).json();
    assert.equal(list.callbacks.length,1); assert.equal(list.callbacks[0].context_label,"Batterie");
    assert.equal(sent.length,0); assert.equal(calls.length,0);
    const id = list.callbacks[0].id;
    const action = (action:string) => request(`/api/admin/callbacks/${id}/action`,{action},"admin");
    assert.equal((await action("call")).status,409);
    assert.equal((await action("permission")).status,200); assert.equal(sent.length,1);
    assert.equal((await action("permission")).status,429); assert.equal(sent.length,1);
    const permission = {AccountSid:config.TWILIO_ACCOUNT_SID,From:"whatsapp:+2250700000001",To:config.TWILIO_WHATSAPP_NUMBER,Body:"VOICE_CALL_REQUEST",ButtonPayload:"ACCEPTED",MessageSid:`SM${"a".repeat(32)}`};
    assert.equal((await webhook("/api/shop/whatsapp/incoming",permission,false)).status,403);
    assert.equal((await action("call")).status,409);
    assert.equal((await webhook("/api/shop/whatsapp/incoming",permission)).status,200);
    const expiry = (await query("SELECT expires_at FROM voice_callback_permissions")).rows[0];
    await webhook("/api/shop/whatsapp/incoming",permission);
    assert.deepEqual((await query("SELECT expires_at FROM voice_callback_permissions")).rows[0],expiry);
    assert.equal((await action("call")).status,200); assert.equal(calls.length,1);
    assert.equal(calls[0].to,permission.From); assert.match(calls[0].twiml,/<Sip>sip:agent@example.test<\/Sip>/);
    assert.equal((await action("call")).status,409); assert.equal(calls.length,1);
    const status = {AccountSid:config.TWILIO_ACCOUNT_SID,From:config.TWILIO_WHATSAPP_NUMBER,To:permission.From,CallSid:sid,CallStatus:"completed"};
    await webhook(`/api/callbacks/whatsapp/status?id=${id}`,{...status,To:"whatsapp:+2250700000022"});
    assert.equal((await query("SELECT status FROM voice_callbacks WHERE id=$1",[id])).rows[0].status,"calling");
    assert.equal((await webhook(`/api/callbacks/whatsapp/status?id=${id}`,status)).status,204);
    await webhook(`/api/callbacks/whatsapp/status?id=${id}`,{...status,CallStatus:"ringing"});
    assert.equal((await query("SELECT status FROM voice_callbacks WHERE id=$1",[id])).rows[0].status,"review");
    assert.equal((await action("call")).status,409);
    assert.equal((await action("complete")).status,200);
    assert.equal((await action("permission")).status,409);
    await webhook("/api/callbacks/whatsapp/incoming",{...permission,ButtonPayload:"REJECTED",MessageSid:`SM${"c".repeat(32)}`});
    assert.equal((await query("SELECT expires_at>now() AS valid FROM voice_callback_permissions")).rows[0].valid,false);
    const legacy = await (await request("/api/shop/whatsapp/incoming",{Body:"Bonjour"})).json();
    assert.equal(legacy.legacy,true);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); await db.close();
    for (const [key,value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key]=value;
  }
});
