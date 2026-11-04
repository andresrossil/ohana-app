import {
  recipeMath,
  estimatedUnitCost,
  type RecipeLine,
} from "./formula-model";
import { additionalCosts } from "./additional-costs";
import type { Row } from "./operations";

export function priceCost(
  variant: Row,
  formulas: Row[],
  catalog: Row,
  saleReference?: Row,
) {
  const candidates = formulas.filter(
    (f) =>
      f.product_id === variant.product_id &&
      (f.estimate_variant_id === variant.id ||
        f.production_mode === "variable_weight") &&
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
) {
  const source = `${formula.code} · v${formula.version}${formula.state === "testing" ? " · En pruebas" : ""}`;
  if (
    !(Number(formula.estimated_units) > 0) &&
    formula.production_mode !== "variable_weight"
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
  if (formula.production_mode === "variable_weight") {
    if (
      !weightVariant ||
      !(Number(weightVariant.weight_min) > 0) ||
      !(Number(weightVariant.weight_max) > Number(weightVariant.weight_min))
    )
      return { cost: null, reason: "Según pesos y variantes del lote", source };
    if (math.massPartial || !(math.theoreticalGrams > 0))
      return {
        cost: null,
        reason: "Peso teórico incompleto para estimar",
        source,
      };
    const perUnit = math.rows
      .filter(
        (r) =>
          r.line_kind === "packaging" ||
          (r.line_kind === "auxiliary" && r.quantity_basis === "unit"),
      )
      .reduce((s, r) => s + (r.cost ?? 0), 0);
    if (perUnit > 0 && !(Number(formula.estimated_units) > 0))
      return {
        cost: null,
        reason: "Unidades estimadas pendientes para empaque",
        source,
      };
    const fixedLines = (formula.overhead_lines || []).filter(
      (l: Row) =>
        catalog.additional_costs?.find((c: Row) => c.id === l.cost_id)?.kind ===
        "overhead",
    );
    const percentageLines = (formula.overhead_lines || []).filter(
      (l: Row) => !fixedLines.includes(l),
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
      percentageLines,
    );
    if (fixed.additional_total == null || commercial.additional_total == null)
      return { cost: null, reason: "Costos adicionales pendientes", source };
    const midpoint =
      (Number(weightVariant.weight_min) + Number(weightVariant.weight_max)) / 2;
    const cost =
      ((math.totalCost - perUnit + fixed.additional_total) * midpoint) /
        math.theoreticalGrams +
      (Number(formula.estimated_units) > 0
        ? perUnit / Number(formula.estimated_units)
        : 0) +
      commercial.additional_total;
    return {
      cost,
      reason: "Aprox. por peso medio; confirmar con pesos reales",
      source,
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
  return { cost, reason: cost == null ? "Costo pendiente" : "", source };
}
