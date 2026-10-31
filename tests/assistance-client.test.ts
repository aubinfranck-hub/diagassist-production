import test from "node:test";
import assert from "node:assert/strict";
import { canPrepareRequest, requestServices, serviceSelectable } from "../src/components/assistance/clientAvailability";
import type { AssistanceStatus } from "../src/components/assistance/api";
import { enqueueRequest, readPending, replayPending } from "../src/components/assistance/offlineQueue";
import { callbackLink, positionFreshness } from "../src/components/assistance/clientSupport";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RequestReview from "../src/components/assistance/RequestReview";

const status: AssistanceStatus = {
  enabled: true, dbConfigured: true, whatsappConfigured: false, zones: [],
  services: [{ code: "mecanique", label: "Mécanique", available: false, atelierAvailable: true }],
};

test("cold offline start permits preparation without claiming provider availability", () => {
  assert.equal(canPrepareRequest(null, false), true);
  const services = requestServices(null, false);
  assert.ok(services.length > 0);
  assert.ok(services.every(s => !s.available));
  assert.equal(serviceSelectable(services[0], false, false), true);
  assert.equal(canPrepareRequest(null, true), false);
  assert.equal(requestServices(null, true).length, 0);
});

test("online service checks respect closures and workshop-only availability", () => {
  assert.equal(canPrepareRequest(status, true), true);
  assert.equal(serviceSelectable(status.services[0], true, true), true);
  assert.equal(serviceSelectable(status.services[0], false, true), false);
  assert.equal(canPrepareRequest({ ...status, enabled: false }, true), false);
  assert.equal(canPrepareRequest({ ...status, dbConfigured: false }, true), false);
  assert.equal(canPrepareRequest({ ...status, services: [] }, true), false);
});

test("arrival freshness rejects missing, invalid, old and future timestamps", () => {
  const now = 1_800_000_000_000;
  assert.equal(positionFreshness(now - 59999, now).stale, false);
  assert.match(positionFreshness(now - 59999, now).label, /moins d'une minute/);
  assert.equal(positionFreshness(now - 299999, now).stale, false);
  assert.equal(positionFreshness(now - 300000, now).stale, true);
  for (const invalid of [undefined, 0, NaN, Infinity, now + 120000]) {
    assert.equal(positionFreshness(invalid, now).stale, true);
  }
});

test("WhatsApp callback encodes the dossier reference without private location or session data", () => {
  const url = new URL(callbackLink("req & #é"));
  assert.equal(url.hostname, "wa.me");
  assert.equal(url.pathname, "/2250707312797");
  assert.match(url.searchParams.get("text")!, /req & #é/);
  assert.equal([...url.searchParams.keys()].length, 1);
});

test("review displays client details and consent without implying an accepted quote", () => {
  const html = renderToStaticMarkup(createElement(RequestReview, {
    atelier: false, symptoms: "Panne <script>", phone: "0700000000",
    vehicle: { brand: "Toyota", model: "Corolla" }, address: "", landmark: "Station",
    position: { lat: 5.36, lng: -4.0083 }, mediaCount: 2, shareDiagnostic: false,
  }));
  for (const text of ["0700000000", "Toyota Corolla", "5.36000, -4.00830", "Station", "Non partagé", "ne valide aucun devis"]) {
    assert.ok(html.includes(text), text);
  }
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});


test("offline queue preserves the confirmed vehicle location and retries server failures", async () => {
  const keys = ["localStorage", "navigator", "window", "fetch"] as const;
  const previous = keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
  const data = new Map<string, string>();
  let online = false;
  let submitted: any;
  let fail = true;
  let geolocationCalls = 0;
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k),
    } });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
      get onLine() { return online; },
      geolocation: { getCurrentPosition: () => { geolocationCalls++; } },
    } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent() {} } });
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (_url: unknown, init: RequestInit) => {
      if (init.method === "GET") return Response.json({ requests: [] });
      submitted = JSON.parse(String(init.body));
      return fail ? Response.json({}, { status: 503 }) : Response.json({ request: { id: "request-1" } });
    } });
    const position = { lat: 5.36, lng: -4.0083, source: "carte", landmark: "Garage", confirmed: true };
    assert.equal((await enqueueRequest({ symptoms: "Panne", position, submit: true }, [])).ok, true);
    assert.equal((await replayPending()).created.length, 0);
    assert.equal(readPending().length, 1);
    online = true;
    assert.equal((await replayPending()).created.length, 0);
    assert.equal(readPending().length, 1, "503 must not discard the pending request");
    fail = false;
    assert.deepEqual((await replayPending()).created, ["request-1"]);
    assert.deepEqual(submitted.position, position);
    assert.equal(submitted.submit, true);
    assert.equal(geolocationCalls, 0);
    assert.equal(readPending().length, 0);
  } finally {
    for (const [k, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, k, descriptor);
      else delete (globalThis as any)[k];
    }
  }
});
