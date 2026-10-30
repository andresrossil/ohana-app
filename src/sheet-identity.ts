import { normalize } from "./sheet-model.ts";
import type { SheetRow, CatalogRow } from "./sheet-model.ts";
import { linkedBarcode } from "./catalog-model.ts";
export function hydrateIdentity(
  row: SheetRow,
  materials: CatalogRow[],
  origins: CatalogRow[],
): SheetRow {
  const material = row.id
    ? materials.find((m) => m.id === row.materialId)
    : materials.find((m) => normalize(m.name) === normalize(row.cells[2]));
  if (row.metadataEdited) return row;
  const cells = [...row.cells];
  cells[13] = material?.sku || "";
  cells[14] = material?.classification || "";
  cells[15] = origins.find((o) => o.id === material?.origin_id)?.name || "";
  cells[16] = material?.barcode || "";
  return {
    ...row,
    cells,
    barcodeCustom: !!material?.barcode_custom,
    materialId: material?.id,
  };
}
export function editIdentity(
  row: SheetRow,
  col: number,
  value: string,
): SheetRow {
  const next = {
    ...row,
    cells: [...row.cells],
    dirty: true,
    duplicateChoice: undefined,
  };
  next.cells[col] = value;
  if (col >= 13) {
    next.metadataEdited = true;
    if (col === 13) {
      next.skuTouched = true;
      next.cells[16] = linkedBarcode(
        value,
        next.cells[16] || "",
        !!next.barcodeCustom,
      );
    }
    if (col === 16) next.barcodeCustom = true;
  }
  return next;
}
export function identityErrors(
  row: SheetRow,
  rows: SheetRow[],
  materials: CatalogRow[],
  products: CatalogRow[],
  origins: CatalogRow[],
) {
  if (!row.metadataEdited) return [];
  const errors: string[] = [],
    name = normalize(row.cells[2]),
    material = materials.find(
      (m) => m.id === row.materialId || normalize(m.name) === name,
    );
  const origin = origins.find(
    (o) => normalize(o.name) === normalize(row.cells[15] || ""),
  );
  if (
    row.cells[15] &&
    (!origin || (!origin.active && origin.id !== material?.origin_id))
  )
    errors.push("ORIGEN desconocido o inactivo; revísalo en Configuración");
  for (const [index, label] of [
    [13, "SKU"],
    [16, "CÓDIGO DE BARRAS"],
  ] as const) {
    const code = normalize(row.cells[index] || "");
    if (!code) continue;
    if (
      [...materials.filter((m) => m.id !== material?.id), ...products].some(
        (m) =>
          normalize(String(m[index === 13 ? "sku" : "barcode"] || "")) === code,
      ) ||
      rows.some(
        (other) =>
          other.key !== row.key &&
          normalize(other.cells[2]) !== name &&
          normalize(other.cells[index] || "") === code,
      )
    )
      errors.push(`${label} ya está en uso en este negocio`);
  }
  if (
    rows.some(
      (other) =>
        other.key !== row.key &&
        other.metadataEdited &&
        normalize(other.cells[2]) === name &&
        [13, 14, 15, 16].some(
          (c) => (other.cells[c] || "").trim() !== (row.cells[c] || "").trim(),
        ),
    )
  )
    errors.push(
      "Las presentaciones del mismo material deben compartir SKU, clasificación, origen y código de barras",
    );
  return errors;
}
