import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleSlash, Disc3, AlertCircle, Volume2, BatteryLow, Truck, HelpCircle,
  LocateFixed, MapPin, Camera, Video, X, ChevronDown, Loader2, ShieldCheck, Car, Wrench,
} from "lucide-react";
import {
  api, authToken, AssistanceError, AssistanceStatus, compressImage, referenceTariffText, knownPhone, MAX_BYTES, readAsBase64, SERVICE_FALLBACK_LABEL,
} from "./api";
import { LatLng, MapScreen, useAddress } from "./AssistanceMaps";
import { enqueueRequest, isOfflineError } from "./offlineQueue";
import { btnPrimary, errText, inputCls, Notice } from "./ui";

/** Données reprises depuis un diagnostic IA (écran de résultat). */
export interface AssistancePrefill {
  vehicle?: { brand?: string; model?: string; year?: string; engine?: string };
  symptoms?: string;
  faultCodes?: string[];
  /** Résumé des pistes à vérifier, transmis seulement si le client coche la case de consentement. */
  summary?: string;
}

interface Tile { id: string; label: string; service: string; icon: React.ReactNode }

const TILES: Tile[] = [
  { id: "demarre", label: "Ne démarre pas", service: "mecanique", icon: <CircleSlash className="w-7 h-7" /> },
  { id: "pneu", label: "Pneu crevé", service: "pneumatiques", icon: <Disc3 className="w-7 h-7" /> },
  { id: "batterie", label: "Batterie à plat", service: "batterie", icon: <BatteryLow className="w-7 h-7" /> },
  { id: "voyant", label: "Voyant allumé", service: "diagnostic", icon: <AlertCircle className="w-7 h-7" /> },
  { id: "bruit", label: "Bruit anormal", service: "mecanique", icon: <Volume2 className="w-7 h-7" /> },
  { id: "remorquage", label: "Remorquage", service: "remorquage", icon: <Truck className="w-7 h-7" /> },
  { id: "autre", label: "Autre problème", service: "", icon: <HelpCircle className="w-7 h-7" /> },
];

interface Attach { blob: Blob; name: string; mime: string; preview?: string; kind: "image" | "video" }

type GeoState = "idle" | "loading" | "denied" | "unavailable" | "timeout";

export default function ClientWizard({
  status, prefill, initialPos, initialAccuracy, onCreated, onClose, onQueued,
}: {
  status: AssistanceStatus;
  prefill?: AssistancePrefill | null;
  initialPos?: LatLng | null;
  initialAccuracy?: number;
  onCreated: (id: string) => void;
  onClose: () => void;
  /** Appelé quand la demande a été gardée hors ligne (file d'attente locale). */
  onQueued?: () => void;
}) {
  // --- Parcours : le véhicule peut-il encore rouler ? (null = pas encore répondu) ---
  const [immobilised, setImmobilised] = useState<boolean | null>(null);
  const atelier = immobilised === false;

  // --- Panne ---
  const [tileId, setTileId] = useState<string>("");
  const [otherService, setOtherService] = useState("");
  const [description, setDescription] = useState(prefill?.symptoms || "");
  const [attachments, setAttachments] = useState<Attach[]>([]);
  const [mediaError, setMediaError] = useState("");

  // --- Véhicule (facultatif) ---
  const [brand, setBrand] = useState(prefill?.vehicle?.brand || "");
  const [model, setModel] = useState(prefill?.vehicle?.model || "");
  const [brands, setBrands] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [showVehicle, setShowVehicle] = useState(!!(prefill?.vehicle?.brand || prefill?.vehicle?.model));

  // --- Position ---
  const [pos, setPos] = useState<LatLng | null>(initialPos || null);
  const [accuracy, setAccuracy] = useState<number | undefined>(initialPos ? initialAccuracy : undefined);
  const [source, setSource] = useState<"gps" | "carte">(initialPos && initialAccuracy ? "gps" : "carte");
  const [geo, setGeo] = useState<GeoState>("idle");
  const [landmark, setLandmark] = useState("");
  const address = useAddress(pos);
  const [phone, setPhone] = useState(knownPhone());

  // --- Envoi ---
  const [share, setShare] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const uploaded = useRef<Map<Attach, string>>(new Map());

  const tile = TILES.find((t) => t.id === tileId);
  const serviceCode = tile ? (tile.service || otherService) : "";
  const serviceInfo = status.services.find((s) => s.code === serviceCode);
  const serviceLabel = serviceInfo?.label || SERVICE_FALLBACK_LABEL[serviceCode] || serviceCode;

  // Dépannage : mécaniciens mobiles ; atelier : garages (repli sur `available` si le serveur ne le précise pas).
  const svcOk = (s?: AssistanceStatus["services"][number]) =>
    !!s && (atelier ? (s.atelierAvailable ?? s.available) : s.available);
  const tileAvailable = (t: Tile) => {
    if (atelier && t.id === "remorquage") return false;
    if (!t.service) return status.services.some((s) => svcOk(s));
    return svcOk(status.services.find((x) => x.code === t.service));
  };

  useEffect(() => {
    const token = authToken();
    if (!token) return;
    fetch("/api/vehicles/brands", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json()).then((d) => { if (d.success) setBrands(d.brands); }).catch(() => {});
  }, []);
  useEffect(() => {
    const token = authToken();
    if (!token || !brand.trim()) { setModels([]); return; }
    fetch(`/api/vehicles/models?brand=${encodeURIComponent(brand.trim())}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json()).then((d) => { if (d.success) setModels(d.models); }).catch(() => {});
  }, [brand]);

  useEffect(() => () => { attachments.forEach((a) => a.preview && URL.revokeObjectURL(a.preview)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const vehicleSource: "catalogue" | "saisie" =
    brands.includes(brand) && (!model || models.includes(model)) ? "catalogue" : "saisie";

  // ---- Médias (photo / vidéo) ----
  const addFiles = async (files: FileList | null, kind: Attach["kind"]) => {
    if (!files) return;
    setMediaError("");
    for (const f of Array.from(files)) {
      if (attachments.length >= 8) { setMediaError("8 fichiers au maximum."); break; }
      const blob = kind === "image" ? await compressImage(f) : f;
      const limit = MAX_BYTES[kind];
      if (blob.size > limit) {
        setMediaError(`« ${f.name} » est trop lourd (maximum ${Math.round(limit / 1048576)} Mo).`);
        continue;
      }
      const mime = kind === "image" ? (blob.type || "image/jpeg") : f.type;
      setAttachments((prev) => [...prev, { blob, name: f.name, mime, kind, preview: kind === "image" ? URL.createObjectURL(blob) : undefined }]);
    }
  };
  const removeAttach = (a: Attach) => {
    if (a.preview) URL.revokeObjectURL(a.preview);
    setAttachments((p) => p.filter((x) => x !== a));
  };

  // ---- Position ----
  const locateMe = () => {
    if (!navigator.geolocation) { setGeo("unavailable"); return; }
    setGeo("loading");
    navigator.geolocation.getCurrentPosition(
      (g) => {
        setGeo("idle");
        setPos({ lat: g.coords.latitude, lng: g.coords.longitude });
        setAccuracy(g.coords.accuracy); setSource("gps");
      },
      (err) => setGeo(err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };
  // Pas de position connue : on tente la géolocalisation dès l'ouverture.
  useEffect(() => { if (!initialPos) locateMe(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Validation ----
  const phoneOk = phone.replace(/\D/g, "").length >= 8;
  const canSend = immobilised !== null && !!tile && !!serviceCode && tileAvailable(tile) && svcOk(serviceInfo) && !!pos && phoneOk && !sending;

  const symptomsText = useMemo(() => {
    const base = tile ? (tile.id === "autre" ? serviceLabel : tile.label) : "";
    const extra = description.trim();
    return extra ? `${base} — ${extra}` : base;
  }, [tile, description, serviceLabel]);

  const send = async () => {
    if (!pos || !tile || sending) return;
    setSending(true); setError("");
    let body: Record<string, unknown> | null = null;
    try {
      const vehicle = {
        brand: brand.trim() || undefined, model: model.trim() || undefined,
        year: prefill?.vehicle?.year || undefined, engine: prefill?.vehicle?.engine || undefined, source: vehicleSource,
      };
      const codes = (prefill?.faultCodes || []).map((c) => c.trim().toUpperCase()).filter(Boolean);
      body = {
        service: serviceCode,
        immobilised: immobilised !== false,
        vehicle,
        symptoms: symptomsText,
        faultCodes: codes.length ? codes : undefined,
        description: description.trim() || undefined,
        contactPhone: phone.trim(),
        position: {
          lat: pos.lat, lng: pos.lng, accuracy, source,
          address: address || undefined, landmark: landmark.trim() || undefined, confirmed: true,
        },
        shareDiagnostic: !!(prefill?.summary && share),
        submit: true,
      };
      if (prefill?.summary && share) {
        body.diagnostic = { summary: prefill.summary, faultCodes: prefill.faultCodes, vehicle };
      }
      if (!navigator.onLine) throw new AssistanceError("Pas de connexion.", 0, "OFFLINE");
      const mediaIds: string[] = [];
      for (const a of attachments) {
        let id = uploaded.current.get(a);
        if (!id) {
          const dataBase64 = await readAsBase64(a.blob);
          const r = await api<{ media: { id: string } }>("/media", { body: { mime: a.mime, dataBase64, name: a.name } });
          id = r.media.id;
          uploaded.current.set(a, id);
        }
        mediaIds.push(id);
      }
      body.mediaIds = mediaIds.length ? mediaIds : undefined;
      const r = await api<{ request: { id: string } }>("/requests", { body });
      onCreated(r.request.id);
    } catch (e) {
      if (body && isOfflineError(e)) {
        // Pas de réseau : on garde la demande et on la renverra automatiquement.
        const known = attachments.map((a) => uploaded.current.get(a)).filter((x): x is string => !!x);
        body.mediaIds = known.length ? known : undefined;
        const q = await enqueueRequest(body, attachments.filter((a) => !uploaded.current.has(a)));
        if (q.ok) { onQueued ? onQueued() : onClose(); return; }
        setError((q as { reason?: string }).reason === "full"
          ? "Vous avez déjà 3 demandes en attente. Annulez-en une ou attendez le retour du réseau."
          : "Pas de réseau et impossible de garder votre demande sur ce téléphone. Réessayez quand le réseau revient.");
      } else {
        setError(errText(e));
      }
    } finally {
      setSending(false);
    }
  };

  const [tariffs, setTariffs] = useState<Record<string, { min?: number; max?: number }>>({});
  useEffect(() => {
    let off = false;
    api<{ tariffs?: Record<string, { min?: number; max?: number }> }>("/tariffs").then((d) => { if (!off && d.tariffs) setTariffs(d.tariffs); }).catch(() => {});
    return () => { off = true; };
  }, []);
  const range = tariffs[serviceCode];
  const tariff = serviceInfo ? (serviceInfo.tariff ?? serviceInfo.indicativeAmount ?? null) : null;

  return (
    <MapScreen
      client={pos}
      accuracy={source === "gps" ? accuracy : undefined}
      editable
      onChange={(p) => { setPos(p); setSource("carte"); setAccuracy(undefined); }}
      onBack={onClose}
      backLabel="Annuler"
      footer={
        <>
          {error && <Notice tone="error">{error}</Notice>}
          <button className={`${btnPrimary} !min-h-[58px] !text-lg`} onClick={send} disabled={!canSend}>
            {sending ? <><Loader2 className="w-5 h-5 animate-spin" /> Envoi en cours…</> : "Envoyer ma demande"}
          </button>
          {!sending && (immobilised === null || !tile || !pos || !phoneOk) && (
            <p className="text-xs text-slate-500 text-center">
              {immobilised === null ? "Dites-nous d'abord si votre véhicule peut encore rouler." : !tile ? "Choisissez le type de panne." : !pos ? "Placez le point rouge sur la carte." : "Indiquez votre numéro de téléphone."}
            </p>
          )}
        </>
      }
    >
      {/* Position confirmée */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-red-600/15 text-red-500 flex items-center justify-center shrink-0"><MapPin className="w-5 h-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{atelier ? "Pour trouver un garage près de vous" : "Le mécanicien vient ici"}</div>
          <div className="text-sm font-black text-white truncate">
            {geo === "loading" ? "Recherche de votre position…" : pos ? (address || "Point rouge sur la carte") : "Position non trouvée"}
          </div>
        </div>
        <button type="button" onClick={locateMe} disabled={geo === "loading"} aria-label="Me localiser" className="shrink-0 w-11 h-11 rounded-full bg-slate-950/80 border border-white/[0.1] text-red-500 flex items-center justify-center cursor-pointer disabled:opacity-40">
          {geo === "loading" ? <Loader2 className="w-5 h-5 animate-spin" /> : <LocateFixed className="w-5 h-5" />}
        </button>
      </div>
      {geo === "denied" && <Notice tone="warn">Localisation refusée. Touchez la carte ou faites glisser le point rouge là où vous êtes.</Notice>}
      {geo === "timeout" && <Notice tone="warn">Position introuvable à temps. Touchez la carte pour placer le point rouge.</Notice>}
      {geo === "unavailable" && <Notice tone="warn">Localisation indisponible. Touchez la carte pour placer le point rouge.</Notice>}
      {source === "gps" && accuracy && accuracy > 100 && pos && (
        <Notice tone="warn">Position peu précise (environ {Math.round(accuracy)} m). Faites glisser le point rouge à l'endroit exact.</Notice>
      )}

      {/* Le véhicule peut-il rouler ? */}
      <div>
        <h2 className="text-xl font-black text-white mb-2">Votre véhicule peut-il encore rouler ?</h2>
        <div className="grid grid-cols-1 gap-2.5">
          {([
            { v: true, title: "Non, il est immobilisé", icon: <Truck className="w-7 h-7" />, hint: "Un mécanicien vient jusqu'à vous (dépannage)." },
            { v: false, title: "Oui, je peux me déplacer", icon: <Wrench className="w-7 h-7" />, hint: "Nous vous proposons un garage proche, vous vous y rendez (atelier)." },
          ] as const).map((o) => {
            const sel = immobilised === o.v;
            return (
              <button
                key={String(o.v)} type="button" onClick={() => { setImmobilised(o.v); setTileId(""); }} aria-pressed={sel}
                className={`text-left rounded-2xl border-2 p-4 min-h-[76px] flex items-center gap-3.5 transition cursor-pointer ${sel ? "border-red-500 bg-red-600/15" : "border-white/[0.08] bg-slate-950/50 hover:border-red-500/40"}`}
              >
                <span className={sel ? "text-red-500" : "text-slate-400"}>{o.icon}</span>
                <span>
                  <span className="block text-base font-black text-white leading-tight">{o.title}</span>
                  <span className="block text-xs text-slate-400 mt-0.5">{o.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {immobilised !== null && (<>
      {/* Type de panne */}
      <div>
        <h2 className="text-xl font-black text-white mb-2">Que se passe-t-il ?</h2>
        {prefill?.summary && (
          <div className="mb-3"><Notice tone="info">Votre diagnostic DiagAssist peut être joint à la demande (pistes à vérifier, pas une certitude). Vous décidez plus bas.</Notice></div>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          {TILES.map((t) => {
            const ok = tileAvailable(t);
            const sel = t.id === tileId;
            return (
              <button
                key={t.id} type="button" disabled={!ok} onClick={() => setTileId(t.id)} aria-pressed={sel}
                className={`text-left rounded-2xl border-2 p-3.5 min-h-[88px] flex flex-col justify-between gap-2 transition cursor-pointer ${
                  !ok ? "opacity-50 cursor-not-allowed border-white/[0.06] bg-slate-950/40"
                    : sel ? "border-red-500 bg-red-600/15"
                    : "border-white/[0.08] bg-slate-950/50 hover:border-red-500/40"
                }`}
              >
                <span className={sel ? "text-red-500" : "text-slate-400"}>{t.icon}</span>
                <span>
                  <span className="block text-sm font-black text-white leading-tight">{t.label}</span>
                  {!ok && <span className="block text-[11px] text-slate-500 mt-0.5">Bientôt disponible</span>}
                </span>
              </button>
            );
          })}
        </div>
        {tile?.id === "autre" && (
          <select value={otherService} onChange={(e) => setOtherService(e.target.value)} className={`${inputCls} mt-3`} aria-label="Type d'aide">
            <option value="">Quel type d'aide ?</option>
            {status.services.map((s) => (
              <option key={s.code} value={s.code} disabled={!s.available}>{s.label}{s.available ? "" : " (bientôt disponible)"}</option>
            ))}
          </select>
        )}
      </div>

      {/* Tarif connu à l'avance */}
      {serviceInfo && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-sm">
          <div className="font-black text-amber-300">{referenceTariffText(tariff, range?.min, range?.max)}</div>
          <div className="text-xs text-slate-400 mt-0.5">
            Plusieurs mécaniciens vous feront une offre, vous choisissez.{" "}
            {atelier
              ? "Vous vous rendez ensuite au garage choisi. "
              : "Le mécanicien choisi vient jusqu'à votre véhicule. "}
            Vous réglez le mécanicien dans l'appli après l'intervention. DiagAssist ne vous facture rien en plus.
          </div>
        </div>
      )}

      {/* Description + médias */}
      <div className="space-y-2.5">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} placeholder="En deux mots, que constatez-vous ? (facultatif)" className={inputCls} />
        <div className="grid grid-cols-2 gap-2.5">
          <label className="inline-flex items-center justify-center gap-2 min-h-[48px] rounded-2xl bg-slate-950/80 border border-white/[0.1] text-sm font-bold text-slate-200 cursor-pointer">
            <Camera className="w-4 h-4" /> Photo
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files, "image"); e.target.value = ""; }} />
          </label>
          <label className="inline-flex items-center justify-center gap-2 min-h-[48px] rounded-2xl bg-slate-950/80 border border-white/[0.1] text-sm font-bold text-slate-200 cursor-pointer">
            <Video className="w-4 h-4" /> Vidéo
            <input type="file" accept="video/mp4,video/webm" className="hidden" onChange={(e) => { void addFiles(e.target.files, "video"); e.target.value = ""; }} />
          </label>
        </div>
        {mediaError && <Notice tone="warn">{mediaError}</Notice>}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-white/[0.1] bg-slate-950 flex items-center justify-center text-slate-400">
                {a.preview ? <img src={a.preview} alt="" className="w-full h-full object-cover" /> : <Video className="w-6 h-6" />}
                <button type="button" onClick={() => removeAttach(a)} aria-label="Retirer" className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-black/70 text-[#ffffff] flex items-center justify-center cursor-pointer"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Repère + téléphone */}
      <div className="space-y-2.5">
        {atelier ? (
          <details>
            <summary className="cursor-pointer text-sm font-bold text-slate-400 min-h-[44px] flex items-center">Ajouter un repère (facultatif)</summary>
            <input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Un repère près de vous" className={inputCls} />
          </details>
        ) : (
          <input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Un repère pour vous trouver (facultatif)" className={inputCls} />
        )}
        <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Votre téléphone : 07 00 00 00 00" className={inputCls} aria-label="Votre numéro de téléphone" />
        {!phoneOk && <p className="text-xs text-amber-400">{atelier ? "Il ne sera transmis au garage qu'après votre confirmation." : "Le mécanicien en aura besoin pour vous joindre."}</p>}
      </div>

      {/* Véhicule */}
      <div>
        <button type="button" onClick={() => setShowVehicle((v) => !v)} className="flex items-center gap-2 min-h-[44px] text-sm font-bold text-slate-300 cursor-pointer" aria-expanded={showVehicle}>
          <Car className="w-4 h-4 text-red-500" /> Mon véhicule (facultatif)
          <ChevronDown className={`w-4 h-4 transition ${showVehicle ? "rotate-180" : ""}`} />
        </button>
        {showVehicle && (
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <input list="asst-brands" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Marque" className={inputCls} aria-label="Marque" />
              <datalist id="asst-brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
            </div>
            <div>
              <input list="asst-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Modèle" className={inputCls} aria-label="Modèle" />
              <datalist id="asst-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
            </div>
          </div>
        )}
      </div>

      {prefill?.summary && (
        <label className={`flex items-start gap-3 rounded-2xl border-2 p-4 cursor-pointer ${share ? "border-red-500 bg-red-600/10" : "border-white/[0.1] bg-slate-950/50"}`}>
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-1 w-6 h-6 accent-red-600 shrink-0" />
          <span className="text-sm text-slate-300 leading-snug">
            <strong className="block text-base text-white">Transmettre mon diagnostic au mécanicien</strong>
            Les pistes à vérifier de DiagAssist seront visibles par les mécaniciens qui font une offre. Sans votre accord, rien n'est transmis.
          </span>
        </label>
      )}

      <p className="text-xs text-slate-500 flex items-start gap-2"><ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
        DiagAssist analysera votre description et vos photos pour aider le mécanicien. Plusieurs mécaniciens proches vous feront une offre, vous choisissez.</p>
      </>)}
    </MapScreen>
  );
}
