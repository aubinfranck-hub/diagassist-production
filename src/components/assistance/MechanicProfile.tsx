import { useState } from "react";
import { FileUp, GraduationCap, Loader2, ShieldCheck } from "lucide-react";
import { api, AssistanceStatus, compressImage, readAsBase64 } from "./api";
import { btnPrimary, btnSecondary, Card, errText, inputCls, Label, Notice } from "./ui";

export interface ProProfile {
  phone: string;
  displayName: string;
  garageName?: string;
  specialties: string[];
  zoneIds: number[];
  mobility: "mobile" | "garage" | "both";
  validationStatus: "en_attente" | "valide" | "suspendu" | "refuse";
  validationNote?: string;
  available: boolean;
  shareLocation?: boolean;
  location?: { lat: number; lng: number; updatedAt: number } | null;
  trainings: { id: number | string; title: string; issuer?: string; completedOn?: string; status: string }[];
  documents: { id: number | string; kind: string; label: string; status: string }[];
  rating?: { avg: number; count: number } | number | null;
  missionsDone?: number;
  activeMissionId?: string | null;
  canReceiveMissions?: boolean;
  subscribed?: boolean;
  blockers?: string[];
}

const DOC_KINDS = [
  { v: "identite", l: "Pièce d'identité" },
  { v: "diplome", l: "Diplôme ou attestation" },
  { v: "assurance", l: "Assurance" },
  { v: "atelier", l: "Photo de l'atelier ou du véhicule" },
  { v: "autre", l: "Autre justificatif" },
];

const DOC_STATUS: Record<string, string> = {
  verifie: "Vérifié", verifiee: "Vérifié", valide: "Vérifié", refuse: "Refusé", refusee: "Refusé",
  en_attente: "En cours de vérification", a_verifier: "En cours de vérification",
};

export default function MechanicProfile({
  profile, status, onSaved,
}: { profile: ProProfile | null; status: AssistanceStatus | null; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(profile?.displayName || "");
  const [garageName, setGarageName] = useState(profile?.garageName || "");
  const [specialties, setSpecialties] = useState<string[]>(profile?.specialties || []);
  const [zoneIds, setZoneIds] = useState<number[]>(profile?.zoneIds || []);
  const [mobility, setMobility] = useState<"mobile" | "garage" | "both">(profile?.mobility || "mobile");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await api("/pro/me", { method: "PUT", body: { displayName: displayName.trim(), garageName: garageName.trim() || undefined, specialties, zoneIds, mobility } });
      setMsg({ tone: "ok", text: profile ? "Profil enregistré." : "Profil créé. Il doit maintenant être validé par DiagAssist." });
      onSaved();
    } catch (e) {
      setMsg({ tone: "error", text: errText(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <h3 className="text-lg font-black text-white">Mon profil</h3>
        <div>
          <Label>Nom affiché au client</Label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} placeholder="Ex : Koné Ibrahim" />
        </div>
        <div>
          <Label>Nom du garage (facultatif)</Label>
          <input value={garageName} onChange={(e) => setGarageName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <Label>Mes spécialités (services)</Label>
          <div className="flex flex-wrap gap-2">
            {(status?.services || []).map((s) => (
              <Chip key={s.code} on={specialties.includes(s.code)} onClick={() => setSpecialties(toggle(specialties, s.code))}>{s.label}</Chip>
            ))}
            {!status && <span className="text-sm text-slate-500">Chargement des services…</span>}
          </div>
        </div>
        <div>
          <Label>Mes zones d'intervention</Label>
          <div className="flex flex-wrap gap-2">
            {(status?.zones || []).map((z) => (
              <Chip key={z.id} on={zoneIds.includes(z.id)} onClick={() => setZoneIds(toggle(zoneIds, z.id))}>{z.name}</Chip>
            ))}
            {status && status.zones.length === 0 && <span className="text-sm text-slate-500">Aucune zone n'est encore ouverte.</span>}
          </div>
        </div>
        <div>
          <Label>Je me déplace ?</Label>
          <div className="grid grid-cols-3 gap-2">
            {([["mobile", "Je me déplace"], ["garage", "Au garage"], ["both", "Les deux"]] as const).map(([v, l]) => (
              <Chip key={v} on={mobility === v} onClick={() => setMobility(v)} block>{l}</Chip>
            ))}
          </div>
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <button className={btnPrimary} disabled={saving || displayName.trim().length < 2 || specialties.length === 0} onClick={save}>
          {saving && <Loader2 className="w-5 h-5 animate-spin" />}
          {profile ? "Enregistrer" : "Créer mon profil"}
        </button>
        {specialties.length === 0 && <p className="text-xs text-slate-500">Choisissez au moins une spécialité.</p>}
      </Card>

      {profile && <Documents profile={profile} onSaved={onSaved} />}
      {profile && <Trainings profile={profile} onSaved={onSaved} />}
    </div>
  );
}

function Chip({ on, onClick, children, block }: { on: boolean; onClick: () => void; children: React.ReactNode; block?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`min-h-[44px] px-4 rounded-full border-2 text-sm font-bold transition cursor-pointer ${block ? "w-full" : ""} ${on ? "border-red-500 bg-red-600/15 text-white" : "border-white/[0.1] bg-slate-900/60 text-slate-300"}`}>
      {children}
    </button>
  );
}

function Documents({ profile, onSaved }: { profile: ProProfile; onSaved: () => void }) {
  const [kind, setKind] = useState("identite");
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const upload = async () => {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const blob = file.type.startsWith("image/") ? await compressImage(file, 1600, 0.78) : file;
      if (blob.size > 4 * 1024 * 1024) throw new Error("Fichier trop lourd (4 Mo maximum).");
      const mime = file.type.startsWith("image/") ? (blob.type || "image/jpeg") : file.type;
      const dataBase64 = await readAsBase64(blob);
      await api("/pro/documents", { body: { kind, label: label.trim() || DOC_KINDS.find((k) => k.v === kind)!.l, mime, dataBase64 } });
      setFile(null); setLabel("");
      setMsg({ tone: "ok", text: "Justificatif envoyé. DiagAssist va le vérifier." });
      onSaved();
    } catch (e: any) {
      setMsg({ tone: "error", text: e?.message && !(e?.status) ? e.message : errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4">
      <h3 className="text-lg font-black text-white flex items-center gap-2"><FileUp className="w-5 h-5 text-red-500" /> Mes justificatifs</h3>
      {profile.documents.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun justificatif envoyé pour le moment.</p>
      ) : (
        <ul className="space-y-2">
          {profile.documents.map((d) => (
            <li key={d.id} className="flex justify-between gap-3 text-sm">
              <span className="text-slate-200 break-words min-w-0">{d.label}</span>
              <span className={`shrink-0 font-bold ${/verifi|valide/.test(d.status) ? "text-emerald-400" : /refus/.test(d.status) ? "text-red-400" : "text-amber-400"}`}>{DOC_STATUS[d.status] || d.status}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-3 pt-2 border-t border-white/[0.06]">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
          {DOC_KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
        </select>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nom du document (facultatif)" className={inputCls} />
        <label className={`${btnSecondary} text-sm`}>
          {file ? file.name : "Choisir un fichier (PDF, JPG, PNG, 4 Mo max)"}
          <input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <button className={btnPrimary} disabled={!file || busy} onClick={upload}>{busy && <Loader2 className="w-5 h-5 animate-spin" />} Envoyer le justificatif</button>
      </div>
    </Card>
  );
}

function Trainings({ profile, onSaved }: { profile: ProProfile; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [issuer, setIssuer] = useState("");
  const [completedOn, setCompletedOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const add = async () => {
    setBusy(true); setMsg(null);
    try {
      await api("/pro/trainings", { body: { title: title.trim(), issuer: issuer.trim(), completedOn } });
      setTitle(""); setIssuer(""); setCompletedOn("");
      setMsg({ tone: "ok", text: "Formation déclarée. Elle ne sera montrée aux clients qu'après vérification par DiagAssist." });
      onSaved();
    } catch (e) {
      setMsg({ tone: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4">
      <h3 className="text-lg font-black text-white flex items-center gap-2"><GraduationCap className="w-5 h-5 text-red-500" /> Mes formations</h3>
      {profile.trainings.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune formation déclarée.</p>
      ) : (
        <ul className="space-y-2">
          {profile.trainings.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 text-sm">
              <span className="text-slate-200 min-w-0 break-words">{t.title}{t.issuer ? ` — ${t.issuer}` : ""}{t.completedOn ? ` (${t.completedOn})` : ""}</span>
              {t.status === "verifiee" ? (
                <span className="shrink-0 inline-flex items-center gap-1 text-emerald-400 font-black"><ShieldCheck className="w-4 h-4" /> Certifié</span>
              ) : (
                <span className="shrink-0 text-amber-400 font-bold text-right">Déclarée, non vérifiée</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-3 pt-2 border-t border-white/[0.06]">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Intitulé de la formation" className={inputCls} />
        <input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Organisme (école, constructeur…)" className={inputCls} />
        <div>
          <Label>Date d'obtention</Label>
          <input type="date" value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} className={inputCls} />
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <button className={btnPrimary} disabled={busy || title.trim().length < 2 || !issuer.trim() || !completedOn} onClick={add}>{busy && <Loader2 className="w-5 h-5 animate-spin" />} Déclarer cette formation</button>
        <p className="text-xs text-slate-500">« Certifié » n'apparaît chez le client qu'une fois la formation vérifiée par DiagAssist.</p>
      </div>
    </Card>
  );
}
