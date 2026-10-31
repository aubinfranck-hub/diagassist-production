import type { RequestDetail } from "./api";

export interface ClientAlert { id: string; text: string; target?: string }
export function clientAlerts(detail: RequestDetail, now = Date.now()): ClientAlert[] {
  const r = detail.request;
  if (r.status === "annulee" || r.status === "sans_disponibilite") return [];
  const alerts: ClientAlert[] = [];
  if (r.status === "recherche") {
    const count = (detail.bids || []).filter(b => b.validUntil > now).length;
    if (count) alerts.push({ id: "offers", text: count === 1 ? "Une offre disponible : comparez le prix et le délai." : count + " offres disponibles : comparez les prix et les délais.", target: "assistance-offers" });
  }
  if (r.status === "sur_place") alerts.push({ id: "arrival", text: r.mode === "atelier" ? "Vous êtes arrivé au garage. Présentez-vous au mécanicien." : "Votre mécanicien est arrivé. Vous pouvez le contacter depuis cet écran." });
  if (detail.allowed.decideQuote) {
    const count = detail.quotes.filter(q => (q.status ?? r.quoteStatus) === "propose").length;
    if (count) alerts.push({ id: "quotes", text: count === 1 ? "Un devis attend votre validation." : count + " devis attendent votre validation.", target: "assistance-quotes" });
  }
  return alerts;
}
