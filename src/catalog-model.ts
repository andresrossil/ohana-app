import {
  defaultMaterialTypes,
  type MaterialType,
} from "./material-types-model.ts";
import { normalize } from "./sheet-model.ts";
import type { CatalogRow } from "./sheet-model";
export function matchesCatalog(row: CatalogRow, query: string) {
  return [row.name, row.sku, row.barcode, row.alternative_name].some((v) =>
    normalize(String(v || "")).includes(normalize(query)),
  );
}
export function prefixFor(
  kind: "material" | "product",
  classification: string,
  types: MaterialType[] = defaultMaterialTypes,
) {
  return kind === "product"
    ? "P"
    : types.find((t) => t.key === classification)?.prefix || null;
}
export function linkedBarcode(sku: string, barcode: string, custom: boolean) {
  return custom ? barcode : /^[\x20-\x7E]*$/.test(sku) ? sku : "";
}
export function identityPayload(form: FormData) {
  return {
    sku: String(form.get("sku") || "").trim() || null,
    classification: String(form.get("classification") || "").trim() || null,
    origin_id: String(form.get("origin_id") || "") || null,
    barcode: String(form.get("barcode") || "").trim() || null,
    barcode_custom: form.get("barcode_custom") === "true",
  };
}
