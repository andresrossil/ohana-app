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
test("cost shares use MP subtotal across mixed dimensions and exclude all packaging", () => {
  const priced = materials.map((m) =>
    m.id === "c" ? { ...m, unit_cost: 3 } : m,
  );
  const input = [
    line("a", "g", 10),
    line("c", "ml", 10),
    line("p", "ud", 100, "", "packaging"),
  ];
  const r = recipeMath(input, units, priced, "quantity", "", "", 1, false, 0);
  assert.equal(r.ingredientCost, 50);
  assert.equal(r.packagingCost, 300);
  assert.equal(r.totalCost, 350);
  assert.deepEqual(
    r.rows.map((r) => r.costPercentage),
    [40, 60, null],
  );
  const scaled = recipeMath(
    input,
    units,
    priced,
    "quantity",
    "",
    "",
    2,
    false,
    0,
  );
  assert.deepEqual(
    scaled.rows.map((r) => r.costPercentage),
    [40, 60, null],
  );
  const missing = recipeMath(
    input,
    units,
    materials,
    "quantity",
    "",
    "",
    1,
    false,
    0,
  );
  assert.equal(missing.totalCost, null);
  assert.deepEqual(
    missing.rows.map((r) => r.costPercentage),
    [null, null, null],
  );
});
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

// Weight estimates use final output, with packaging and unit supplies kept outside the gram rate.
import { estimatedWeightCost } from '../src/estimated-weight-cost.ts';
import { formulaCost } from '../src/price-cost.ts';
test('weight variant estimates use final yield and retain per-unit packaging', () => {
  const expected = [12.75,14.25,15.75,17.25];
  for (let i=0;i<4;i++) assert.equal(estimatedWeightCost(150,1000,80+i*10,90+i*10).manufacturingCost,expected[i]);
  assert.equal(estimatedWeightCost(150,1000,80,90,2,1).manufacturingCost,15.75);
  assert.equal(estimatedWeightCost(150,1000,90,100,2,1).manufacturingCost,17.25);
  assert.equal(estimatedWeightCost(150,null,80,90).manufacturingCost,null);
  assert.equal(estimatedWeightCost(null,1000,80,90).manufacturingCost,null);
  assert.equal(estimatedWeightCost(150,0,80,90).manufacturingCost,null);
  assert.equal(estimatedWeightCost(150,1000,90,80).manufacturingCost,null);
  assert.equal(estimatedWeightCost(0,1000,80,90).manufacturingCost,0);
});
test('formula costs keep overhead and percentage expenses separate without doubling them', () => {
 const catalog={currency:'GTQ',units,materials:[{id:'raw',name:'Raw',unit_id:'g',unit_cost:.15},{id:'pack',name:'Pack',unit_id:'ud',unit_cost:2},{id:'supply',name:'Supply',unit_id:'ud',unit_cost:1}],additional_costs:[{id:'overhead',name:'Gas',kind:'overhead',unit_price:.5,currency:'GTQ'},{id:'labor',kind:'labor',percent:5},{id:'advertising',kind:'advertising',percent:3}]};
 const formula={code:'F000001',version:1,production_mode:'variable_weight',capture_mode:'quantity',estimated_units:10,estimated_final_weight_g:1000,ingredients:[{id:'i',material_id:'raw',unit_id:'g',quantity:1000,line_kind:'ingredient'},{id:'p',material_id:'pack',unit_id:'ud',quantity:10,line_kind:'packaging'},{id:'a',material_id:'supply',unit_id:'ud',quantity:1,line_kind:'auxiliary',quantity_basis:'unit'}],overhead_lines:[{cost_id:'overhead',quantity:1},{cost_id:'labor',quantity:1},{cost_id:'advertising',quantity:1}]};
 const variant={id:'v',weight_min:80,weight_max:90,price:50,currency:'GTQ'};
 const result=formulaCost(formula,catalog,variant,variant);
 assert.equal(result.costPerGram,.15);
 assert.equal(result.manufacturingCost,15.75);
 assert.equal(result.expenses,4.5);
 assert.equal(result.cost,20.25);
 assert.equal(formulaCost({...formula,estimated_final_weight_g:null},catalog,variant,variant).cost,null);
 assert.equal(formulaCost({...formula,estimated_final_weight_g:1200},catalog,variant,variant).costPerGram,.125);
 const changed={...catalog,materials:catalog.materials.map(m=>m.id==='raw'?{...m,unit_cost:.3}:m)};
 assert.equal(formulaCost(formula,changed,variant,variant).costPerGram,.3);
});
