import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Ambulance, Flame, Loader2, MessageCircle, Phone, Send, ShieldAlert, Siren, X } from "lucide-react";
import { digitsPhone } from "./api";
import { btnPrimary, btnSecondary, inputCls, Notice } from "./ui";

const CONTACT_KEY = "assistance_sos_contact";

interface Contact { name: string; phone: string }

function loadContact(): Contact | null {
  try {
    const c = JSON.parse(localStorage.getItem(CONTACT_KEY) || "null");
    return c && typeof c.phone === "string" ? { name: String(c.name || ""), phone: c.phone } : null;
  } catch { return null; }
}
function saveContact(c: Contact | null) {
  try { if (c) localStorage.setItem(CONTACT_KEY, JSON.stringify(c)); else localStorage.removeItem(CONTACT_KEY); } catch { /* ignore */ }
}

const EMERGENCY = [
  { label: "Police", num: "110", alt: "111", icon: <ShieldAlert className="w-5 h-5" /> },
  { label: "Sapeurs-pompiers", num: "180", icon: <Flame className="w-5 h-5" /> },
  { label: "SAMU (urgence médicale)", num: "185", icon: <Ambulance className="w-5 h-5" /> },
];

/** Petit bouton rouge SOS, à placer en haut à droite d'un écran. */
export function SosButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button" onClick={() => setOpen(true)} aria-label="SOS, urgence grave"
        className={`inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-full bg-red-600 text-[#ffffff] text-sm font-black shadow-lg shadow-red-600/30 border border-red-400/40 cursor-pointer active:scale-95 transition ${className}`}
      >
        <Siren className="w-4 h-4" /> SOS
      </button>
      {/* Portail : sinon la feuille reste prisonnière de la carte (overflow caché + animation = « fixed » relatif à la carte). */}
      {open && createPortal(<SosSheet onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

export function SosSheet({ onClose }: { onClose: () => void }) {
  const [contact, setContact] = useState<Contact | null>(() => loadContact());
  const [editing, setEditing] = useState(() => !loadContact());
  const [name, setName] = useState(contact?.name || "");
  const [phone, setPhone] = useState(contact?.phone || "");
  const [locating, setLocating] = useState(false);
  const [msg, setMsg] = useState<{ tone: "warn" | "ok"; text: string } | null>(null);
  const [links, setLinks] = useState<{ wa: string; sms: string } | null>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const phoneOk = digitsPhone(phone).length >= 8;

  const save = () => {
    if (!phoneOk) return;
    const c = { name: name.trim(), phone: phone.trim() };
    saveContact(c); setContact(c); setEditing(false); setMsg(null);
  };

  const build = (text: string, num: string) => ({
    wa: `https://wa.me/${num}?text=${encodeURIComponent(text)}`,
    sms: `sms:+${num}?body=${encodeURIComponent(text)}`,
  });

  const share = () => {
    if (!contact || locating) return;
    const num = digitsPhone(contact.phone);
    setMsg(null); setLinks(null);
    const finish = (text: string, note?: string) => {
      const l = build(text, num);
      setLinks(l);
      setLocating(false);
      if (note) setMsg({ tone: "warn", text: note });
      else setMsg({ tone: "ok", text: "Message prêt. Si WhatsApp ne s'ouvre pas, touchez le bouton ci-dessous." });
      try { window.open(l.wa, "_blank", "noopener"); } catch { /* le bouton reste disponible */ }
    };
    if (!navigator.geolocation) {
      finish("Urgence : j'ai besoin d'aide. Je n'ai pas pu envoyer ma position, appelez-moi.", "Position indisponible : le message est envoyé sans position.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (g) => finish(`Urgence : j'ai besoin d'aide. Ma position : https://maps.google.com/?q=${g.coords.latitude},${g.coords.longitude}`),
      () => finish("Urgence : j'ai besoin d'aide. Je n'ai pas pu envoyer ma position, appelez-moi.", "Position introuvable : le message est envoyé sans position. Autorisez la localisation si vous le pouvez."),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70" role="dialog" aria-modal="true" aria-label="Urgence SOS" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-slate-900 border border-white/[0.1] p-5 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-red-600 text-[#ffffff] flex items-center justify-center shrink-0"><Siren className="w-5 h-5" /></div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-black text-white leading-tight">Urgence</h2>
            <p className="text-sm text-slate-400">Restez calme, nous allons vous aider.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="shrink-0 w-11 h-11 rounded-full bg-slate-950/80 border border-white/[0.1] text-slate-200 flex items-center justify-center cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        <Notice tone="warn"><strong>En cas de danger grave, appelez d'abord les secours.</strong> Accident, blessé, feu, agression : composez un numéro ci-dessous.</Notice>

        <div className="space-y-2">
          {EMERGENCY.map((e) => (
            <div key={e.num} className="flex gap-2">
              <a href={`tel:${e.num}`} className="flex-1 min-h-[56px] rounded-2xl bg-red-600/15 border border-red-500/40 text-white flex items-center gap-3 px-4 cursor-pointer">
                <span className="text-red-400">{e.icon}</span>
                <span className="flex-1 text-sm font-bold">{e.label}</span>
                <span className="inline-flex items-center gap-1.5 text-lg font-black"><Phone className="w-4 h-4" /> {e.num}</span>
              </a>
              {e.alt && (
                <a href={`tel:${e.alt}`} aria-label={`Appeler le ${e.alt}`} className="min-h-[56px] px-4 rounded-2xl bg-red-600/15 border border-red-500/40 text-white flex items-center text-lg font-black cursor-pointer">{e.alt}</a>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-2.5 border-t border-white/[0.08] pt-4">
          <h3 className="text-base font-black text-white">Prévenir un proche</h3>
          {contact && !editing ? (
            <>
              <div className="flex items-center gap-3 rounded-2xl bg-slate-950/60 border border-white/[0.08] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Mon contact d'urgence</div>
                  <div className="text-base font-black text-white truncate">{contact.name || "Mon proche"} · {contact.phone}</div>
                </div>
                <button type="button" onClick={() => setEditing(true)} className="text-sm font-bold text-red-400 min-h-[44px] px-2 cursor-pointer">Modifier</button>
              </div>
              <button type="button" onClick={share} disabled={locating} className={`${btnPrimary} !min-h-[64px] !text-lg`}>
                {locating ? <><Loader2 className="w-5 h-5 animate-spin" /> Recherche de ma position…</> : <><Send className="w-5 h-5" /> Envoyer ma position à mon proche</>}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-400">Enregistrez une seule fois une personne de confiance. Elle sera gardée sur ce téléphone uniquement.</p>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Son prénom" className={inputCls} aria-label="Nom du contact" maxLength={60} />
              <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Son téléphone : 07 00 00 00 00" className={inputCls} aria-label="Téléphone du contact" />
              <button type="button" onClick={save} disabled={!phoneOk} className={btnPrimary}>Enregistrer mon contact</button>
              {contact && <button type="button" onClick={() => { setEditing(false); setName(contact.name); setPhone(contact.phone); }} className={btnSecondary}>Annuler</button>}
            </>
          )}
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          {links && (
            <div className="grid grid-cols-2 gap-2.5">
              <a href={links.wa} target="_blank" rel="noopener noreferrer" className={btnSecondary}><MessageCircle className="w-4 h-4" /> WhatsApp</a>
              <a href={links.sms} className={btnSecondary}>SMS</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
