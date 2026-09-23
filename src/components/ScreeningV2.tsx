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

export default function ScreeningV2({ sessionId, pairingCode, role }: { sessionId:string; pairingCode:string; role:"technician"|"controller"|"coach" }) {
  const wsRef=useRef<WebSocket|null>(null);
  const [connected,setConnected]=useState(false);
  const [frame,setFrame]=useState<string|null>(null);
  const [status,setStatus]=useState("Connexion…");
  const [inputText,setInputText]=useState("");
  const [vision,setVision]=useState<VisionAnalysis|null>(null);
  const [visionBusy,setVisionBusy]=useState(false);
  const [autoCoach,setAutoCoach]=useState(true);
  const [remoteControlApproved,setRemoteControlApproved]=useState(role === "controller");
  const [humanCoachRequested,setHumanCoachRequested]=useState(false);
  const [sessionEnded,setSessionEnded]=useState(false);
  const [voiceActive,setVoiceActive]=useState(false);
  const [voiceBusy,setVoiceBusy]=useState(false);
  const peerRef=useRef<RTCPeerConnection|null>(null);
  const voiceStreamRef=useRef<MediaStream|null>(null);
  const voiceAudioRef=useRef<HTMLAudioElement|null>(null);
  const lastAnalyzedFrameRef=useRef<string|null>(null);
  const token=localStorage.getItem("auth_session_token") || "";

  useEffect(()=>{
    if(!token){setStatus("Connexion DiagAssist requise.");return;}
    let stopped=false;
    let reconnectTimer:number|undefined;
    let reconnectAttempt=0;
    let sessionEndedLocal=false;

    const connect=()=>{
      if(stopped||sessionEndedLocal)return;
      const protocol=location.protocol==="https:"?"wss":"ws";
      const ws=new WebSocket(protocol+"://"+location.host+"/api/screening/stream?token="+encodeURIComponent(token));
      wsRef.current=ws;
      ws.onopen=()=>{
        reconnectAttempt=0;
        if(!stopped&&!sessionEndedLocal){
          setStatus("Connexion de la session…");
          ws.send(JSON.stringify({type:"pairing",sessionId,pairingCode,role}));
        }
      };
      ws.onmessage=e=>{
        try{
          const m=JSON.parse(e.data);
          if(m.type==="pairing"&&m.success){setConnected(true);setStatus("Session connectée.");}
          if(m.type==="frame"){
            const nextFrame=m.payload?.imageData||null;
            setFrame(nextFrame);
          }
          if(m.type==="error"){
            setConnected(false);
            setStatus(m.message||"Erreur");
            if(/session.*termin|session.*expir/i.test(String(m.message||""))){
              sessionEndedLocal=true;
              setSessionEnded(true);
              if(reconnectTimer!==undefined)window.clearTimeout(reconnectTimer);
            }
          }
          if(m.type==="human_coach_requested"){setHumanCoachRequested(true);setStatus("Coach humain demandé.");}
          if(m.type==="session_ended"){
            sessionEndedLocal=true;
            setConnected(false);
            setSessionEnded(true);
            setStatus("Session terminée.");
            if(reconnectTimer!==undefined)window.clearTimeout(reconnectTimer);
          }
          if(m.type==="voice_start" && role==="coach"){setStatus("Appel vocal demandé depuis la tablette.");}
          if(m.type==="voice_signal" && role==="coach"){handleVoiceSignal(m.payload);}
          if(m.type==="voice_end"){endVoice(false);}
        }catch{}
      };
      ws.onclose=()=>{
        setConnected(false);
        if(stopped||sessionEndedLocal)return;
        const delays=[1000,2000,5000,10000];
        const delay=delays[Math.min(reconnectAttempt,delays.length-1)];
        reconnectAttempt=Math.min(reconnectAttempt+1,delays.length-1);
        setStatus("Connexion interrompue. Reconnexion…");
        reconnectTimer=window.setTimeout(connect,delay);
      };
      ws.onerror=()=>setConnected(false);
    };

    connect();
    return()=>{
      stopped=true;
      if(reconnectTimer!==undefined)window.clearTimeout(reconnectTimer);
      const ws=wsRef.current;
      wsRef.current=null;
      if(ws)ws.close();
    };
  },[sessionId,pairingCode,token,role]);

  const command=(action:string,payload:any={})=>{
    if(sessionEnded)return;
    if(action!=="request_screen"&&!remoteControlApproved){
      setStatus("Activez la validation humaine avant d’envoyer une commande à la tablette.");
      return;
    }
    if(wsRef.current?.readyState===WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({type:"command",sessionId,payload:{action,...payload}}));
  };

  const sendVoice=(type:string,payload:any={})=>{
    if(wsRef.current?.readyState===WebSocket.OPEN) wsRef.current.send(JSON.stringify({type,sessionId,payload}));
  };

  const createVoicePeer=async(initiator:boolean)=>{
    if(peerRef.current) return peerRef.current;
    const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
    peerRef.current=pc;
    pc.onicecandidate=e=>{if(e.candidate)sendVoice("voice_signal",{kind:"ice",candidate:e.candidate});};
    pc.ontrack=e=>{if(voiceAudioRef.current){voiceAudioRef.current.srcObject=e.streams[0];voiceAudioRef.current.play().catch(()=>{});}};
    const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    voiceStreamRef.current=stream;
    stream.getTracks().forEach(t=>pc.addTrack(t,stream));
    pc.onconnectionstatechange=()=>{if(["connected","completed"].includes(pc.connectionState)){setVoiceActive(true);setVoiceBusy(false);} if(["failed","closed","disconnected"].includes(pc.connectionState)){setVoiceActive(false);}};
    if(initiator){
      const offer=await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendVoice("voice_signal",{kind:"offer",sdp:offer.sdp});
    }
    return pc;
  };

  const handleVoiceSignal=async(signal:any)=>{
    if(!signal)return;
    try{
      const pc=await createVoicePeer(signal.kind==="offer");
      if(signal.kind==="offer"){
        await pc.setRemoteDescription({type:"offer",sdp:signal.sdp});
        const answer=await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendVoice("voice_signal",{kind:"answer",sdp:answer.sdp});
      }else if(signal.kind==="answer"){
        await pc.setRemoteDescription({type:"answer",sdp:signal.sdp});
      }else if(signal.kind==="ice"&&signal.candidate){await pc.addIceCandidate(signal.candidate);}
    }catch(e:any){setVoiceBusy(false);setStatus(e.message||"Appel vocal impossible.");}
  };

  const startVoice=async()=>{
    if(sessionEnded||voiceBusy||voiceActive)return;
    setVoiceBusy(true);
    setStatus("Connexion audio…");
    try{await createVoicePeer(true);sendVoice("voice_start");}catch(e:any){setVoiceBusy(false);setStatus(e.message||"Autorisation micro requise.");}
  };

  const endVoice=(notify=true)=>{
    voiceStreamRef.current?.getTracks().forEach(t=>t.stop());
    voiceStreamRef.current=null;
    peerRef.current?.close();
    peerRef.current=null;
    if(voiceAudioRef.current)voiceAudioRef.current.srcObject=null;
    setVoiceActive(false);setVoiceBusy(false);
    if(notify)sendVoice("voice_end");
  };

  useEffect(()=>()=>endVoice(false),[]);

  const endSession=async()=>{
    await fetch("/api/screening/sessions/"+encodeURIComponent(sessionId)+"/end",{
      method:"POST",headers:{Authorization:"Bearer "+token}
    });
  };

  const analyzeFrame=async()=>{
    if(sessionEnded||!frame||visionBusy)return;
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
    if(role!=="controller" && role!=="coach")return;
    const rect=e.currentTarget.getBoundingClientRect();
    const scaleX=e.currentTarget.naturalWidth/rect.width;
    const scaleY=e.currentTarget.naturalHeight/rect.height;
    command("click",{x:Math.round((e.clientX-rect.left)*scaleX),y:Math.round((e.clientY-rect.top)*scaleY)});
  };

  return <section className="screening-v2 space-y-3">
    <header className="flex items-center justify-between gap-3">
      <div><strong>{role==="controller" ? "DiagAssist — Tablette du scanner" : "DiagAssist V2"}</strong><div className="text-xs opacity-70">{status}</div></div>
      {connected&&<span className="text-xs">🟢 Connecté</span>}
    </header>

    {(role==="controller"||role==="coach")&&<div className="rounded-2xl overflow-hidden border border-white/10 bg-black min-h-[240px] flex items-center justify-center">
      {frame?<img onClick={clickFrame} src={frame} alt="Écran du technicien" className={role==="coach"?"max-w-full cursor-crosshair":"max-w-full"} style={{maxHeight:"70vh"}}/>:<div className="p-10 text-sm opacity-60">En attente de l’écran de la tablette…</div>}
    </div>}

    {(role==="technician"||role==="controller")&&<div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-4 space-y-3"><div className="text-xs font-black uppercase tracking-widest text-emerald-300">🤖 DiagAssist — Coach principal</div><p className="text-sm text-slate-300">DiagAssist analyse automatiquement les nouvelles captures de votre scanner et vous explique quoi vérifier et quoi faire ensuite.</p><div className="text-[10px] uppercase font-black tracking-widest text-slate-500">Option 2 — aide d’un autre technicien</div><button onClick={async()=>{try{const res=await fetch("/api/screening/sessions/"+encodeURIComponent(sessionId)+"/request-human-coach",{method:"POST",headers:{Authorization:"Bearer "+token}});const data=await res.json();if(!res.ok||!data.success)throw new Error(data.message||"Demande impossible.");setHumanCoachRequested(true);setStatus("Demande d’aide envoyée. DiagAssist reste actif.");}catch(e:any){setStatus(e.message||"Erreur.");}}} disabled={humanCoachRequested} className="px-3 py-2 rounded-lg bg-amber-600 disabled:opacity-50 text-white text-xs font-bold">{humanCoachRequested?"Aide d’un autre technicien demandée":"Demander l’aide d’un ami / technicien"}</button></div>}

    {(role==="controller"||role==="coach")&&!sessionEnded&&<div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <button onClick={()=>command("request_screen")} className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold">Actualiser</button>
        
        <button onClick={analyzeFrame} disabled={!frame||visionBusy} className="px-3 py-2 rounded-lg bg-red-600 disabled:opacity-40 text-white text-xs font-bold">
          {visionBusy?"Analyse…":"Analyser avec IA"}
        </button>
        <button onClick={()=>command("back")} className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold">Retour</button>
        <button onClick={()=>command("scroll",{direction:"up"})} className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold">↑ Scroll</button>
        <button onClick={()=>command("scroll",{direction:"down"})} className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold">↓ Scroll</button>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-amber-200">
        <input type="checkbox" checked={remoteControlApproved} onChange={e=>setRemoteControlApproved(e.target.checked)}/>
        Contrôle de la tablette autorisé après son appairage QR.
      </label>
      <label className="flex items-center gap-2 text-[11px] text-slate-400">
        <input type="checkbox" checked={autoCoach} onChange={e=>setAutoCoach(e.target.checked)}/>
        Analyser automatiquement les nouvelles captures (consomme le quota IA).
      </label>
      <div className="flex gap-1.5">
        <input value={inputText} onChange={e=>setInputText(e.target.value)} placeholder="Texte à saisir sur la tablette" className="flex-1 rounded-lg bg-slate-950 border border-white/10 px-3 py-2 text-white text-sm"/>
        <button onClick={()=>{command("input",{text:inputText});setInputText("");}} disabled={!inputText} className="px-3 py-2 rounded-lg bg-red-600 disabled:opacity-40 text-white text-xs font-bold">Saisir</button>
      </div>
    </div>}

    {vision&&<div className="rounded-2xl border border-red-500/20 bg-slate-950/70 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-white">🤖 DiagAssist — Analyse et coaching</strong>
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

    <audio ref={voiceAudioRef} autoPlay playsInline className="hidden" />
    {!sessionEnded&&<button onClick={endSession} className="px-3 py-2 rounded-lg border border-red-500/30 text-red-300 text-xs font-bold">Terminer la session</button>}
    {sessionEnded&&<div className="rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-400">Cette session est terminée. Créez une nouvelle session pour reprendre le coaching.</div>}
  </section>;
}

