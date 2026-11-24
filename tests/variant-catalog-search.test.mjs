import assert from "node:assert/strict";
import { test } from "node:test";
import { variantMatches } from "../src/variant-catalog-search.ts";

test("variant search covers commercial size, code, identifiers and configured attributes", () => {
  const variant = {
    name: "Pequeño",
    commercial_code: "JT-1",
    sku: "P0001-02",
    barcode: "75010042",
    attributes: { acabado: "Satín", aroma: "Limón" },
  };
  for (const query of [" pequenO ", "JT-1", "0001-02", "75010042", "acabado satin", "JT-1 limon"]) {
    assert.equal(variantMatches(query, variant), true, query);
  }
  assert.equal(variantMatches("", variant), true);
  assert.equal(variantMatches("JT-1 vainilla", variant), false);
});
