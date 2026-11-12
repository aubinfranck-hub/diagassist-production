import assert from "node:assert/strict";
import test from "node:test";
import { readCart, saveCart } from "../src/modules/shop/cart";

const item = { product_id: 8, quantity: 2, name: "Scanner", price_fcfa: 149900, photo: null };

test("restores valid legacy cart lines and skips invalid lines independently", () => {
  const data = [null, { ...item, quantity: -1 }, { ...item, product_id: "8", quantity: "2", price_fcfa: "149900" }, item];
  assert.deepEqual(readCart(() => JSON.stringify(data)), [item]);
  assert.deepEqual(readCart(() => JSON.stringify([{ ...item, price_fcfa: null }])), [{ ...item, price_fcfa: null }]);
});

test("invalid or inaccessible cart storage recovers without crashing", () => {
  for (const value of [null, "{", "{}", "null", "12", "[null]"]) assert.deepEqual(readCart(() => value), []);
  assert.deepEqual(readCart(() => { throw new Error("storage denied"); }), []);
  assert.equal(saveCart([item], () => { throw new Error("quota exceeded"); }), false);
  let saved = "";
  assert.equal(saveCart([item], value => { saved = value; }), true);
  assert.deepEqual(readCart(() => saved), [item]);
});
