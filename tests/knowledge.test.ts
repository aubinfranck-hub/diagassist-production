import test from "node:test";
import assert from "node:assert/strict";
import { buildDtcReference, dtcKbStats, extractDtcCodes, isGenericDtc, lookupDtc, normalizeDtcCode } from "../src/modules/dtc/dtcKnowledge";
import { decodeVin, extractVin, formatVinForPrompt, normalizeVin } from "../src/modules/vin/vinDecoder";

test("base DTC : chargement et volumes", () => {
  const st: any = dtcKbStats();
  assert.equal(st.loaded, true);
  assert.ok(st.genericCodes > 9000, `codes génériques : ${st.genericCodes}`);
  assert.ok(st.oemDefinitions > 9000, `définitions constructeur : ${st.oemDefinitions}`);
  assert.ok(st.repairProcedures > 300);
});

test("base DTC : extraction et normalisation des codes", () => {
  assert.deepEqual(extractDtcCodes("valise : p0301, P0171 et C112A:77 puis encore P0301"), ["P0301", "P0171", "C112A"]);
  assert.equal(normalizeDtcCode("u0100-00"), "U0100");
  assert.equal(normalizeDtcCode("X1234"), null);
  assert.equal(isGenericDtc("P0301"), true);
  assert.equal(isGenericDtc("P1155"), false);
  assert.equal(isGenericDtc("P3400"), true);
  assert.equal(isGenericDtc("B1342"), false);
});

test("base DTC : fiche générique enrichie", () => {
  const info = lookupDtc("P0301");
  assert.ok(info?.generic?.t?.toLowerCase().includes("misfire"));
  assert.ok((info?.generic?.c || []).length >= 3);
  const ref = buildDtcReference(["P0301", "P9ZZZ"], "Toyota");
  assert.deepEqual(ref.found, ["P0301"]);
  assert.match(ref.text, /FICHES DE LA BASE DE CODES/);
  assert.match(ref.text, /Causes connues/);
});

test("base DTC : codes constructeur filtrés par marque (famille incluse)", () => {
  const toyota = lookupDtc("P1155", "Lexus");
  assert.ok(toyota && toyota.oem.length > 0);
  assert.ok(toyota.oem.every(o => ["Toyota", "Lexus"].includes(o.brand)), JSON.stringify(toyota.oem));
  const all = lookupDtc("P1155");
  assert.ok(all && all.oem.length >= toyota.oem.length);
});

test("VIN : format et extraction", () => {
  assert.equal(normalizeVin("4t1bf1fk5cu123456"), "4T1BF1FK5CU123456");
  assert.equal(normalizeVin("4T1BF1FK5CU12345O"), null); // O interdit
  assert.equal(extractVin("Le VIN est 1HGCM82633A004352 merci"), "1HGCM82633A004352");
});

test("VIN : décodage hors ligne (Corgi + node:sqlite)", async () => {
  const v = await decodeVin("1HGCM82633A004352");
  assert.equal(v.valid, true);
  assert.equal(v.make, "Honda");
  assert.equal(v.model, "Accord");
  assert.equal(v.year, 2003);
  assert.match(formatVinForPrompt(v), /VÉHICULE IDENTIFIÉ PAR LE VIN/);
  const bad = await decodeVin("ABC");
  assert.equal(bad.valid, false);
});
