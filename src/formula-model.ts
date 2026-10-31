export type RecipeUnit = {
  id: string;
  symbol: string;
  dimension: string;
  base_factor: number | string;
  active?: boolean;
};
export type RecipeMaterial = {
  id: string;
  name: string;
  unit_id: string;
  unit_cost?: number | string | null;
  active?: boolean;
  classification?: string;
  sku?: string;
};
export type RecipeLine = {
  key: string;
  material: string;
  unit: string;
  quantity: number | string;
  percentage: number | string;
  line_kind: "ingredient" | "packaging";
  search?: string;
};
export const recipeNumber = (value: unknown): number | null => {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
export const roundQuantity = (n: number) =>
  Math.round((n + Number.EPSILON) * 1e8) / 1e8;
export function recipeMath(
  lines: RecipeLine[],
  units: RecipeUnit[],
  materials: RecipeMaterial[],
  mode: "quantity" | "percentage",
  total: number | string,
  totalUnit: string,
  scale = 1,
  lossEnabled = false,
  lossPercent = 5,
) {
  const errors: string[] = [];
  const unitMap = new Map(units.map((u) => [u.id, u])),
    materialMap = new Map(materials.map((m) => [m.id, m]));
  const target = unitMap.get(totalUnit),
    targetQty = recipeNumber(total);
  const seen = new Set<string>();
  const rows = lines.map((line) => {
    const material = materialMap.get(line.material),
      unit = unitMap.get(line.unit),
      base = material && unitMap.get(material.unit_id);
    const compatible = !!unit && !!base && unit.dimension === base.dimension;
    if (!material) errors.push("Selecciona cada materia prima desde la lista.");
    if (!compatible)
      errors.push(
        "Revisa las unidades: cada material necesita una unidad de su dimensión.",
      );
    if (seen.has(line.material) && line.material)
      errors.push("Una materia prima solo puede aparecer una vez.");
    seen.add(line.material);
    let quantity = recipeNumber(line.quantity),
      percentage = recipeNumber(line.percentage);
    if (mode === "percentage" && line.line_kind === "ingredient") {
      if (
        !target ||
        !targetQty ||
        targetQty <= 0 ||
        !unit ||
        target.dimension !== unit.dimension
      ) {
        quantity = null;
        errors.push(
          "El total y los ingredientes deben usar unidades compatibles; no se mezclan gramos y mililitros.",
        );
      } else if (percentage == null || percentage <= 0 || percentage > 100) {
        quantity = null;
        errors.push(
          "Cada porcentaje debe ser mayor que cero y como máximo 100 %.",
        );
      } else
        quantity = roundQuantity(
          (targetQty * Number(target.base_factor) * percentage) /
            100 /
            Number(unit.base_factor),
        );
    }
    if (quantity === null || quantity <= 0 || quantity >= 1e12)
      errors.push(
        "Cada cantidad debe ser mayor que cero y menor que un billón.",
      );
    const physical =
      compatible && quantity !== null
        ? quantity * Number(unit!.base_factor)
        : null;
    const unitCost = recipeNumber(material?.unit_cost);
    const cost =
      compatible && quantity !== null && unitCost !== null
        ? ((quantity * Number(unit!.base_factor)) / Number(base!.base_factor)) *
          unitCost *
          scale
        : null;
    return { ...line, quantity, percentage, material, unit, physical, cost };
  });
  const ingredients = rows.filter((r) => r.line_kind === "ingredient"),
    packaging = rows.filter((r) => r.line_kind === "packaging");
  const dimensions = new Set(
    ingredients.map((r) => r.unit?.dimension).filter(Boolean),
  );
  const compatible =
    dimensions.size === 1 && ingredients.every((r) => r.physical !== null);
  const physicalTotal = compatible
    ? ingredients.reduce((sum, r) => sum + (r.physical || 0), 0)
    : null;
  if (mode === "quantity")
    rows.forEach((r) => {
      r.percentage =
        r.line_kind === "ingredient" && physicalTotal && r.physical !== null
          ? (r.physical / physicalTotal) * 100
          : null;
    });
  const percentageTotal = ingredients.reduce(
    (sum, r) => sum + (r.percentage || 0),
    0,
  );
  if (mode === "percentage" && Math.abs(percentageTotal - 100) > 0.000001)
    errors.push("Los porcentajes deben sumar 100 %.");
  if (!ingredients.length) errors.push("Añade al menos una materia prima.");
  if (!Number.isFinite(scale) || scale <= 0)
    errors.push("El factor de escala debe ser mayor que cero.");
  if (
    lossEnabled &&
    (!Number.isFinite(lossPercent) || lossPercent < 0 || lossPercent > 100)
  )
    errors.push("La merma debe estar entre 0 y 100 %.");
  const subtotal = (items: typeof rows) =>
    items.some((r) => r.cost === null)
      ? null
      : items.reduce((sum, r) => sum + r.cost!, 0);
  const ingredientCost = subtotal(ingredients),
    packagingCost = subtotal(packaging);
  const totalCost =
    ingredientCost !== null && packagingCost !== null
      ? ingredientCost + packagingCost
      : null;
  const lossGroups: { dimension: string; quantity: number; unit: string }[] =
    [];
  if (lossEnabled)
    for (const dimension of dimensions) {
      const unit =
        units.find(
          (u) => u.dimension === dimension && Number(u.base_factor) === 1,
        ) || ingredients.find((r) => r.unit?.dimension === dimension)!.unit!;
      lossGroups.push({
        dimension: dimension!,
        quantity:
          (ingredients
            .filter((r) => r.unit?.dimension === dimension)
            .reduce((sum, r) => sum + (r.physical || 0), 0) *
            scale *
            lossPercent) /
          100 /
          Number(unit.base_factor),
        unit: unit.symbol,
      });
    }
  return {
    rows,
    compatible,
    physicalTotal,
    percentageTotal,
    ingredientCost,
    packagingCost,
    totalCost,
    knownCost: rows.reduce((sum, r) => sum + (r.cost || 0), 0),
    missingCosts: rows.filter((r) => r.cost === null).length,
    lossCost:
      lossEnabled && ingredientCost !== null
        ? (ingredientCost * lossPercent) / 100
        : null,
    lossGroups,
    errors: [...new Set(errors)],
  };
}
