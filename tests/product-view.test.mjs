import test from "node:test";
import assert from "node:assert/strict";
import {
  orderedProducts,
  resolveProduct,
  productLabel,
} from "../src/product-view.ts";
const rows = [
  {
    id: "b",
    name: "Jabón 10",
    sku: "P10",
    barcode: "B2",
    active: true,
    created_at: "2026-10-02T10:00:00Z",
    origin_id: "o2",
  },
  {
    id: "a",
    name: "Jabón 2",
    sku: "P2",
    barcode: "B1",
    active: false,
    created_at: "2026-10-01T10:00:00Z",
    origin_id: "o1",
  },
  {
    id: "c",
    name: "Aceite",
    sku: null,
    barcode: null,
    active: true,
    created_at: null,
  },
];
test("product sorting uses creation timestamps by default and preserves input records", () => {
  assert.deepEqual(
    orderedProducts(rows, "created_at", "asc", []).map((p) => p.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    orderedProducts(rows, "created_at", "desc", []).map((p) => p.id),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    rows.map((p) => p.id),
    ["b", "a", "c"],
  );
});
test("all product data columns sort naturally in either direction and unknown values stay last", () => {
  const origins = [
    { id: "o1", name: "Comprado" },
    { id: "o2", name: "Fabricado" },
  ];
  for (const col of ["sku", "name", "barcode", "active", "origin"]) {
    const asc = orderedProducts(rows, col, "asc", origins),
      desc = orderedProducts(rows, col, "desc", origins);
    assert.equal(new Set(asc.map((p) => p.id)).size, 3);
    assert.equal(new Set(desc.map((p) => p.id)).size, 3);
  }
  assert.deepEqual(
    orderedProducts(rows, "sku", "asc", origins).map((p) => p.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    orderedProducts(rows, "sku", "desc", origins).map((p) => p.id),
    ["b", "a", "c"],
  );
  assert.equal(orderedProducts(rows, "origin", "asc", origins)[0].id, "a");
});
test("formula product selection accepts name, SKU and suggested label without accepting ambiguous or archived products", () => {
  assert.equal(resolveProduct(rows, " p10 ")?.id, "b");
  assert.equal(resolveProduct(rows, "jabón 10")?.id, "b");
  assert.equal(resolveProduct(rows, productLabel(rows[0]))?.id, "b");
  assert.equal(resolveProduct(rows, "P2"), null);
  assert.equal(resolveProduct(rows, "Inventado"), null);
  assert.equal(
    resolveProduct([...rows, { ...rows[0], id: "other" }], "Jabón 10"),
    null,
  );
});
