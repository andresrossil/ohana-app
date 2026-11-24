const normalize = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/\p{M}/gu, "")
  .toLocaleLowerCase("es");

export function variantMatches(query: string, variant: {
  name?: string;
  commercial_code?: string;
  sku?: string;
  barcode?: string;
  attributes?: Record<string, unknown>;
}) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const text = [
    variant.name, variant.commercial_code, variant.sku, variant.barcode,
    ...Object.entries(variant.attributes || {}).flat(),
  ].map(normalize).join(" ");
  return terms.every(term => text.includes(term));
}
