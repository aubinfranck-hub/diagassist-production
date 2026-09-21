import crypto from "crypto";
import type { Express } from "express";
import type { Server } from "http";
import { WebSocketServer } from "ws";

const sessions = new Map<string, any>();
const clients = new Map<string, Set<any>>();
const attempts = new Map<string, number>();
const PAIRING_TTL = 10 * 60 * 1000;
const SESSION_TTL = 60 * 60 * 1000;
const ALLOWED = new Set(["click","scroll","input","back","request_screen"]);

function code() { return crypto.randomInt(100000, 1000000).toString(); }
function getSession(id:string) { const s=sessions.get(id); if(!s || Date.now()>s.expiresAt){ if(s) sessions.delete(id); return null; } return s; }
function sendAll(id:string,msg:any,except?:any) { for(const ws of clients.get(id)||[]) if(ws!==except && ws.readyState===1) ws.send(JSON.stringify(msg)); }

export function registerScreening(app:Express, server:Server, deps:{requireAuth:any; getEffectivePlan:(phone:string)=>string; sessions:Map<string, any>}) {
  const wss=new WebSocketServer({noServer:true});
  app.post("/api/screening/sessions", deps.requireAuth, (req:any,res)=>{
    if(deps.getEffectivePlan(req.session.phone)!=="premium") return res.status(403).json({success:false,message:"Le coaching temps réel est réservé au Premium.",requiredTier:"premium"});
    const id="scr_"+crypto.randomBytes(12).toString("hex"), now=Date.now();
    const s={id,technicianPhone:req.session.phone,pairingCode:code(),pairingExpiresAt:now+PAIRING_TTL,status:"pending",createdAt:now,expiresAt:now+SESSION_TTL,frameCount:0};
    sessions.set(id,s);
    res.json({success:true,sessionId:id,pairingCode:s.pairingCode,expiresIn:PAIRING_TTL});
  });
  app.get("/api/screening/sessions/:id",deps.requireAuth,(req:any,res)=>{
    const s=getSession(req.params.id); if(!s) return res.status(404).json({success:false,message:"Session introuvable."});
    if(req.session.phone!==s.technicianPhone && req.session.phone!==s.coachPhone) return res.status(403).json({success:false,message:"Accès refusé."});
    const safe={...s}; if(req.session.phone!==s.technicianPhone) delete safe.pairingCode; res.json({success:true,session:safe});
  });
  app.post("/api/screening/sessions/:id/end",deps.requireAuth,(req:any,res)=>{
    const s=getSession(req.params.id); if(!s) return res.status(404).json({success:false,message:"Session introuvable."});
    if(req.session.phone!==s.technicianPhone && req.session.phone!==s.coachPhone) return res.status(403).json({success:false,message:"Accès refusé."});
    s.status="completed"; sendAll(s.id,{type:"session_ended",sessionId:s.id,timestamp:Date.now()}); res.json({success:true,frameCount:s.frameCount});
  });
  server.on("upgrade",(request,socket,head)=>{
    const url=new URL(request.url||"","http://localhost"); if(url.pathname!=="/api/screening/stream") return;
    const token=url.searchParams.get("token")||"", auth=deps.sessions.get(token);
    if(!auth || deps.getEffectivePlan(auth.phone)!=="premium"){ socket.write("HTTP/1.1 403 Forbidden\\r\
\\r\\n"); socket.destroy(); return; }
    wss.handleUpgrade(request,socket,head,ws=>{ (ws as any)._phone=auth.phone; wss.emit("connection",ws); });
  });
  wss.on("connection",(ws:any)=>{
    let paired=false, role:string|null=null, sid:string|null=null;
    ws.on("message",(raw:Buffer)=>{ try {
      const m=JSON.parse(raw.toString());
      if(m.type==="pairing"){ const s=getSession(String(m.sessionId)); if(!s) return ws.send(JSON.stringify({type:"error",message:"Session expirée."}));
        const key=s.id+":"+ws._phone, n=(attempts.get(key)||0)+1; attempts.set(key,n);
        if(n>3) return ws.send(JSON.stringify({type:"error",message:"Trop de tentatives."}));
        if(Date.now()>s.pairingExpiresAt) return ws.send(JSON.stringify({type:"error",message:"Code d’appairage expiré. Créez une nouvelle session."}));\n        if(m.pairingCode!==s.pairingCode) return ws.send(JSON.stringify({type:"error",message:"Code incorrect."}));
        role=ws._phone===s.technicianPhone?"technician":"coach"; if(role==="coach"){ if(s.coachPhone && s.coachPhone!==ws._phone) return ws.send(JSON.stringify({type:"error",message:"Coach non autorisé."})); s.coachPhone=ws._phone; }
        sid=s.id; paired=true; s.status="active"; if(!clients.has(sid)) clients.set(sid,new Set()); clients.get(sid).add(ws);
        return ws.send(JSON.stringify({type:"pairing",success:true,role,sessionId:sid,timestamp:Date.now()})); }
      if(!paired||!sid) return ws.send(JSON.stringify({type:"error",message:"Appairage requis."}));
      if(m.type==="frame"&&role==="technician"){ const s=getSession(sid); const imageData=String(m.payload?.imageData||""); if(s && imageData.length<=2_500_000){s.frameCount++; sendAll(sid,m,ws);} }
      else if(m.type==="command"&&role==="coach"){ if(!m.payload || typeof m.payload!=="object" || !ALLOWED.has(m.payload.action)) return ws.send(JSON.stringify({type:"error",message:"Commande non autorisée."})); sendAll(sid,m,ws); }
      else if(m.type==="command_result"&&role==="technician") sendAll(sid,m,ws);
    } catch { ws.send(JSON.stringify({type:"error",message:"Message invalide."})); } });
    ws.on("close",()=>{if(sid) clients.get(sid)?.delete(ws);});
  });
}