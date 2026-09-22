import React, { useEffect, useRef, useState } from "react";

type VisionAnalysis = {
  summary: string;
  observations: string[];
  probableCodes: { code: string; description: string }[];
  checks: string[];
  nextActions: string[];
  safety: string;
  confidence: number;
  uncertainty: string;
};

export default function ScreeningV2({ sessionId, pairingCode, role }: { sessionId:string; pairingCode:string; role:"technician"|"coach" }) {
  const wsRef=useRef<WebSocket|null>(null);
  const [connected,setConnected]=useState(false);
  const [frame,setFrame]=useState<string|null>(null);
  const [status,setStatus]=useState("Connexion…");
  const [inputText,setInputText]=useState("");
  const [vision,setVision]=useState<VisionAnalysis|null>(null);
  const [visionBusy,setVisionBusy]=useState(false);
  const [autoCoach,setAutoCoach]=useState(false);
  const [remoteControlApproved,setRemoteControlApproved]=useState(false);
  const [humanCoachRequested,setHumanCoachRequested]=useState(false);
  const lastAnalyzedFrameRef=useRef<string|null>(null);
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
        if(m.type==="frame"){
          const nextFrame=m.payload?.imageData||null;
          setFrame(nextFrame);
        }
        if(m.type==="error")setStatus(m.message||"Erreur");
        if(m.type==="human_coach_requested"){setHumanCoachRequested(true);setStatus("Coach humain demandé.");}
        if(m.type==="session_ended"){setConnected(false);setStatus("Session terminée.");}
      }catch{}
    };
    ws.onclose=()=>setConnected(false);
    return()=>ws.close();
  },[sessionId,pairingCode,token]);

  const command=(action:string,payload:any={})=>{
    if(action!=="request_screen"&&!remoteControlApproved){
      setStatus("Activez la validation humaine avant d’envoyer une commande à la tablette.");
      return;
    }
    if(wsRef.current?.readyState===WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({type:"command",sessionId,payload:{action,...payload}}));
  };

  const endSession=async()=>{
    await fetch("/api/screening/sessions/"+encodeURIComponent(sessionId)+"/end",{
      method:"POST",headers:{Authorization:"Bearer "+token}
    });
  };

  const analyzeFrame=async()=>{
    if(!frame||visionBusy)return;
    setVisionBusy(true);
    setStatus("Analyse Vision en cours…");
    try{
      const res=await fetch("/api/screening/analyze-frame",{
        method:"POST",
        headers:{
          Authorization:"Bearer "+token,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({sessionId,imageData:frame})
      });
      const data=await res.json();
      if(!res.ok||!data.success)throw new Error(data.message||"Analyse impossible.");
      setVision(data.analysis);
      setStatus("Analyse Vision terminée.");
    }catch(e:any){
      setStatus(e.message||"Erreur d'analyse Vision.");
    }finally{
      setVisionBusy(false);
    }
  };

  useEffect(()=>{
    if(!autoCoach||!frame||visionBusy||frame===lastAnalyzedFrameRef.current)return;
    const timer=window.setTimeout(()=>{
      lastAnalyzedFrameRef.current=frame;
      analyzeFrame();
    },1500);
    return()=>window.clearTimeout(timer);
  },[frame,autoCoach,visionBusy]);

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

    {role==="technician"&&<div className="rounded-2xl border border-red-500/20 bg-red-950/10 p-4 space-y-2"><div className="text-xs font-black uppercase tracking-widest text-red-300">🤖 Gemini — Coach par défaut</div><p className="text-sm text-slate-300">Gemini accompagne automatiquement le diagnostic. Un coach humain ne peut rejoindre la session qu’après confirmation du technicien.</p><button onClick={async()=>{try{const res=await fetch("/api/screening/sessions/"+encodeURIComponent(sessionId)+"/request-human-coach",{method:"POST",headers:{Authorization:"Bearer "+token}});const data=await res.json();if(!res.ok||!data.success)throw new Error(data.message||"Demande impossible.");setHumanCoachRequested(true);setStatus("Coach humain demandé.");}catch(e:any){setStatus(e.message||"Erreur.");}}} disabled={humanCoachRequested} className="px-3 py-2 rounded-lg bg-amber-600 disabled:opacity-50 text-white text-xs font-bold">{humanCoachRequested?"Coach humain demandé":"Demander un coach humain"}</button></div>}

    {role==="coach"&&<div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button onClick={()=>command("request_screen")} className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold">Actualiser</button>
        <button onClick={analyzeFrame} disabled={!frame||visionBusy} className="px-3 py-2 rounded-lg bg-red-600 disabled:opacity-40 text-white text-xs font-bold">
          {visionBusy?"Analyse…":"Analyser avec IA"}
        </button>
        <button onClick={()=>command("back")} className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold">Retour</button>
        <button onClick={()=>command("scroll",{direction:"up"})} className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold">↑ Scroll</button>
        <button onClick={()=>command("scroll",{direction:"down"})} className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold">↓ Scroll</button>
      </div>
      <label className="flex items-center gap-2 text-xs text-amber-200">
        <input type="checkbox" checked={remoteControlApproved} onChange={e=>setRemoteControlApproved(e.target.checked)}/>
        J’ai la confirmation du technicien avant chaque commande à distance.
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-400">
        <input type="checkbox" checked={autoCoach} onChange={e=>setAutoCoach(e.target.checked)}/>
        Analyser automatiquement les nouvelles captures (consomme le quota IA).
      </label>
      <div className="flex gap-2">
        <input value={inputText} onChange={e=>setInputText(e.target.value)} placeholder="Texte à saisir sur la tablette" className="flex-1 rounded-lg bg-slate-950 border border-white/10 px-3 py-2 text-white text-sm"/>
        <button onClick={()=>{command("input",{text:inputText});setInputText("");}} disabled={!inputText} className="px-3 py-2 rounded-lg bg-red-600 disabled:opacity-40 text-white text-xs font-bold">Saisir</button>
      </div>
    </div>}

    {vision&&<div className="rounded-2xl border border-red-500/20 bg-slate-950/70 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-white">🤖 Gemini — Analyse et coaching</strong>
        <span className="text-xs text-slate-400">Confiance {Math.round(Math.max(0,Math.min(1,vision.confidence))*100)}%</span>
      </div>
      <p className="text-sm text-slate-200">{vision.summary}</p>
      {vision.probableCodes.length>0&&<div><div className="text-[10px] uppercase font-black text-red-300">Codes visibles</div><ul className="mt-1 space-y-1">{vision.probableCodes.map((c,i)=><li key={i} className="text-sm text-white"><b>{c.code}</b> — {c.description}</li>)}</ul></div>}
      {vision.observations.length>0&&<div><div className="text-[10px] uppercase font-black text-slate-400">Observations</div><ul className="mt-1 list-disc pl-5 text-sm text-slate-300">{vision.observations.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
      {vision.checks.length>0&&<div><div className="text-[10px] uppercase font-black text-amber-300">Prochain contrôle</div><ul className="mt-1 list-disc pl-5 text-sm text-slate-300">{vision.checks.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
      {vision.nextActions.length>0&&<div><div className="text-[10px] uppercase font-black text-emerald-300">Actions</div><ul className="mt-1 list-disc pl-5 text-sm text-slate-300">{vision.nextActions.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
      <div className="text-xs text-slate-400"><b>Sécurité :</b> {vision.safety}</div>
      {vision.uncertainty&&<div className="text-xs text-slate-500"><b>Limites :</b> {vision.uncertainty}</div>}
      <div className="text-[10px] text-slate-500">L’analyse IA est une aide au diagnostic et doit être confirmée par les mesures et procédures appropriées.</div>
    </div>}

    <button onClick={endSession} className="px-3 py-2 rounded-lg border border-red-500/30 text-red-300 text-xs font-bold">Terminer la session</button>
  </section>;
}

