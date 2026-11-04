import type { Row } from "./operations";
const numeric = (v: unknown): number | null =>
  v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v);
export const costCatalogNames: Record<string, string> = {
  overhead: "Otros gastos",
  labor: "Mano de obra",
  advertising: "Publicidad",
};
export function costAvailable(
  item: Row,
  selected: Row[],
  items: Row[],
  exclude = -1,
) {
  return !selected.some(
    (line, index) =>
      index !== exclude &&
      (line.cost_id === item.id ||
        (["labor", "advertising"].includes(item.kind) &&
          items.find((x) => x.id === line.cost_id)?.kind === item.kind)),
  );
}
export function costSelectionError(selected: Row[], items: Row[]) {
  if (new Set(selected.map((line) => line.cost_id)).size !== selected.length)
    return "No puedes repetir conceptos de costos adicionales.";
  for (const kind of ["labor", "advertising"]) {
    if (
      selected.filter(
        (line) => items.find((item) => item.id === line.cost_id)?.kind === kind,
      ).length > 1
    )
      return (
        "Solo puedes seleccionar un concepto de " +
        costCatalogNames[kind] +
        " por fórmula."
      );
  }
  return "";
}
export function additionalCosts(
  items: Row[],
  currency: string,
  count: unknown,
  variant?: Row,
  _laborId?: string,
  _advertisingId?: string,
  selected: Row[] = [],
) {
  const units = numeric(count),
    n = units != null && units > 0 ? units : null;
  const price = variant?.currency === currency ? numeric(variant.price) : null;
  const lines = selected.map((line) => {
    const item = items.find((x) => x.id === line.cost_id),
      quantity = item?.kind === "overhead" ? n : numeric(line.quantity),
      percent = numeric(line.percent) ?? numeric(item?.percent);
    const fixed = item?.kind === "overhead";
    return {
      cost_id: line.cost_id,
      kind: item?.kind,
      name: item?.name || "Selecciona un concepto",
      quantity,
      percent: fixed ? null : percent,
      unit_price: fixed ? numeric(item!.unit_price) : null,
      currency: fixed ? item!.currency : currency,
      total: !item
        ? null
        : fixed
          ? quantity !== null && quantity > 0 && item.currency === currency
            ? quantity * Number(item.unit_price)
            : null
          : price !== null && percent !== null && n !== null
            ? ((price * percent) / 100) * n
            : null,
    };
  });
  const sum = (rows: Row[]) =>
    rows.every((x) => x.total != null)
      ? rows.reduce((s, x) => s + x.total, 0)
      : null;
  const overheadLines = lines.filter((x) => x.kind === "overhead"),
    overhead = sum(overheadLines),
    total = sum(lines);
  return {
    currency,
    estimated_units: n,
    unit_basis_count: n,
    sale_price: price,
    variant_id: variant?.id || null,
    cost_lines: lines,
    overhead_lines: overheadLines,
    overhead_total: overhead,
    overhead_unit: overhead !== null && n !== null ? overhead / n : null,
    additional_total: total,
    additional_unit: total !== null && n !== null ? total / n : null,
  };
}
