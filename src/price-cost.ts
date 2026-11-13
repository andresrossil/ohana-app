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
  visited = new Set<string>(),
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
  return formulaCost(formula, catalog, saleReference, variant, formulas, visited);
}

export function formulaCost(
  formula: Row,
  catalog: Row,
  saleReference?: Row,
  weightVariant?: Row,
  formulas: Row[] = [],
  visited = new Set<string>(),
): Row {
  if (visited.has(formula.id)) return { cost: null };
  const ancestors = new Set(visited).add(formula.id);
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
  if (!lines.some((l) => l.line_kind === "ingredient") && !formula.intermediates?.length)
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
  if (math.totalCost == null || math.errors.some((error) =>
    !formula.intermediates?.length || error !== "Añade al menos una materia prima."))
    return { cost: null, reason: "Costo de materiales incompleto", source };
  const intermediateCost = estimateIntermediateCost(formula.intermediates || [], catalog, 1, formulas, ancestors);
  if (intermediateCost == null)
    return { cost: null, reason: "Costo de fabricación de productos intermedios pendiente", source };

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
    const perUnit = (amount: number | null) =>
      amount == null
        ? null
        : amount === 0
          ? 0
          : validUnits
            ? amount / units
            : null;
    const commonMaterials = math.totalCost - packagingTotal - suppliesTotal + intermediateCost;
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
      productionCost: estimate.manufacturingCost != null && overheadUnit != null
        ? estimate.manufacturingCost + overheadUnit : null,
      commonMaterials,
      referenceMaterials: {
        intermediates: estimate.midpoint == null ? null : intermediateCost * estimate.midpoint / Number(formula.estimated_final_weight_g),
        ingredients:
          estimate.costPerGram != null &&
          estimate.midpoint != null &&
          math.ingredientCost != null
            ? (math.ingredientCost * estimate.midpoint) /
              Number(formula.estimated_final_weight_g)
            : null,
        packaging: estimate.packagingUnit,
        supplies:
          estimate.costPerGram != null &&
          estimate.midpoint != null &&
          estimate.suppliesUnit != null &&
          math.suppliesCost != null
            ? ((math.suppliesCost - suppliesTotal) * estimate.midpoint) /
                Number(formula.estimated_final_weight_g) +
              estimate.suppliesUnit
            : null,
      },
      unitQuote: {
        currency: catalog.currency,
        unit_basis_count: 1,
        sale_price: commercial.sale_price,
        cost_lines: [
          ...fixed.cost_lines.map((line) => ({
            ...line,
            total: perUnit(line.total),
          })),
          ...commercial.cost_lines,
        ],
        additional_total: expenses,
      },
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
  const cost =
    extra.additional_total == null
      ? null
      : estimatedUnitCost(
          math.totalCost + intermediateCost + extra.additional_total,
          formula.estimated_units,
        );
  return {
    cost,
    productionCost: extra.overhead_total == null ? null : estimatedUnitCost(
      math.totalCost + intermediateCost + extra.overhead_total, formula.estimated_units,
    ),
    referenceMaterials: {
      intermediates: estimatedUnitCost(intermediateCost, formula.estimated_units),
      ingredients: estimatedUnitCost(
        math.ingredientCost,
        formula.estimated_units,
      ),
      packaging: estimatedUnitCost(math.packagingCost, formula.estimated_units),
      supplies: estimatedUnitCost(math.suppliesCost, formula.estimated_units),
    },
    unitQuote: {
      ...extra,
      unit_basis_count: 1,
      cost_lines: extra.cost_lines.map((line) => ({
        ...line,
        total: estimatedUnitCost(line.total, formula.estimated_units),
      })),
      additional_total: extra.additional_unit,
    },
    manufacturingCost: estimatedUnitCost(
      math.totalCost + intermediateCost,
      formula.estimated_units,
    ),
    expenses: extra.additional_unit,
    reason: cost == null ? "Costo pendiente" : "",
    source,
  };
}

export function estimateIntermediateCost(lines: Row[], catalog: Row, scale = 1, formulas: Row[] = [], visited = new Set<string>()): number | null {
  let total = 0;
  for (const line of lines) {
    const option = catalog.intermediate_options?.find((item: Row) => item.id === line.variant_id);
    const unit = catalog.units.find((item: Row) => item.id === line.unit_id);
    const base = catalog.units.find((item: Row) => item.id === option?.unit_id);
    if (!option || !unit || !base || unit.dimension !== base.dimension) return null;
    let needed = Number(line.quantity) * scale * Number(unit.base_factor) / Number(base.base_factor);
    if (!Number.isFinite(needed) || needed <= 0) return null;
    const quantity = needed;
    let fifo = 0;
    for (const entry of (quantity <= Number(option.available) ? option.stock_entries || [] : [])) {
      if (entry.cost == null) break;
      const used = Math.min(needed, Number(entry.remaining));
      fifo += used * Number(entry.cost);
      needed -= used;
      if (needed < 1e-8) break;
    }
    if (needed < 1e-8) {
      total += fifo;
      continue;
    }
    const variant = (catalog.presentations || []).find((item: Row) => item.id === option.id)
      || option;
    const estimate = priceCost(variant, formulas, catalog, undefined, visited);
    if (estimate.productionCost == null) return null;
    total += quantity * estimate.productionCost;
  }
  return total;
}
