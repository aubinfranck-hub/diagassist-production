import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, WifiOff, Loader2, Send, Star, MessageCircle } from "lucide-react";
import { api, AssistanceError, ChatMsg, usePolling } from "./api";

// Petits blocs d'interface partagés (style de l'app : fond sombre, rouge DiagAssist, thème clair géré par index.css)

export const inputCls =
  "w-full bg-slate-950/90 border border-white/[0.08] rounded-2xl px-4 py-3.5 text-base text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition";

export const btnPrimary =
  "w-full inline-flex items-center justify-center gap-2 min-h-[52px] px-6 py-3.5 rounded-2xl bg-red-600 hover:bg-red-700 text-[#ffffff] text-base font-black shadow-lg shadow-red-600/25 border border-red-500/20 transition active:scale-[0.98] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100";

export const btnSecondary =
  "w-full inline-flex items-center justify-center gap-2 min-h-[52px] px-6 py-3.5 rounded-2xl bg-slate-950/80 hover:bg-slate-900 text-slate-200 text-base font-bold border border-white/[0.1] transition active:scale-[0.98] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

export const btnGreen =
  "w-full inline-flex items-center justify-center gap-2 min-h-[52px] px-6 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-[#ffffff] text-base font-black shadow-lg shadow-emerald-600/20 border border-emerald-400/20 transition active:scale-[0.98] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`premium-glass-card rounded-3xl p-5 md:p-6 ${className}`}>{children}</div>;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm font-bold text-slate-300 mb-1.5">{children}</label>;
}

export function Spinner({ text }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-slate-400 text-sm">
      <Loader2 className="w-5 h-5 animate-spin" />
      {text && <span>{text}</span>}
    </div>
  );
}

export function Notice({
  tone = "info", children, action,
}: { tone?: "info" | "warn" | "error" | "ok"; children: React.ReactNode; action?: React.ReactNode }) {
  const tones = {
    info: "bg-sky-500/10 border-sky-500/30 text-sky-300",
    warn: "bg-amber-500/10 border-amber-500/30 text-amber-300",
    error: "bg-red-500/10 border-red-500/30 text-red-300",
    ok: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
  } as const;
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm leading-relaxed ${tones[tone]}`} role={tone === "error" ? "alert" : undefined}>
      <div className="flex items-start gap-2.5">
        {(tone === "warn" || tone === "error") && <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function OfflineBanner() {
  return (
    <Notice tone="warn">
      <span className="inline-flex items-center gap-2"><WifiOff className="w-4 h-4" /> Vous êtes hors ligne. Les informations se mettront à jour dès que le réseau revient.</span>
    </Notice>
  );
}

/** Page d'état pleine largeur (assistance indisponible, erreur de chargement…) */
export function StateBox({
  icon, title, text, children,
}: { icon: React.ReactNode; title: string; text?: string; children?: React.ReactNode }) {
  return (
    <Card className="text-center space-y-3 py-10">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-950/70 border border-white/[0.06] flex items-center justify-center text-slate-400">{icon}</div>
      <h3 className="text-lg font-black text-white">{title}</h3>
      {text && <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">{text}</p>}
      {children && <div className="max-w-xs mx-auto pt-2 space-y-2">{children}</div>}
    </Card>
  );
}

export function errText(e: unknown): string {
  if (e instanceof AssistanceError) return e.message;
  return "Une erreur est survenue. Réessayez dans un instant.";
}

export function Stars({
  value, onChange, size = 32,
}: { value: number; onChange?: (n: number) => void; size?: number }) {
  return (
    <div className="flex items-center gap-1" role={onChange ? "radiogroup" : "img"} aria-label={`Note : ${value} sur 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          aria-label={`${n} sur 5`}
          className={`p-1 ${onChange ? "cursor-pointer" : "cursor-default"}`}
        >
          <Star style={{ width: size, height: size }} className={n <= value ? "text-amber-400 fill-amber-400" : "text-slate-600"} />
        </button>
      ))}
    </div>
  );
}

/** Compte à rebours jusqu'à `until` (ms). Appelle onEnd une fois à 0. */
export function useCountdown(until: number, onEnd?: () => void): number {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((until - Date.now()) / 1000)));
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    let fired = false;
    const tick = () => {
      const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(s);
      if (s === 0 && !fired) { fired = true; endRef.current?.(); }
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [until]);
  return left;
}

/** Messagerie client <-> mécanicien (même route pour les deux côtés, rôle déduit du jeton). */
export function ChatPanel({ requestId, me, disabled }: { requestId: string; me: "client" | "pro"; disabled?: boolean }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const lastId = useRef<number | string>(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages([]); lastId.current = 0; }, [requestId]);

  usePolling(async () => {
    const since = lastId.current ? `?since=${encodeURIComponent(String(lastId.current))}` : "";
    const d = await api<{ messages: ChatMsg[] }>(`/requests/${requestId}/messages${since}`);
    if (d.messages?.length) {
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const add = d.messages.filter((m) => !seen.has(m.id));
        return add.length ? [...prev, ...add] : prev;
      });
      lastId.current = d.messages[d.messages.length - 1].id;
    }
  }, 6000, true, requestId);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [messages.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      await api(`/requests/${requestId}/messages`, { body: { body } });
      setText("");
      const since = lastId.current ? `?since=${encodeURIComponent(String(lastId.current))}` : "";
      const d = await api<{ messages: ChatMsg[] }>(`/requests/${requestId}/messages${since}`);
      if (d.messages?.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...d.messages.filter((m) => !seen.has(m.id))];
        });
        lastId.current = d.messages[d.messages.length - 1].id;
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="space-y-3">
      <h3 className="text-base font-black text-white flex items-center gap-2"><MessageCircle className="w-5 h-5 text-red-500" /> Messages</h3>
      <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
        {messages.length === 0 && <p className="text-sm text-slate-500">Aucun message pour le moment.</p>}
        {messages.map((m) => {
          const mine = m.fromRole === me;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${mine ? "bg-red-600 text-[#ffffff]" : "bg-slate-950/80 text-slate-200 border border-white/[0.08]"}`}>
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                <div className={`text-[10px] mt-1 ${mine ? "text-red-100" : "text-slate-500"}`}>
                  {new Date(m.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!disabled && (
        <form onSubmit={send} className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Écrire un message…" className={inputCls} />
          <button type="submit" disabled={sending || !text.trim()} aria-label="Envoyer" className="shrink-0 w-14 rounded-2xl bg-red-600 text-[#ffffff] flex items-center justify-center disabled:opacity-40 cursor-pointer">
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </form>
      )}
    </Card>
  );
}
