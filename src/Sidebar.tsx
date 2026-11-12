import { onIdleRefresh } from "./idle-refresh";
import SearchSelect from "./SearchSelect";
import { AppIcon, AppButton } from "./AppIcon";
import NavIcon from "./NavIcon";
import { useEffect, useRef, useState } from "react";
import { supabase as db } from "./client";
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
  ["order-preparation", "Preparación de pedidos", ""],
  ["customers", "Clientes", "♧"],
  ["suppliers", "Proveedores", ""],
  ["couriers", "Mensajerías", ""],
  ["settlements", "Liquidaciones de mensajería", ""],
  ["prices", "Listas de precios", ""],
  ["expenses", "Gastos", ""],
  ["funds", "Fondos", ""],
  ["reports", "Reportes", "▥"],
  ["settings", "Configuración", "☷"],
] as const;
export type Section = (typeof sections)[number][0];
const categories: { id: string; label: string; icon: Section; items: Section[] }[] = [
  { id: "sales", label: "Ventas", icon: "sales", items: ["sales", "order-preparation", "settlements", "prices"] },
  { id: "inventory", label: "Inventario y producción", icon: "inventory", items: ["materials", "products", "formulas", "production", "inventory"] },
  { id: "purchases", label: "Compras y gastos", icon: "purchases", items: ["purchases", "expenses", "funds"] },
  { id: "partners", label: "Socios de negocio", icon: "customers", items: ["customers", "suppliers", "couriers"] },
];
const sectionLabels = new Map<Section, string>(sections.map(([key, label]) => [key, label]));

export default function Sidebar({
  section,
  onNavigate,
  company,
  companies,
  onCompany,
  email,
  userId,
  onLogout,
  corporations = [],
  onCorporation,
  allowedSections,
}: {
  section: Section;
  onNavigate: (s: Section, fromLogo?: boolean) => boolean;
  company: string;
  companies: CatalogRow[];
  onCompany: (value: string) => void;
  email?: string;
  userId?: string;
  onLogout: () => void;
  corporations?: CatalogRow[];
  onCorporation?: (id: string) => void;
  allowedSections?: string[];
}) {
  const [open, setOpen] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [profile, setProfile] = useState({ name: "", photo: "" });
  const activeCategory = categories.find(({ items }) => items.includes(section))?.id;
  const [expanded, setExpanded] = useState(() => new Set(activeCategory ? [activeCategory] : []));
  const drawer = useRef<HTMLElement>(null),
    toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [section, company]);
  useEffect(() => {
    if (activeCategory) setExpanded((previous) => previous.has(activeCategory)
      ? previous
      : new Set(previous).add(activeCategory));
  }, [section, activeCategory]);
  useEffect(() => {
    const shell = document.querySelector(".shell");
    shell?.classList.toggle("chrome-collapsed", collapsed);
    return () => shell?.classList.remove("chrome-collapsed");
  }, [collapsed]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      if (!userId) return;
      const { data } = await db
        .from("user_profiles")
        .select("display_name,avatar_path")
        .eq("user_id", userId)
        .maybeSingle();
      let photo = "";
      if (data?.avatar_path) {
        const signed = await db.storage
          .from("user-avatars")
          .createSignedUrl(data.avatar_path, 3600);
        photo = signed.data?.signedUrl || "";
      }
      if (live) setProfile({ name: data?.display_name || "Usuario", photo });
    };
    void load();
    window.addEventListener("ohana-user-profile-saved", load);
    const cancelIdle = onIdleRefresh(load);
    return () => {
      live = false;
      window.removeEventListener("ohana-user-profile-saved", load);
      cancelIdle();
    };
  }, [userId]);
  useEffect(() => {
    if (!open) return;
    drawer.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (e: Event) => {
      const target = e.target as HTMLElement;
      if (
        !drawer.current?.contains(target) &&
        !toggle.current?.contains(target)
      )
        setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const activeCompany = companies.find((c) => c.id === company);
  const canShow = (key: Section) => !allowedSections || allowedSections.includes(key);
  const navigationButton = (key: Section) => (
    <button
      key={key}
      type="button"
      className={section === key ? "selected" : ""}
      aria-current={section === key ? "page" : undefined}
      onClick={() => {
        if (onNavigate(key)) setOpen(false);
      }}
    >
      <span aria-hidden="true"><NavIcon name={key} /></span>
      {sectionLabels.get(key)}
    </button>
  );

  return (
    <>
      <header className={"app-topbar" + (collapsed ? " is-collapsed" : "")}>
        <div className="chrome-left">
          <button
            ref={toggle}
            className="secondary chrome-menu-toggle"
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={open}
            aria-controls="ohana-drawer"
            onClick={() => setOpen(!open)}
          >
            <AppIcon name={open ? "navigation.close" : "navigation.menu"} />
          </button>
          <button
            className="chrome-brand"
            aria-label="Ir al Dashboard de la empresa actual"
            onClick={() => {
              onNavigate("dashboard", true);
              setOpen(false);
            }}
          >
            {activeCompany ? (
              <CompanyLogo company={activeCompany} />
            ) : (
              <img
                src={import.meta.env.BASE_URL + "brand/ohana-logo.png"}
                alt="OHANA"
              />
            )}
          </button>
        </div>
        <button
          className={
            "secondary chrome-collapse" + (collapsed ? " is-collapsed" : "")
          }
          aria-label={
            collapsed ? "Mostrar cinta superior" : "Ocultar cinta superior"
          }
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <AppIcon name="action.collapse" />
        </button>
        <div className="chrome-user">
          <span title={email}>{profile.name || "Usuario"}</span>
          {profile.photo ? (
            <img
              className="chrome-avatar"
              src={profile.photo}
              alt={profile.name}
              onError={() => setProfile((p) => ({ ...p, photo: "" }))}
            />
          ) : (
            <span
              className="chrome-avatar chrome-avatar-empty"
              aria-hidden="true"
            >
              {(profile.name || "U").slice(0, 1)}
            </span>
          )}
          <AppButton
            className="secondary"
            iconKey="action.back"
            onClick={onLogout}
          >
            Cerrar sesión
          </AppButton>
        </div>
      </header>
      {open && (
        <button
          className="drawer-backdrop"
          aria-label="Cerrar menú"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        ref={drawer}
        id="ohana-drawer"
        className={`app-sidebar ${open ? "menu-open" : ""}`}
        inert={!open}
        aria-hidden={!open}
      >
        <div className="sidebar-top">
          <button
            className="brand-home"
            type="button"
            aria-label={
              "Ir al Dashboard de " +
              (companies.find((c) => c.id === company)?.name ||
                "la empresa actual")
            }
            title="Volver al Dashboard"
            onClick={() => {
              onNavigate("dashboard", true);
              setOpen(false);
            }}
          >
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
          </button>
          <button
            className="drawer-close secondary"
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={open}
            aria-controls="ohana-navigation"
            onClick={() => setOpen(!open)}
          >
            <AppIcon name={open ? "navigation.close" : "navigation.menu"} />
          </button>
        </div>
        <div id="ohana-navigation" className="sidebar-content">
          <div className="workspace">
            <span>ESPACIO DE TRABAJO</span>
            <SearchSelect
              aria-label="Empresa"
              value={company}
              onChange={(e) => onCompany(e.target.value)}
            >
              {[...new Set(companies.map((c) => c.corporation_id || ""))].map(
                (id) => (
                  <optgroup
                    key={id}
                    label={
                      corporations.find((c) => c.id === id)?.name ||
                      companies.find((c) => c.corporation_id === id)
                        ?.corporation_name ||
                      "Empresas"
                    }
                  >
                    {companies
                      .filter((c) => (c.corporation_id || "") === id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </optgroup>
                ),
              )}
            </SearchSelect>
          </div>
          <nav className="sidebar-navigation" aria-label="Navegación principal">
            {canShow("dashboard") && navigationButton("dashboard")}
            {categories.map(({ id, label, icon, items }) => {
              const visible = items.filter(canShow);
              if (!visible.length) return null;
              const isExpanded = expanded.has(id);
              const contentId = `ohana-nav-${id}`;
              return <div className="sidebar-category" key={id}>
                <button
                  type="button"
                  className={activeCategory === id && !isExpanded ? "sidebar-category-toggle selected" : "sidebar-category-toggle"}
                  aria-expanded={isExpanded}
                  aria-controls={contentId}
                  onClick={() => setExpanded((previous) => {
                    const next = new Set(previous);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })}
                >
                  <span aria-hidden="true"><NavIcon name={icon} /></span>
                  {label}
                  <span className="sidebar-category-arrow" aria-hidden="true">
                    <AppIcon name={isExpanded ? "action.collapse" : "action.expand"} />
                  </span>
                </button>
                <div className="sidebar-category-items" id={contentId} hidden={!isExpanded}>
                  {visible.map(navigationButton)}
                </div>
              </div>;
            })}
            {canShow("reports") && navigationButton("reports")}
            {canShow("settings") && navigationButton("settings")}
          </nav>
          <div className="aside-bottom">
            <p>
              Pequeños detalles,
              <br />
              grandes creaciones.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
