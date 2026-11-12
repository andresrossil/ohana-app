import MoneyInput from "./MoneyInput";
import MaterialMinimums from "./MaterialMinimums";
import MaterialPhoto, { uploadMaterialPhoto } from "./MaterialPhoto";
import ProductImage from "./ProductImage";
import { MaterialTypesProvider, MaterialTypeLabel } from "./MaterialTypesContext";
const MaterialTypeSettings = lazy(() => import("./MaterialTypeSettings"));
import { MarginProvider } from "./MarginBadge";
const MarginSettings = lazy(() => import("./MarginSettings"));
import SearchSelect from "./SearchSelect";
import MobileViewport from "./MobileViewport";
import ResponsiveTable from "./ResponsiveTable";
import { confirmAction, ConfirmHost, ConfirmDialog } from "./ConfirmDialog";
import { SearchField } from "./PoolControls";
import AutoTextarea from "./AutoTextarea";
import CatalogBadge from "./CatalogBadge";
import { useNavigationProtection } from "./navigation-protection";
import { AppButton, AppIcon } from "./AppIcon";
import { IconProvider } from "./AppIcon";
import React, { Suspense, useEffect, useRef, useState } from "react";
import { lazyWithRecovery as lazy } from "./lazy-module";
import UpdateGuard from "./UpdateGuard";
import { onIdleRefresh } from "./idle-refresh";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { supabase as db, confirmationRedirect } from "./client";
import "./style.css";
import "./consolidated.css";
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
import { PasswordRecovery } from "./UserSettings";
const UserSettings = lazy(() => import("./UserSettings"));
import CompanyPicker from "./CompanyPicker";
import { useCompanyTheme } from "./CompanyBrand";
type Row = { id: string; [key: string]: any };
const Reports = lazy(() => import("./Reports"));
const Inventory = lazy(() => import("./Inventory"));
const CuringProduction = lazy(() => import("./CuringProduction"));
const Formulas = lazy(() => import("./Formulas"));
const Production = lazy(() => import("./Production"));
const BusinessPartners = lazy(() => import("./BusinessPartners"));
const Couriers = lazy(() => import("./Couriers"));
const Sales = lazy(() => import("./Sales"));
const OrderPreparation = lazy(() => import("./OrderPreparation"));
const PublicStore = lazy(() => import("./PublicStore"));
const AdditionalCostSettings = lazy(() => import("./AdditionalCostSettings"));
const PriceLists = lazy(() => import("./PriceLists"));
const CourierSettlements = lazy(() => import("./CourierSettlements"));
const MaterialCreateForm = lazy(() => import("./MaterialCreateForm"));
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
  const [passwordRecovery, setPasswordRecovery] = useState(() => new URLSearchParams(location.hash.slice(1)).get("type") === "recovery");
  const [quoteCurrency,setQuoteCurrency]=useState("GTQ");
  const protection = useNavigationProtection();
  const [pendingNavigation, setPendingNavigation] = useState<Section | null>(
    null,
  );
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
    [expenseView, setExpenseView] = useState("overhead"),
    [classification, setClassification] = useState(""),
    [origin, setOrigin] = useState(""),
    [barcode, setBarcode] = useState<Row | null>(null);
  const [corporations, setCorporations] = useState<Row[]>([]),
    [canCreate, setCanCreate] = useState(false),
    [pickerCorp, setPickerCorp] = useState(""),
    [settingsDirty, setSettingsDirty] = useState(false);
  useEffect(() => {
    protection.clear();
    setPendingNavigation(null);
  }, [company, session?.user.id]);
  const authIdentity = useRef<string | null>(null);
  const contextVersion = useRef(0);
  const activeCompany = companies.find((c) => c.id === company);
  useCompanyTheme(company);
  const loadVersion = useRef(0);
  const legacyVisible =
    section === "materials" ||
    (section === "settings" &&
      ["suppliers", "presentations", "units"].includes(configView));
  const filtered = data[tab].filter(
    (r) =>
      matchesCatalog(r, query) &&
      (tab !== "raw_materials" ||
        (classificationMatches(r.classification, classification) &&
          originMatches(r.origin_id, origin))),
  );
  const sectionTitle = sections.find((s) => s[0] === section)?.[1] || "";
  const leaveSheet = async () => {
    if (
      !(
        sheetDirty ||
        settingsDirty ||
        protection.dirty() ||
        protection.busy() ||
        busy
      )
    )
      return true;
    return confirmAction(
      "Hay cambios sin guardar o una operación pendiente. ¿Quieres salir sin guardar?",
      {
        title: "Cambios sin guardar",
        cancelText: "Cancelar",
        confirmText: "Salir sin guardar",
        danger: true,
        iconKey: "status.warning",
        busyCheck: () => protection.busy() || busy,
      },
    );
  };
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
      if (_e === "PASSWORD_RECOVERY") setPasswordRecovery(true);
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
    const cancelIdle = onIdleRefresh(() => refreshContext());
    return () => {
      contextVersion.current++;
      cancelIdle();
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
    if (tab === "raw_materials" && edit?.id && sheetDirty) {
      setError(
        "Guarda o descarta primero los cambios de presentaciones y precios.",
      );
      return;
    }
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = { company_id: company };
    for (const [k, v] of f.entries())
      if (k !== "photo" && k !== "remove_photo") payload[k] =
        v === "" && (k === "website_url" || k === "product_url") ? null : v;
    let uploadedPhoto: string | null = null;
    if (tab === "raw_materials") {
      try {
        const file = f.get("photo");
        if (file instanceof File && file.size) uploadedPhoto = await uploadMaterialPhoto(file, company);
        payload.photo_path = uploadedPhoto || (f.has("remove_photo") ? null : edit?.photo_path || null);
      } catch (error: any) {
        setError(error.message || "No se pudo cargar la imagen");
        setBusy(false);
        return;
      }
    }
    if (tab === "raw_materials") {
      Object.assign(payload, identityPayload(f));
      payload.minimum_stock=f.get("minimum_stock")===""?null:Number(f.get("minimum_stock"));
      payload.maximum_stock=f.get("maximum_stock")===""?null:Number(f.get("maximum_stock"));
    }
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
    if (result.error) {
      if (uploadedPhoto) await db.storage.from("catalog-images").remove([uploadedPhoto]);
      setError(result.error.message);
    }
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
      <SearchSelect
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
      </SearchSelect>
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
      {tab === "raw_materials" && key === "name" ? (
        <AutoTextarea
          name={key}
          required={required}
          maxLength={160}
          defaultValue={edit?.[key] ?? ""}
          readOnly={locked}
        />
      ) : (
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
      )}
    </label>
  );
  if (passwordRecovery && ready && session) return <PasswordRecovery onDone={() => { setPasswordRecovery(false); setConfirmation(null); window.history.replaceState(null, "", import.meta.env.BASE_URL); setNotice("Contraseña actualizada."); }} />;
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
    <IconProvider company={company}><MarginProvider company={company}><MaterialTypesProvider company={company}>
      <div className="shell chrome-shell">
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
            ...(activeCompany?.sales_read ? ["sales", "order-preparation"] : []),
            ...(activeCompany?.manage || activeCompany?.sales_read
              ? ["customers"]
              : []),
            ...(activeCompany?.manage || activeCompany?.sales_read ? ["couriers", "settlements"] : []),
            ...(activeCompany?.manage || activeCompany?.catalog_read || activeCompany?.inventory_read ? ["suppliers"] : []),
            ...(activeCompany?.reports_read ? ["reports"] : []),
            ...(activeCompany?.manage ? ["prices", "expenses"] : []),
            ...(activeCompany && (activeCompany.manage || canCreate)
              ? ["settings"]
              : []),
          ]}
          corporations={corporations}
          onCorporation={async (id) => {
            if (!(await leaveSheet())) return;
            setPickerCorp(id);
            const list = companies.filter(
              (c) => c.corporation_id === id && c.active !== false,
            );
            chooseCompany(list.length === 1 ? list[0].id : "");
            setSection("dashboard");
          }}
          email={session.user.email}
          userId={session.user.id}
          onCompany={async (value) => {
            if (value === company) return;
            if (await leaveSheet()) chooseCompany(value);
          }}
          onNavigate={(next, fromLogo = false) => {
            if (
              !fromLogo &&
              next === section &&
              edit === undefined &&
              !importOpen
            )
              return true;
            if (
              sheetDirty ||
              settingsDirty ||
              protection.dirty() ||
              protection.busy() ||
              busy
            ) {
              setPendingNavigation(next);
              return false;
            }
            if (fromLogo) {
              setImportOpen(false);
              setHistory(null);
              setBarcode(null);
              setPendingNavigation(null);
              protection.clear();
            }
            setSection(next);
            if (next === "settings" && !activeCompany?.manage)
              setConfigView("origins");
            if (next === "materials") setTab("raw_materials");
            if (
              next === "settings" &&
              ["suppliers", "presentations", "units"].includes(configView)
            )
              setTab(configView as Tab);
            setQuery("");
            setEdit(undefined);
            setImportNotice("");
            setSheetDirty(false);
            return true;
          }}
          onLogout={async () => {
            if (!(await leaveSheet())) return;
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
              onConfigure={async (id) => {
                if (!(await leaveSheet())) return;
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
                      ["users", "Usuarios"],
                      ["margin", "Margen esperado"],
                      ["materials", "Materiales"],
                      ["structure", "Corporaciones y accesos"],
                      ["store", "Tienda y ventas"],
                      ["origins", "Orígenes"],
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
                          iconKey={key === "margin" ? "action.calculate" : undefined}
                          className={configView === key ? "selected" : ""}
                          onClick={async () => {
                            if (key === configView) return;
                            if (!(await leaveSheet())) return;
                            setConfigView(key);
                            if (
                              ["suppliers", "presentations", "units"].includes(
                                key,
                              )
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
                  {configView === "profile" && activeCompany?.manage && (
                    <AppButton
                      className="secondary company-back"
                      iconKey="action.back"
                      onClick={async () => {
                        if (await leaveSheet()) setConfigView("structure");
                      }}
                    >
                      Volver a la corporación
                    </AppButton>
                  )}
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
                  {configView === "materials" && activeCompany?.manage && <MaterialTypeSettings key={company} company={company} onDirty={setSettingsDirty} />}
                  {configView === "users" && activeCompany?.manage && <UserSettings key={company} company={company} onDirty={setSettingsDirty} />}
                  {configView === "margin" && activeCompany?.manage && <MarginSettings key={company} company={company} onDirty={setSettingsDirty} />}
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
                      onConfigure={async (id) => {
                        if (!(await leaveSheet())) return;
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
                <section
                  className="admin-dashboard"
                  aria-label="Resumen de empresa"
                >
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
                </section>
              )}
              {section === "dashboard" && activeCompany?.production_read && (
                <section className="catalog admin-dashboard" aria-labelledby="dashboard-curing">
                  <h2 id="dashboard-curing">Lotes en curación</h2>
                  <CuringProduction
                    key={company}
                    company={company}
                    onProduction={async () => {
                      if (await leaveSheet()) setSection("production");
                    }}
                  />
                </section>
              )}
              {section === "prices" && activeCompany?.manage && (
                <PriceLists
                  key={company}
                  company={company}
                  onDirty={setSettingsDirty}
                />
              )}
              {section === "expenses" && activeCompany?.manage && (
                <>
                  <section className="intro">
                    <div>
                      <p className="eyebrow">CATÁLOGOS DE TU EMPRESA</p>
                      <h1 className="module-title">
                        <AppIcon name="module.expenses" /> Gastos
                      </h1>
                      <p>Administra otros gastos, mano de obra y publicidad.</p>
                    </div>
                  </section>
                  <nav
                    className="settings-tabs"
                    aria-label="Catálogos de gastos"
                  >
                    {[
                      ["overhead", "Otros gastos"],
                      ["labor", "Mano de obra"],
                      ["advertising", "Publicidad"],
                    ].map(([key, label]) => (
                      <AppButton
                        key={key}
                        className={
                          expenseView === key ? "selected" : "secondary"
                        }
                        onClick={async () => {
                          if (key !== expenseView && (await leaveSheet()))
                            setExpenseView(key);
                        }}
                      >
                        {label}
                      </AppButton>
                    ))}
                  </nav>
                  <AdditionalCostSettings
                    key={company + expenseView}
                    company={company}
                    kind={expenseView}
                    onDirty={setSettingsDirty}
                  />
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
                  productionRead={activeCompany?.production_read}
                />
              )}
              {section === "formulas" && (
                <Formulas
                  key={company}
                  company={company}
                  onDirty={setSettingsDirty}
                />
              )}
              {section === "production" && (
                <Production
                  key={company + section}
                  company={company}
                  onDirty={setSettingsDirty}
                  manager={activeCompany?.manage}
                />
              )}
              {section === "sales" && (
                <Sales
                  key={company + section}
                  company={company}
                  currency={activeCompany?.currency}
                />
              )}
              {section === "order-preparation" && <OrderPreparation key={company} company={company} />}
              {(section === "customers" || section === "suppliers") && (
                <BusinessPartners
                  key={company + section}
                  partnerType={section === "suppliers" ? "supplier" : "customer"}
                  company={company}
                  onDirty={setSettingsDirty}
                  onSaved={load}
                />
              )}
              {section === "couriers" && <Couriers key={company} company={company} onDirty={setSettingsDirty} onSaved={load} canManage={activeCompany?.manage===true}/>}
              {section === "settlements" && <CourierSettlements key={company} company={company} onDirty={setSettingsDirty}/>}
              {section === "reports" && (
                <Reports key={company} company={company} currency={activeCompany?.currency} inventoryAllowed={activeCompany?.inventory_read === true} />
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
                "order-preparation",
                "customers",
                "suppliers",
                "couriers",
                "settlements",
                "reports",
                "prices",
                "expenses",
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
                      <h1 className="module-title">
                        <AppIcon
                          name={
                            tab === "raw_materials"
                              ? "module.materials"
                              : "module.settings"
                          }
                        />
                        {labels[tab]}
                      </h1>
                      <p>Conoce lo que compras. Cuida lo que creas.</p>
                    </div>
                    {canWrite && (
                      <div className="catalog-entry-actions">
                        <AppButton
                          disabled={loading}
                          onClick={async () => {
                            if (!(await leaveSheet())) return;
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
                            onClick={async () => {
                              if (!(await leaveSheet())) return;
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
                      <button
                        type="button"
                        className="stat-link"
                        onClick={async () => {
                          if (await leaveSheet()) setSection("suppliers");
                        }}
                      >
                        <span>Proveedores activos</span>
                        <strong>
                          {data.suppliers
                            .filter((r) => r.active)
                            .length.toString()
                            .padStart(2, "0")}
                        </strong>
                      </button>
                    </div>
                    <div>
                      <button
                        type="button"
                        className="stat-link"
                        disabled={!activeCompany?.manage}
                        onClick={async () => {
                          if (await leaveSheet()) setSection("prices");
                        }}
                      >
                        <span>Presentaciones con precio vigente</span>
                        <strong>
                          {prices
                            .filter((p) => p.active && p.amount !== null)
                            .length.toString()
                            .padStart(2, "0")}
                        </strong>
                      </button>
                    </div>
                  </section>
                  {tab === "raw_materials" && (
                    <div className="sheet-view-switch">
                      {canWrite&&<MaterialMinimums key={company} company={company} onSaved={load}/>}
                      {canWrite && (
                        <AppButton
                          disabled={busy}
                          onClick={async () => {
                            if (
                              !(await confirmAction(
                                "¿Generar los SKU faltantes? Se conservarán los existentes. Se usarán los prefijos configurados para cada tipo de material.",
                              ))
                            )
                              return;
                            setBusy(true);
                            try {
                              const r = await db.rpc(
                                "generate_missing_material_skus",
                                { p_company: company },
                              );
                              if (r.error) throw r.error;
                              setImportNotice(
                                `SKU generados: ${r.data.generated}. Sin clasificación: ${r.data.unclassified}.`,
                              );
                              await load();
                            } catch (e: any) {
                              setError(e.message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Generar SKU faltantes
                        </AppButton>
                      )}
                      <AppButton
                        className="secondary"
                        onClick={async () => {
                          if (await leaveSheet()) setSheetView(!sheetView);
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
                        <SearchField
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
                          <ResponsiveTable>
                            <thead>
                              <tr>
                                {tab === "raw_materials" && (
                                  <>
                                    <th>SKU</th>
                                    <th>Clasificación</th>
                                    <th>Origen</th>
                                    <th>Código de barras</th>
                                    <th>Inventario mínimo</th>
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
                                          <MaterialTypeLabel typeKey={r.classification}/>
                                        </td>
                                        <td>
                                          <CatalogBadge
                                            origin={
                                              data.catalog_origins.find(
                                                (o) => o.id === r.origin_id,
                                              )?.name || "Pendiente"
                                            }
                                          />
                                        </td>
                                        <td>{r.barcode || "—"}</td>
                                        <td data-sort-value={r.minimum_stock}>{r.minimum_stock==null?"—":Number(r.minimum_stock).toLocaleString("es-GT",{maximumFractionDigits:8})}</td>
                                      </>
                                    )}
                                    {tab === "presentations" && (
                                      <>
                                        <td>{r.sku || "Pendiente"}</td>
                                        <td>{r.barcode || "—"}</td>
                                      </>
                                    )}
                                    <td>
                                      {tab === "raw_materials" && r.photo_path && <ProductImage path={r.photo_path} name={r.name} />}
                                      <strong className="admin-name">
                                        {r.name}
                                      </strong>
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
                                          <CatalogBadge active={r.active} />
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
                                          <AppIcon name="action.expand" /> Ver
                                          enlace
                                        </a>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </ResponsiveTable>
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
        {pendingNavigation && (
          <ConfirmDialog
            title="Cambios sin guardar"
            message="Hay cambios sin guardar o datos pendientes de confirmar. ¿Quieres salir?"
            iconKey="status.warning"
            danger
            confirmText="Salir sin guardar"
            cancelText="Cancelar"
            busyCheck={() => protection.busy() || busy}
            onCancel={() => setPendingNavigation(null)}
            onConfirm={() => {
              if (protection.busy() || busy) {
                setError("Espera a que termine la operación en curso.");
                return;
              }
              const next = pendingNavigation;
              protection.clear();
              setPendingNavigation(null);
              setEdit(undefined);
              setImportOpen(false);
              setHistory(null);
              setBarcode(null);
              setSheetDirty(false);
              setSettingsDirty(false);
              setSection(next);
              if (next === "materials") setTab("raw_materials");
            }}
          />
        )}
        {tab === "raw_materials" && edit === null && (
          <MaterialCreateForm
            company={company}
            currency={activeCompany?.currency || "GTQ"}
            catalog={data}
            onSaved={load}
            onClose={() => setEdit(undefined)}
            onDirty={setSheetDirty}
          />
        )}
        {edit !== undefined && !(tab === "raw_materials" && edit === null) && (
          <div className="overlay">
            <section
              role="dialog"
              aria-modal="true"
              aria-label="Editar catálogo"
              className={
                tab === "raw_materials" && edit?.id
                  ? "modal material-editor-modal"
                  : "modal"
              }
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
              <form onSubmit={save} aria-busy={busy}>
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
                    <label>Inventario mínimo · opcional<input name="minimum_stock" type="number" min="0" max="999999999999999" step="any" defaultValue={edit?.minimum_stock??""}/><small>En la unidad de inventario seleccionada.</small></label>
                    <label>Inventario máximo · opcional<input name="maximum_stock" type="number" min="0" max="999999999999999" step="any" defaultValue={edit?.maximum_stock??""}/><small>En la unidad de inventario seleccionada.</small></label>
                    <MaterialPhoto path={edit?.photo_path} name={edit?.name} />
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
                      <SearchSelect
                        name="dimension"
                        defaultValue={edit?.dimension || "mass"}
                        disabled={!!edit}
                      >
                        <option value="mass">Masa (base: g)</option>
                        <option value="volume">Volumen (base: ml)</option>
                        <option value="count">Conteo (base: ud)</option>
                      </SearchSelect>
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
                    <AutoTextarea
                      name="notes"
                      defaultValue={edit?.notes || ""}
                    />
                  </label>
                )}
                {edit && (
                  <label>
                    Estado
                    <SearchSelect name="active" defaultValue={String(edit.active)}>
                      <option value="true">Activo</option>
                      <option value="false">Archivado</option>
                    </SearchSelect>
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
              {tab === "raw_materials" && edit?.id && (
                <MaterialSheet
                  key={edit.id}
                  materialId={edit.id}
                  company={company}
                  currency={activeCompany?.currency || "GTQ"}
                  canWrite={canWrite}
                  catalog={data}
                  onSaved={load}
                  onDirty={setSheetDirty}
                />
              )}
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
                    <MoneyInput currency={quoteCurrency}
                      name="amount"
                      type="number"
                      min="0"
                      step="0.0001"
                      required
                    />
                  </label>
                  <label>
                    Moneda
                    <SearchSelect name="currency" value={quoteCurrency} onChange={e=>setQuoteCurrency(e.target.value)}>
                      <option>GTQ</option>
                      <option>USD</option>
                    </SearchSelect>
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
        <ConfirmHost key={company} />
        <UpdateGuard user={session.user.id} blocked={() => busy || sheetDirty || settingsDirty || protection.busy() || protection.dirty()} />
      </div>
    </MaterialTypesProvider></MarginProvider></IconProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<main className="store-loading">Cargando Ohana…</main>}>
      <MobileViewport />
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

import "./mobile.css";

import "./layout-polish.css";
import "./app-chrome.css";
