import test from "node:test";
import assert from "node:assert/strict";
import { clientAlerts } from "../src/components/assistance/clientAlerts";
import type { RequestDetail } from "../src/components/assistance/api";
const detail = (status = "recherche") => ({ request: { id: "r", status }, bids: [], quotes: [], allowed: {} } as unknown as RequestDetail);
test("alerts ignore expired offers and point to available offers", () => {
 const d = detail(); d.bids = [{validUntil: 100}, {validUntil: 201}] as any;
 const a = clientAlerts(d, 200); assert.equal(a.length, 1); assert.match(a[0].text, /Une offre/); assert.equal(a[0].target, "assistance-offers");
 assert.equal(clientAlerts(d, 202).length, 0);
});
test("quote alerts require permission and a pending quote", () => {
 const d = detail("en_intervention"); d.quotes = [{id:"q",status:"propose"}] as any;
 assert.equal(clientAlerts(d).length,0); d.allowed.decideQuote = true;
 assert.equal(clientAlerts(d)[0].target,"assistance-quotes");
 d.quotes[0].status = "accepte"; assert.equal(clientAlerts(d).length,0);
});
test("arrival wording respects workshop mode and terminal absence suppresses alerts", () => {
 const d=detail("sur_place"); assert.match(clientAlerts(d)[0].text,/mécanicien est arrivé/);
 d.request.mode="atelier"; assert.match(clientAlerts(d)[0].text,/arrivé au garage/);
 for (const status of ["annulee","sans_disponibilite"]) assert.equal(clientAlerts(detail(status)).length,0);
});
