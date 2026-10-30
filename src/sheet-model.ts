// Stable logical indices keep historical price calculations independent of display order.
export const columns = [
  "PROVEEDOR",
  "OTRO NOMBRE",
  "MATERIAL",
  "CAPACIDAD",
  "PRESENTACION",
  "UNIDAD MEDIDA",
  "COMENTARIO",
  "PRECIO PRESENTACION",
  "PRECIO UN",
  "VS",
  "PRECIO ANTERIOR",
  "PROVEEDOR ANTERIOR",
  "FECHA CONSULTA",
  "SKU",
  "CLASIFICACIÓN",
  "ORIGEN",
  "CÓDIGO DE BARRAS",
];
export const visualOrder = [
  13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16,
];
export const manualColumns = [0, 1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15, 16];
export const classifications = ["Materia prima", "Material de empaque"];
export type SheetRow = {
  key: string;
  cells: string[];
  id?: string;
  materialId?: string;
  priceId?: string;
  currency: string;
  dirty: boolean;
  mode: "add" | "update";
  duplicateChoice?: boolean;
  legacyAmount?: number | null;
  legacySupplier?: string | null;
  legacyBasis?: string;
  importedPrevious?: string;
  importedSupplier?: string;
  metadataEdited?: boolean;
  barcodeCustom?: boolean;
  skuTouched?: boolean;
};
export type CatalogRow = { id: string; [key: string]: any };
export const normalize = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
export function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function parseNumber(value: string): number | null {
  let s = value
    .trim()
    .replace(/^(?:Q|GTQ|USD|\$)\s*/i, "")
    .replace(/\s/g, "");
  if (!s) return null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^-?\d+,\d{1,8}$/.test(s)) s = s.replace(",", ".");
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export function parseDate(value: string): string | null {
  const s = value.trim();
  let parts = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y, m, d;
  if (parts) [, y, m, d] = parts;
  else {
    parts = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!parts) return null;
    [, d, m, y] = parts;
  }
  const n = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (
    n.getUTCFullYear() !== Number(y) ||
    n.getUTCMonth() + 1 !== Number(m) ||
    n.getUTCDate() !== Number(d)
  )
    return null;
  return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
}
// Excel TSV uses doubled quotes, quoted tabs and quoted multiline cells.
export function parseTSV(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const s = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && (quoted || cell === "")) {
      if (quoted && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "\t" || c === "\n")) {
      row.push(cell);
      cell = "";
      if (c === "\n") {
        result.push(row);
        row = [];
      }
    } else cell += c;
  }
  if (quoted)
    throw Error("El texto contiene una celda entre comillas sin cerrar.");
  row.push(cell);
  result.push(row);
  if (s.endsWith("\n")) result.pop();
  return result;
}
export function formatTSV(rows: string[][]) {
  return rows
    .map((r) =>
      r
        .map((c) => (/[\t\n"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
        .join("\t"),
    )
    .join("\r\n");
}
export function blankRow(): SheetRow {
  return {
    key: crypto.randomUUID(),
    cells: Array.from({ length: columns.length }, (_, i) =>
      i === 12 ? localDate() : "",
    ),
    currency: "GTQ",
    dirty: true,
    mode: "add",
  };
}
const headerKey = (s: string) =>
  normalize(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ ._]/g, "");
export function pasteLayout(matrix: string[][], start = 0) {
  const keys = matrix[0]?.map(headerKey) || [];
  const aliases = new Map(columns.map((c, i) => [headerKey(c), i]));
  aliases.set("mp", 2);
  aliases.set("cantidad", 4);
  // Header-based mapping is independent of order. Unknown header columns fail clearly.
  if (
    keys.some((k) => k === "mp" || k === "material") &&
    keys.some((k) => k === "proveedor" || k === "unidadmedida")
  ) {
    const mapping = keys.map((k) => aliases.get(k));
    if (
      mapping.some((c) => c === undefined) ||
      new Set(mapping).size !== mapping.length
    )
      throw Error(
        "Hay encabezados desconocidos o repetidos. Copia los encabezados de la tabla de Ohana.",
      );
    return { matrix: matrix.slice(1), mapping: mapping as number[] };
  }
  const width = Math.max(0, ...matrix.map((r) => r.length));
  // Original, headerless 13-column Excel layout remains supported at the first cell.
  const legacy =
    start === 0 &&
    width === 13 &&
    !matrix.some((r) => classifications.includes(r[1])) &&
    matrix.some((r) => parseNumber(r[4] || "") !== null);
  const mapping = legacy
    ? Array.from({ length: 13 }, (_, i) => i)
    : visualOrder.slice(start, start + width);
  if (width > mapping.length)
    throw Error(
      "El rango pegado supera las 17 columnas. Selecciona la primera celda o un rango menor.",
    );
  return { matrix, mapping };
}
export function comparison(variation: number | null) {
  return variation === null || variation === 0
    ? "neutral"
    : variation < 0
      ? "lower"
      : "higher";
}
export function findUnit(symbol: string, units: CatalogRow[]) {
  const matches = units.filter(
    (u) =>
      u.active &&
      (normalize(u.symbol) === normalize(symbol) ||
        normalize(u.name) === normalize(symbol)),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
export function validateRow(
  row: SheetRow,
  units: CatalogRow[],
  suppliers: CatalogRow[],
  materials: CatalogRow[],
) {
  const c = row.cells,
    errors: string[] = [];
  const quantity = parseNumber(c[4]),
    price = parseNumber(c[7]);
  if (!c[2].trim()) errors.push("MATERIAL obligatorio");
  for (const i of [0, 1, 2])
    if (c[i].trim().length > 160)
      errors.push(`${columns[i]}: máximo 160 caracteres`);
  if (quantity === null || quantity <= 0 || quantity > 999999999999)
    errors.push("PRESENTACION debe ser mayor que 0");
  if (c[7].trim() && (price === null || price < 0 || price > 99999999999999))
    errors.push("PRECIO PRESENTACION inválido");
  if (quantity !== null && Number(quantity.toFixed(8)) !== quantity)
    errors.push("PRESENTACION: máximo 8 decimales");
  if (price !== null && Number(price.toFixed(4)) !== price)
    errors.push("PRECIO PRESENTACION: máximo 4 decimales");
  if (c[12].trim() && !parseDate(c[12]))
    errors.push("FECHA CONSULTA: usa día/mes/año o año-mes-día");
  const unit = findUnit(c[5], units);
  if (!unit)
    errors.push("UNIDAD MEDIDA desconocida o ambigua; configúrala en Unidades");
  const supplier = suppliers.filter(
    (s) => normalize(s.name) === normalize(c[0]),
  );
  if (supplier.length > 1) errors.push("Proveedor ambiguo");
  else if (supplier[0] && !supplier[0].active)
    errors.push("Proveedor archivado");
  const material = row.materialId
    ? materials.find((m) => m.id === row.materialId)
    : materials.find((m) => normalize(m.name) === normalize(c[2]));
  if (material && !material.active) errors.push("Material archivado");
  const base = units.find((u) => u.id === material?.unit_id);
  if (base && unit && base.dimension !== unit.dimension)
    errors.push("La unidad no es compatible con el material");
  if (
    row.importedPrevious?.trim() &&
    (parseNumber(row.importedPrevious) === null ||
      (parseNumber(row.importedPrevious) as number) < 0)
  )
    errors.push("PRECIO ANTERIOR inválido");
  if (c[14] && !classifications.includes(c[14]))
    errors.push("CLASIFICACIÓN: elige Materia prima o Material de empaque");
  if ((c[13] || "").length > 80) errors.push("SKU: máximo 80 caracteres");
  if (c[16] && (!/^[\x20-\x7E]+$/.test(c[16]) || c[16].length > 80))
    errors.push(
      "CÓDIGO DE BARRAS: usa hasta 80 letras sin acentos, números o signos ASCII para Code 128",
    );
  return errors;
}
export function incompleteWarnings(row: SheetRow) {
  const missing = [0, 1, 3, 6, 7, 12]
    .filter((i) => !row.cells[i].trim())
    .map((i) => columns[i]);
  return missing.length
    ? [
        `Datos pendientes: ${missing.join(", ")}. Puedes guardar y completarlos después.`,
      ]
    : [];
}
export function calculate(
  row: SheetRow,
  units: CatalogRow[],
  presentations: CatalogRow[],
  materials: CatalogRow[],
  suppliers: CatalogRow[],
  history: CatalogRow[],
  legacyImport: boolean,
  basis: string,
) {
  const qty = parseNumber(row.cells[4]),
    price = parseNumber(row.cells[7]),
    unit = findUnit(row.cells[5], units),
    date = parseDate(row.cells[12]);
  const current = qty && price !== null ? price / qty : null;
  const materialId =
    row.materialId ||
    materials.find((m) => normalize(m.name) === normalize(row.cells[2]))?.id;
  const own = history.find((h) => h.id === row.priceId),
    ownPresentation = presentations.find((p) => p.id === row.id);
  const currentSupplier = suppliers.find(
    (s) => normalize(s.name) === normalize(row.cells[0]),
  );
  const quoteChanged =
    !own ||
    (own.amount == null ? null : Number(own.amount)) !== price ||
    own.effective_on !== date ||
    Number(ownPresentation?.quantity) !== qty ||
    ownPresentation?.unit_id !== unit?.id ||
    ownPresentation?.supplier_id !== (currentSupplier?.id ?? null);
  const candidates = history
    .filter((h) => h.id !== row.priceId || quoteChanged)
    .flatMap((h) => {
      const p = presentations.find((p) => p.id === h.presentation_id),
        u = units.find((u) => u.id === p?.unit_id);
      if (
        !p ||
        !u ||
        !unit ||
        p.raw_material_id !== materialId ||
        u.dimension !== unit.dimension ||
        h.currency !== row.currency ||
        h.amount == null ||
        !h.effective_on ||
        !date ||
        h.effective_on > date
      )
        return [];
      // An unchanged saved quotation compares only with earlier chronological records.
      if (
        !quoteChanged &&
        own &&
        [h.effective_on, h.created_at, h.id].join("|") >=
          [own.effective_on, own.created_at, own.id].join("|")
      )
        return [];
      return [
        {
          ...h,
          effective_on: String(h.effective_on),
          created_at: String(h.created_at),
          normalized:
            (Number(h.amount) / Number(p.quantity)) *
            (Number(unit.base_factor) / Number(u.base_factor)),
          supplier: suppliers.find((s) => s.id === p.supplier_id)?.name || "—",
        },
      ];
    })
    .sort((a, b) =>
      [b.effective_on, b.created_at, b.id]
        .join("|")
        .localeCompare([a.effective_on, a.created_at, a.id].join("|")),
    );
  const previous = candidates[0];
  let previousUnit: number | null = previous?.normalized ?? null;
  const legacyAmount =
    legacyImport && row.importedPrevious !== undefined
      ? parseNumber(row.importedPrevious)
      : (row.legacyAmount ?? null);
  const inheritedComparable =
    !own ||
    (own.currency === row.currency &&
      ownPresentation?.unit_id === unit?.id &&
      Number(ownPresentation?.quantity) === qty &&
      !!date &&
      date >= own.effective_on);
  const legacyBasis =
    legacyImport && row.importedPrevious !== undefined
      ? basis
      : inheritedComparable
        ? row.legacyBasis
        : "unknown";
  if (previousUnit === null && legacyAmount !== null) {
    if (legacyBasis === "unit") previousUnit = legacyAmount;
    else if (legacyBasis === "presentation" && qty)
      previousUnit = legacyAmount / qty;
  }
  return {
    current,
    previousUnit,
    variation:
      current !== null && previousUnit !== null ? current - previousUnit : null,
    previousDisplay: previousUnit ?? legacyAmount,
    previousSupplier:
      previous?.supplier ||
      (legacyImport ? row.importedSupplier : row.legacySupplier) ||
      "—",
    previousDate: previous?.effective_on || null,
    unknown: !previous && legacyAmount !== null && previousUnit === null,
  };
}
