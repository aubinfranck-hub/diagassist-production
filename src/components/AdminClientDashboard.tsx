import React, { useState, useEffect, useCallback, useRef } from "react";
import { UserPlus, Users, MapPin, LogOut, RefreshCw, Key, AlertCircle, Shield, MessageCircle, History, Image as ImageIcon, Trash2, ToggleLeft, ToggleRight, Wrench, Upload, Car } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Account {
  phone: string;
  createdAt: number;
  plan: string;
  expiresAt: number | null;
  isAdmin: boolean;
  email: string | null;
  name: string | null;
  location: { latitude: number; longitude: number; accuracy?: number; updatedAt: number } | null;
}

interface SessionInfo {
  tokenRef: string;
  phone: string;
  plan: string;
  createdAt: number;
  location: { latitude: number; longitude: number; accuracy?: number; updatedAt: number } | null;
}

interface HistoryEntry {
  phone: string;
  timestamp: number;
}

interface MechanicEntry {
  id: string;
  type: "mechanic" | "parts_vendor";
  name: string;
  garageName?: string;
  phone: string;
  city: string;
  area?: string;
  specialties?: string;
  hasScanner: boolean;
  certified: boolean;
  active: boolean;
  createdAt: number;
}

interface Banner {
  id: string;
  imageUrl: string;
  linkUrl?: string;
  displayType: "banner" | "floating";
  active: boolean;
  createdAt: number;
}

interface JekoPayment {
  reference: string;
  phone: string;
  plan: string;
  amount_cents: number;
  status: "pending" | "success" | "error";
  created_at: number;
  jeko_id: string | null;
}

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("auth_session_token");
  return { "Content-Type": "application/json", "Authorization": `Bearer ${token || ""}` };
};

const PLAN_LABELS: Record<string, string> = {
  free_trial: "Essai gratuit",
  free_expired: "Expiré",
  lite: "Lite",
  premium: "Premium",
  payg_active: "Pass 24h",
  owner_week: "Pass Semaine",
};

const formatDate = (ts: number) => new Date(ts).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

// Affiche le temps restant avant expiration du forfait, ou son absence pour les forfaits sans durée
function formatRemainingTime(expiresAt: number | null, plan: string): { text: string; expired: boolean } {
  if (plan === "free_expired") return { text: "Expiré", expired: true };
  if (!expiresAt) return { text: "—", expired: false };
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) return { text: "Expiré", expired: true };
  const days = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((remainingMs / (1000 * 60 * 60)) % 24);
  if (days > 0) return { text: `${days}j ${hours}h`, expired: false };
  const minutes = Math.floor((remainingMs / (1000 * 60)) % 60);
  return { text: `${hours}h ${minutes}m`, expired: false };
}

// Numéro au format international -> format attendu par wa.me (chiffres uniquement)
const toWaMeNumber = (phone: string) => phone.replace(/[^0-9]/g, "");

// Carte intégrée avec un vrai repère à la position exacte, dépliable au clic
function LocationMapPreview({ location }: { location: { latitude: number; longitude: number; accuracy?: number; updatedAt: number } }) {
  const [expanded, setExpanded] = useState(false);
  const embedUrl = `https://www.google.com/maps?q=${location.latitude},${location.longitude}&z=15&output=embed`;
  const fullMapUrl = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer flex-wrap"
      >
        <MapPin className="w-3 h-3" />
        {expanded ? "Masquer la carte" : "Voir le point exact sur la carte"}
        ({location.latitude.toFixed(4)}, {location.longitude.toFixed(4)})
        <span className="text-slate-500">— maj {formatDate(location.updatedAt)}</span>
      </button>
      {typeof location.accuracy === "number" && (
        <p className={`text-[10px] flex items-center gap-1 ${location.accuracy > 1000 ? "text-amber-400" : "text-slate-500"}`}>
          {location.accuracy > 1000 ? "⚠️" : "🎯"} Précision : ± {location.accuracy < 1000 ? `${Math.round(location.accuracy)} m` : `${(location.accuracy / 1000).toFixed(1)} km`}
          {location.accuracy > 1000 && " — position approximative (WiFi/IP), pas de GPS précis sur cet appareil"}
        </p>
      )}
      {expanded && (
        <div className="rounded-xl overflow-hidden border border-white/[0.08]">
          <iframe
            title="Position du client"
            src={embedUrl}
            width="100%"
            height="220"
            style={{ border: 0 }}
            loading="lazy"
          />
          <a
            href={fullMapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-[10px] text-slate-400 hover:text-white bg-slate-900 py-1.5"
          >
            Ouvrir en plein écran dans Google Maps
          </a>
        </div>
      )}
    </div>
  );
}

// Icônes chargées depuis un CDN plutôt qu'importées localement : évite de dépendre
// des déclarations de types PNG (non configurées dans ce projet) pour un simple asset statique.
const clientMarkerIcon = L.icon({
  iconUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Vue d'ensemble : tous les clients géolocalisés sur une seule carte (fond sombre CartoDB,
// pas de clé API requise, contrairement à l'API JS Google Maps).
function ClientsMap({ accounts }: { accounts: Account[] }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  const located = accounts.filter((a) => a.location);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current).setView([5.34, -4.03], 7); // Abidjan par défaut
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      maxZoom: 19,
    }).addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const points: [number, number][] = [];
    located.forEach((a) => {
      const loc = a.location!;
      points.push([loc.latitude, loc.longitude]);
      const label = a.name || a.phone;
      L.marker([loc.latitude, loc.longitude], { icon: clientMarkerIcon })
        .bindPopup(
          `<b>${label}</b><br/>${a.phone}<br/>${PLAN_LABELS[a.plan] || a.plan}<br/><span style="color:#94a3b8">maj ${formatDate(loc.updatedAt)}</span>`
        )
        .addTo(layer);
    });
    if (points.length > 0) {
      map.fitBounds(points, { padding: [30, 30], maxZoom: 13 });
    }
  }, [located]);

  return (
    <div className="space-y-2">
      <div ref={mapContainerRef} className="w-full h-[420px] rounded-xl overflow-hidden border border-white/[0.08]" />
      <p className="text-[10px] text-slate-500">
        {located.length} client(s) géolocalisé(s) sur {accounts.length} compte(s) au total.
      </p>
    </div>
  );
}

export default function AdminClientDashboard() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeSessions, setActiveSessions] = useState<SessionInfo[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [bannerList, setBannerList] = useState<Banner[]>([]);
  const [jekoPayments, setJekoPayments] = useState<JekoPayment[]>([]);
  const [reconcilingRef, setReconcilingRef] = useState<string | null>(null);
  const [resetPwdPhone, setResetPwdPhone] = useState<string | null>(null);
  const [resetPwdValue, setResetPwdValue] = useState("");
  const [resetPwdBusy, setResetPwdBusy] = useState(false);
  const [resetPwdFeedback, setResetPwdFeedback] = useState<{ phone: string; ok: boolean; message: string } | null>(null);

  const [vehiclesApiCode, setVehiclesApiCode] = useState("");
  const [vehiclesSyncing, setVehiclesSyncing] = useState(false);
  const [vehiclesSyncResult, setVehiclesSyncResult] = useState<string | null>(null);
  const [vehiclesCount, setVehiclesCount] = useState<{ count: number; brands: number } | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [logoutBusyPhone, setLogoutBusyPhone] = useState<string | null>(null);
  const [logoutFeedback, setLogoutFeedback] = useState<{ phone: string; ok: boolean; message: string } | null>(null);
  const [mapModalLocation, setMapModalLocation] = useState<Account["location"]>(null);

  // Création de compte
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("+225");
  const [accountName, setAccountName] = useState("");
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState("");
  const [durationValue, setDurationValue] = useState<number>(30);
  const [durationUnit, setDurationUnit] = useState("jour");
  const [asAdmin, setAsAdmin] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdAccount, setCreatedAccount] = useState<{ phone: string; password: string } | null>(null);

  // Bannières / publicités
  const [bannerImageUrl, setBannerImageUrl] = useState("");
  const [bannerUploading, setBannerUploading] = useState(false);
  const bannerFileInputRef = useRef<HTMLInputElement>(null);

  const handleBannerFileUpload = (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      alert("Image trop volumineuse (max 5 Mo).");
      return;
    }
    setBannerUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      setBannerImageUrl(reader.result as string);
      setBannerUploading(false);
    };
    reader.onerror = () => setBannerUploading(false);
    reader.readAsDataURL(file);
  };
  const [bannerLinkUrl, setBannerLinkUrl] = useState("");
  const [bannerType, setBannerType] = useState<"banner" | "floating">("banner");
  const [bannerCreating, setBannerCreating] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  // Réseau de mécaniciens agréés
  const [mechanicsList, setMechanicsList] = useState<MechanicEntry[]>([]);
  const [mType, setMType] = useState<"mechanic" | "parts_vendor">("mechanic");
  const [mName, setMName] = useState("");
  const [mGarage, setMGarage] = useState("");
  const [mPhone, setMPhone] = useState("");
  const [mCity, setMCity] = useState("");
  const [mArea, setMArea] = useState("");
  const [mSpecialties, setMSpecialties] = useState("");
  const [mHasScanner, setMHasScanner] = useState(true);
  const [mCertified, setMCertified] = useState(true);
  const [mCreating, setMCreating] = useState(false);
  const [mError, setMError] = useState<string | null>(null);

  const handleCreateMechanic = async (e: React.FormEvent) => {
    e.preventDefault();
    setMCreating(true);
    setMError(null);
    try {
      const res = await fetch("/api/admin/mechanics", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          type: mType,
          name: mName,
          garageName: mGarage || undefined,
          phone: mPhone,
          city: mCity,
          area: mArea || undefined,
          specialties: mSpecialties || undefined,
          hasScanner: mHasScanner,
          certified: mCertified,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMName(""); setMGarage(""); setMPhone(""); setMCity(""); setMArea(""); setMSpecialties("");
        loadData();
      } else {
        setMError(data.message || "Échec de l'ajout du mécanicien.");
      }
    } catch {
      setMError("Erreur réseau.");
    } finally {
      setMCreating(false);
    }
  };

  const handleToggleMechanic = async (id: string) => {
    try {
      await fetch(`/api/admin/mechanics/${id}/toggle`, { method: "POST", headers: authHeaders() });
      loadData();
    } catch {
      // silencieux — l'utilisateur peut réessayer via le bouton rafraîchir
    }
  };

  const handleDeleteMechanic = async (id: string) => {
    try {
      await fetch(`/api/admin/mechanics/${id}`, { method: "DELETE", headers: authHeaders() });
      loadData();
    } catch {
      // silencieux
    }
  };

  const generatePassword = (): string => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let pwd = "";
    for (let i = 0; i < 8; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    return pwd;
  };

  const loadData = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const [accRes, sessRes, histRes, bannerRes, mechRes, jekoRes] = await Promise.all([
        fetch("/api/admin/accounts", { headers: authHeaders() }),
        fetch("/api/admin/sessions", { headers: authHeaders() }),
        fetch("/api/admin/connection-history", { headers: authHeaders() }),
        fetch("/api/admin/banners", { headers: authHeaders() }),
        fetch("/api/admin/mechanics", { headers: authHeaders() }),
        fetch("/api/admin/jeko/payments", { headers: authHeaders() }),
      ]);
      const accData = await accRes.json();
      const sessData = await sessRes.json();
      const histData = await histRes.json();
      const bannerData = await bannerRes.json();
      const mechData = await mechRes.json();
      const jekoData = await jekoRes.json();

      const errors: string[] = [];
      if (accData.success) setAccounts(accData.accounts); else errors.push(accData.message || "comptes");
      if (sessData.success) setActiveSessions(sessData.sessions); else errors.push(sessData.message || "sessions");
      if (histData.success) setHistory(histData.history); else errors.push(histData.message || "historique");
      if (bannerData.success) setBannerList(bannerData.banners); else errors.push(bannerData.message || "bannières");
      if (mechData.success) setMechanicsList(mechData.mechanics); else errors.push(mechData.message || "mécaniciens");
      if (jekoData.success) setJekoPayments(jekoData.payments); else errors.push(jekoData.message || "paiements Jèko");

      if (errors.length > 0) setListError(`Certaines données n'ont pas pu être chargées : ${errors.join(", ")}`);
    } catch {
      setListError("Erreur réseau lors du chargement. Vérifiez votre connexion et réessayez.");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    fetch("/api/admin/vehicles/count", { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => { if (data.success) setVehiclesCount({ count: data.count, brands: data.brands }); })
      .catch(() => {});
  }, []);

  const handleSyncVehicles = async () => {
    setVehiclesSyncing(true);
    setVehiclesSyncResult(null);
    try {
      const res = await fetch("/api/admin/vehicles/sync", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ apiCode: vehiclesApiCode }),
      });
      const data = await res.json();
      if (data.success) {
        setVehiclesSyncResult(`${data.inserted} motorisation(s) importée(s), ${data.brands} marque(s).`);
        setVehiclesCount({ count: data.inserted, brands: data.brands });
      } else {
        setVehiclesSyncResult(`Erreur : ${data.message}`);
      }
    } catch {
      setVehiclesSyncResult("Erreur réseau.");
    } finally {
      setVehiclesSyncing(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreatedAccount(null);
    try {
      const cleanPhone = phone.replace(/\s+/g, "");
      const fullPhone = `${countryCode}${cleanPhone}`;
      const generatedPassword = generatePassword();
      const res = await fetch("/api/admin/create-account", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          phone: fullPhone,
          password: generatedPassword,
          plan: plan || undefined,
          isAdmin: asAdmin,
          email: email || undefined,
          name: accountName.trim() || undefined,
          durationValue: plan ? durationValue : undefined,
          durationUnit: plan ? durationUnit : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCreatedAccount({ phone: fullPhone, password: generatedPassword });
        setPhone("");
        setEmail("");
        setAccountName("");
        loadData();
      } else {
        setCreateError(data.message || "Échec de la création du compte.");
      }
    } catch {
      setCreateError("Erreur réseau — la requête n'a pas atteint le serveur.");
    } finally {
      setCreating(false);
    }
  };

  const handleForceLogout = async (targetPhone: string) => {
    setLogoutBusyPhone(targetPhone);
    setLogoutFeedback(null);
    try {
      const res = await fetch("/api/admin/force-logout", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ phone: targetPhone }),
      });
      const data = await res.json();
      if (data.success) {
        setLogoutFeedback({ phone: targetPhone, ok: true, message: data.message || "Déconnecté." });
        loadData();
      } else {
        setLogoutFeedback({ phone: targetPhone, ok: false, message: data.message || "Échec de la déconnexion." });
      }
    } catch {
      setLogoutFeedback({ phone: targetPhone, ok: false, message: "Erreur réseau — la requête n'a pas atteint le serveur." });
    } finally {
      setLogoutBusyPhone(null);
    }
  };

  const handleCreateBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    setBannerCreating(true);
    setBannerError(null);
    try {
      const res = await fetch("/api/admin/banners", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ imageUrl: bannerImageUrl, linkUrl: bannerLinkUrl || undefined, displayType: bannerType }),
      });
      const data = await res.json();
      if (data.success) {
        setBannerImageUrl("");
        setBannerLinkUrl("");
        loadData();
      } else {
        setBannerError(data.message || "Échec de la création de la bannière.");
      }
    } catch {
      setBannerError("Erreur réseau.");
    } finally {
      setBannerCreating(false);
    }
  };

  const handleSetPassword = async (phone: string) => {
    if (resetPwdValue.length < 6) {
      setResetPwdFeedback({ phone, ok: false, message: "6 caractères minimum." });
      return;
    }
    setResetPwdBusy(true);
    try {
      const res = await fetch(`/api/admin/accounts/${encodeURIComponent(phone)}/set-password`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ password: resetPwdValue }),
      });
      const data = await res.json();
      setResetPwdFeedback({ phone, ok: Boolean(data.success), message: data.message || "Erreur." });
      if (data.success) {
        setResetPwdPhone(null);
        setResetPwdValue("");
      }
    } catch {
      setResetPwdFeedback({ phone, ok: false, message: "Erreur réseau." });
    } finally {
      setResetPwdBusy(false);
    }
  };

  const handleReconcilePayment = async (reference: string) => {
    setReconcilingRef(reference);
    try {
      await fetch(`/api/admin/jeko/payments/${encodeURIComponent(reference)}/reconcile`, { method: "POST", headers: authHeaders() });
      loadData();
    } catch {
      // silencieux — l'utilisateur peut réessayer
    } finally {
      setReconcilingRef(null);
    }
  };

  const handleToggleBanner = async (id: string) => {
    try {
      await fetch(`/api/admin/banners/${id}/toggle`, { method: "POST", headers: authHeaders() });
      loadData();
    } catch {
      // silencieux — l'utilisateur peut réessayer via le bouton rafraîchir
    }
  };

  const handleDeleteBanner = async (id: string) => {
    try {
      await fetch(`/api/admin/banners/${id}`, { method: "DELETE", headers: authHeaders() });
      loadData();
    } catch {
      // silencieux
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Création de compte */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-emerald-400" />
          Créer un compte client
        </h3>
        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <select
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            className="bg-slate-950 border border-white/[0.08] text-slate-300 rounded-xl px-3 py-2.5 text-xs font-bold focus:outline-none focus:border-emerald-500 cursor-pointer w-full"
          >
            <option value="+225">+225 (CI)</option>
            <option value="+221">+221 (SN)</option>
            <option value="+223">+223 (ML)</option>
            <option value="+226">+226 (BF)</option>
            <option value="+228">+228 (TG)</option>
            <option value="+229">+229 (BJ)</option>
          </select>
          <input
            type="tel"
            required
            placeholder="07 12 34 56"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
          />
          <input
            type="text"
            placeholder="Nom (optionnel)"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            className="w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
          />
          <input
            type="email"
            placeholder="Email (optionnel)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
          />

          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className="bg-slate-950 border border-white/[0.08] text-slate-300 rounded-xl px-3 py-2.5 text-xs font-bold focus:outline-none focus:border-emerald-500 cursor-pointer w-full"
          >
            <option value="">Forfait : ne pas changer</option>
            <option value="free_trial">Essai gratuit</option>
            <option value="lite">Lite</option>
            <option value="premium">Premium</option>
            <option value="payg_active">Pass 24h</option>
            <option value="owner_week">Pass Semaine (propriétaire)</option>
          </select>
          <input
            type="number"
            min={1}
            disabled={!plan}
            value={durationValue}
            onChange={(e) => setDurationValue(Number(e.target.value))}
            placeholder="Durée"
            className="w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 disabled:opacity-40"
          />
          <select
            value={durationUnit}
            disabled={!plan}
            onChange={(e) => setDurationUnit(e.target.value)}
            className="bg-slate-950 border border-white/[0.08] text-slate-300 rounded-xl px-3 py-2.5 text-xs font-bold focus:outline-none focus:border-emerald-500 cursor-pointer w-full disabled:opacity-40"
          >
            <option value="jour">Jour(s)</option>
            <option value="semaine">Semaine(s)</option>
            <option value="mois">Mois</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-400 font-bold whitespace-nowrap px-1 cursor-pointer bg-slate-950 border border-white/[0.08] rounded-xl justify-center">
            <input
              type="checkbox"
              checked={asAdmin}
              onChange={(e) => setAsAdmin(e.target.checked)}
              className="cursor-pointer accent-emerald-500"
            />
            Compte admin
          </label>

          <button
            type="submit"
            disabled={creating}
            className="sm:col-span-2 lg:col-span-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer disabled:opacity-50 w-full"
          >
            {creating ? "Création..." : "Créer le compte"}
          </button>
        </form>

        {createError && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-xl flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{createError}</span>
          </div>
        )}
        {createdAccount && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-1.5">
            <p className="text-[11px] text-emerald-300 font-bold uppercase tracking-wider">Compte créé — communiquez ceci au client :</p>
            <p className="text-xs text-slate-300">Numéro : <span className="font-mono font-bold text-white">{createdAccount.phone}</span></p>
            <p className="text-xs text-slate-300">Mot de passe : <span className="font-mono font-bold text-white text-base">{createdAccount.password}</span></p>
            <p className="text-[10px] text-emerald-400/70">⚠️ Ce mot de passe ne sera plus jamais affiché ici.</p>
            <a
              href={`https://wa.me/${createdAccount.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                `Bonjour, voici vos identifiants DiagAssist :\n\nNuméro : ${createdAccount.phone}\nMot de passe : ${createdAccount.password}\n\nConnectez-vous sur https://www.diagassist.app pour commencer.`
              )}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-2 rounded-lg"
            >
              <MessageCircle className="w-3.5 h-3.5" /> Envoyer par WhatsApp
            </a>
          </div>
        )}
      </div>

      {/* Sessions actives */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-400" />
            Connexions actives ({activeSessions.length})
          </h3>
          <button
            onClick={loadData}
            className="text-slate-400 hover:text-white transition cursor-pointer"
            title="Rafraîchir"
          >
            <RefreshCw className={`w-4 h-4 ${loadingList ? "animate-spin" : ""}`} />
          </button>
        </div>

        {listError && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-xl flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{listError}</span>
          </div>
        )}

        {activeSessions.length === 0 && !loadingList && (
          <p className="text-xs text-slate-500">Aucune connexion active pour le moment.</p>
        )}

        <div className="space-y-2">
          {activeSessions.map((s) => (
            <div key={s.tokenRef} className="flex flex-col gap-2 bg-slate-950 border border-white/[0.06] rounded-xl p-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <p className="text-xs font-mono font-bold text-white">{s.phone}</p>
                  <p className="text-[10px] text-slate-500">
                    {PLAN_LABELS[s.plan] || s.plan} · connecté le {formatDate(s.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={`https://wa.me/${toWaMeNumber(s.phone)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-950/30 hover:bg-emerald-950/50 border border-emerald-500/20 text-emerald-400 rounded-xl text-[11px] font-bold transition cursor-pointer whitespace-nowrap"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    WhatsApp
                  </a>
                  <button
                    onClick={() => handleForceLogout(s.phone)}
                    disabled={logoutBusyPhone === s.phone}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/30 hover:bg-rose-950/50 border border-rose-500/20 text-rose-400 rounded-xl text-[11px] font-bold transition cursor-pointer whitespace-nowrap disabled:opacity-50"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    {logoutBusyPhone === s.phone ? "..." : "Déconnecter"}
                  </button>
                </div>
              </div>

              {s.location ? (
                <LocationMapPreview location={s.location} />
              ) : (
                <p className="text-[10px] text-slate-600 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Position non partagée par ce client
                </p>
              )}

              {logoutFeedback && logoutFeedback.phone === s.phone && (
                <p className={`text-[10px] ${logoutFeedback.ok ? "text-emerald-400" : "text-rose-400"}`}>
                  {logoutFeedback.message}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Paiements Jèko (abonnements payés en ligne) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
          <Wrench className="w-4 h-4 text-emerald-400" />
          Paiements Jèko ({jekoPayments.length})
        </h3>
        {jekoPayments.length === 0 && !loadingList && (
          <p className="text-xs text-slate-500">Aucun paiement en ligne pour le moment.</p>
        )}
        {jekoPayments.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 uppercase text-[10px] border-b border-slate-800">
                  <th className="py-2 pr-3">Téléphone</th>
                  <th className="py-2 pr-3">Forfait</th>
                  <th className="py-2 pr-3">Montant</th>
                  <th className="py-2 pr-3">Statut</th>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {jekoPayments.map((p) => (
                  <tr key={p.reference} className="border-b border-slate-800/60">
                    <td className="py-2 pr-3 font-mono text-slate-300">{p.phone}</td>
                    <td className="py-2 pr-3 text-slate-300">{PLAN_LABELS[p.plan] || p.plan}</td>
                    <td className="py-2 pr-3 text-slate-300">{(p.amount_cents / 100).toLocaleString("fr-FR")} F</td>
                    <td className="py-2 pr-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        p.status === "success" ? "bg-emerald-500/10 text-emerald-400" :
                        p.status === "error" ? "bg-rose-500/10 text-rose-400" :
                        "bg-amber-500/10 text-amber-400"
                      }`}>
                        {p.status === "success" ? "Confirmé" : p.status === "error" ? "Échoué" : "En attente"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{formatDate(p.created_at)}</td>
                    <td className="py-2 pr-3">
                      {p.status === "pending" && p.jeko_id && (
                        <button
                          onClick={() => handleReconcilePayment(p.reference)}
                          disabled={reconcilingRef === p.reference}
                          className="text-sky-400 hover:text-sky-300 text-[10px] font-bold uppercase disabled:opacity-50 cursor-pointer"
                        >
                          {reconcilingRef === p.reference ? "..." : "Revérifier"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Base véhicules (Auto-Data.net) — alimente les menus marque/modèle du formulaire de diagnostic */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
          <Car className="w-4 h-4 text-amber-400" />
          Base véhicules (Auto-Data.net)
        </h3>
        <p className="text-xs text-slate-500">
          {vehiclesCount ? `${vehiclesCount.count.toLocaleString("fr-FR")} motorisation(s) en base, ${vehiclesCount.brands} marque(s).` : "Chargement..."}
        </p>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            placeholder="Code d'accès API Auto-Data.net"
            value={vehiclesApiCode}
            onChange={(e) => setVehiclesApiCode(e.target.value)}
            className="flex-1 bg-slate-950 border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 font-mono"
          />
          <button
            onClick={handleSyncVehicles}
            disabled={vehiclesSyncing || !vehiclesApiCode.trim()}
            className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition cursor-pointer whitespace-nowrap"
          >
            {vehiclesSyncing ? "Synchronisation..." : "Synchroniser"}
          </button>
        </div>
        {vehiclesSyncResult && <p className="text-xs text-slate-400">{vehiclesSyncResult}</p>}
      </div>

      {/* Historique des connexions */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
          <History className="w-4 h-4 text-amber-400" />
          Historique des connexions ({history.length})
        </h3>
        <div className="max-h-64 overflow-y-auto space-y-1.5">
          {history.length === 0 && <p className="text-xs text-slate-500">Aucun historique pour le moment.</p>}
          {history.map((h, i) => (
            <div key={i} className="flex items-center justify-between text-xs bg-slate-950/60 rounded-lg px-3 py-2">
              <span className="font-mono text-slate-300">{h.phone}</span>
              <span className="text-slate-500 text-[10px]">{formatDate(h.timestamp)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Carte des clients */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-emerald-400" />
          Carte des clients
        </h3>
        <ClientsMap accounts={accounts} />
      </div>

      {/* Tous les comptes */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
          <Key className="w-4 h-4 text-slate-400" />
          Tous les comptes ({accounts.length})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <th className="py-2 pr-3">Numéro</th>
                <th className="py-2 pr-3">Nom</th>
                <th className="py-2 pr-3">Forfait</th>
                <th className="py-2 pr-3">Temps restant</th>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Créé le</th>
                <th className="py-2 pr-3">Rôle</th>
                <th className="py-2 pr-3">Position</th>
                <th className="py-2 pr-3">Contact</th>
                <th className="py-2 pr-3">Mot de passe</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const remaining = formatRemainingTime(a.expiresAt, a.plan);
                return (
                <tr key={a.phone} className="border-b border-slate-800/50">
                  <td className="py-2 pr-3 font-mono text-white">{a.phone}</td>
                  <td className="py-2 pr-3 text-slate-300">{a.name || "—"}</td>
                  <td className="py-2 pr-3 text-slate-300">{PLAN_LABELS[a.plan] || a.plan}</td>
                  <td className={`py-2 pr-3 font-mono ${remaining.expired ? "text-rose-400" : "text-emerald-400"}`}>{remaining.text}</td>
                  <td className="py-2 pr-3 text-slate-400">{a.email || "—"}</td>
                  <td className="py-2 pr-3 text-slate-500">{formatDate(a.createdAt)}</td>
                  <td className="py-2 pr-3">
                    {a.isAdmin ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                        <Shield className="w-3 h-3" /> Admin
                      </span>
                    ) : (
                      <span className="text-slate-500">Client</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {a.location ? (
                      <button
                        onClick={() => setMapModalLocation(a.location)}
                        className="text-emerald-400 hover:text-emerald-300 cursor-pointer"
                        title="Voir le point exact sur la carte"
                      >
                        <MapPin className="w-4 h-4" />
                      </button>
                    ) : (
                      <span className="text-slate-600" title="Position non partagée">
                        <MapPin className="w-4 h-4" />
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <a
                      href={`https://wa.me/${toWaMeNumber(a.phone)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-400 hover:text-emerald-300"
                      title="Écrire sur WhatsApp"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </a>
                  </td>
                  <td className="py-2 pr-3">
                    {resetPwdPhone === a.phone ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          autoFocus
                          placeholder="Nouveau mdp"
                          value={resetPwdValue}
                          onChange={(e) => setResetPwdValue(e.target.value)}
                          className="w-24 bg-slate-950 border border-white/[0.08] rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-emerald-500"
                        />
                        <button
                          onClick={() => handleSetPassword(a.phone)}
                          disabled={resetPwdBusy}
                          className="text-emerald-400 hover:text-emerald-300 text-[10px] font-bold uppercase cursor-pointer disabled:opacity-50"
                        >
                          OK
                        </button>
                        <button
                          onClick={() => { setResetPwdPhone(null); setResetPwdValue(""); }}
                          className="text-slate-500 hover:text-slate-300 text-[10px] cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setResetPwdPhone(a.phone); setResetPwdValue(""); setResetPwdFeedback(null); }}
                        className="text-sky-400 hover:text-sky-300 text-[10px] font-bold uppercase cursor-pointer"
                      >
                        Réinitialiser
                      </button>
                    )}
                    {resetPwdFeedback && resetPwdFeedback.phone === a.phone && (
                      <p className={`text-[10px] mt-0.5 ${resetPwdFeedback.ok ? "text-emerald-400" : "text-rose-400"}`}>
                        {resetPwdFeedback.message}
                      </p>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Réseau de partenaires : mécaniciens agréés et vendeurs de pièces */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
          <Wrench className="w-4 h-4 text-sky-400" />
          Réseau de partenaires ({mechanicsList.length})
        </h3>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Mécaniciens agréés et vendeurs de pièces proposés aux propriétaires de véhicules, dans deux sections séparées de l'application.
        </p>

        <form onSubmit={handleCreateMechanic} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          <select
            value={mType}
            onChange={(e) => setMType(e.target.value as "mechanic" | "parts_vendor")}
            className="w-full bg-slate-950 border border-white/[0.08] text-slate-300 rounded-xl px-3 py-2.5 text-xs font-bold focus:outline-none focus:border-sky-500 cursor-pointer"
          >
            <option value="mechanic">Type : Mécanicien</option>
            <option value="parts_vendor">Type : Vendeur de pièces</option>
          </select>
          <input
            type="text" required placeholder="Nom du mécanicien *"
            value={mName} onChange={(e) => setMName(e.target.value)}
            className="w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
          />
          <input
            type="text" placeholder="Nom du garage (optionnel)"
            value={mGarage} onChange={(e) => setMGarage(e.target.value)}
            className="w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
          />
          <input
            type="tel" required placeholder="Téléphone * (+225...)"
            value={mPhone} onChange={(e) => setMPhone(e.target.value)}
            className="w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500 font-mono"
          />
          <input
            type="text" required placeholder="Ville * (ex: Abidjan)"
            value={mCity} onChange={(e) => setMCity(e.target.value)}
            className="w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
          />
          <input
            type="text" placeholder="Quartier (ex: Yopougon)"
            value={mArea} onChange={(e) => setMArea(e.target.value)}
            className="w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
          />
          <input
            type="text" placeholder="Spécialités (ex: Diesel, boîte auto)"
            value={mSpecialties} onChange={(e) => setMSpecialties(e.target.value)}
            className="w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
          />
          <label className="flex items-center gap-1.5 text-xs text-slate-400 font-bold cursor-pointer bg-slate-950 border border-white/[0.08] rounded-xl justify-center py-2.5">
            <input type="checkbox" checked={mHasScanner} onChange={(e) => setMHasScanner(e.target.checked)} className="cursor-pointer accent-sky-500" />
            A une valise
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-400 font-bold cursor-pointer bg-slate-950 border border-white/[0.08] rounded-xl justify-center py-2.5">
            <input type="checkbox" checked={mCertified} onChange={(e) => setMCertified(e.target.checked)} className="cursor-pointer accent-emerald-500" />
            Agréé
          </label>
          <button
            type="submit" disabled={mCreating}
            className="bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer disabled:opacity-50 w-full"
          >
            {mCreating ? "Ajout..." : "Ajouter au réseau"}
          </button>
        </form>

        {mError && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-xl flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{mError}</span>
          </div>
        )}

        <div className="space-y-2">
          {mechanicsList.length === 0 && <p className="text-xs text-slate-500">Aucun mécanicien dans le réseau.</p>}
          {mechanicsList.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3 bg-slate-950 border border-white/[0.06] rounded-xl p-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate">
                  {m.garageName || m.name} <span className="font-mono text-slate-400">— {m.phone}</span>
                </p>
                <p className="text-[10px] text-slate-500">
                  <span className={m.type === "parts_vendor" ? "text-amber-400 font-bold" : "text-sky-400 font-bold"}>
                    {m.type === "parts_vendor" ? "📦 Pièces" : "🔧 Mécanicien"}
                  </span>
                  {" · "}
                  {m.area ? `${m.area}, ${m.city}` : m.city}
                  {m.specialties ? ` · ${m.specialties}` : ""}
                  {m.hasScanner ? " · 🔧 valise" : ""}
                  {m.certified ? " · ✅ agréé" : ""}
                  {!m.active ? " · ⛔ désactivé" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => handleToggleMechanic(m.id)} className="text-slate-400 hover:text-white cursor-pointer" title={m.active ? "Désactiver" : "Activer"}>
                  {m.active ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5" />}
                </button>
                <button onClick={() => handleDeleteMechanic(m.id)} className="text-rose-400 hover:text-rose-300 cursor-pointer" title="Supprimer">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bannières / Publicités */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-fuchsia-400" />
          Publicités (bannière page d'accueil / image flottante)
        </h3>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          "Bannière" s'affiche en haut de l'écran d'accueil. "Flottante" apparaît en superposition et se ferme quand le client clique dessus.
        </p>

        <form onSubmit={handleCreateBanner} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <input
            type="url"
            required
            placeholder="URL de l'image (https://...)"
            value={bannerImageUrl}
            onChange={(e) => setBannerImageUrl(e.target.value)}
            className="sm:col-span-2 w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-fuchsia-500"
          />
          <input
            ref={bannerFileInputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleBannerFileUpload(e.target.files[0])}
          />
          <button
            type="button"
            onClick={() => bannerFileInputRef.current?.click()}
            disabled={bannerUploading}
            className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-2.5 rounded-xl cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" /> {bannerUploading ? "Chargement..." : "ou uploader une image"}
          </button>
          <input
            type="url"
            placeholder="Lien au clic (optionnel)"
            value={bannerLinkUrl}
            onChange={(e) => setBannerLinkUrl(e.target.value)}
            className="w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-fuchsia-500"
          />
          <select
            value={bannerType}
            onChange={(e) => setBannerType(e.target.value as "banner" | "floating")}
            className="bg-slate-950 border border-white/[0.08] text-slate-300 rounded-xl px-3 py-2.5 text-xs font-bold focus:outline-none focus:border-fuchsia-500 cursor-pointer w-full"
          >
            <option value="banner">Bannière (accueil)</option>
            <option value="floating">Image flottante</option>
          </select>
          <button
            type="submit"
            disabled={bannerCreating}
            className="sm:col-span-2 lg:col-span-4 bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer disabled:opacity-50 w-full"
          >
            {bannerCreating ? "Création..." : "Ajouter la publicité"}
          </button>
        </form>

        {bannerError && <p className="text-xs text-rose-400">{bannerError}</p>}

        <div className="space-y-2">
          {bannerList.length === 0 && <p className="text-xs text-slate-500">Aucune publicité configurée.</p>}
          {bannerList.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 bg-slate-950 border border-white/[0.06] rounded-xl p-3">
              <div className="flex items-center gap-3 min-w-0">
                <img src={b.imageUrl} alt="" className="w-12 h-12 object-cover rounded-lg border border-white/[0.08] shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-white truncate max-w-[220px]">{b.imageUrl}</p>
                  <p className="text-[10px] text-slate-500">{b.displayType === "banner" ? "Bannière accueil" : "Image flottante"} · {b.active ? "Active" : "Désactivée"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => handleToggleBanner(b.id)} className="text-slate-400 hover:text-white cursor-pointer" title={b.active ? "Désactiver" : "Activer"}>
                  {b.active ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5" />}
                </button>
                <button onClick={() => handleDeleteBanner(b.id)} className="text-rose-400 hover:text-rose-300 cursor-pointer" title="Supprimer">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Fenêtre modale : carte avec point exact */}
      {mapModalLocation && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setMapModalLocation(null)}
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-slate-800">
              <span className="text-xs font-bold text-white">
                Position : {mapModalLocation.latitude.toFixed(5)}, {mapModalLocation.longitude.toFixed(5)}
              </span>
              <button onClick={() => setMapModalLocation(null)} className="text-slate-400 hover:text-white cursor-pointer text-lg leading-none">×</button>
            </div>
            <iframe
              title="Position du client"
              src={`https://www.google.com/maps?q=${mapModalLocation.latitude},${mapModalLocation.longitude}&z=15&output=embed`}
              width="100%"
              height="320"
              style={{ border: 0 }}
              loading="lazy"
            />
            <a
              href={`https://www.google.com/maps?q=${mapModalLocation.latitude},${mapModalLocation.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-xs text-slate-300 hover:text-white bg-slate-950 py-2"
            >
              Ouvrir en plein écran dans Google Maps
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
