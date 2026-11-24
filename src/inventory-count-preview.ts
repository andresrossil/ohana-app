export function inventoryCountPreview(theoretical: number | null, captured: unknown, action: string) {
  if (theoretical == null || !Number.isFinite(theoretical)) {
    return { theoretical: null, resulting: null, difference: null };
  }
  const text = String(captured ?? "").trim();
  const quantity = text ? Number(text) : NaN;
  if (!Number.isFinite(quantity) || quantity < 0 || (action !== "count" && quantity === 0)) {
    return { theoretical, resulting: null, difference: null };
  }
  if (action === "adjust_in") return { theoretical, resulting: theoretical + quantity, difference: quantity };
  if (action === "adjust_out") return { theoretical, resulting: theoretical - quantity, difference: -quantity };
  return { theoretical, resulting: quantity, difference: quantity - theoretical };
}
