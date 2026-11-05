export function estimatedWeightCost(
  commonMaterials: number | null,
  finalGrams: unknown,
  minimum: unknown,
  maximum: unknown,
  packagingUnit: number | null = 0,
  suppliesUnit: number | null = 0,
) {
  const grams =
      finalGrams === "" || finalGrams == null ? null : Number(finalGrams),
    validYield = grams != null && Number.isFinite(grams) && grams > 0;
  const costPerGram =
    commonMaterials != null && Number.isFinite(commonMaterials) && validYield
      ? commonMaterials / grams
      : null;
  const low = minimum == null || minimum === "" ? null : Number(minimum),
    high = maximum == null || maximum === "" ? null : Number(maximum);
  const midpoint =
    low != null &&
    high != null &&
    Number.isFinite(low) &&
    Number.isFinite(high) &&
    low >= 0 &&
    high > low
      ? (low + high) / 2
      : null;
  const weightCost =
    costPerGram != null && midpoint != null ? costPerGram * midpoint : null;
  return {
    costPerGram,
    midpoint,
    weightCost,
    packagingUnit,
    suppliesUnit,
    manufacturingCost:
      weightCost != null && packagingUnit != null && suppliesUnit != null
        ? weightCost + packagingUnit + suppliesUnit
        : null,
    reason: !validYield
      ? "Pendiente de rendimiento final estimado"
      : commonMaterials == null
        ? "Costo de materiales pendiente"
        : packagingUnit == null || suppliesUnit == null
          ? "Unidades estimadas pendientes para empaque o insumos"
          : midpoint == null
            ? "Pendiente de rango de peso"
            : "",
  };
}
