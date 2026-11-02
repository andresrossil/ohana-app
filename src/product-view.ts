type Product = {
  id?: string;
  name?: string;
  sku?: string | null;
  active?: boolean;
  [key: string]: any;
};
export const productLabel = (p: Product) =>
  p.sku ? `${p.sku} · ${p.name || ""}` : p.name || "";
export function resolveProduct(products: Product[], text: string) {
  const key = text.trim().toLocaleLowerCase("es");
  if (!key) return null;
  const matches = products.filter(
    (p) =>
      p.active &&
      [p.name, p.sku, productLabel(p)].some(
        (v) => v?.trim().toLocaleLowerCase("es") === key,
      ),
  );
  return matches.length === 1 ? matches[0] : null;
}
export function orderedProducts<T extends Product>(
  rows: T[],
  column: string,
  direction: "asc" | "desc",
  origins: { id: string; name: string }[],
) {
  const collator = new Intl.Collator("es", {
    numeric: true,
    sensitivity: "base",
  });
  const value = (p: T): string | number | null =>
    column === "created_at"
      ? p.created_at && Number.isFinite(Date.parse(p.created_at))
        ? Date.parse(p.created_at)
        : null
      : column === "origin"
        ? origins.find((o) => o.id === p.origin_id)?.name || "Pendiente"
        : column === "active"
          ? p.active
            ? "Activo"
            : "Archivado"
          : p[column] || null;
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null)
        return a.v === b.v ? a.index - b.index : a.v === null ? 1 : -1;
      const n =
        typeof a.v === "number" && typeof b.v === "number"
          ? a.v - b.v
          : collator.compare(String(a.v), String(b.v));
      return (direction === "asc" ? n : -n) || a.index - b.index;
    })
    .map((x) => x.row);
}
