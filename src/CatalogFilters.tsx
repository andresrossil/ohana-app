import { classifications } from "./sheet-model";
import type { CatalogRow } from "./sheet-model";
export function classificationMatches(
  value: string | null | undefined,
  filter: string,
) {
  return !filter || (filter === "pending" ? !value : value === filter);
}
export function originMatches(
  value: string | null | undefined,
  filter: string,
) {
  return !filter || (filter === "pending" ? !value : value === filter);
}
export default function CatalogFilters({
  classification,
  onClassification,
  origin,
  onOrigin,
  origins,
}: {
  classification?: string;
  onClassification?: (value: string) => void;
  origin: string;
  onOrigin: (value: string) => void;
  origins: CatalogRow[];
}) {
  return (
    <div className="catalog-filters">
      {onClassification && (
        <label>
          Clasificación
          <select
            value={classification}
            onChange={(e) => onClassification(e.target.value)}
          >
            <option value="">Todas las clasificaciones</option>
            {classifications.map((c) => (
              <option key={c}>{c}</option>
            ))}
            <option value="pending">Pendientes de clasificar</option>
          </select>
        </label>
      )}
      <label>
        Origen
        <select value={origin} onChange={(e) => onOrigin(e.target.value)}>
          <option value="">Todos los orígenes</option>
          {origins.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.active ? "" : " (inactivo)"}
            </option>
          ))}
          <option value="pending">Pendiente de definir</option>
        </select>
      </label>
    </div>
  );
}
