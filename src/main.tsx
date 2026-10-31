import { AppButton, AppIcon } from "./AppIcon";
import { IconProvider } from "./AppIcon";
import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { supabase as db, confirmationRedirect } from "./client";
import "./style.css";
import MaterialSheet from "./MaterialSheet";
import ImportMaterials from "./ImportMaterials";
import Sidebar, { sections } from "./Sidebar";
import type { Section } from "./Sidebar";
import ProductsCatalog from "./ProductsCatalog";
import OriginsSettings from "./OriginsSettings";

import CatalogFields from "./CatalogFields";
import CatalogFilters, {
  classificationMatches,
  originMatches,
} from "./CatalogFilters";
const BarcodeDialog = lazy(() => import("./BarcodeDialog"));
import { identityPayload, matchesCatalog } from "./catalog-model";
import CompanySettings from "./CompanySettings";
import OrganizationAdmin from "./OrganizationAdmin";
import CompanyPicker from "./CompanyPicker";
import { useCompanyTheme } from "./CompanyBrand";
type Row = { id: string; [key: string]: any };
const Reports = lazy(() => import("./Reports"));
const Inventory = lazy(() => import("./Inventory"));
const Production = lazy(() => import("./Production"));
const Sales = lazy(() => import("./Sales"));
const PublicStore = lazy(() => import("./PublicStore"));
const StoreSettings = lazy(() => import("./StoreSettings"));
type Tab = "raw_materials" | "suppliers" | "presentations" | "units";
type Catalog = Record<Tab, Row[]> & { products: Row[]; catalog_origins: Row[] };
const emptyCatalog: Catalog = {
  raw_materials: [],
  suppliers: [],
  presentations: [],
  units: [],
  products: [],
  catalog_origins: [],
};
const labels: Record<Tab, string> = {
  raw_materials: "Materiales",
  suppliers: "Proveedores",
  presentations: "Presentaciones",
  units: "Unidades",
};
const money = (n: number, c = "GTQ") =>
  new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency: c,
    maximumFractionDigits: 4,
  }).format(n);
function App() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [companies, setCompanies] = useState<Row[]>([]),
    [company, setCompany] = useState(""),
    [role, setRole] = useState("viewer");
  const [tab, setTab] = useState<Tab>("raw_materials"),
    [data, setData] = useState<Catalog>(emptyCatalog),
    [prices, setPrices] = useState<Row[]>([]),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [edit, setEdit] = useState<Row | null | undefined>(undefined),
    [history, setHistory] = useState<Row | null>(null),
    [entries, setEntries] = useState<Row[]>([]);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login"),
    [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<
    "checking" | "verified" | "error" | null
  >(() =>
    new URLSearchParams(location.search).get("auth") === "confirm"
      ? "checking"
      : null,
  );
  const [sheetView, setSheetView] = useState(false),
    [sheetDirty, setSheetDirty] = useState(false);
  const [importOpen, setImportOpen] = useState(false),
    [importNotice, setImportNotice] = useState("");
  const [section, setSection] = useState<Section>("dashboard"),
    [configView, setConfigView] = useState("profile"),
    [classification, setClassification] = useState(""),
    [origin, setOrigin] = useState(""),
    [barcode, setBarcode] = useState<Row | null>(null);
  const [corporations, setCorporations] = useState<Row[]>([]),
    [canCreate, setCanCreate] = useState(false),
    [pickerCorp, setPickerCorp] = useState(""),
    [settingsDirty, setSettingsDirty] = useState(false);
  const authIdentity = useRef<string | null>(null);
  const contextVersion = useRef(0);
  const activeCompany = companies.find((c) => c.id === company);
  useCompanyTheme(company);
  const loadVersion = useRef(0);
  const legacyVisible =
    section === "materials" ||
    (section === "settings" &&
      !["origins", "profile", "appearance", "structure", "store"].includes(
        configView,
      ));
  const filtered = data[tab].filter(
    (r) =>
      matchesCatalog(r, query) &&
      (tab !== "raw_materials" ||
        (classificationMatches(r.classification, classification) &&
          originMatches(r.origin_id, origin))),
  );
  const sectionTitle = sections.find((s) => s[0] === section)?.[1] || "";
  const leaveSheet = () =>
    !(sheetDirty || settingsDirty) ||
    window.confirm("Hay cambios sin guardar. ¿Quieres descartarlos?");
  const canWrite = role !== "viewer" && !!activeCompany?.write;
  const currentCompany = useRef(company);
  currentCompany.current = company;
  function chooseCompany(id: string) {
    currentCompany.current = id;
    loadVersion.current++;
    setData(emptyCatalog);
    setPrices([]);
    setRole("viewer");
    setEdit(undefined);
    setHistory(null);
    setBarcode(null);
    setQuery("");
    setClassification("");
    setOrigin("");
    setImportOpen(false);
    setImportNotice("");
    setSheetDirty(false);
    setSettingsDirty(false);
    setSheetView(false);
    setCompany(id);
    setSection("dashboard");
  }
  function acceptSession(next: Session | null) {
    if (authIdentity.current !== (next?.user.id || null)) {
      contextVersion.current++;
      loadVersion.current++;
      setCompanies([]);
      setCorporations([]);
      setCanCreate(false);
      setCompany("");
      setData(emptyCatalog);
      setPrices([]);
      setRole("viewer");
      setSection("dashboard");
      setConfigView("profile");
      setPickerCorp("");
      setEdit(undefined);
      setHistory(null);
    }
    authIdentity.current = next?.user.id || null;
    setSession(next);
  }
  useEffect(() => {
    db.auth.getSession().then(({ data, error }) => {
      if (error) setError(error.message);
      acceptSession(data.session);
      setReady(true);
      if (new URLSearchParams(location.search).get("auth") === "confirm") {
        setConfirmation(
          !error && data.session?.user.email_confirmed_at
            ? "verified"
            : "error",
        );
        window.history.replaceState(null, "", import.meta.env.BASE_URL);
      }
    });
    const { data } = db.auth.onAuthStateChange((_e, s) => {
      acceptSession(s);
      setReady(true);
      if (!s) {
        setCompanies([]);
        setCompany("");
        setEdit(undefined);
        setHistory(null);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  async function refreshContext() {
    const version = ++contextVersion.current;
    const { data, error } = await db.rpc("company_context");
    if (version !== contextVersion.current) return;
    if (error) {
      setError(error.message);
      return;
    }
    setCompanies(data.companies);
    setCorporations(data.corporations);
    setCanCreate(data.can_create);
    setCompany((old) =>
      data.companies.some((c: Row) => c.id === old && c.active !== false)
        ? old
        : data.companies.filter((c: Row) => c.active !== false).length === 1
          ? data.companies.find((c: Row) => c.active !== false).id
          : "",
    );
  }
  useEffect(() => {
    if (!session) return;
    void refreshContext();
    const timer = setInterval(() => void refreshContext(), 60000);
    return () => {
      contextVersion.current++;
      clearInterval(timer);
    };
  }, [session?.user.id]);
  async function load() {
    if (currentCompany.current !== company) return;
    const version = ++loadVersion.current;
    if (!company) return;
    setLoading(true);
    setError("");
    try {
      async function all(table: string, sort = "name") {
        const collected: Row[] = [];
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await db
            .from(table)
            .select("*")
            .eq("company_id", company)
            .order(sort)
            .order("id")
            .range(offset, offset + 999);
          if (error) throw error;
          collected.push(...(data || []));
          if (!data || data.length < 1000) break;
        }
        return collected;
      }
      const tables = [...Object.keys(labels), "products", "catalog_origins"];
      const [results, p, r] = await Promise.all([
        Promise.all(tables.map(async (t) => [t, await all(t)] as const)),
        all("current_prices"),
        db.rpc("company_permission", { p_company: company, p_action: "write" }),
      ]);
      if (r.error) throw r.error;
      if (version !== loadVersion.current || currentCompany.current !== company)
        return;
      setData(Object.fromEntries(results) as Catalog);
      setPrices(p);
      setRole(r.data ? "editor" : "viewer");
    } catch (e: any) {
      if (version === loadVersion.current) setError(e.message);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }
  useEffect(() => {
    setImportOpen(false);
    setImportNotice("");
    setEdit(undefined);
    setHistory(null);
    setData(emptyCatalog);
    setBarcode(null);
    setClassification("");
    setOrigin("");
    setQuery("");
    setSheetView(false);
    setPrices([]);
    setRole("viewer");
    void load();
  }, [company, activeCompany?.catalog_read, activeCompany?.write]);
  async function auth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    setNotice("");
    const credentials = {
      email: String(f.get("email")),
      password: String(f.get("password")),
    };
    const { error } =
      authMode === "signup"
        ? await db.auth.signUp({
            ...credentials,
            options: { emailRedirectTo: confirmationRedirect },
          })
        : await db.auth.signInWithPassword(credentials);
    if (error)
      setError(
        authMode === "signup"
          ? error.message
          : "No se pudo iniciar sesión. Revisa el correo y la contraseña.",
      );
    else if (authMode === "signup")
      setNotice(
        "Revisa tu correo y confirma tu cuenta. Después vuelve a esta página e inicia sesión.",
      );
    setBusy(false);
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canWrite) return;
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = { company_id: company };
    for (const [k, v] of f.entries())
      payload[k] =
        v === "" && (k === "website_url" || k === "product_url") ? null : v;
    if (tab === "raw_materials") Object.assign(payload, identityPayload(f));
    if (tab === "units") payload.base_factor = Number(payload.base_factor);
    if (tab === "presentations") {
      payload.quantity = Number(payload.quantity);
      payload.sku = f.get("sku") || null;
      payload.barcode = f.get("barcode") || null;
      payload.barcode_custom = f.has("barcode_custom");
      if (!payload.supplier_id) payload.supplier_id = null;
    }
    if (edit?.id) payload.active = f.get("active") === "true";
    const result = edit?.id
      ? await db
          .from(tab)
          .update(payload)
          .eq("company_id", company)
          .eq("id", edit.id)
      : await db.from(tab).insert(payload);
    if (result.error) setError(result.error.message);
    else {
      setEdit(undefined);
      await load();
    }
    setBusy(false);
  }
  async function showHistory(row: Row) {
    if (currentCompany.current !== company) return;
    setError("");
    setEntries([]);
    const { data, error } = await db
      .from("price_history")
      .select("*")
      .eq("company_id", company)
      .eq("presentation_id", row.id)
      .order("effective_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (currentCompany.current !== company) return;
    if (error) setError(error.message);
    else {
      setEntries(data || []);
      setHistory(row);
    }
  }
  async function addPrice(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const { error } = await db.from("price_history").insert({
      company_id: company,
      presentation_id: history!.id,
      amount: Number(f.get("amount")),
      currency: String(f.get("currency")),
      effective_on: f.get("effective_on"),
      notes: f.get("notes") || "",
    });
    if (error) setError(error.message);
    else {
      await showHistory(history!);
      await load();
    }
    setBusy(false);
  }
  const name = (t: Tab, id: string) =>
    data[t].find((r) => r.id === id)?.name || "—";
  const select = (
    key: string,
    title: string,
    rows: Row[],
    disabled = false,
    required = true,
  ) => (
    <label>
      {title}
      <select
        name={key}
        required={required}
        defaultValue={edit?.[key] || ""}
        disabled={disabled}
      >
        <option value="" disabled>
          Seleccionar
        </option>
        {rows
          .filter((r) => r.active || r.id === edit?.[key])
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.symbol ? ` (${r.symbol})` : ""}
            </option>
          ))}
      </select>
      {disabled && <input type="hidden" name={key} value={edit?.[key]} />}
    </label>
  );
  const input = (
    key: string,
    title: string,
    type = "text",
    required = false,
    locked = false,
  ) => (
    <label>
      {title}
      <input
        name={key}
        type={type}
        required={required}
        defaultValue={edit?.[key] ?? ""}
        readOnly={locked}
        min={type === "number" ? "0.00000001" : undefined}
        step={type === "number" ? "any" : undefined}
        maxLength={type === "text" ? 160 : undefined}
      />
    </label>
  );
  if (confirmation)
    return (
      <main className="login">
        <div className="brand brand-login">
          <img
            src={`${import.meta.env.BASE_URL}brand/ohana-logo.png`}
            alt="OHANA"
          />
        </div>
        <section className="confirmation" aria-live="polite">
          <p className="eyebrow">TU CUENTA OHANA</p>
          <h1>
            {confirmation === "checking"
              ? "Verificando tu cuenta…"
              : confirmation === "verified"
                ? "Cuenta verificada"
                : "No pudimos confirmar el enlace"}
          </h1>
          <p>
            {confirmation === "checking"
              ? "Un momento, estamos comprobando tu sesión."
              : confirmation === "verified"
                ? "Tu correo fue verificado correctamente. Ya puedes entrar a Ohana."
                : "El enlace puede haber vencido o ya fue utilizado. Si ya confirmaste tu correo, inicia sesión con tu cuenta."}
          </p>
          {confirmation !== "checking" && (
            <AppButton onClick={() => setConfirmation(null)}>
              {confirmation === "verified"
                ? "Entrar a Ohana →"
                : "Volver al acceso"}
            </AppButton>
          )}
        </section>
      </main>
    );
  if (!ready) return <main className="login">Cargando Ohana…</main>;
  if (!session)
    return (
      <main className="login">
        <div className="brand brand-login">
          <img
            src={`${import.meta.env.BASE_URL}brand/ohana-logo.png`}
            alt="OHANA"
          />
        </div>
        <form onSubmit={auth}>
          <p className="eyebrow">TU NEGOCIO, EN ARMONÍA</p>
          <h1>Bienvenido a Ohana</h1>
          <p>Un espacio para tus materiales, productos y costos.</p>
          <label>
            Correo electrónico
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Contraseña
            <input
              name="password"
              type="password"
              autoComplete={
                authMode === "signup" ? "new-password" : "current-password"
              }
              minLength={authMode === "signup" ? 12 : undefined}
              required
            />
          </label>
          <AppButton disabled={busy}>
            {busy
              ? "Procesando…"
              : authMode === "signup"
                ? "Crear cuenta y verificar correo"
                : "Entrar a mi negocio →"}
          </AppButton>
          <AppButton
            className="auth-toggle"
            type="button"
            disabled={busy}
            onClick={() => {
              setAuthMode(authMode === "login" ? "signup" : "login");
              setError("");
              setNotice("");
            }}
          >
            {authMode === "login"
              ? "Primera vez: crear mi cuenta"
              : "Ya tengo cuenta: iniciar sesión"}
          </AppButton>
          <p className="muted">
            Acceso privado. Solo las cuentas autorizadas pueden acceder al
            catálogo.
          </p>
          {notice && <p role="status">{notice}</p>}
        </form>
        {error && (
          <p role="alert" className="error">
            <AppIcon name="status.error" />
            {error}
          </p>
        )}
      </main>
    );
  return (
    <IconProvider company={company}>
      <div className="shell">
        <Sidebar
          section={section}
          company={company}
          companies={companies.filter((c) => c.active !== false)}
          allowedSections={[
            "dashboard",
            ...(activeCompany?.catalog_read
              ? ["materials", "products", "settings"]
              : []),
            ...(activeCompany?.inventory_read
              ? ["purchases", "inventory"]
              : []),
            ...(activeCompany?.production_read
              ? ["formulas", "production"]
              : []),
            ...(activeCompany?.sales_read ? ["sales", "customers"] : []),
            ...(activeCompany?.reports_read ? ["reports"] : []),
            ...(activeCompany?.manage || canCreate ? ["settings"] : []),
          ]}
          corporations={corporations}
          onCorporation={(id) => {
            if (!leaveSheet()) return;
            setPickerCorp(id);
            const list = companies.filter(
              (c) => c.corporation_id === id && c.active !== false,
            );
            chooseCompany(list.length === 1 ? list[0].id : "");
            setSection("dashboard");
          }}
          email={session.user.email}
          onCompany={(value) => {
            if (value === company) return;
            if (leaveSheet()) chooseCompany(value);
          }}
          onNavigate={(next) => {
            if (next === section) return true;
            if (!leaveSheet()) return false;
            setSection(next);
            if (next === "settings" && !activeCompany?.manage)
              setConfigView("origins");
            if (next === "materials") setTab("raw_materials");
            if (
              next === "settings" &&
              ![
                "origins",
                "profile",
                "appearance",
                "structure",
                "store",
              ].includes(configView)
            )
              setTab(configView as Tab);
            setQuery("");
            setEdit(undefined);
            setImportNotice("");
            setSheetDirty(false);
            return true;
          }}
          onLogout={() => {
            if (!leaveSheet()) return;
            void db.auth.signOut().then(({ error }) => {
              if (error) setError(error.message);
            });
          }}
        />
        <main>
          <header>
            <span>OHANA / {sectionTitle.toUpperCase()}</span>
            <span className="badge">
              {role === "viewer" ? "Solo lectura" : "Acceso de edición"}
            </span>
          </header>
          {importNotice && (
            <p className="sheet-notice" role="status">
              <AppIcon name="status.info" />
              {importNotice}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              <AppIcon name="status.error" />
              {error}
            </p>
          )}
          {!company && section === "settings" && configView === "structure" ? (
            <OrganizationAdmin
              onConfigure={(id) => {
                if (!leaveSheet()) return;
                if (id !== company) chooseCompany(id);
                setSection("settings");
                setConfigView("profile");
              }}
              companies={companies}
              corporations={corporations}
              canCreate={canCreate}
              onSaved={refreshContext}
            />
          ) : !company ? (
            <CompanyPicker
              key={pickerCorp}
              initialCorporation={pickerCorp}
              companies={companies}
              corporations={corporations}
              canCreate={canCreate}
              onSelect={(id) => {
                chooseCompany(id);
                setSection("dashboard");
              }}
              onManage={() => {
                setSection("settings");
                setConfigView("structure");
              }}
            />
          ) : (
            <>
              {section === "settings" && (
                <>
                  <section className="intro">
                    <div>
                      <p className="eyebrow">TU ESPACIO DE TRABAJO</p>
                      <h1>Configuración</h1>
                      <p>
                        Administra las opciones y los catálogos de tu negocio.
                      </p>
                    </div>
                  </section>
                  <nav
                    className="settings-tabs"
                    aria-label="Catálogos de configuración"
                  >
                    {[
                      ["profile", "Datos de empresa"],
                      ["appearance", "Apariencia"],
                      ["structure", "Corporaciones y accesos"],
                      ["store", "Tienda y ventas"],
                      ["origins", "Orígenes"],
                      ["suppliers", "Proveedores"],
                      ["presentations", "Presentaciones"],
                      ["units", "Unidades"],
                    ]
                      .filter(
                        ([key]) =>
                          activeCompany?.manage ||
                          [
                            "origins",
                            "suppliers",
                            "presentations",
                            "units",
                          ].includes(key),
                      )
                      .map(([key, label]) => (
                        <AppButton
                          key={key}
                          className={configView === key ? "selected" : ""}
                          onClick={() => {
                            if (key === configView) return;
                            if (!leaveSheet()) return;
                            setConfigView(key);
                            if (
                              ![
                                "origins",
                                "profile",
                                "appearance",
                                "structure",
                                "store",
                              ].includes(key)
                            )
                              setTab(key as Tab);
                            setEdit(undefined);
                            setQuery("");
                          }}
                        >
                          {label}
                        </AppButton>
                      ))}
                  </nav>
                  {(configView === "profile" || configView === "appearance") &&
                    activeCompany && (
                      <CompanySettings
                        key={company + configView}
                        company={activeCompany}
                        canManage={!!activeCompany.manage}
                        appearance={configView === "appearance"}
                        onSaved={refreshContext}
                        onDirty={setSettingsDirty}
                      />
                    )}
                  {configView === "store" && activeCompany?.manage && (
                    <StoreSettings
                      key={company}
                      company={company}
                      currency={activeCompany.currency}
                      onDirty={setSettingsDirty}
                    />
                  )}
                  {configView === "structure" && (
                    <OrganizationAdmin
                      onConfigure={(id) => {
                        if (!leaveSheet()) return;
                        if (id !== company) chooseCompany(id);
                        setSection("settings");
                        setConfigView("profile");
                      }}
                      companies={companies}
                      corporations={corporations}
                      canCreate={canCreate}
                      onSaved={refreshContext}
                    />
                  )}
                  {configView === "origins" && (
                    <OriginsSettings
                      key={company}
                      company={company}
                      origins={data.catalog_origins}
                      canWrite={canWrite}
                      onSaved={load}
                    />
                  )}
                </>
              )}
              {section === "dashboard" && (
                <>
                  <section className="intro">
                    <div>
                      <p className="eyebrow">
                        {activeCompany?.corporation_name}
                      </p>
                      <h1>{activeCompany?.name}</h1>
                      <p>Tu negocio, en armonía.</p>
                    </div>
                  </section>
                  {activeCompany?.catalog_read && (
                    <section className="stats">
                      <div>
                        <span>Materiales</span>
                        <strong>
                          {data.raw_materials.filter((m) => m.active).length}
                        </strong>
                      </div>
                      <div>
                        <span>Productos</span>
                        <strong>
                          {data.products.filter((p) => p.active).length}
                        </strong>
                      </div>
                      <div>
                        <span>Proveedores</span>
                        <strong>
                          {data.suppliers.filter((p) => p.active).length}
                        </strong>
                      </div>
                    </section>
                  )}
                  <div className="form-actions">
                    {(
                      [
                        [
                          "materials",
                          "Materiales",
                          activeCompany?.catalog_read,
                        ],
                        ["products", "Productos", activeCompany?.catalog_read],
                        ["purchases", "Compras", activeCompany?.inventory_read],
                        [
                          "inventory",
                          "Inventario",
                          activeCompany?.inventory_read,
                        ],
                        [
                          "formulas",
                          "Fórmulas",
                          activeCompany?.production_read,
                        ],
                        [
                          "production",
                          "Producción",
                          activeCompany?.production_read,
                        ],
                        ["sales", "Ventas", activeCompany?.sales_read],
                        ["reports", "Reportes", activeCompany?.reports_read],
                      ] as const
                    )
                      .filter(([, , allowed]) => allowed)
                      .map(([key, label]) => (
                        <AppButton
                          key={key}
                          className="secondary"
                          onClick={() => {
                            setSection(key);
                            if (key === "materials") setTab("raw_materials");
                          }}
                        >
                          Abrir {label.toLowerCase()}
                        </AppButton>
                      ))}
                    {activeCompany?.manage && (
                      <AppButton
                        onClick={() => {
                          setSection("settings");
                          setConfigView("profile");
                        }}
                      >
                        Configurar empresa
                      </AppButton>
                    )}
                  </div>
                </>
              )}
              {section === "products" && (
                <ProductsCatalog
                  key={company}
                  company={company}
                  products={data.products}
                  origins={data.catalog_origins}
                  units={data.units}
                  canWrite={canWrite}
                  onSaved={load}
                  onBarcode={setBarcode}
                />
              )}
              {(section === "inventory" || section === "purchases") && (
                <Inventory
                  key={company + section}
                  company={company}
                  currency={activeCompany?.currency}
                  purchases={section === "purchases"}
                />
              )}
              {(section === "formulas" || section === "production") && (
                <Production
                  key={company + section}
                  company={company}
                  formulasOnly={section === "formulas"}
                  manager={activeCompany?.manage}
                />
              )}
              {(section === "sales" || section === "customers") && (
                <Sales
                  key={company + section}
                  company={company}
                  currency={activeCompany?.currency}
                  customersOnly={section === "customers"}
                />
              )}
              {section === "reports" && (
                <Reports key={company} company={company} />
              )}
              {![
                "dashboard",
                "materials",
                "products",
                "settings",
                "inventory",
                "purchases",
                "formulas",
                "production",
                "sales",
                "customers",
                "reports",
              ].includes(section) && (
                <section className="empty module-pending">
                  <p className="eyebrow">PRÓXIMAMENTE EN OHANA</p>
                  <h1>{sectionTitle}</h1>
                  <p>Este módulo está pendiente de desarrollo.</p>
                  <p className="muted">
                    Ya puedes organizar Materiales, Productos y sus opciones
                    desde Configuración.
                  </p>
                </section>
              )}
              {legacyVisible && (
                <>
                  <section className="intro">
                    <div>
                      <p className="eyebrow">LA BASE DE CADA CREACIÓN</p>
                      <h1>{labels[tab]}</h1>
                      <p>Conoce lo que compras. Cuida lo que creas.</p>
                    </div>
                    {canWrite && (
                      <div className="catalog-entry-actions">
                        <AppButton
                          disabled={loading}
                          onClick={() => {
                            if (!leaveSheet()) return;
                            if (tab === "raw_materials") setSheetView(false);
                            setEdit(null);
                          }}
                        >
                          {tab === "raw_materials"
                            ? "Agregar material individual"
                            : tab === "suppliers"
                              ? "Agregar proveedor"
                              : tab === "units"
                                ? "Agregar unidad"
                                : "Agregar presentación"}
                        </AppButton>
                        {tab === "raw_materials" && (
                          <AppButton
                            className="secondary"
                            disabled={loading}
                            onClick={() => {
                              if (!leaveSheet()) return;
                              setSheetView(false);
                              setEdit(undefined);
                              setImportNotice("");
                              setImportOpen(true);
                            }}
                          >
                            Copiar de Tabla
                          </AppButton>
                        )}
                      </div>
                    )}
                  </section>
                  <section className="stats">
                    <div>
                      <span>Materiales activas</span>
                      <strong>
                        {data.raw_materials
                          .filter((r) => r.active)
                          .length.toString()
                          .padStart(2, "0")}
                      </strong>
                    </div>
                    <div>
                      <span>Proveedores activos</span>
                      <strong>
                        {data.suppliers
                          .filter((r) => r.active)
                          .length.toString()
                          .padStart(2, "0")}
                      </strong>
                    </div>
                    <div>
                      <span>Presentaciones con precio vigente</span>
                      <strong>
                        {prices
                          .filter((p) => p.active && p.amount !== null)
                          .length.toString()
                          .padStart(2, "0")}
                      </strong>
                    </div>
                  </section>
                  {tab === "raw_materials" && (
                    <div className="sheet-view-switch">
                      <AppButton
                        className="secondary"
                        onClick={() => {
                          if (leaveSheet()) setSheetView(!sheetView);
                        }}
                      >
                        {sheetView
                          ? "Volver al catálogo"
                          : "Editar catálogo en tabla"}
                      </AppButton>
                    </div>
                  )}
                  {tab === "raw_materials" && sheetView ? (
                    <MaterialSheet
                      currency={activeCompany?.currency}
                      key={company}
                      company={company}
                      canWrite={canWrite}
                      catalog={data}
                      onBarcode={setBarcode}
                      onSaved={load}
                      onDirty={setSheetDirty}
                    />
                  ) : (
                    <section className="catalog">
                      <div className="toolbar">
                        <h2>
                          Tu catálogo <small>{data[tab].length}</small>
                        </h2>
                        <input
                          aria-label="Buscar en el catálogo"
                          placeholder="Nombre, SKU o código de barras…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </div>
                      {tab === "raw_materials" && (
                        <CatalogFilters
                          classification={classification}
                          onClassification={setClassification}
                          origin={origin}
                          onOrigin={setOrigin}
                          origins={data.catalog_origins}
                        />
                      )}{" "}
                      {loading ? (
                        <p className="empty" role="status">
                          Cargando catálogo…
                        </p>
                      ) : data[tab].length === 0 ? (
                        <div className="empty">
                          <span className="seed">✳</span>
                          <h2>Un buen comienzo</h2>
                          <p>
                            Agrega {labels[tab].toLowerCase()} para construir tu
                            catálogo.
                          </p>
                          <p className="muted">
                            Tus datos se guardan de forma privada en tu empresa.
                          </p>
                        </div>
                      ) : (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                {tab === "raw_materials" && (
                                  <>
                                    <th>SKU</th>
                                    <th>Clasificación</th>
                                    <th>Origen</th>
                                    <th>Código de barras</th>
                                  </>
                                )}
                                {tab === "presentations" && (
                                  <>
                                    <th>SKU</th>
                                    <th>Código de barras</th>
                                  </>
                                )}
                                <th>Nombre</th>
                                <th>
                                  {tab === "raw_materials"
                                    ? "Unidad base"
                                    : tab === "suppliers"
                                      ? "Contacto"
                                      : tab === "units"
                                        ? "Equivalencia base"
                                        : "Proveedor / contenido"}
                                </th>
                                <th>
                                  {tab === "presentations"
                                    ? "Precio vigente"
                                    : "Estado"}
                                </th>
                                <th>Acciones</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filtered.map((r) => {
                                const price = prices.find((p) => p.id === r.id);
                                return (
                                  <tr key={r.id}>
                                    {tab === "raw_materials" && (
                                      <>
                                        <td>{r.sku || "—"}</td>
                                        <td>
                                          {r.classification || "Pendiente"}
                                        </td>
                                        <td>
                                          {data.catalog_origins.find(
                                            (o) => o.id === r.origin_id,
                                          )?.name || "Pendiente"}
                                        </td>
                                        <td>{r.barcode || "—"}</td>
                                      </>
                                    )}
                                    {tab === "presentations" && (
                                      <>
                                        <td>{r.sku || "Pendiente"}</td>
                                        <td>{r.barcode || "—"}</td>
                                      </>
                                    )}
                                    <td>
                                      <strong>{r.name}</strong>
                                      {tab === "presentations" && (
                                        <small>{r.alternative_name}</small>
                                      )}
                                      <small>
                                        {tab === "presentations"
                                          ? name(
                                              "raw_materials",
                                              r.raw_material_id,
                                            )
                                          : r.notes}
                                      </small>
                                    </td>
                                    <td>
                                      {tab === "raw_materials" ? (
                                        name("units", r.unit_id)
                                      ) : tab === "suppliers" ? (
                                        r.contact || "—"
                                      ) : tab === "units" ? (
                                        `${r.base_factor} ${r.dimension === "mass" ? "g" : r.dimension === "volume" ? "ml" : "ud"}`
                                      ) : (
                                        <>
                                          {name("suppliers", r.supplier_id)}
                                          <small>
                                            {r.quantity}{" "}
                                            {name("units", r.unit_id)}
                                          </small>
                                        </>
                                      )}
                                    </td>
                                    <td>
                                      {tab === "presentations" ? (
                                        <>
                                          {price?.amount != null
                                            ? money(
                                                price.amount,
                                                price.currency,
                                              )
                                            : "Sin precio"}
                                          {price?.cost_per_material_unit !=
                                            null && (
                                            <small>
                                              {money(
                                                price.cost_per_material_unit,
                                                price.currency,
                                              )}{" "}
                                              /{" "}
                                              {name(
                                                "units",
                                                data.raw_materials.find(
                                                  (m) =>
                                                    m.id === r.raw_material_id,
                                                )?.unit_id,
                                              )}
                                            </small>
                                          )}
                                          {!r.active && (
                                            <small>Archivada</small>
                                          )}
                                        </>
                                      ) : (
                                        <span
                                          className={
                                            "status " +
                                            (!r.active ? "inactive" : "")
                                          }
                                        >
                                          {r.active ? "Activo" : "Archivado"}
                                        </span>
                                      )}
                                    </td>
                                    <td className="actions">
                                      {canWrite && (
                                        <AppButton onClick={() => setEdit(r)}>
                                          Editar
                                        </AppButton>
                                      )}
                                      {(tab === "raw_materials" ||
                                        tab === "presentations") &&
                                        r.barcode && (
                                          <AppButton
                                            onClick={() => setBarcode(r)}
                                          >
                                            Código de barras
                                          </AppButton>
                                        )}
                                      {tab === "presentations" && (
                                        <AppButton
                                          onClick={() => void showHistory(r)}
                                        >
                                          Precios
                                        </AppButton>
                                      )}
                                      {(r.product_url || r.website_url) && (
                                        <a
                                          href={r.product_url || r.website_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          Ver enlace ↗
                                        </a>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {!filtered.length && (
                            <p className="empty">
                              No hay resultados para esta búsqueda.
                            </p>
                          )}
                        </div>
                      )}
                    </section>
                  )}
                  <footer>
                    OHANA · Pequeños detalles, grandes creaciones.
                  </footer>
                </>
              )}
            </>
          )}
        </main>
        {barcode && (
          <Suspense
            fallback={<p role="status">Preparando código de barras…</p>}
          >
            <BarcodeDialog item={barcode} onClose={() => setBarcode(null)} />
          </Suspense>
        )}{" "}
        {importOpen && (
          <ImportMaterials
            currency={activeCompany?.currency}
            company={company}
            canWrite={canWrite}
            catalog={data}
            onBarcode={setBarcode}
            onSaved={load}
            onDirty={setSheetDirty}
            onCancel={() => setImportOpen(false)}
            onComplete={(count) => {
              setImportOpen(false);
              setImportNotice(`${count} filas guardadas correctamente.`);
            }}
          />
        )}
        {edit !== undefined && (
          <div className="overlay">
            <section
              role="dialog"
              aria-modal="true"
              aria-label="Editar catálogo"
              className="modal"
            >
              <AppButton
                className="close"
                aria-label="Cerrar"
                disabled={busy}
                onClick={() => setEdit(undefined)}
              >
                ×
              </AppButton>
              <p className="eyebrow">{labels[tab]}</p>
              <h2>{edit ? "Editar registro" : "Un nuevo comienzo"}</h2>
              <form onSubmit={save}>
                {input("name", "Nombre", "text", true)}
                {tab === "raw_materials" && (
                  <>
                    <CatalogFields
                      key={edit?.id || "new"}
                      company={company}
                      kind="material"
                      item={edit}
                      origins={data.catalog_origins}
                    />
                    {select("unit_id", "Unidad base", data.units, !!edit)}
                  </>
                )}
                {tab === "suppliers" && (
                  <>
                    {input("contact", "Contacto")}
                    {input("website_url", "Sitio web", "url")}
                  </>
                )}
                {tab === "units" && (
                  <>
                    {input("symbol", "Símbolo", "text", true)}
                    <label>
                      Tipo
                      <select
                        name="dimension"
                        defaultValue={edit?.dimension || "mass"}
                        disabled={!!edit}
                      >
                        <option value="mass">Masa (base: g)</option>
                        <option value="volume">Volumen (base: ml)</option>
                        <option value="count">Conteo (base: ud)</option>
                      </select>
                    </label>
                    {edit && (
                      <input
                        type="hidden"
                        name="dimension"
                        value={edit.dimension}
                      />
                    )}{" "}
                    {input(
                      "base_factor",
                      "Equivalencia en la unidad base",
                      "number",
                      true,
                      !!edit,
                    )}
                    <p className="muted">
                      Ejemplo: kilogramo = 1000 gramos. Las conversiones no
                      cambian después de guardar.
                    </p>
                  </>
                )}
                {tab === "presentations" && (
                  <>
                    {input("sku", "SKU (se sugiere automáticamente)")}
                    {input("barcode", "Código de barras personalizado")}
                    <label>
                      <input
                        type="checkbox"
                        name="barcode_custom"
                        defaultChecked={edit?.barcode_custom ?? false}
                      />{" "}
                      Conservar código personalizado, incluso vacío
                    </label>
                    {input("alternative_name", "Nombre alternativo")}
                    {select(
                      "raw_material_id",
                      "Material",
                      data.raw_materials,
                      !!edit,
                    )}
                    {select(
                      "supplier_id",
                      "Proveedor (opcional)",
                      data.suppliers,
                      !!edit,
                      false,
                    )}
                    {input(
                      "quantity",
                      "Contenido de la presentación",
                      "number",
                      true,
                      !!edit,
                    )}
                    {select(
                      "unit_id",
                      "Unidad del contenido",
                      data.units,
                      !!edit,
                    )}
                    {input("product_url", "Enlace de compra", "url")}
                    <p className="muted">
                      Usa unidades del mismo tipo que la material. Registra el
                      precio desde “Precios” después de guardar.
                    </p>
                  </>
                )}
                {(tab === "raw_materials" || tab === "suppliers") && (
                  <label>
                    Notas
                    <textarea name="notes" defaultValue={edit?.notes || ""} />
                  </label>
                )}
                {edit && (
                  <label>
                    Estado
                    <select name="active" defaultValue={String(edit.active)}>
                      <option value="true">Activo</option>
                      <option value="false">Archivado</option>
                    </select>
                  </label>
                )}
                {error && (
                  <p role="alert" className="error">
                    <AppIcon name="status.error" />
                    {error}
                  </p>
                )}
                <AppButton disabled={busy}>
                  {busy ? "Guardando…" : "Guardar"}
                </AppButton>
              </form>
            </section>
          </div>
        )}
        {history && (
          <div className="overlay">
            <section
              role="dialog"
              aria-modal="true"
              aria-label="Historial de precios"
              className="modal"
            >
              <AppButton
                className="close"
                aria-label="Cerrar"
                disabled={busy}
                onClick={() => setHistory(null)}
              >
                ×
              </AppButton>
              <p className="eyebrow">PRECIOS HISTÓRICOS</p>
              <h2>{history.name}</h2>
              <p>
                Cada precio es un registro nuevo. Los precios futuros se aplican
                desde su fecha.
              </p>
              {canWrite && (
                <form onSubmit={addPrice}>
                  <label>
                    Precio por presentación
                    <input
                      name="amount"
                      type="number"
                      min="0"
                      step="0.0001"
                      required
                    />
                  </label>
                  <label>
                    Moneda
                    <select name="currency" defaultValue="GTQ">
                      <option>GTQ</option>
                      <option>USD</option>
                    </select>
                  </label>
                  <label>
                    Vigente desde
                    <input
                      name="effective_on"
                      type="date"
                      defaultValue={new Date().toLocaleDateString("en-CA")}
                      required
                    />
                  </label>
                  <label>
                    Nota
                    <input name="notes" />
                  </label>
                  <AppButton disabled={busy}>
                    {busy ? "Guardando…" : "Registrar precio"}
                  </AppButton>
                </form>
              )}
              {error && (
                <p className="error" role="alert">
                  <AppIcon name="status.error" />
                  {error}
                </p>
              )}
              <ol className="history">
                {entries.map((r) => (
                  <li key={r.id}>
                    <strong>
                      {r.amount == null
                        ? "Precio pendiente"
                        : money(r.amount, r.currency)}
                    </strong>
                    <span>{r.effective_on || "Fecha pendiente"}</span>
                    <small>{r.notes}</small>
                    {r.legacy_previous_amount != null && (
                      <small>
                        Referencia importada:{" "}
                        {money(r.legacy_previous_amount, r.currency)} ·{" "}
                        {r.legacy_previous_supplier || "Proveedor no indicado"}{" "}
                        · Fecha desconocida ·{" "}
                        {r.legacy_previous_basis === "unknown"
                          ? "Sin unidad conocida: no comparable"
                          : r.legacy_previous_basis === "unit"
                            ? "Precio por unidad indicada"
                            : "Precio total de la misma presentación"}
                      </small>
                    )}
                  </li>
                ))}
              </ol>
              {!entries.length && <p>Todavía no hay precios registrados.</p>}
            </section>
          </div>
        )}
      </div>
    </IconProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<main className="store-loading">Cargando Ohana…</main>}>
      {new URLSearchParams(location.search).get("shop") ? (
        <PublicStore
          key={new URLSearchParams(location.search).get("shop")!}
          company={new URLSearchParams(location.search).get("shop")!}
        />
      ) : (
        <App />
      )}
    </Suspense>
  </React.StrictMode>,
);
import "./admin.css";
import "./admin-forms.css";
import "./configuration.css";
