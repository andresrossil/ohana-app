import type { Row } from "./operations";
const numeric = (v: unknown): number | null =>
  v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const sum = (values: unknown[]) =>
  values.every((v) => numeric(v) != null)
    ? values.reduce<number>((s, v) => s + Number(v), 0)
    : null;
export function materialCosts(lines: Row[], field = "cost") {
  const group = (kind: string) =>
    sum(
      lines
        .filter((l) => (l.line_kind || "ingredient") === kind)
        .map((l) => l[field]),
    );
  return {
    ingredients: group("ingredient"),
    packaging: group("packaging"),
    supplies: group("auxiliary"),
  };
}
export function mergeCostLines(lines: Row[]): Row[] {
  const grouped = new Map<string, Row[]>();
  for (const line of lines) {
    const key = line.kind + ":" + line.cost_id;
    grouped.set(key, [...(grouped.get(key) || []), line]);
  }
  return [...grouped.values()].map((values) => ({
    ...values[0],
    total: sum(values.map((l) => l.total)),
  }));
}
export function financialSummary(materials: Row, quote: Row) {
  const count = numeric(quote.unit_basis_count ?? quote.estimated_units),
    n = count != null && count > 0 ? count : null;
  const price = numeric(quote.sale_price),
    sales = price != null && n != null ? price * n : null;
  const materialTotal = sum([
    materials.packaging,
    materials.ingredients,
    materials.supplies,
    ...("intermediates" in materials ? [materials.intermediates] : []),
  ]);
  const groups = Object.fromEntries(
    ["overhead", "labor", "advertising"].map((kind) => [
      kind,
      sum(
        (quote.cost_lines || [])
          .filter((line: Row) => line.kind === kind)
          .map((line: Row) => line.total),
      ),
    ]),
  );
  const expenses = numeric(quote.additional_total),
    totalCost =
      materialTotal != null && expenses != null
        ? materialTotal + expenses
        : null;
  const before =
    sales != null && materialTotal != null ? sales - materialTotal : null;
  const profit = sales != null && totalCost != null ? sales - totalCost : null;
  const unit = (value: number | null) =>
    value != null && n != null ? value / n : null;
  const margin =
    sales != null && sales > 0 && profit != null
      ? (profit / sales) * 100
      : null;
  return {
    n,
    price,
    sales,
    materialTotal,
    groups,
    totalCost,
    before,
    profit,
    margin,
    unit,
  };
}

export function weightSummaryQuote(plan: Row): Row {
  const units: Row[] = plan.units || [],
    n = Number(plan.unit_count) || units.length;
  const revenue =
    units.length &&
    units.every((u) => numeric(u.price_reference?.price) != null)
      ? units.reduce((s, u) => s + Number(u.price_reference.price), 0)
      : null;
  const lines = mergeCostLines([
    ...(plan.fixed_costs?.cost_lines || []),
    ...units.flatMap((u) => u.commercial_lines || []),
  ]);
  const extra = sum(lines.map((l) => l.total));
  return {
    currency: plan.currency,
    unit_basis_count: n,
    sale_price: revenue != null && n > 0 ? revenue / n : null,
    cost_lines: lines,
    additional_total: extra,
    average: true,
    variable_weight: true,
  };
}
