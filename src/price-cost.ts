import { estimatedWeightCost } from "./estimated-weight-cost.ts";
import {
  recipeMath,
  estimatedUnitCost,
  type RecipeLine,
} from "./formula-model.ts";
import { additionalCosts } from "./additional-costs.ts";
import type { Row } from "./operations";

export function priceCost(
  variant: Row,
  formulas: Row[],
  catalog: Row,
  saleReference?: Row,
): Row {
  const hasRange = variant.weight_min != null && variant.weight_max != null;
  const candidates = formulas.filter(
    (f) =>
      f.product_id === variant.product_id &&
      (f.estimate_variant_id === variant.id ||
        f.production_mode === "variable_weight" ||
        hasRange) &&
      ["current", "testing"].includes(f.state),
  );
  const current = candidates.filter((f) => f.state === "current");
  const eligible = current.length ? current : candidates;
  if (!eligible.length)
    return { cost: null, reason: "Sin fórmula vinculada", source: "" };
  if (new Set(eligible.map((f) => f.family_id || f.id)).size > 1)
    return {
      cost: null,
      reason: "Varias fórmulas: define la referencia vigente",
      source: "",
    };
  const formula = [...eligible].sort(
    (a, b) => Number(b.version) - Number(a.version),
  )[0];
  return formulaCost(formula, catalog, saleReference, variant);
}

export function formulaCost(
  formula: Row,
  catalog: Row,
  saleReference?: Row,
  weightVariant?: Row,
): Row {
  const source = `${formula.code} · v${formula.version}${formula.state === "testing" ? " · En pruebas" : ""}`;
  if (
    !(Number(formula.estimated_units) > 0) &&
    formula.production_mode !== "variable_weight" &&
    weightVariant?.weight_min == null
  )
    return { cost: null, reason: "Unidades estimadas pendientes", source };
  const lines: RecipeLine[] = (formula.ingredients || []).map((i: Row) => ({
    key: i.id,
    material: i.material_id,
    unit: i.unit_id,
    quantity: Number(i.quantity),
    percentage: i.percentage == null ? "" : Number(i.percentage),
    line_kind: i.line_kind || "ingredient",
    quantity_basis: i.quantity_basis || "recipe",
    reference_notes: i.reference_notes || "",
    density_g_ml: i.density_g_ml ?? "",
  }));
  if (!lines.some((l) => l.line_kind === "ingredient"))
    return { cost: null, reason: "Composición pendiente", source };
  const math = recipeMath(
    lines,
    catalog.units,
    catalog.materials,
    formula.capture_mode,
    formula.total_quantity || 1000,
    formula.total_unit_id || "",
    1,
    formula.loss_enabled,
    Number(formula.loss_percent),
    formula.estimated_units,
  );
  if (math.totalCost == null || math.errors.length)
    return { cost: null, reason: "Costo de materiales incompleto", source };
  if (
    formula.production_mode === "variable_weight" ||
    weightVariant?.weight_min != null
  ) {
    const fixedLines = (formula.overhead_lines || []).filter(
      (line: Row) =>
        catalog.additional_costs?.find((item: Row) => item.id === line.cost_id)
          ?.kind === "overhead",
    );
    const commercialLines = (formula.overhead_lines || []).filter(
      (line: Row) => !fixedLines.includes(line),
    );
    const fixed = additionalCosts(
      catalog.additional_costs || [],
      catalog.currency,
      formula.estimated_units,
      undefined,
      "",
      "",
      fixedLines,
    );
    const commercial = additionalCosts(
      catalog.additional_costs || [],
      catalog.currency,
      1,
      saleReference,
      "",
      "",
      commercialLines,
    );
    const packagingTotal = math.rows
      .filter((row) => row.line_kind === "packaging")
      .reduce((sum, row) => sum + (row.cost ?? 0), 0);
    const suppliesTotal = math.rows
      .filter(
        (row) => row.line_kind === "auxiliary" && row.quantity_basis === "unit",
      )
      .reduce((sum, row) => sum + (row.cost ?? 0), 0);
    const units = Number(formula.estimated_units),
      validUnits = Number.isFinite(units) && units > 0;
    const perUnit = (amount: number) =>
      amount === 0 ? 0 : validUnits ? amount / units : null;
    const commonMaterials = math.totalCost - packagingTotal - suppliesTotal;
    const estimate = estimatedWeightCost(
      commonMaterials,
      formula.estimated_final_weight_g,
      weightVariant?.weight_min,
      weightVariant?.weight_max,
      perUnit(packagingTotal),
      perUnit(suppliesTotal),
    );
    const overheadUnit = fixedLines.length ? fixed.additional_unit : 0;
    const expenses =
      overheadUnit != null && commercial.additional_total != null
        ? overheadUnit + commercial.additional_total
        : null;
    const cost =
      estimate.manufacturingCost != null && expenses != null
        ? estimate.manufacturingCost + expenses
        : null;
    return {
      ...estimate,
      commonMaterials,
      cost,
      expenses,
      source,
      reason:
        estimate.reason ||
        (expenses == null
          ? "Gastos pendientes de precio o unidades"
          : "Estimado por peso promedio; gastos separados"),
    };
  }
  const extra = additionalCosts(
    catalog.additional_costs || [],
    catalog.currency,
    formula.estimated_units,
    saleReference,
    formula.labor_level_id,
    formula.advertising_level_id,
    formula.overhead_lines || [],
  );
  if (extra.additional_total == null)
    return { cost: null, reason: "Costos adicionales pendientes", source };
  const cost = estimatedUnitCost(
    math.totalCost + extra.additional_total,
    formula.estimated_units,
  );
  return {
    cost,
    manufacturingCost: estimatedUnitCost(
      math.totalCost,
      formula.estimated_units,
    ),
    expenses: extra.additional_unit,
    reason: cost == null ? "Costo pendiente" : "",
    source,
  };
}
