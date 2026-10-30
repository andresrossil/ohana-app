import test from "node:test";
import assert from "node:assert/strict";
import JsBarcode from "jsbarcode";
import {
  blankRow,
  columns,
  visualOrder,
  parseTSV,
  formatTSV,
  pasteLayout,
  comparison,
  validateRow,
} from "../src/sheet-model.ts";
import {
  hydrateIdentity,
  editIdentity,
  identityErrors,
} from "../src/sheet-identity.ts";
import {
  linkedBarcode,
  prefixFor,
  matchesCatalog,
} from "../src/catalog-model.ts";
const units = [
  {
    id: "g",
    name: "Gramo",
    symbol: "g",
    active: true,
    dimension: "mass",
    base_factor: 1,
  },
];
const materials = [
  {
    id: "m1",
    name: "Material existente",
    unit_id: "g",
    sku: "M0099",
    barcode: "PERSONAL-99",
    barcode_custom: true,
    classification: "Materia prima",
    origin_id: "o1",
    active: true,
  },
];
const origins = [
  { id: "o1", name: "Adquirido", active: false },
  { id: "o2", name: "Fabricado", active: true },
];
test("old Excel headers and headerless 13-column data keep the original material and prices", () => {
  const data = [
    "Proveedor",
    "",
    "Nuevo material",
    "",
    "50",
    "g",
    "",
    "120",
    "2.4",
    "-1",
    "130",
    "",
    "3/07/2026",
  ];
  for (const input of [
    formatTSV([data]),
    formatTSV([
      ["PROVEEDOR", "OTRO NOMBRE", "MP", ...columns.slice(3, 13)],
      data,
    ]),
  ]) {
    const { matrix, mapping } = pasteLayout(parseTSV(input));
    const row = blankRow();
    mapping.forEach((c, i) => (row.cells[c] = matrix[0][i]));
    assert.equal(row.cells[2], "Nuevo material");
    assert.equal(row.cells[7], "120");
    assert.equal(row.cells[12], "3/07/2026");
    assert.equal(row.cells[13], "");
  }
});
test("new 17-column round trips preserve SKU, classification, barcode, multiline comment and blanks", () => {
  const row = blankRow();
  row.cells[13] = "CUSTOM-1";
  row.cells[14] = "Material de empaque";
  row.cells[15] = "Fabricado";
  row.cells[2] = "Caja";
  row.cells[4] = "5";
  row.cells[5] = "g";
  row.cells[6] = "nota\ncon\ttab";
  row.cells[16] = "BAR-123";
  const { matrix, mapping } = pasteLayout(
    parseTSV(
      formatTSV([
        visualOrder.map((c) => columns[c]),
        visualOrder.map((c) => row.cells[c]),
      ]),
    ),
  );
  const output = blankRow();
  mapping.forEach((c, i) => (output.cells[c] = matrix[0][i]));
  assert.deepEqual(output.cells, row.cells);
  const partial = visualOrder.slice(0, 13).map((c) => row.cells[c]);
  assert.deepEqual(pasteLayout([partial]).mapping, visualOrder.slice(0, 13));
  assert.throws(() =>
    pasteLayout([["MATERIAL", "UNIDAD MEDIDA", "DESCONOCIDA"]]),
  );
  assert.deepEqual(
    pasteLayout([
      ["MATERIAL", "PRESENTACIÓN", "UNIDAD MEDIDA"],
      ["Caja", "1", "g"],
    ]).mapping,
    [2, 4, 5],
  );
});
test("legacy import hydrates existing identifiers and origins without marking metadata for replacement", () => {
  const row = blankRow();
  row.cells[2] = "Material existente";
  const hydrated = hydrateIdentity(row, materials, origins);
  assert.equal(hydrated.cells[13], "M0099");
  assert.equal(hydrated.cells[15], "Adquirido");
  assert.equal(hydrated.cells[16], "PERSONAL-99");
  assert.equal(hydrated.metadataEdited, undefined);
  const classified = editIdentity(hydrated, 14, "Material de empaque");
  assert.equal(classified.cells[13], "M0099");
  assert.equal(classified.cells[16], "PERSONAL-99");
  assert.equal(classified.metadataEdited, true);
  assert.equal(editIdentity(classified, 13, "M0100").cells[16], "PERSONAL-99");
  const cleared = editIdentity(classified, 16, "");
  assert.equal(editIdentity(cleared, 13, "M0101").cells[16], "");
  const linked = editIdentity(blankRow(), 13, "M0001");
  assert.equal(linked.cells[16], "M0001");
});
test("optional codes, configured origins and cross-catalog duplicate checks", () => {
  const row = blankRow();
  row.cells[2] = "New material";
  row.cells[4] = "1";
  row.cells[5] = "g";
  assert.deepEqual(validateRow(row, units, [], []), []);
  const duplicate = editIdentity(row, 13, "m0099");
  assert.match(
    identityErrors(duplicate, [duplicate], materials, [], origins).join(),
    /SKU/,
  );
  const barcode = editIdentity(row, 16, "PRODUCT-BAR");
  assert.match(
    identityErrors(
      barcode,
      [barcode],
      [],
      [{ id: "p", barcode: "PRODUCT-BAR" }],
      origins,
    ).join(),
    /BARRAS/,
  );
  const original = hydrateIdentity(
    {
      ...row,
      cells: [
        ...row.cells.slice(0, 2),
        "Material existente",
        ...row.cells.slice(3),
      ],
    },
    materials,
    origins,
  );
  original.metadataEdited = true;
  assert.deepEqual(
    identityErrors(original, [original], materials, [], origins),
    [],
  );
  const inactive = editIdentity(row, 15, "Adquirido");
  assert.match(
    identityErrors(inactive, [inactive], materials, [], origins).join(),
    /inactivo/,
  );
  const unknown = editIdentity(row, 15, "Unknown");
  assert.match(
    identityErrors(unknown, [unknown], materials, [], origins).join(),
    /desconocido/,
  );
  const invalid = editIdentity(row, 16, "CÓDIGO");
  assert.match(validateRow(invalid, units, [], []).join(), /Code 128/);
});
test("prefix suggestions, searches and personalized blank barcodes", () => {
  assert.equal(prefixFor("material", "Materia prima"), "M");
  assert.equal(prefixFor("material", "Material de empaque"), "E");
  assert.equal(prefixFor("material", ""), null);
  assert.equal(prefixFor("product", ""), "P");
  assert.equal(linkedBarcode("M0001", "", false), "M0001");
  assert.equal(linkedBarcode("M0002", "CUSTOM", true), "CUSTOM");
  assert.equal(linkedBarcode("M0002", "", true), "");
  assert.equal(matchesCatalog(materials[0], "personal-99"), true);
  assert.equal(matchesCatalog(materials[0], "M0099"), true);
});
test("VS only colors strictly lower or higher comparable prices", () => {
  assert.equal(comparison(-1), "lower");
  assert.equal(comparison(1), "higher");
  assert.equal(comparison(0), "neutral");
  assert.equal(comparison(null), "neutral");
  assert.equal(comparison(-1e-12), "lower");
});
test("Code 128 encodes letters, digits and punctuation with start/stop and rejects unsupported text", () => {
  for (const code of ["M0001", "P0001", "123456789012", "CUSTOM-99 / A"]) {
    const result = {};
    JsBarcode(result, code, { format: "CODE128" });
    assert.ok(result.encodings[0].data.startsWith("110100"));
    assert.ok(result.encodings[0].data.endsWith("1100011101011"));
    assert.equal(result.encodings[0].text, code);
  }
  assert.throws(() => JsBarcode({}, "CÓDIGO", { format: "CODE128" }));
});
