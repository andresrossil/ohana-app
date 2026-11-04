import type { Row } from "./operations";
const numeric = (v: unknown): number | null =>
  v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v);
export const costCatalogNames: Record<string, string> = {
  overhead: "Otros gastos",
  labor: "Mano de obra",
  advertising: "Publicidad",
};
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
