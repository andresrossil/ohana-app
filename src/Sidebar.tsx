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
  ["customers", "Socios de negocio", "♧"],
  ["prices", "Listas de precios", ""],
  ["expenses", "Gastos", ""],
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
  const drawer = useRef<HTMLElement>(null),
    toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [section, company]);
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
    window.addEventListener("focus", load);
    return () => {
      live = false;
      window.removeEventListener("ohana-user-profile-saved", load);
      window.removeEventListener("focus", load);
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
          </div>
        </div>
      </aside>
    </>
  );
}
