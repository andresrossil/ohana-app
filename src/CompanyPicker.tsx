import { AppButton } from "./AppIcon";
import { useState } from "react";
import type { CatalogRow } from "./sheet-model";
import CompanyLogo from "./CompanyBrand";
export default function CompanyPicker({
  companies,
  corporations,
  onSelect,
  onManage,
  canCreate,
  initialCorporation = "",
}: {
  initialCorporation?: string;
  companies: CatalogRow[];
  corporations: CatalogRow[];
  onSelect: (company: string) => void;
  onManage: () => void;
  canCreate: boolean;
}) {
  const [corporation, setCorporation] = useState(
    initialCorporation || (corporations.length === 1 ? corporations[0].id : ""),
  );
  const list = companies.filter(
    (c) =>
      c.active !== false && (!corporation || c.corporation_id === corporation),
  );
  const pickCorp = (id: string) => {
    const matches = companies.filter(
      (c) => c.corporation_id === id && c.active !== false,
    );
    if (matches.length === 1) onSelect(matches[0].id);
    else setCorporation(id);
  };
  return (
    <section className="company-picker">
      <p className="eyebrow">TU ESPACIO DE TRABAJO</p>
      <h1>
        {!corporation && corporations.length > 1
          ? "Selecciona una corporación"
          : "Selecciona una empresa"}
      </h1>
      {!corporation && corporations.length > 1 ? (
        <div className="company-cards">
          {corporations.map((c) => (
            <AppButton
              className="company-card"
              key={c.id}
              onClick={() => pickCorp(c.id)}
            >
              <span className="company-initial">{c.name.slice(0, 1)}</span>
              <strong>{c.name}</strong>
            </AppButton>
          ))}
        </div>
      ) : (
        <>
          {corporations.length > 1 && (
            <AppButton className="secondary" onClick={() => setCorporation("")}>
              ← Cambiar corporación
            </AppButton>
          )}
          <div className="company-cards">
            {list.map((c) => (
              <AppButton
                className="company-card"
                key={c.id}
                onClick={() => onSelect(c.id)}
              >
                <CompanyLogo company={c} />
                <strong>{c.name}</strong>
                <small>{c.corporation_name}</small>
              </AppButton>
            ))}
          </div>
          {!list.length && (
            <p>No tienes empresas activas disponibles en esta corporación.</p>
          )}
        </>
      )}
      {(canCreate ||
        companies.some((c) => c.manage) ||
        corporations.some((c) => c.manage)) && (
        <AppButton onClick={onManage}>
          Administrar corporaciones y empresas
        </AppButton>
      )}
      {!companies.length && !canCreate && (
        <p>Una persona administradora debe asignarte acceso a una empresa.</p>
      )}
    </section>
  );
}
