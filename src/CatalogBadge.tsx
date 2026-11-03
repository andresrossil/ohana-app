import { AppIcon } from "./AppIcon";
export default function CatalogBadge({
  active,
  origin,
}: {
  active?: boolean;
  origin?: string;
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
      {origin || (active ? "Activo" : "Archivado")}
    </span>
  );
}
