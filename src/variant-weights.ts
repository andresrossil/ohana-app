export type WeightVariant = {
  id: string;
  product_id?: string;
  name?: string;
  active?: boolean;
  attributes?: Record<string, unknown>;
  weight_min?: number | string | null;
  weight_max?: number | string | null;
};
export const normalizedAttributes = (
  attributes: Record<string, unknown> = {},
) =>
  JSON.stringify(
    Object.entries(attributes)
      .map(([k, v]) => [
        k.trim().replace(/\s+/g, " ").toLowerCase(),
        String(v ?? "")
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase(),
      ])
      .filter(([, v]) => v !== "")
      .sort(([a], [b]) => a.localeCompare(b)),
  );
export function weightMatches(
  variants: WeightVariant[],
  attributes: Record<string, unknown>,
  weight: unknown,
) {
  const n = weight == null || weight === "" ? NaN : Number(weight);
  if (
    !Number.isFinite(n) ||
    n <= 0 ||
    n >= 1e12 ||
    Math.abs(n * 10000 - Math.round(n * 10000)) > 0.00001
  )
    return [];
  const key = normalizedAttributes(attributes);
  return variants.filter(
    (v) =>
      v.active !== false &&
      v.weight_min != null &&
      v.weight_max != null &&
      Number(v.weight_min) <= n &&
      n < Number(v.weight_max) &&
      normalizedAttributes(v.attributes) === key,
  );
}
export function weightRangeError(
  variants: WeightVariant[],
  draft: WeightVariant,
): string {
  const min =
      draft.weight_min === "" || draft.weight_min == null
        ? null
        : Number(draft.weight_min),
    max =
      draft.weight_max === "" || draft.weight_max == null
        ? null
        : Number(draft.weight_max);
  if (min === null && max === null) return "";
  if (min === null || max === null)
    return "Indica tanto el peso mínimo como el máximo, o deja ambos vacíos.";
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || min >= max)
    return "El peso mínimo debe ser mayor que cero y menor que el máximo.";
  if (
    draft.active !== false &&
    variants.some(
      (v) =>
        v.id !== draft.id &&
        v.active !== false &&
        normalizedAttributes(v.attributes) ===
          normalizedAttributes(draft.attributes) &&
        v.weight_min != null &&
        v.weight_max != null &&
        min < Number(v.weight_max) &&
        Number(v.weight_min) < max,
    )
  )
    return "El rango se superpone con otra variante del mismo producto y atributos.";
  return "";
}
export const weightRangeLabel = (v: WeightVariant) =>
  v.weight_min != null && v.weight_max != null
    ? Number(v.weight_min).toLocaleString("es-GT",{maximumFractionDigits:4}) + " g ≤ peso < " + Number(v.weight_max).toLocaleString("es-GT",{maximumFractionDigits:4}) + " g"
    : "Sin rango";
