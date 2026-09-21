import React, { useEffect, useRef, useState } from "react";

export default function ScreeningV2({ sessionId, pairingCode, role }: { sessionId:string; pairingCode:string; role:"technician"|"coach" }) {
  const wsRef=useRef<WebSocket|null>(null);
  const [connected,setConnected]=useState(false);
  const [frame,setFrame]=useState<string|null>(null);
  const [status,setStatus]=useState("Connexion…");
  useEffect(()=>{
    const token=localStorage.getItem("auth_session_token");
    if(!token){setStatus("Connexion DiagAssist requise.");return;}
    const ws=new WebSocket("wss://"+location.host+"/api/screening/stream?token="+encodeURIComponent(token));
    wsRef.current=ws;
    ws.onopen=()=>ws.send(JSON.stringify({type:"pairing",sessionId,pairingCode}));
    ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.type==="pairing"&&m.success){setConnected(true);setStatus("Session connectée.");} if(m.type==="frame")setFrame(m.payload?.imageData||null); if(m.type==="error")setStatus(m.message||"Erreur");};
    ws.onclose=()=>setConnected(false);
    return()=>ws.close();
  },[sessionId,pairingCode]);
  const command=(action:string,payload:any={})=>wsRef.current?.send(JSON.stringify({type:"command",sessionId,payload:{action,...payload}}));
  return <section className="screening-v2"><header><strong>DiagAssist V2</strong><span>{connected?"🟢 Connecté":"⚪ "+status}</span></header>{frame?<img src={frame} alt="Écran du technicien" style={{maxWidth:"100%",borderRadius:12}}/>:<div>En attente de l’écran de la tablette…</div>}{role==="coach"&&<div style={{display:"flex",gap:8,marginTop:12}}><button onClick={()=>command("request_screen")}>Actualiser</button><button onClick={()=>command("back")}>Retour</button></div>}</section>;
}