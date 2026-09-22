import React, { useEffect, useRef, useState } from "react";

export default function ScreeningV2({ sessionId, pairingCode, role }: { sessionId:string; pairingCode:string; role:"technician"|"coach" }) {
  const wsRef=useRef<WebSocket|null>(null);
  const [connected,setConnected]=useState(false);
  const [frame,setFrame]=useState<string|null>(null);
  const [status,setStatus]=useState("Connexion…");
  const [inputText,setInputText]=useState("");
  const token=localStorage.getItem("auth_session_token") || "";

  useEffect(()=>{
    if(!token){setStatus("Connexion DiagAssist requise.");return;}
    const protocol=location.protocol==="https:"?"wss":"ws";
    const ws=new WebSocket(protocol+"://"+location.host+"/api/screening/stream?token="+encodeURIComponent(token));
    wsRef.current=ws;
    ws.onopen=()=>ws.send(JSON.stringify({type:"pairing",sessionId,pairingCode}));
    ws.onmessage=e=>{
      try{
        const m=JSON.parse(e.data);
        if(m.type==="pairing"&&m.success){setConnected(true);setStatus("Session connectée.");}
        if(m.type==="frame")setFrame(m.payload?.imageData||null);
        if(m.type==="error")setStatus(m.message||"Erreur");
        if(m.type==="session_ended"){setConnected(false);setStatus("Session terminée.");}
      }catch{}
    };
    ws.onclose=()=>setConnected(false);
    return()=>ws.close();
  },[sessionId,pairingCode,token]);

  const command=(action:string,payload:any={})=>{
    if(wsRef.current?.readyState===WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({type:"command",sessionId,payload:{action,...payload}}));
  };

  const endSession=async()=>{
    await fetch("/api/screening/sessions/"+encodeURIComponent(sessionId)+"/end",{
      method:"POST",headers:{Authorization:"Bearer "+token}
    });
  };

  const clickFrame=(e:React.MouseEvent<HTMLImageElement>)=>{
    if(role!=="coach")return;
    const rect=e.currentTarget.getBoundingClientRect();
    const scaleX=e.currentTarget.naturalWidth/rect.width;
    const scaleY=e.currentTarget.naturalHeight/rect.height;
    command("click",{x:Math.round((e.clientX-rect.left)*scaleX),y:Math.round((e.clientY-rect.top)*scaleY)});
  };

  return <section className="screening-v2 space-y-3">
    <header className="flex items-center justify-between gap-3">
      <div><strong>DiagAssist V2</strong><div className="text-xs opacity-70">{status}</div></div>
      {connected&&<span className="text-xs">🟢 Connecté</span>}
    </header>
    <div className="rounded-2xl overflow-hidden border border-white/10 bg-black min-h-[240px] flex items-center justify-center">
      {frame?<img onClick={clickFrame} src={frame} alt="Écran du technicien" className={role==="coach"?"max-w-full cursor-crosshair":"max-w-full"} style={{maxHeight:"70vh"}}/>:<div className="p-10 text-sm opacity-60">En attente de l’écran de la tablette…</div>}
    </div>
    {role==="coach"&&<div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button onClick={()=>command("request_screen")} className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold">Actualiser</button>
        <button onClick={()=>command("back")} className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold">Retour</button>
        <button onClick={()=>command("scroll",{direction:"up"})} className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold">↑ Scroll</button>
        <button onClick={()=>command("scroll",{direction:"down"})} className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold">↓ Scroll</button>
      </div>
      <div className="flex gap-2">
        <input value={inputText} onChange={e=>setInputText(e.target.value)} placeholder="Texte à saisir sur la tablette" className="flex-1 rounded-lg bg-slate-950 border border-white/10 px-3 py-2 text-white text-sm"/>
        <button onClick={()=>command("input",{text:inputText})} disabled={!inputText} className="px-3 py-2 rounded-lg bg-red-600 disabled:opacity-40 text-white text-xs font-bold">Saisir</button>
      </div>
    </div>}
    <button onClick={endSession} className="px-3 py-2 rounded-lg border border-red-500/30 text-red-300 text-xs font-bold">Terminer la session</button>
  </section>;
}