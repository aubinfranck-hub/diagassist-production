import React, { useState, useEffect, useCallback } from "react";
import { UserPlus, Users, MapPin, LogOut, RefreshCw, Key, AlertCircle, Shield } from "lucide-react";

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

export default function AdminClientDashboard() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeSessions, setActiveSessions] = useState<SessionInfo[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

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
      const [accRes, sessRes] = await Promise.all([
        fetch("/api/admin/accounts", { headers: authHeaders() }),
        fetch("/api/admin/sessions", { headers: authHeaders() }),
      ]);
      const accData = await accRes.json();
      const sessData = await sessRes.json();
      if (accData.success) setAccounts(accData.accounts);
      if (sessData.success) setActiveSessions(sessData.sessions);
      if (!accData.success || !sessData.success) {
        setListError(accData.message || sessData.message || "Erreur de chargement.");
      }
    } catch {
      setListError("Erreur réseau lors du chargement.");
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
      setCreateError("Erreur réseau.");
    } finally {
      setCreating(false);
    }
  };

  const handleForceLogout = async (targetPhone: string) => {
    try {
      await fetch("/api/admin/force-logout", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ phone: targetPhone }),
      });
      loadData();
    } catch {
      // silencieux, l'utilisateur peut réessayer
    }
  };

  const formatDate = (ts: number) => new Date(ts).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

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

        {listError && <p className="text-xs text-rose-400">{listError}</p>}

        {activeSessions.length === 0 && !loadingList && (
          <p className="text-xs text-slate-500">Aucune connexion active pour le moment.</p>
        )}

        <div className="space-y-2">
          {activeSessions.map((s) => (
            <div key={s.tokenRef} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-950 border border-white/[0.06] rounded-xl p-3">
              <div className="space-y-0.5">
                <p className="text-xs font-mono font-bold text-white">{s.phone}</p>
                <p className="text-[10px] text-slate-500">
                  {PLAN_LABELS[s.plan] || s.plan} · connecté le {formatDate(s.createdAt)}
                </p>
                {s.location ? (
                  <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {s.location.latitude.toFixed(4)}, {s.location.longitude.toFixed(4)}
                    <span className="text-slate-500">(maj {formatDate(s.location.updatedAt)})</span>
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-600 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Position non partagée
                  </p>
                )}
              </div>
              <button
                onClick={() => handleForceLogout(s.phone)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/30 hover:bg-rose-950/50 border border-rose-500/20 text-rose-400 rounded-xl text-[11px] font-bold transition cursor-pointer whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                Déconnecter
              </button>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
