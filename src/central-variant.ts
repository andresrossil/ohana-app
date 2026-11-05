import type { Row } from "./operations";
/** Lower median of product variants, ordered only by range bounds; ID stabilizes exact ties. */
export function centralVariant(
  variants: Row[],
  product: string,
): Row | undefined {
  const entries = variants.filter(
    (v) => v.product_id === product,
  );
  if (entries.length === 1) return entries[0];
  const number = (v: unknown) => (v == null || v === "" ? NaN : Number(v));
  if (
    !entries.length ||
    entries.some(
      (v) =>
        !Number.isFinite(number(v.weight_min)) ||
        !Number.isFinite(number(v.weight_max)) ||
        number(v.weight_min) < 0 ||
        number(v.weight_max) < number(v.weight_min),
    )
  )
    return undefined;
  return [...entries].sort(
    (a, b) =>
      number(a.weight_min) - number(b.weight_min) ||
      number(a.weight_max) - number(b.weight_max) ||
      String(a.id).localeCompare(String(b.id)),
  )[Math.floor((entries.length - 1) / 2)];
}
