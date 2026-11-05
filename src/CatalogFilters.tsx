import { useMaterialTypes } from "./MaterialTypesContext";
import SearchSelect from "./SearchSelect";
import { AppIcon } from "./AppIcon";
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
  const types = useMaterialTypes();
  return (
    <div className="catalog-filters">
      {onClassification && (
        <label>
          <span className="field-caption">
            <AppIcon name="control.filter" /> Clasificación
          </span>
          <SearchSelect
            value={classification}
            onChange={(e) => onClassification(e.target.value)}
          >
            <option value="">Todas las clasificaciones</option>
            {types.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
            <option value="pending">Pendientes de clasificar</option>
          </SearchSelect>
        </label>
      )}
      <label>
        <span className="field-caption">
          <AppIcon name="control.filter" /> Origen
        </span>
        <SearchSelect value={origin} onChange={(e) => onOrigin(e.target.value)}>
          <option value="">Todos los orígenes</option>
          {origins.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.active ? "" : " (inactivo)"}
            </option>
          ))}
          <option value="pending">Pendiente de definir</option>
        </SearchSelect>
      </label>
    </div>
  );
}
