import type { Row } from "./operations";
/** name is the existing commercial-size field; SKU is never a commercial code. */
export function variantLabel(v: Row): string {
  if (!("commercial_code" in v)) return v.name || v.sku || "Variante";
  const parts = [v.commercial_code, v.name].map((x) =>
    String(x || "").toUpperCase(),
  );
  if (
    v.weight_min != null &&
    v.weight_min !== "" &&
    v.weight_max != null &&
    v.weight_max !== ""
  )
    parts.push(
      `${Number(v.weight_min).toLocaleString("es-GT", { maximumFractionDigits: 4 })}–${Number(v.weight_max).toLocaleString("es-GT", { maximumFractionDigits: 4 })} g`,
    );
  parts.push(
    ...Object.values(v.attributes || {}).map((x) => String(x).toUpperCase()),
  );
  return (
    parts.filter((x) => x != null && String(x).trim()).join(" · ") ||
    v.sku ||
    "Variante"
  );
}
