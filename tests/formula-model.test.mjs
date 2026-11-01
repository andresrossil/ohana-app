import test from "node:test";
import assert from "node:assert/strict";
import { recipeMath, estimatedUnitCost } from "../src/formula-model.ts";
const units = [
  { id: "g", symbol: "g", dimension: "mass", base_factor: 1 },
  { id: "kg", symbol: "kg", dimension: "mass", base_factor: 1000 },
  { id: "ml", symbol: "ml", dimension: "volume", base_factor: 1 },
  { id: "ud", symbol: "ud", dimension: "count", base_factor: 1 },
];
const materials = [
  { id: "a", name: "A", unit_id: "g", unit_cost: 2 },
  { id: "b", name: "B", unit_id: "g", unit_cost: 4 },
  { id: "c", name: "C", unit_id: "ml", unit_cost: null },
  { id: "p", name: "Pack", unit_id: "ud", unit_cost: 3 },
];
const line = (
  material,
  unit,
  quantity,
  percentage = "",
  kind = "ingredient",
) => ({ key: material, material, unit, quantity, percentage, line_kind: kind });
test("theoretical mass uses explicit density, excludes packaging and scales without inferred loss", () => {
  const rows = [
    line("a", "kg", 1),
    { ...line("c", "ml", 100), density_g_ml: 0.9 },
    line("p", "ud", 3, "", "packaging"),
  ];
  const r = recipeMath(rows, units, materials, "quantity", "", "", 2, true, 10);
  assert.equal(r.theoreticalGrams, 2180);
  assert.equal(r.massPartial, false);
  assert.equal(rows[1].quantity, 100);
  const partial = recipeMath(
    [line("a", "g", 25), line("c", "ml", 100)],
    units,
    materials,
    "quantity",
    "",
    "",
    1,
    false,
    0,
  );
  assert.equal(partial.theoreticalGrams, 25);
  assert.equal(partial.massPartial, true);
});
test("densities and quantities never substitute unknown volume with grams", () => {
  const r = recipeMath(
    [{ ...line("c", "ml", 100), density_g_ml: "" }],
    units,
    materials,
    "quantity",
    "",
    "",
    1,
    false,
    0,
  );
  assert.equal(r.theoreticalGrams, 0);
  assert.equal(r.massPartial, true);
  const bad = recipeMath(
    [{ ...line("c", "ml", 100), density_g_ml: -2 }],
    units,
    materials,
    "quantity",
    "",
    "",
    1,
    false,
    0,
  );
  assert.match(bad.errors.join(" "), /densidad/);
});
test("quantity mode converts kg and grams, keeps packaging outside 100%, and scales only the preview", () => {
  const input = [
    line("a", "kg", 1),
    line("b", "g", 1000),
    line("p", "ud", 2, "", "packaging"),
  ];
  const r = recipeMath(input, units, materials, "quantity", "", "", 2, true, 5);
  assert.equal(r.percentageTotal, 100);
  assert.equal(r.rows[0].percentage, 50);
  assert.equal(r.rows[2].percentage, null);
  assert.equal(r.ingredientCost, 12000);
  assert.equal(r.packagingCost, 12);
  assert.equal(r.lossCost, 600);
  assert.equal(r.lossGroups[0].quantity, 200);
  assert.equal(input[0].quantity, 1);
  assert.deepEqual(r.errors, []);
});
test("percentage mode derives unit-aware quantities and validates 100 percent", () => {
  const r = recipeMath(
    [
      line("a", "kg", "", 25),
      line("b", "g", "", 75),
      line("p", "ud", 2, "", "packaging"),
    ],
    units,
    materials,
    "percentage",
    2000,
    "g",
  );
  assert.equal(r.rows[0].quantity, 0.5);
  assert.equal(r.rows[1].quantity, 1500);
  assert.equal(r.percentageTotal, 100);
  assert.deepEqual(r.errors, []);
  assert.ok(
    recipeMath(
      [line("a", "g", "", 60)],
      units,
      materials,
      "percentage",
      100,
      "g",
    ).errors.includes("Los porcentajes deben sumar 100 %."),
  );
});
test("mass and volume never receive combined percentages; missing prices stay unknown, zero remains a price", () => {
  const r = recipeMath(
    [line("a", "g", 10), line("c", "ml", 20)],
    units,
    materials,
    "quantity",
    "",
    "",
    1,
    false,
    5,
  );
  assert.equal(r.compatible, false);
  assert.equal(r.rows[0].percentage, null);
  assert.equal(r.totalCost, null);
  assert.equal(r.knownCost, 20);
  assert.deepEqual(r.lossGroups, []);
  assert.equal(r.lossCost, null);
  assert.ok(
    recipeMath(
      [line("c", "ml", "", 100)],
      units,
      materials,
      "percentage",
      100,
      "g",
    ).errors.length > 0,
  );
  assert.equal(
    recipeMath(
      [line("a", "g", 10)],
      units,
      [{ ...materials[0], unit_cost: 0 }],
      "quantity",
      "",
      "",
    ).totalCost,
    0,
  );
});
test("duplicates and incompatible units cannot pass validation", () => {
  assert.ok(
    recipeMath(
      [line("a", "g", 10), line("a", "g", 20)],
      units,
      materials,
      "quantity",
      "",
      "",
    ).errors.some((e) => e.includes("solo puede aparecer")),
  );
  assert.ok(
    recipeMath([line("a", "ml", 10)], units, materials, "quantity", "", "")
      .errors.length > 0,
  );
});

test("estimated unit cost stays optional and stable when scaling the same recipe", () => {
  assert.equal(estimatedUnitCost(27, 10), 2.7);
  assert.equal(estimatedUnitCost(54, 10, 2), 2.7);
  assert.equal(estimatedUnitCost(null, 10), null);
  assert.equal(estimatedUnitCost(27, ""), null);
  assert.equal(estimatedUnitCost(27, 0), null);
  assert.equal(estimatedUnitCost(27, 10, 0), null);
});
