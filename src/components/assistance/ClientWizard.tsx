import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Car, CircleSlash, Disc3, AlertCircle, Volume2, BatteryLow, Truck, HelpCircle,
  LocateFixed, MapPin, Camera, Video, Mic, X, ChevronDown, ChevronLeft, Check, Search, Loader2, ShieldCheck,
} from "lucide-react";
import {
  api, authToken, AssistanceStatus, compressImage, formatXOF, indicativeText, knownPhone, MAX_BYTES, readAsBase64, SERVICE_FALLBACK_LABEL,
} from "./api";
import { LocationPicker, LatLng } from "./AssistanceMaps";
import { btnPrimary, btnSecondary, Card, errText, inputCls, Label, Notice } from "./ui";

/** Données reprises depuis un diagnostic IA (écran de résultat). */
export interface AssistancePrefill {
  vehicle?: { brand?: string; model?: string; year?: string; engine?: string };
  symptoms?: string;
  faultCodes?: string[];
  /** Résumé des pistes à vérifier, transmis seulement si le client coche la case de consentement. */
  summary?: string;
}

interface Tile { id: string; label: string; hint: string; service: string; icon: React.ReactNode }

const TILES: Tile[] = [
  { id: "demarre", label: "Ne démarre pas", hint: "Le moteur ne se lance pas", service: "mecanique", icon: <CircleSlash className="w-8 h-8" /> },
  { id: "pneu", label: "Pneu crevé", hint: "Pneu à plat ou éclaté", service: "pneumatiques", icon: <Disc3 className="w-8 h-8" /> },
  { id: "voyant", label: "Voyant allumé", hint: "Un voyant s'affiche au tableau de bord", service: "diagnostic", icon: <AlertCircle className="w-8 h-8" /> },
  { id: "bruit", label: "Bruit anormal", hint: "Claquement, grincement, sifflement…", service: "mecanique", icon: <Volume2 className="w-8 h-8" /> },
  { id: "batterie", label: "Batterie à plat", hint: "Plus de courant, clic au démarrage", service: "batterie", icon: <BatteryLow className="w-8 h-8" /> },
  { id: "remorquage", label: "Besoin d'un remorquage", hint: "Le véhicule doit être déplacé", service: "remorquage", icon: <Truck className="w-8 h-8" /> },
  { id: "autre", label: "Autre problème", hint: "Je choisis moi-même", service: "", icon: <HelpCircle className="w-8 h-8" /> },
];

interface Attach { blob: Blob; name: string; mime: string; preview?: string; kind: "image" | "video" | "audio" }

type GeoState = "idle" | "loading" | "denied" | "unavailable" | "timeout";

export default function ClientWizard({
  status, prefill, initialPos, onCreated, onClose,
}: {
  status: AssistanceStatus;
  prefill?: AssistancePrefill | null;
  initialPos?: LatLng | null;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // --- Étape 1 : panne + véhicule ---
  const [tileId, setTileId] = useState<string>("");
  const [otherService, setOtherService] = useState("");
  const [brand, setBrand] = useState(prefill?.vehicle?.brand || "");
  const [model, setModel] = useState(prefill?.vehicle?.model || "");
  const [year, setYear] = useState(prefill?.vehicle?.year || "");
  const [engine, setEngine] = useState(prefill?.vehicle?.engine || "");
  const [faultCodes, setFaultCodes] = useState((prefill?.faultCodes || []).join(", "));
  const [description, setDescription] = useState(prefill?.symptoms || "");
  const [brands, setBrands] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<Attach[]>([]);
  const [mediaError, setMediaError] = useState("");
  const [showMore, setShowMore] = useState(!!(prefill?.faultCodes?.length || prefill?.vehicle?.year || prefill?.vehicle?.engine));

  // --- Étape 2 : position ---
  const [pos, setPos] = useState<LatLng | null>(initialPos || null);
  const [accuracy, setAccuracy] = useState<number | undefined>();
  const [source, setSource] = useState<"gps" | "carte" | "adresse">("carte");
  const [geo, setGeo] = useState<GeoState>("idle");
  const [address, setAddress] = useState("");
  const [landmark, setLandmark] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [phone, setPhone] = useState(knownPhone());

  // --- Étape 3 : envoi ---
  const [share, setShare] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const uploaded = useRef<Map<Attach, string>>(new Map());

  const tile = TILES.find((t) => t.id === tileId);
  const serviceCode = tile ? (tile.service || otherService) : "";
  const serviceInfo = status.services.find((s) => s.code === serviceCode);
  const serviceLabel = serviceInfo?.label || SERVICE_FALLBACK_LABEL[serviceCode] || serviceCode;

  const tileAvailable = (t: Tile) => {
    if (!t.service) return status.services.some((s) => s.available);
    const s = status.services.find((x) => x.code === t.service);
    return !!s?.available;
  };

  // Marques / modèles (catalogue existant)
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

  // ---- Médias ----
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
  const setPoint = (p: LatLng, src: "gps" | "carte" | "adresse", acc?: number) => {
    setPos(p); setSource(src); setAccuracy(acc); setConfirmed(false);
  };

  const useGps = () => {
    if (!navigator.geolocation) { setGeo("unavailable"); return; }
    setGeo("loading");
    navigator.geolocation.getCurrentPosition(
      (g) => {
        setGeo("idle");
        setPoint({ lat: g.coords.latitude, lng: g.coords.longitude }, "gps", g.coords.accuracy);
      },
      (err) => setGeo(err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const searchAddress = async () => {
    const q = address.trim();
    if (!q) return;
    setSearching(true); setSearchMsg("");
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ci&q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (Array.isArray(d) && d[0]) {
        setPoint({ lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) }, "adresse");
        setSearchMsg("Adresse trouvée. Vérifiez le point rouge et déplacez-le si besoin.");
      } else {
        setSearchMsg("Adresse introuvable. Touchez la carte pour placer le point vous-même.");
      }
    } catch {
      setSearchMsg("Recherche impossible pour le moment. Touchez la carte pour placer le point.");
    } finally {
      setSearching(false);
    }
  };

  // ---- Validation ----
  const phoneOk = phone.replace(/\D/g, "").length >= 8;
  const step1Ok = !!tile && !!serviceCode && tileAvailable(tile) && (serviceInfo ? serviceInfo.available : false);
  const step2Ok = !!pos && confirmed && phoneOk;

  const symptomsText = useMemo(() => {
    const base = tile ? (tile.id === "autre" ? serviceLabel : tile.label) : "";
    const extra = description.trim();
    return extra ? `${base} — ${extra}` : base;
  }, [tile, description, serviceLabel]);

  const send = async () => {
    if (!pos || !tile || sending) return;
    setSending(true); setError("");
    try {
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
      const codes = faultCodes.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
      const vehicle = {
        brand: brand.trim() || undefined, model: model.trim() || undefined,
        year: year.trim() || undefined, engine: engine.trim() || undefined, source: vehicleSource,
      };
      const body: Record<string, unknown> = {
        service: serviceCode,
        vehicle,
        symptoms: symptomsText,
        faultCodes: codes.length ? codes : undefined,
        description: description.trim() || undefined,
        contactPhone: phone.trim(),
        position: {
          lat: pos.lat, lng: pos.lng, accuracy, source,
          address: address.trim() || undefined, landmark: landmark.trim() || undefined, confirmed: true,
        },
        shareDiagnostic: !!(prefill?.summary && share),
        mediaIds: mediaIds.length ? mediaIds : undefined,
        submit: true,
      };
      if (prefill?.summary && share) {
        body.diagnostic = { summary: prefill.summary, faultCodes: prefill.faultCodes, vehicle };
      }
      const r = await api<{ request: { id: string } }>("/requests", { body });
      onCreated(r.request.id);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSending(false);
    }
  };

  const Progress = (
    <div className="flex items-center gap-2 mb-1" aria-label={`Étape ${step} sur 3`}>
      {[1, 2, 3].map((n) => (
        <div key={n} className={`h-2 flex-1 rounded-full ${n <= step ? "bg-red-600" : "bg-slate-800"}`} />
      ))}
      <span className="text-xs font-bold text-slate-400 ml-1 whitespace-nowrap">Étape {step}/3</span>
    </div>
  );

  // =========================== RENDU ===========================
  return (
    <div className="space-y-4 animate-fade-in">
      {Progress}

      {/* ---------------- Étape 1 ---------------- */}
      {step === 1 && (
        <>
          <div>
            <h2 className="text-2xl font-black text-white">Que se passe-t-il ?</h2>
            <p className="text-sm text-slate-400 mt-1">Touchez ce qui ressemble le plus à votre problème.</p>
          </div>

          {prefill?.summary && (
            <Notice tone="info">
              Le résultat de votre diagnostic DiagAssist est prêt à être joint (ce sont des pistes à vérifier, pas une certitude). Vous déciderez à la dernière étape si le mécanicien le reçoit.
            </Notice>
          )}

          <div className="grid grid-cols-2 gap-3">
            {TILES.map((t) => {
              const ok = tileAvailable(t);
              const sel = t.id === tileId;
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={!ok}
                  onClick={() => setTileId(t.id)}
                  aria-pressed={sel}
                  className={`text-left rounded-3xl border-2 p-4 min-h-[124px] flex flex-col justify-between transition cursor-pointer ${
                    !ok ? "opacity-50 cursor-not-allowed border-white/[0.06] bg-slate-950/40"
                      : sel ? "border-red-500 bg-red-600/15 shadow-lg shadow-red-600/10"
                      : "border-white/[0.08] bg-slate-900/60 hover:border-red-500/40"
                  }`}
                >
                  <span className={sel ? "text-red-500" : "text-slate-400"}>{t.icon}</span>
                  <span>
                    <span className="block text-base font-black text-white leading-tight mt-2">{t.label}</span>
                    <span className="block text-xs text-slate-400 mt-0.5 leading-snug">
                      {ok ? t.hint : "Bientôt disponible dans votre zone"}
                    </span>
                    {ok && (() => {
                      const code = t.service || "";
                      const info = code ? status.services.find((x) => x.code === code) : null;
                      if (!code) return null;
                      return <span className="block text-[11px] text-amber-300/90 mt-1 leading-snug">{typeof info?.indicativeAmount === "number" && info.indicativeAmount > 0 ? `Indicatif : ${formatXOF(info.indicativeAmount)}` : "Montant à convenir"}</span>;
                    })()}
                  </span>
                </button>
              );
            })}
          </div>

          {tile?.id === "autre" && (
            <div>
              <Label>Quel type d'aide ?</Label>
              <select value={otherService} onChange={(e) => setOtherService(e.target.value)} className={inputCls}>
                <option value="">Choisir…</option>
                {status.services.map((s) => (
                  <option key={s.code} value={s.code} disabled={!s.available}>
                    {s.label}{s.available ? "" : " (bientôt disponible dans votre zone)"}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Card className="space-y-4">
            <h3 className="text-base font-black text-white flex items-center gap-2"><Car className="w-5 h-5 text-red-500" /> Votre véhicule</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Marque</Label>
                <input list="asst-brands" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Ex : Toyota" className={inputCls} />
                <datalist id="asst-brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
              </div>
              <div>
                <Label>Modèle</Label>
                <input list="asst-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Ex : Corolla" className={inputCls} />
                <datalist id="asst-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
              </div>
            </div>
            <div>
              <Label>En deux mots, que constatez-vous ? (facultatif)</Label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} placeholder="Ex : ça a calé au feu rouge" className={inputCls} />
            </div>

            <button type="button" onClick={() => setShowMore((v) => !v)} className="flex items-center gap-2 text-sm font-bold text-slate-300 cursor-pointer" aria-expanded={showMore}>
              <ChevronDown className={`w-4 h-4 transition ${showMore ? "rotate-180" : ""}`} />
              Plus de détails (facultatif)
            </button>
            {showMore && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Année</Label>
                    <input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="2015" className={inputCls} />
                  </div>
                  <div>
                    <Label>Carburant</Label>
                    <select value={engine} onChange={(e) => setEngine(e.target.value)} className={inputCls}>
                      <option value="">Je ne sais pas</option>
                      <option>Essence</option><option>Diesel</option><option>Hybride</option><option>Électrique</option>
                    </select>
                  </div>
                </div>
                <div>
                  <Label>Code affiché par un appareil de diagnostic</Label>
                  <input value={faultCodes} onChange={(e) => setFaultCodes(e.target.value)} placeholder="Ex : P0300 (si vous le connaissez)" className={inputCls} />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Photo, vidéo ou son (facultatif)</Label>
              <div className="grid grid-cols-3 gap-2">
                <label className={`${btnSecondary} !px-2 !min-h-[48px] text-sm`}><Camera className="w-4 h-4" /> Photo
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files, "image"); e.target.value = ""; }} />
                </label>
                <label className={`${btnSecondary} !px-2 !min-h-[48px] text-sm`}><Video className="w-4 h-4" /> Vidéo
                  <input type="file" accept="video/mp4,video/webm" className="hidden" onChange={(e) => { void addFiles(e.target.files, "video"); e.target.value = ""; }} />
                </label>
                <label className={`${btnSecondary} !px-2 !min-h-[48px] text-sm`}><Mic className="w-4 h-4" /> Son
                  <input type="file" accept="audio/*" className="hidden" onChange={(e) => { void addFiles(e.target.files, "audio"); e.target.value = ""; }} />
                </label>
              </div>
              {mediaError && <Notice tone="warn">{mediaError}</Notice>}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((a, i) => (
                    <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-white/[0.1] bg-slate-950 flex items-center justify-center text-slate-400">
                      {a.preview ? <img src={a.preview} alt="" className="w-full h-full object-cover" /> : a.kind === "video" ? <Video className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                      <button type="button" onClick={() => removeAttach(a)} aria-label="Retirer" className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-black/70 text-[#ffffff] flex items-center justify-center cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-3 gap-3">
            <button className={btnSecondary} onClick={onClose}>Annuler</button>
            <button className={`${btnPrimary} col-span-2`} disabled={!step1Ok} onClick={() => setStep(2)}>Continuer</button>
          </div>
        </>
      )}

      {/* ---------------- Étape 2 ---------------- */}
      {step === 2 && (
        <>
          <div>
            <h2 className="text-2xl font-black text-white">Où êtes-vous ?</h2>
            <p className="text-sm text-slate-400 mt-1">Le mécanicien a besoin de votre position exacte pour vous rejoindre.</p>
          </div>

          <button type="button" onClick={useGps} disabled={geo === "loading"} className={btnPrimary}>
            {geo === "loading" ? <Loader2 className="w-5 h-5 animate-spin" /> : <LocateFixed className="w-5 h-5" />}
            {geo === "loading" ? "Recherche de votre position…" : "Utiliser ma position"}
          </button>

          {geo === "denied" && (
            <Notice tone="warn">
              La localisation est refusée sur votre téléphone. Vous pouvez l'autoriser dans les réglages du navigateur, ou simplement placer le point sur la carte ci-dessous.
            </Notice>
          )}
          {geo === "timeout" && <Notice tone="warn">Votre position n'a pas pu être trouvée à temps. Réessayez dehors, ou placez le point sur la carte.</Notice>}
          {geo === "unavailable" && <Notice tone="warn">La localisation n'est pas disponible sur cet appareil. Placez le point sur la carte.</Notice>}
          {source === "gps" && accuracy && accuracy > 100 && pos && (
            <Notice tone="warn">Position peu précise (environ {Math.round(accuracy)} m). Déplacez le point rouge à l'endroit exact si besoin.</Notice>
          )}

          <Card className="space-y-3">
            <p className="text-sm font-bold text-slate-300 flex items-center gap-2"><MapPin className="w-4 h-4 text-red-500" /> Sinon, touchez la carte pour placer le point</p>
            <LocationPicker value={pos} accuracy={source === "gps" ? accuracy : undefined} onChange={(p) => setPoint(p, "carte")} />
            <div>
              <Label>Adresse ou quartier (facultatif)</Label>
              <div className="flex gap-2">
                <input value={address} onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchAddress(); } }} placeholder="Ex : Boulevard de Marseille, Marcory" className={inputCls} />
                <button type="button" onClick={searchAddress} disabled={searching || !address.trim()} aria-label="Chercher cette adresse" className="shrink-0 w-14 rounded-2xl bg-slate-950/80 border border-white/[0.1] text-slate-200 flex items-center justify-center disabled:opacity-40 cursor-pointer">
                  {searching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                </button>
              </div>
              {searchMsg && <p className="text-xs text-slate-400 mt-1.5">{searchMsg}</p>}
            </div>
            <div>
              <Label>Un repère pour vous trouver (facultatif)</Label>
              <input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Ex : devant la pharmacie, station Total" className={inputCls} />
            </div>
          </Card>

          <div>
            <Label>Votre numéro de téléphone</Label>
            <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07 00 00 00 00" className={inputCls} />
            {!phoneOk && <p className="text-xs text-amber-400 mt-1">Le mécanicien en aura besoin pour vous joindre.</p>}
          </div>

          {pos && (
            <label className={`flex items-start gap-3 rounded-2xl border-2 p-4 cursor-pointer ${confirmed ? "border-emerald-500 bg-emerald-500/10" : "border-white/[0.1] bg-slate-900/50"}`}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 w-6 h-6 accent-emerald-600 shrink-0" />
              <span className="text-sm text-slate-200 leading-snug">
                <strong className="block text-base text-white">Je confirme que le point rouge est bien ma position</strong>
                Le mécanicien viendra exactement à cet endroit.
              </span>
            </label>
          )}

          <div className="grid grid-cols-3 gap-3">
            <button className={btnSecondary} onClick={() => setStep(1)}><ChevronLeft className="w-5 h-5" /> Retour</button>
            <button className={`${btnPrimary} col-span-2`} disabled={!step2Ok} onClick={() => setStep(3)}>Continuer</button>
          </div>
          {!pos && <p className="text-xs text-slate-500 text-center">Placez d'abord un point sur la carte ou utilisez votre position.</p>}
        </>
      )}

      {/* ---------------- Étape 3 ---------------- */}
      {step === 3 && (
        <>
          <div>
            <h2 className="text-2xl font-black text-white">Vérifiez et envoyez</h2>
            <p className="text-sm text-slate-400 mt-1">Nous contactons les mécaniciens près de vous : le premier qui accepte prend votre demande.</p>
          </div>

          <Card className="space-y-3 text-sm">
            <Row k="Problème" v={symptomsText} />
            <Row k="Service" v={serviceLabel} />
            <Row k="Véhicule" v={[brand, model, year].filter(Boolean).join(" ") || "Non précisé"} />
            {faultCodes.trim() && <Row k="Code défaut" v={faultCodes} />}
            <Row k="Position" v={address.trim() || (source === "gps" ? "Position GPS confirmée" : "Point confirmé sur la carte")} />
            {landmark.trim() && <Row k="Repère" v={landmark} />}
            <Row k="Téléphone" v={phone} />
            <Row k="Montant" v={indicativeText(serviceInfo?.indicativeAmount)} />
            {attachments.length > 0 && <Row k="Pièces jointes" v={`${attachments.length} fichier${attachments.length > 1 ? "s" : ""}`} />}
          </Card>

          {prefill?.summary && (
            <label className={`flex items-start gap-3 rounded-2xl border-2 p-4 cursor-pointer ${share ? "border-red-500 bg-red-600/10" : "border-white/[0.1] bg-slate-900/50"}`}>
              <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-1 w-6 h-6 accent-red-600 shrink-0" />
              <span className="text-sm text-slate-300 leading-snug">
                <strong className="block text-base text-white">J'accepte de transmettre ce diagnostic au mécanicien</strong>
                Les pistes à vérifier de DiagAssist (véhicule, symptômes, codes défaut) seront visibles par le mécanicien qui accepte votre demande. Ce sont des pistes, pas une certitude. Sans votre accord, rien n'est transmis.
              </span>
            </label>
          )}

          <Notice tone="info">DiagAssist analysera votre description et vos photos pour aider le mécanicien.</Notice>

          <Notice tone="info">
            <span className="inline-flex items-start gap-2"><ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
              Aucun paiement via DiagAssist. Le mécanicien vous propose un devis, vous l'acceptez ou le refusez avant tout travail ; le montant convenu se règle directement avec lui.</span>
          </Notice>

          {error && <Notice tone="error">{error}</Notice>}

          <div className="grid grid-cols-3 gap-3">
            <button className={btnSecondary} onClick={() => setStep(2)} disabled={sending}><ChevronLeft className="w-5 h-5" /> Retour</button>
            <button className={`${btnPrimary} col-span-2`} onClick={send} disabled={sending}>
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
              {sending ? "Envoi en cours…" : "Envoyer ma demande"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500 shrink-0">{k}</span>
      <span className="text-slate-200 font-semibold text-right break-words min-w-0">{v}</span>
    </div>
  );
}
