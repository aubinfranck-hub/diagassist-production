import React, { useState, useEffect, useCallback } from "react";
import { UserPlus, Users, MapPin, LogOut, RefreshCw, Key, AlertCircle, Shield, MessageCircle, History, Image as ImageIcon, Trash2, ToggleLeft, ToggleRight } from "lucide-react";

interface Account {
  phone: string;
  createdAt: number;
  plan: string;
  isAdmin: boolean;
  email: string | null;
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

interface Banner {
  id: string;
  imageUrl: string;
  linkUrl?: string;
  displayType: "banner" | "floating";
  active: boolean;
  createdAt: number;
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
};

const formatDate = (ts: number) => new Date(ts).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

// Numéro au format international -> format attendu par wa.me (chiffres uniquement)
const toWaMeNumber = (phone: string) => phone.replace(/[^0-9]/g, "");

export default function AdminClientDashboard() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeSessions, setActiveSessions] = useState<SessionInfo[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [bannerList, setBannerList] = useState<Banner[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [logoutBusyPhone, setLogoutBusyPhone] = useState<string | null>(null);
  const [logoutFeedback, setLogoutFeedback] = useState<{ phone: string; ok: boolean; message: string } | null>(null);

  // Création de compte
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("+225");
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
  const [bannerLinkUrl, setBannerLinkUrl] = useState("");
  const [bannerType, setBannerType] = useState<"banner" | "floating">("banner");
  const [bannerCreating, setBannerCreating] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

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
      const [accRes, sessRes, histRes, bannerRes] = await Promise.all([
        fetch("/api/admin/accounts", { headers: authHeaders() }),
        fetch("/api/admin/sessions", { headers: authHeaders() }),
        fetch("/api/admin/connection-history", { headers: authHeaders() }),
        fetch("/api/admin/banners", { headers: authHeaders() }),
      ]);
      const accData = await accRes.json();
      const sessData = await sessRes.json();
      const histData = await histRes.json();
      const bannerData = await bannerRes.json();

      const errors: string[] = [];
      if (accData.success) setAccounts(accData.accounts); else errors.push(accData.message || "comptes");
      if (sessData.success) setActiveSessions(sessData.sessions); else errors.push(sessData.message || "sessions");
      if (histData.success) setHistory(histData.history); else errors.push(histData.message || "historique");
      if (bannerData.success) setBannerList(bannerData.banners); else errors.push(bannerData.message || "bannières");

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
          durationValue: plan ? durationValue : undefined,
          durationUnit: plan ? durationUnit : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCreatedAccount({ phone: fullPhone, password: generatedPassword });
        setPhone("");
        setEmail("");
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
            type="email"
            placeholder="Email (optionnel)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="sm:col-span-2 lg:col-span-2 w-full bg-slate-950 border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
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
                <a
                  href={`https://www.google.com/maps?q=${s.location.latitude},${s.location.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 underline"
                >
                  <MapPin className="w-3 h-3" />
                  Voir la position précise sur la carte ({s.location.latitude.toFixed(4)}, {s.location.longitude.toFixed(4)})
                  <span className="text-slate-500">— maj {formatDate(s.location.updatedAt)}</span>
                </a>
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
                <th className="py-2 pr-3">Forfait</th>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Créé le</th>
                <th className="py-2 pr-3">Rôle</th>
                <th className="py-2 pr-3">Contact</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.phone} className="border-b border-slate-800/50">
                  <td className="py-2 pr-3 font-mono text-white">{a.phone}</td>
                  <td className="py-2 pr-3 text-slate-300">{PLAN_LABELS[a.plan] || a.plan}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
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
    </div>
  );
}
