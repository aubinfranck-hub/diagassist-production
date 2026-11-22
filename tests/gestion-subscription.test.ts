import test from "node:test";
import assert from "node:assert/strict";
import { computeState } from "../src/modules/gestion/subscription";

const DAY = 86_400_000;
const now = 1_800_000_000_000;

test("abonnement : jamais démarré", () => {
  assert.equal(computeState(null, now).state, "none");
});
test("abonnement : essai en cours puis expiré", () => {
  const s = computeState({ trial_ends_at: now + 3 * DAY, paid_until: null }, now);
  assert.deepEqual([s.state, s.daysLeft], ["trial", 3]);
  assert.equal(computeState({ trial_ends_at: now - 1, paid_until: null }, now).state, "expired");
});
test("abonnement : payé prime sur l'essai, expiration = lecture seule", () => {
  assert.equal(computeState({ trial_ends_at: now - DAY, paid_until: now + 10 * DAY }, now).state, "active");
  const e = computeState({ trial_ends_at: now - 5 * DAY, paid_until: now - DAY }, now);
  assert.deepEqual([e.state, e.until], ["expired", now - DAY]);
});
