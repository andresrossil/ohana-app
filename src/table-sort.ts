const collator = new Intl.Collator("es", {
  numeric: true,
  sensitivity: "base",
});
export function sortValue(value: unknown): number | string | null {
  const text = String(value ?? "")
    .replace(/\u00a0/g, " ")
    .trim();
  if (
    !text ||
    /^[—–-]$/.test(text) ||
    /^(pendiente\b|según\b|no registrado\b|no disponible\b|sin (precio|costo|fórmula|presentación|datos|registros|acceso|definir)\b)/i.test(
      text,
    )
  )
    return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text);
  if (iso) return Date.parse(text.length === 10 ? text + "T00:00:00Z" : text);
  const date =
    /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?)?$/i.exec(
      text,
    );
  if (date) {
    let hour = Number(date[4] || 0);
    if (date[7]) hour = (hour % 12) + (/^p/i.test(date[7]) ? 12 : 0);
    return Date.UTC(
      Number(date[3]),
      Number(date[2]) - 1,
      Number(date[1]),
      hour,
      Number(date[5] || 0),
      Number(date[6] || 0),
    );
  }
  let amount = text
    .replace(/^(?:GTQ|USD|MXN|EUR|Q|\$|€)\s*/i, "")
    .replace(/\s*%$/, "")
    .replace(/\s/g, "")
    .replace(/−/g, "-");
  if (/^[+-]?\d+(?:[.,]\d+)*$/.test(amount)) {
    const comma = amount.lastIndexOf(","),
      dot = amount.lastIndexOf(".");
    if (comma >= 0 && dot >= 0)
      amount =
        comma > dot
          ? amount.replace(/\./g, "").replace(",", ".")
          : amount.replace(/,/g, "");
    else if (comma >= 0)
      amount = /^[-+]?\d{1,3}(,\d{3})+$/.test(amount)
        ? amount.replace(/,/g, "")
        : amount.replace(",", ".");
    const n = Number(amount);
    if (Number.isFinite(n)) return n;
  }
  return text;
}
export function compareCells(
  a: unknown,
  b: unknown,
  direction: "asc" | "desc",
) {
  const left = sortValue(a),
    right = sortValue(b);
  if (left == null || right == null)
    return left == null ? (right == null ? 0 : 1) : -1;
  const result =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : collator.compare(String(left), String(right));
  if (result === 0) return 0;
  return direction === "asc" ? result : -result;
}
export function cellSortText(cell: HTMLTableCellElement): string {
  if (cell.hasAttribute("data-sort-value")) return cell.dataset.sortValue || "";
  const control = cell.querySelector<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >("input:not([type=hidden]),select,textarea");
  if (control instanceof HTMLSelectElement)
    return control.selectedOptions[0]?.textContent?.trim() || control.value;
  if (control instanceof HTMLInputElement && control.type === "checkbox")
    return control.checked ? "Sí" : "No";
  if (control) return control.dataset.precisionValue ?? control.value;
  const copy = cell.cloneNode(true) as HTMLElement;
  copy
    .querySelectorAll(
      '.mobile-cell-label,.mobile-row-toggle,[aria-hidden="true"],svg',
    )
    .forEach((node) => node.remove());
  const fallback = copy.textContent?.trim() || "";
  copy.querySelectorAll("small").forEach((node) => node.remove());
  const primary = copy.textContent?.trim();
  if (!primary) return fallback;
  return typeof sortValue(primary) === "number" || sortValue(primary) == null
    ? primary
    : fallback;
}
