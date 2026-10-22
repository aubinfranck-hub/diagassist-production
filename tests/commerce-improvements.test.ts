import test from "node:test";
import assert from "node:assert/strict";
import { catalogIndex, compareCatalogPrices } from "../src/modules/shop/catalogSearch";
import { compareBids } from "../src/components/assistance/bidComparison";
import { callbackInput, callbackPhone, callingConfig } from "../src/modules/callbacks/domain";

test("catalog finds misspellings, accents and vehicle compatibility", () => {
  const products = [
    { id: 1, name: "Batterie démarrage", brand: "Bosch", model: "S4", compatibility: "Toyota Yaris" },
    { id: 2, name: "Valise diagnostic", brand: "Launch", model: "X431", compatibility: "Renault" },
  ];
  const index = catalogIndex(products);
  assert.equal(index.search("baterie")[0].item.id, 1);
  assert.equal(index.search("demarrage")[0].item.id, 1);
  assert.equal(index.search("yaris")[0].item.id, 1);
  assert.equal(index.search("x431")[0].item.id, 2);
  assert.equal(index.search("qqqqqqqqqq").length, 0);
});
test("prices on request stay last in ascending and descending order", () => {
  const products = [{ price_fcfa: null }, { price_fcfa: 20000 }, { price_fcfa: 5000 }];
  assert.deepEqual([...products].sort(compareCatalogPrices).map(p => p.price_fcfa), [5000, 20000, null]);
  assert.deepEqual([...products].sort((a,b) => compareCatalogPrices(a,b,true)).map(p => p.price_fcfa), [20000, 5000, null]);
});
test("bid filters omit expired offers and sort ratings with review-count tie break", () => {
  const bids: any[] = [
    { id: "expired", amount: 1, etaMinutes: 1, validUntil: 100, pro: {} },
    { id: "fast", amount: 10000, etaMinutes: 10, validUntil: 200, pro: { rating: { avg: 4.8, count: 2 } } },
    { id: "cheap", amount: 5000, etaMinutes: 40, validUntil: 200, pro: { rating: { avg: 4.8, count: 10 } } },
    { id: "new", amount: 8000, etaMinutes: 20, validUntil: 200, pro: {} },
  ];
  assert.deepEqual(compareBids(bids, "price", null, null, 100).map(b=>b.id), ["cheap", "new", "fast"]);
  assert.deepEqual(compareBids(bids, "eta", 9000, 30, 100).map(b=>b.id), ["new"]);
  assert.equal(compareBids(bids, "rating", null, null, 100)[0].id, "cheap");
});
test("callback validates consent, scope and phone without inventing an international country", () => {
  assert.equal(callbackPhone("07 00 00 00 01"), "+2250700000001");
  assert.equal(callbackPhone("0033612345678"), "+33612345678");
  assert.throws(()=>callbackPhone("123456789"));
  assert.throws(()=>callbackInput({ phone:"0700000001", source:"boutique", consent:"true" }));
  assert.throws(()=>callbackInput({ phone:"0700000001", source:"other", consent:true }));
  assert.equal(callbackInput({ phone:"0700000001", source:"boutique", consent:true }).source,"boutique");
});
test("voice API stays disabled without a dedicated sender, secure callback URL and SIP endpoint", () => {
  assert.equal(callingConfig({}).ready, false);
  const env = { WHATSAPP_CALLING_ENABLED:"true", WHATSAPP_CALLBACK_PUBLIC_URL:"https://example.test", TWILIO_WHATSAPP_NUMBER:"whatsapp:+2250700000001", WHATSAPP_CALLBACK_SIP:"sip:agent@example.test", WHATSAPP_CALL_PERMISSION_CONTENT_SID:`HX${"a".repeat(32)}`, TWILIO_ACCOUNT_SID:"ACtest", TWILIO_AUTH_TOKEN:"test" };
  assert.equal(callingConfig(env).ready, true);
  assert.equal(callingConfig({...env,TWILIO_WHATSAPP_NUMBER:"whatsapp:+14155238886"}).ready, false);
  assert.equal(callingConfig({...env,WHATSAPP_CALLBACK_SIP:"+2250700000002"}).ready, false);
  assert.equal(callingConfig({...env,WHATSAPP_CALLBACK_PUBLIC_URL:"https://example.test/path"}).ready, false);
});
