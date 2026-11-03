import { AppIcon } from "./AppIcon";
export default function CatalogBadge({
  active,
  origin,
  label,
}: {
  active?: boolean;
  origin?: string;
  label?: string;
}) {
  const state = origin
    ? origin.toLowerCase() === "comprado"
      ? "purchased"
      : origin.toLowerCase() === "fabricado"
        ? "manufactured"
        : "pending"
    : active
      ? "active"
      : "archived";
  return (
    <span className={"catalog-badge badge-" + state}>
      <AppIcon name={"status." + state} />
      {label || origin || (active ? "Activo" : "Archivado")}
    </span>
  );
}
