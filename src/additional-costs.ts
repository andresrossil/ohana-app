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
  laborId?: string,
  advertisingId?: string,
  selectedExpenses: Row[] = [],
) {
  const units = numeric(count),
    n = units != null && units > 0 ? units : null;
  const expenses = selectedExpenses.map((line) => {
    const item = items.find(
      (x) => x.kind === "overhead" && x.id === line.cost_id,
    );
    const qty = numeric(line.quantity);
    return {
      cost_id: line.cost_id,
      name: item?.name || "Concepto no disponible",
      quantity: qty,
      unit_price: item ? numeric(item.unit_price) : null,
      currency: item?.currency,
      total:
        item && qty !== null && qty > 0 && item.currency === currency
          ? qty * Number(item.unit_price)
          : null,
    };
  });
  const overhead = expenses.every((x) => x.total !== null)
    ? expenses.reduce((sum, x) => sum + x.total!, 0)
    : null;
  const price = variant?.currency === currency ? numeric(variant.price) : null;
  const level = (id: string | undefined, kind: string) => {
    const row = items.find((x) => x.id === id && x.kind === kind);
    const unit = !id
      ? 0
      : row && price !== null
        ? (price * Number(row.percent)) / 100
        : null;
    return {
      id: id || null,
      name: row?.name,
      percent: row?.percent ?? null,
      unit,
      total: !id ? 0 : unit !== null && n !== null ? unit * n : null,
    };
  };
  const labor = level(laborId, "labor"),
    advertising = level(advertisingId, "advertising");
  const total =
    overhead !== null && labor.total !== null && advertising.total !== null
      ? overhead + labor.total + advertising.total
      : null;
  return {
    currency,
    estimated_units: n,
    sale_price: price,
    variant_id: variant?.id || null,
    overhead_total: overhead,
    overhead_lines: expenses,
    unit_basis_count: n,
    overhead_unit: overhead !== null && n !== null ? overhead / n : null,
    labor,
    advertising,
    additional_total: total,
    additional_unit: total !== null && n !== null ? total / n : null,
  };
}
