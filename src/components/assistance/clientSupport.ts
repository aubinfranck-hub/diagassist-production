// Same commercial WhatsApp contact as the DiagAssist landing page.
export const SUPPORT_WHATSAPP = "2250707312797";

export function callbackLink(requestId: string): string {
  const text = `Bonjour DiagAssist, je souhaite être rappelé au sujet de ma demande d'assistance ${requestId}. Merci de m'aider à trouver un professionnel.`;
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`;
}

export function positionFreshness(updatedAt: number | undefined, now = Date.now()) {
  if (!Number.isFinite(updatedAt) || !updatedAt || updatedAt > now + 60000) {
    return { stale: true, label: "Heure de la position inconnue" };
  }
  const minutes = Math.max(0, Math.floor((now - updatedAt) / 60000));
  return {
    stale: now - updatedAt >= 5 * 60000,
    label: minutes < 1 ? "Position actualisée il y a moins d'une minute" : `Position actualisée il y a ${minutes} min`,
  };
}
