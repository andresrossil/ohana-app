export type MarginRange = {
  label: string;
  min: number | null;
  max: number | null;
  color: string;
  icon: string;
};
export const marginIcons = [
  "status.success",
  "status.warning",
  "action.cancel",
  "status.error",
  "status.info",
  "status.active",
  "status.archived",
  "status.purchased",
  "status.manufactured",
];
export const defaultMargins: MarginRange[] = [
  {
    label: "Bajo",
    min: null,
    max: 40,
    color: "#B42318",
    icon: "action.cancel",
  },
  {
    label: "Atención",
    min: 40,
    max: 50,
    color: "#946200",
    icon: "status.warning",
  },
  {
    label: "Esperado",
    min: 50,
    max: null,
    color: "#18794E",
    icon: "status.success",
  },
];
export function marginRange(value: number | null, ranges: MarginRange[]) {
  return value == null || !Number.isFinite(value)
    ? undefined
    : ranges.find(
        (r) =>
          (r.min == null || value >= r.min) && (r.max == null || value < r.max),
      );
}
export function validateMargins(ranges: MarginRange[]) {
  if (!ranges.length || ranges.length > 20)
    return "Configura entre 1 y 20 rangos.";
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (
      !r.label.trim() ||
      r.label.trim().length > 80 ||
      !/^#[a-f0-9]{6}$/i.test(r.color) ||
      !marginIcons.includes(r.icon)
    )
      return "Cada rango necesita un nombre, un color y un icono válido.";
    if ([r.min, r.max].some((n) => n != null && !Number.isFinite(n)))
      return "Revisa los porcentajes.";
    if (
      (i === 0 && r.min != null) ||
      (i > 0 && (r.min == null || r.min !== ranges[i - 1].max)) ||
      (i === ranges.length - 1 && r.max != null) ||
      (i < ranges.length - 1 && r.max == null) ||
      (r.min != null && r.max != null && r.min >= r.max)
    )
      return "Los rangos deben ser consecutivos, sin huecos ni solapamientos. Deja vacío el mínimo del primero y el máximo del último.";
  }
  return "";
}
