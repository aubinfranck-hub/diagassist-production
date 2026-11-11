import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

test("OSRM : trajets routiers, table, repli si indisponible", async () => {
  const calls: string[] = [];
  const srv = http.createServer((req, res) => {
    calls.push(req.url || "");
    res.setHeader("Content-Type", "application/json");
    if (req.url!.startsWith("/route/v1/driving/")) return res.end(JSON.stringify({ code: "Ok", routes: [{ distance: 7400, duration: 1260 }] }));
    if (req.url!.startsWith("/table/v1/driving/")) return res.end(JSON.stringify({ code: "Ok", durations: [[600], [300], [null]], distances: [[5000], [2500], [null]] }));
    res.statusCode = 404; res.end("{}");
  }).listen(0, "127.0.0.1");
  await once(srv, "listening");
  const port = (srv.address() as any).port;
  const { routeLeg, routeManyTo, routingEnabled } = await import("../src/modules/assistance/routing");
  try {
    delete process.env.OSRM_URL;
    assert.equal(routingEnabled(), false);
    assert.equal(await routeLeg({ lat: 5.3, lng: -4 }, { lat: 5.35, lng: -4.02 }), null);

    process.env.OSRM_URL = `http://127.0.0.1:${port}/`;
    process.env.OSRM_DURATION_FACTOR = "1.5";
    const leg = await routeLeg({ lat: 5.3, lng: -4 }, { lat: 5.35, lng: -4.02 });
    assert.deepEqual(leg, { km: 7.4, minutes: 32 }); // 21 min × 1,5
    assert.match(calls[0], /^\/route\/v1\/driving\/-4\.000000,5\.300000;-4\.020000,5\.350000/); // ordre lng,lat
    await routeLeg({ lat: 5.3, lng: -4 }, { lat: 5.35, lng: -4.02 });
    assert.equal(calls.length, 1, "deuxième appel servi par le cache");

    const many = await routeManyTo([{ lat: 5.31, lng: -4 }, { lat: 5.32, lng: -4 }, { lat: 9, lng: 9 }], { lat: 5.35, lng: -4.02 });
    assert.deepEqual(many, [{ km: 5, minutes: 15 }, { km: 2.5, minutes: 8 }, null]);
    assert.match(calls[1], /destinations=3/);

    process.env.OSRM_URL = "http://127.0.0.1:1"; // injoignable
    assert.equal(await routeLeg({ lat: 6, lng: -5 }, { lat: 6.1, lng: -5.1 }, 500), null);
  } finally {
    delete process.env.OSRM_URL; delete process.env.OSRM_DURATION_FACTOR;
    srv.close();
  }
});
