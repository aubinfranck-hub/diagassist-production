import test from "node:test";
import assert from "node:assert/strict";
import { createProductSearch, searchTokens } from "../src/utils/productSearch";

const items = [
  { name: "BOUGIE D'ALLUMAGE NGK BKR6E", brand: "NGK", compatibility: "Peugeot 406, 307, Citroën C4", category_name: "Allumage" },
  { name: "Bougie Bosch Platinum", brand: "Bosch", compatibility: "Peugeot 407", category_name: "Allumage" },
  { name: "Amortisseur avant Monroe", brand: "Monroe", compatibility: "Toyota Corolla 2010-2014", category_name: "Suspension" },
  { name: "Valise de diagnostic Humzor NexzScan", brand: "Humzor", category_name: "Scanners" },
  { name: "Filtre à huile", brand: "Mann", compatibility: "Hyundai Tucson", category_name: "Filtration" },
];
const search = createProductSearch(items);
const names = (q: string) => search(q).map((i) => i.name);

test("recherche boutique : tous les mots, dans tous les champs", () => {
  assert.deepEqual(names("bougie peugeot 406"), ["BOUGIE D'ALLUMAGE NGK BKR6E"]);
  assert.equal(names("bougies pour peugeot").length, 2);
  assert.deepEqual(names("filtre a huile tucson"), ["Filtre à huile"]);
});

test("recherche boutique : fautes de frappe tolérées, nombres exacts", () => {
  assert.deepEqual(names("amortiseur corolla"), ["Amortisseur avant Monroe"]);
  assert.equal(names("bougi").length, 2);
  assert.deepEqual(names("406"), ["BOUGIE D'ALLUMAGE NGK BKR6E"]); // pas la pièce de 407
  assert.deepEqual(names("pneu"), []);
  assert.deepEqual(searchTokens("Bougies pour la Peugeot 406"), ["bougie", "peugeot", "406"]);
});
