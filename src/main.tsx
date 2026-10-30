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
import CatalogOverview from "./CatalogOverview";
import CatalogFields from "./CatalogFields";
import CatalogFilters, {
  classificationMatches,
  originMatches,
} from "./CatalogFilters";
const BarcodeDialog = lazy(() => import("./BarcodeDialog"));
import { identityPayload, matchesCatalog } from "./catalog-model";
type Row = { id: string; [key: string]: any };
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
  const [section, setSection] = useState<Section>("materials"),
    [configView, setConfigView] = useState("origins"),
    [classification, setClassification] = useState(""),
    [origin, setOrigin] = useState(""),
    [barcode, setBarcode] = useState<Row | null>(null);
  const loadVersion = useRef(0);
  const legacyVisible =
    section === "materials" ||
    (section === "settings" && configView !== "origins");
  const filtered = data[tab].filter(
    (r) =>
      matchesCatalog(r, query) &&
      (tab !== "raw_materials" ||
        (classificationMatches(r.classification, classification) &&
          originMatches(r.origin_id, origin))),
  );
  const sectionTitle = sections.find((s) => s[0] === section)?.[1] || "";
  const leaveSheet = () =>
    !sheetDirty ||
    window.confirm(
      "Hay cambios sin guardar en la hoja. ¿Quieres descartarlos?",
    );
  const canWrite = role !== "viewer";
  useEffect(() => {
    db.auth.getSession().then(({ data, error }) => {
      if (error) setError(error.message);
      setSession(data.session);
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
      setSession(s);
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
  useEffect(() => {
    if (!session) return;
    let live = true;
    db.from("companies")
      .select("*")
      .order("name")
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setError(error.message);
        else {
          setCompanies(data || []);
          setCompany(data?.[0]?.id || "");
        }
      });
    return () => {
      live = false;
    };
  }, [session?.user.id]);
  async function load() {
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
        db
          .from("company_members")
          .select("role")
          .eq("company_id", company)
          .eq("user_id", session!.user.id)
          .single(),
      ]);
      if (r.error) throw r.error;
      if (version !== loadVersion.current) return;
      setData(Object.fromEntries(results) as Catalog);
      setPrices(p);
      setRole(r.data.role);
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
  }, [company]);
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
    setError("");
    setEntries([]);
    const { data, error } = await db
      .from("price_history")
      .select("*")
      .eq("company_id", company)
      .eq("presentation_id", row.id)
      .order("effective_on", { ascending: false })
      .order("created_at", { ascending: false });
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
            <button onClick={() => setConfirmation(null)}>
              {confirmation === "verified"
                ? "Entrar a Ohana →"
                : "Volver al acceso"}
            </button>
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
          <button disabled={busy}>
            {busy
              ? "Procesando…"
              : authMode === "signup"
                ? "Crear cuenta y verificar correo"
                : "Entrar a mi negocio →"}
          </button>
          <button
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
          </button>
          <p className="muted">
            Acceso privado. Solo las cuentas autorizadas pueden acceder al
            catálogo.
          </p>
          {notice && <p role="status">{notice}</p>}
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </main>
    );
  return (
    <div className="shell">
      <Sidebar
        section={section}
        company={company}
        companies={companies}
        email={session.user.email}
        onCompany={(value) => {
          if (value === company) return;
          if (leaveSheet()) setCompany(value);
        }}
        onNavigate={(next) => {
          if (next === section) return true;
          if (!leaveSheet()) return false;
          setSection(next);
          if (next === "materials") setTab("raw_materials");
          if (next === "settings" && configView !== "origins")
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
            {importNotice}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!company ? (
          <section className="empty">
            <h1>Tu cuenta está lista</h1>
            <p>
              El administrador debe asignarte acceso a Ohana para ver el
              catálogo.
            </p>
          </section>
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
                    ["origins", "Orígenes"],
                    ["suppliers", "Proveedores"],
                    ["presentations", "Presentaciones"],
                    ["units", "Unidades"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      className={configView === key ? "selected" : ""}
                      onClick={() => {
                        if (!leaveSheet()) return;
                        setConfigView(key);
                        if (key !== "origins") setTab(key as Tab);
                        setEdit(undefined);
                        setQuery("");
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
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
            {(section === "inventory" || section === "reports") && (
              <CatalogOverview
                key={company + section}
                materials={data.raw_materials}
                products={data.products}
                origins={data.catalog_origins}
                report={section === "reports"}
              />
            )}
            {![
              "materials",
              "products",
              "settings",
              "inventory",
              "reports",
            ].includes(section) && (
              <section className="empty module-pending">
                <p className="eyebrow">PRÓXIMAMENTE EN OHANA</p>
                <h1>{sectionTitle}</h1>
                <p>Este módulo está pendiente de desarrollo.</p>
                <p className="muted">
                  Ya puedes organizar Materiales, Productos y sus opciones desde
                  Configuración.
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
                      <button
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
                      </button>
                      {tab === "raw_materials" && (
                        <button
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
                        </button>
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
                    <button
                      className="secondary"
                      onClick={() => {
                        if (leaveSheet()) setSheetView(!sheetView);
                      }}
                    >
                      {sheetView
                        ? "Volver al catálogo"
                        : "Editar catálogo en tabla"}
                    </button>
                  </div>
                )}
                {tab === "raw_materials" && sheetView ? (
                  <MaterialSheet
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
                                      <td>{r.classification || "Pendiente"}</td>
                                      <td>
                                        {data.catalog_origins.find(
                                          (o) => o.id === r.origin_id,
                                        )?.name || "Pendiente"}
                                      </td>
                                      <td>{r.barcode || "—"}</td>
                                    </>
                                  )}
                                  <td>
                                    <strong>{r.name}</strong>
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
                                          ? money(price.amount, price.currency)
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
                                        {!r.active && <small>Archivada</small>}
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
                                      <button onClick={() => setEdit(r)}>
                                        Editar
                                      </button>
                                    )}
                                    {tab === "raw_materials" && r.barcode && (
                                      <button onClick={() => setBarcode(r)}>
                                        Código de barras
                                      </button>
                                    )}
                                    {tab === "presentations" && (
                                      <button
                                        onClick={() => void showHistory(r)}
                                      >
                                        Precios
                                      </button>
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
                <footer>OHANA · Pequeños detalles, grandes creaciones.</footer>
              </>
            )}
          </>
        )}
      </main>
      {barcode && (
        <Suspense fallback={<p role="status">Preparando código de barras…</p>}>
          <BarcodeDialog item={barcode} onClose={() => setBarcode(null)} />
        </Suspense>
      )}{" "}
      {importOpen && (
        <ImportMaterials
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
            <button
              className="close"
              aria-label="Cerrar"
              disabled={busy}
              onClick={() => setEdit(undefined)}
            >
              ×
            </button>
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
                  {error}
                </p>
              )}
              <button disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button>
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
            <button
              className="close"
              aria-label="Cerrar"
              disabled={busy}
              onClick={() => setHistory(null)}
            >
              ×
            </button>
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
                <button disabled={busy}>
                  {busy ? "Guardando…" : "Registrar precio"}
                </button>
              </form>
            )}
            {error && (
              <p className="error" role="alert">
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
                      {r.legacy_previous_supplier || "Proveedor no indicado"} ·
                      Fecha desconocida ·{" "}
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
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
