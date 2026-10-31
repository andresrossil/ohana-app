// Sorting is a view concern: canonical row order retains calculation chronology.
export function sortSheetKeys<T extends { key: string }>(
  rows: T[],
  value: (row: T) => string | number | null,
  direction: "asc" | "desc",
) {
  const collator = new Intl.Collator("es", {
    numeric: true,
    sensitivity: "base",
  });
  return rows
    .map((row, index) => ({ row, index, value: value(row) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null)
        return a.value === b.value
          ? a.index - b.index
          : a.value === null
            ? 1
            : -1;
      const compared =
        typeof a.value === "number" && typeof b.value === "number"
          ? a.value - b.value
          : collator.compare(String(a.value), String(b.value));
      return (direction === "asc" ? compared : -compared) || a.index - b.index;
    })
    .map(({ row }) => row.key);
}

export function mergeSheetEdits<T extends { key: string }>(
  canonical: T[],
  edited: T[],
) {
  const byKey = new Map(edited.map((row) => [row.key, row]));
  const existing = new Set(canonical.map((row) => row.key));
  return [
    ...canonical.map((row) => byKey.get(row.key) ?? row),
    ...edited.filter((row) => !existing.has(row.key)),
  ];
}
