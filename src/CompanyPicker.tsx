import { AppButton } from "./AppIcon";
import type { CatalogRow } from "./sheet-model";
import CompanyLogo from "./CompanyBrand";
export default function CompanyPicker({
  companies,
  corporations,
  onSelect,
  onManage,
  canCreate,
}: {
  initialCorporation?: string;
  companies: CatalogRow[];
  corporations: CatalogRow[];
  onSelect: (company: string) => void;
  onManage: () => void;
  canCreate: boolean;
}) {
  const active = companies.filter((c) => c.active !== false);
  const groupIds = [
    ...new Set([
      ...corporations.filter((c) => c.active !== false).map((c) => c.id),
      ...active.map((c) => c.corporation_id || ""),
    ]),
  ];
  return (
    <section className="company-picker">
      <p className="eyebrow">TU ESPACIO DE TRABAJO</p>
      <h1>Selecciona una empresa</h1>
      {groupIds.map((id) => {
        const corporation = corporations.find((c) => c.id === id),
          list = active.filter((c) => (c.corporation_id || "") === id);
        const name =
          corporation?.name || list[0]?.corporation_name || "Empresas";
        return (
          <section
            className="company-corporation-group"
            key={id}
            aria-label={name}
          >
            <h2>{name}</h2>
            <div className="company-cards">
              {list.map((c) => (
                <button
                  type="button"
                  className="company-card"
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                >
                  <CompanyLogo company={c} />
                  <strong>{c.name}</strong>
                </button>
              ))}
            </div>
            {!list.length && (
              <p className="muted">
                No hay empresas activas disponibles en esta corporación.
              </p>
            )}
          </section>
        );
      })}
      {(canCreate ||
        companies.some((c) => c.manage) ||
        corporations.some((c) => c.manage)) && (
        <AppButton onClick={onManage}>
          Administrar corporaciones y empresas
        </AppButton>
      )}
      {!active.length && !canCreate && (
        <p>Una persona administradora debe asignarte acceso a una empresa.</p>
      )}
    </section>
  );
}
