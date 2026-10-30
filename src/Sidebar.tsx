import NavIcon from "./NavIcon";
import { useState } from "react";
import type { CatalogRow } from "./sheet-model";
import CompanyLogo from "./CompanyBrand";
export const sections = [
  ["dashboard", "Inicio", "⌂"],
  ["materials", "Materiales", "◈"],
  ["products", "Productos", "▣"],
  ["purchases", "Compras", "↙"],
  ["formulas", "Fórmulas", "⚗"],
  ["production", "Producción", "⚙"],
  ["inventory", "Inventario", "▤"],
  ["sales", "Ventas", "↗"],
  ["customers", "Clientes", "♧"],
  ["reports", "Reportes", "▥"],
  ["settings", "Configuración", "☷"],
] as const;
export type Section = (typeof sections)[number][0];
export default function Sidebar({
  section,
  onNavigate,
  company,
  companies,
  onCompany,
  email,
  onLogout,
  corporations = [],
  onCorporation,
  allowedSections,
}: {
  section: Section;
  onNavigate: (s: Section) => boolean;
  company: string;
  companies: CatalogRow[];
  onCompany: (value: string) => void;
  email?: string;
  onLogout: () => void;
  corporations?: CatalogRow[];
  onCorporation?: (id: string) => void;
  allowedSections?: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <aside className={`app-sidebar ${open ? "menu-open" : ""}`}>
      <div className="sidebar-top">
        {companies.find((c) => c.id === company) ? (
          <CompanyLogo company={companies.find((c) => c.id === company)!} />
        ) : (
          <div className="brand brand-sidebar">
            <img
              src={`${import.meta.env.BASE_URL}brand/ohana-logo.png`}
              alt="OHANA"
            />
          </div>
        )}
        <button
          className="menu-toggle secondary"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={open}
          aria-controls="ohana-navigation"
          onClick={() => setOpen(!open)}
        >
          {open ? "×" : "☰"}
        </button>
      </div>
      <div id="ohana-navigation" className="sidebar-content">
        <div className="workspace">
          <span>ESPACIO DE TRABAJO</span>
          {corporations.length > 1 && onCorporation && (
            <select
              aria-label="Corporación"
              value={
                companies.find((c) => c.id === company)?.corporation_id || ""
              }
              onChange={(e) => onCorporation(e.target.value)}
            >
              <option value="">Seleccionar corporación</option>
              {corporations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Empresa"
            value={company}
            onChange={(e) => onCompany(e.target.value)}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <nav aria-label="Navegación principal">
          {sections
            .filter(
              ([key]) => !allowedSections || allowedSections.includes(key),
            )
            .map(([key, label, icon]) => (
              <button
                key={key}
                className={section === key ? "selected" : ""}
                aria-current={section === key ? "page" : undefined}
                onClick={() => {
                  if (onNavigate(key)) setOpen(false);
                }}
              >
                <span aria-hidden="true">
                  <NavIcon name={key} />
                </span>
                {label}
              </button>
            ))}
        </nav>
        <div className="aside-bottom">
          <p>
            Pequeños detalles,
            <br />
            grandes creaciones.
          </p>
          <small>{email}</small>
          <button onClick={onLogout}>Cerrar sesión</button>
        </div>
      </div>
    </aside>
  );
}
