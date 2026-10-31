import test from "node:test";
import assert from "node:assert/strict";
import { sortSheetKeys, mergeSheetEdits } from "../src/sheet-order.ts";

test("numeric and natural text sorting retain ties and put unknowns last in both directions", () => {
  const rows = [
    { key: "a", n: 10, s: "M10" },
    { key: "b", n: 2, s: "M2" },
    { key: "c", n: null, s: null },
    { key: "d", n: 2, s: "M3" },
  ];
  assert.deepEqual(
    sortSheetKeys(rows, (r) => r.n, "asc"),
    ["b", "d", "a", "c"],
  );
  assert.deepEqual(
    sortSheetKeys(rows, (r) => r.n, "desc"),
    ["a", "b", "d", "c"],
  );
  assert.deepEqual(
    sortSheetKeys(rows, (r) => r.s, "asc"),
    ["b", "d", "a", "c"],
  );
  assert.deepEqual(
    rows.map((r) => r.key),
    ["a", "b", "c", "d"],
  );
});
test("edits and new pasted rows in sorted view keep canonical chronology and record identities", () => {
  const original = [
    { key: "a", price: 10 },
    { key: "b", price: 20 },
  ];
  const merged = mergeSheetEdits(original, [
    { key: "b", price: 21 },
    { key: "a", price: 11 },
    { key: "new", price: 30 },
  ]);
  assert.deepEqual(merged, [
    { key: "a", price: 11 },
    { key: "b", price: 21 },
    { key: "new", price: 30 },
  ]);
  assert.equal(original[0].price, 10);
});
