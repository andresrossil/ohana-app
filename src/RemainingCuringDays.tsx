export default function remainingCuringDaysCell(availableOn: string | null | undefined, date: string) {
  const days = availableOn
    ? Math.max(0, (Date.parse(availableOn) - Date.parse(date)) / 86_400_000)
    : NaN;
  const known = Number.isFinite(days);
  return (
    <td data-sort-value={known ? days : ""}>
      {known ? days === 0 ? "0 días · Listo" : days === 1 ? "1 día" : `${days} días` : "—"}
    </td>
  );
}
