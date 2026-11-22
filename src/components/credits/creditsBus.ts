// Petit canal entre les écrans : n'importe quel écran peut ouvrir la boutique de packs de diagnostics
// ou demander un rafraîchissement du compteur, sans passer de propriétés dans toute l'application.
export type CreditsOpenDetail = { exhausted?: boolean; reference?: string };

export const openCredits = (detail: CreditsOpenDetail = {}) =>
  window.dispatchEvent(new CustomEvent<CreditsOpenDetail>("diag-credits-open", { detail }));

export const creditsChanged = () => window.dispatchEvent(new Event("diag-credits-changed"));

/** Vrai quand le serveur répond « plus de diagnostics » (HTTP 402). */
export const isCreditsExhausted = (res: { status: number }) => res.status === 402;

export type CreditsInfo = {
  unlimited: boolean; freeTotal: number; freeRemaining: number; paidBalance: number; total: number;
  packs: { id: string; label: string; credits: number; priceXof: number }[]; paymentEnabled: boolean;
};

export async function fetchCredits(): Promise<CreditsInfo | null> {
  try {
    const res = await fetch("/api/credits", { headers: { Authorization: `Bearer ${localStorage.getItem("auth_session_token") || ""}` } });
    const data = await res.json();
    return res.ok && data.success ? data : null;
  } catch { return null; }
}

export const formatFcfa = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n).replace(/\s/g, " ")} F`;
