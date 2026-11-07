import SearchSelect from "./SearchSelect";
import ResponsiveTable from "./ResponsiveTable";
import { confirmAction } from "./ConfirmDialog";
import CatalogBadge from "./CatalogBadge";
import { SearchField } from "./PoolControls";
import { useEffect, useRef, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { request } from "./commerce";
import { money, type Row } from "./operations";
import "./partners.css";
import { paymentMethods } from "./payment-methods";
import { departments } from "./delivery-model";
import CustomerBalance from "./CustomerBalance";

const typeName = (type: string) =>
  type === "courier" ? "Mensajería" : type === "supplier" ? "Proveedor" : "Cliente";
const orderStatus: Record<string, string> = {
  pending: "Pendiente",
  dispatched: "Entregado",
  cancelled: "Cancelado",
  expired: "Vencido",
};
const blank = (): Row => ({
  type: "customer",
  code: "",
  name: "",
  legal_name: "",
  tax_id: "",
  phone: "",
  whatsapp: "",
  email: "",
  active: true,
  notes: "",
  commercial_notes: "",
  purchase_terms: "",
  delivery_instructions: "",
  addresses: [],
});
export default function BusinessPartners({
  company,
  partnerType,
  onTariffs,
  onDirty,
  onSaved,
}: {
  company: string;
  partnerType: "customer" | "supplier" | "courier";
  onTariffs?: (row: Row) => void;
  onDirty: (dirty: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [data, setData] = useState<Row>({
      rows: [],
      total: 0,
      canManage: false,
    }),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [sort, setSort] = useState("name"),
    [direction, setDirection] = useState("asc"),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [mode, setMode] = useState<"view" | "edit" | null>(null),
    [draft, setDraft] = useState<Row>(blank),
    [related, setRelated] = useState<Row>({}),
    [matches, setMatches] = useState<Row[]>([]),
    [accounts, setAccounts] = useState<Row[]>([]),
    [dirty, setDirty] = useState(false),
    [refresh, setRefresh] = useState(0);
  const generation = useRef(0),
    suggestion = useRef(0),
    heading = useRef<HTMLHeadingElement>(null);
  const api = (action: string, data: Row = {}) =>
    request("partners", { p_company: company, p_action: action, p_data: data });
  useEffect(() => {
    const ticket = ++generation.current;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      api("list", { query, type: partnerType, status, page, sort, direction })
        .then((result) => {
          if (generation.current !== ticket) return;
          setData(result);
          if (page > 1 && (page - 1) * 25 >= result.total)
            setPage(Math.max(1, Math.ceil(result.total / 25)));
        })
        .catch((e) => {
          if (generation.current === ticket) setError(e.message);
        })
        .finally(() => {
          if (generation.current === ticket) setLoading(false);
        });
    }, 180);
    return () => {
      generation.current++;
      clearTimeout(timer);
    };
  }, [company, query, partnerType, status, page, sort, direction, refresh]);
  useEffect(() => {
    if (mode !== "edit" || !data.canManage) { setMatches([]); return; }
    let live = true;
    const timer = setTimeout(() => {
      api("matches", { id: draft.id, name: draft.name, instagram: draft.instagram, facebook: draft.facebook, phone: draft.phone, phone_secondary: draft.phone_secondary, whatsapp: draft.whatsapp })
        .then((rows) => { if (live) setMatches(rows); }).catch(() => { if (live) setMatches([]); });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [company, mode, data.canManage, draft.id, draft.name, draft.instagram, draft.facebook, draft.phone, draft.phone_secondary, draft.whatsapp]);
  useEffect(() => {
    onDirty(dirty || busy);
    return () => onDirty(false);
  }, [dirty, busy, onDirty]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  useEffect(() => {
    if (mode) heading.current?.focus();
  }, [mode]);
  function change(key: string, value: any) {
    setDraft((old) => ({ ...old, [key]: value,
      ...(key === "phone" && old.whatsapp_same ? { whatsapp: value } : {}),
      ...(key === "whatsapp_same" && value ? { whatsapp: old.phone } : {}),
    }));
    setDirty(true);
  }
  async function close() {
    if (busy) return;
    if (
      dirty &&
      !(await confirmAction("Hay cambios sin guardar. ¿Descartarlos?"))
    )
      return;
    setMode(null);
    setDirty(false);
    setError("");
    suggestion.current++;
  }
  async function open(row?: Row, edit = false, addRole = false) {
    setBusy(true);
    setError("");
    try {
      if (row) {
        const detail = await api("get", { id: row.id });
        setDraft({
          ...detail.partner,
          type: detail.partner.partner_type,
          addresses: detail.addresses,
          ...(addRole ? { [partnerType === "customer" ? "is_customer" : "is_supplier"]: true } : {}),
        });
        setRelated(detail.related);
        setAccounts(detail.account || []);
      } else {
        const initial = blank();
        initial.type = partnerType;
        initial.is_customer = partnerType === "customer";
        initial.is_supplier = partnerType === "supplier";
        initial.is_courier = partnerType === "courier";
        initial.code = (await api("suggest", { type: initial.type })).code;
        if (partnerType === "customer") initial.price_list_id = data.default_price_list || "";
        setDraft(initial);
        setRelated({});
        setAccounts([]);
      }
      setDirty(addRole);
      setMode(row && !edit ? "view" : "edit");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("save", draft);
      setDirty(false);
      setMode(null);
      setNotice("Socio guardado correctamente.");
      setRefresh((n) => n + 1);
      await onSaved();
    } catch (e: any) {
      setError(
        e.code === "23505"
          ? "El código alterno o nombre de proveedor ya está registrado en esta empresa. Puedes utilizar el socio existente."
          : e.message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function toggle(row: Row) {
    if (
      !(await confirmAction(
        `${row.active ? "Desactivar" : "Activar"} a ${row.name}? ${row.active ? "Conservará su historial y dejará de estar disponible en nuevas operaciones." : "Volverá a estar disponible."}`,
      ))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api("active", { id: row.id, active: !row.active });
      setNotice("Estado actualizado.");
      setRefresh((n) => n + 1);
      await onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function orderBy(key: string) {
    setDirection(sort === key && direction === "asc" ? "desc" : "asc");
    setSort(key);
    setPage(1);
  }
  function field(
    key: string,
    label: string,
    {
      wide = false,
      multiline = false,
      inputType = "text",
      max = 200,
      required = false,
    }: {
      wide?: boolean;
      multiline?: boolean;
      inputType?: string;
      max?: number;
      required?: boolean;
    } = {},
  ) {
    return (
      <label className={wide ? "form-wide" : ""}>
        {label}
        {multiline ? (
          <textarea
            value={draft[key] || ""}
            maxLength={max}
            onChange={(e) => change(key, e.target.value)}
          />
        ) : (
          <input
            value={draft[key] || ""}
            type={inputType}
            maxLength={max}
            required={required}
            readOnly={key === "code"}
            disabled={key === "whatsapp" && draft.whatsapp_same}
            pattern={
              key === "alternate_code" ? "[A-Za-z0-9\\-]{1,40}" : undefined
            }
            title={
              key === "alternate_code"
                ? "Usa letras, números o guiones; máximo 40 caracteres."
                : undefined
            }
            onChange={(e) => {
              change(key, e.target.value);
            }}
          />
        )}
      </label>
    );
  }
  const readOnly = mode === "view";
  return (
    <>
      <section className="intro">
        <div>
          <p className="eyebrow">RELACIONES DE TU EMPRESA</p>
          <h1 className="module-title">
            <AppIcon name={partnerType === "courier" ? "module.couriers" : partnerType === "customer" ? "module.customers" : "module.suppliers"} />
            {partnerType === "courier" ? "Mensajerías" : partnerType === "customer" ? "Clientes" : "Proveedores"}
          </h1>
          <p>
            {partnerType === "courier" ? "Contactos de transporte y sus tarifas por entrega." : partnerType === "customer" ? "Tus clientes, contactos y pedidos." : "Tus proveedores, materiales y compras."}
          </p>
        </div>
        {data.canManage && (
          <AppButton
            disabled={busy || loading}
            iconKey="action.add"
            onClick={() => open()}
          >
            {partnerType === "courier" ? "Nueva mensajería" : partnerType === "customer" ? "Nuevo cliente" : "Nuevo proveedor"}
          </AppButton>
        )}
      </section>
      {notice && <p role="status">{notice}</p>}
      {!mode && error && (
        <p role="alert" className="error">
          <AppIcon name="status.error" />
          {error}
        </p>
      )}
      <section className="catalog partner-catalog">
        <div className="partner-filters">
          <label>
            Buscar {typeName(partnerType).toLowerCase()}
            <SearchField
              type="search"
              placeholder="Código, nombre, redes sociales o teléfonos…"
              value={query}
              maxLength={120}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Estado
            <SearchSelect
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </SearchSelect>
          </label>
        </div>
        <div className="partner-table-scroll" aria-busy={loading}>
          <ResponsiveTable>
            <thead>
              <tr>
                {[
                  ["code", "Código"],
                  ["alternate_code", "Código alterno"],
                  ["name", "Nombre"],
                  partnerType === "courier" ? ["courier_tariff_mode", "Modalidad de tarifa"] : ["partner_type", "Tipo"],
                  ["phone", "Teléfono"],
                  ["active", "Estado"],
                ].map(([key, label]) => (
                  <th
                    key={key}
                    aria-sort={
                      sort === key
                        ? direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <AppButton
                      className="secondary partner-sort"
                      iconKey="control.sort"
                      onClick={() => orderBy(key)}
                    >
                      {label}{" "}
                      {sort === key
                        ? direction === "asc"
                          ? " · Asc."
                          : " · Desc."
                        : ""}
                    </AppButton>
                  </th>
                ))}
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row: Row) => (
                <tr key={row.id}>
                  <td>{row.code}</td>
                  <td>{row.alternate_code || "—"}</td>
                  <td
                    className={
                      row.partner_type === "supplier" ? "admin-name" : ""
                    }
                  >
                    {row.name}
                  </td>
                  <td>{partnerType === "courier" ? ({general:"General",zone:"Por zona",department:"Por departamento"} as Row)[row.courier_tariff_mode] : row.is_customer && row.is_supplier ? "Cliente y proveedor" : typeName(row.partner_type)}</td>
                  <td>{row.phone || "—"}</td>
                  <td>
                    <CatalogBadge
                      active={row.active}
                      label={row.active ? "Activo" : "Inactivo"}
                    />
                  </td>
                  <td className="actions">
                    {onTariffs && <AppButton disabled={busy || loading} className="secondary" iconKey="action.calculate" onClick={() => onTariffs(row)}>Tarifas</AppButton>}
                    <AppButton
                      disabled={busy || loading}
                      className="secondary"
                      onClick={() => open(row)}
                    >
                      Ver
                    </AppButton>
                    {data.canManage && (
                      <>
                        <AppButton
                          disabled={busy || loading}
                          className="secondary"
                          onClick={() => open(row, true)}
                        >
                          Editar
                        </AppButton>
                        <AppButton
                          disabled={busy || loading}
                          className="secondary"
                          onClick={() => toggle(row)}
                        >
                          {row.active ? "Desactivar" : "Activar"}
                        </AppButton>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </ResponsiveTable>
        </div>
        <div className="partner-pagination">
          <span role="status">
            {loading
              ? "Cargando socios…"
              : `${data.total} socios · Página ${page} de ${Math.max(1, Math.ceil(data.total / 25))}`}
          </span>
          <div className="form-actions">
            <AppButton
              className="secondary"
              disabled={loading || page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </AppButton>
            <AppButton
              className="secondary"
              disabled={loading || page * 25 >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </AppButton>
          </div>
        </div>
        {!loading && !data.total && (
          <p className="empty">No hay socios que coincidan con los filtros.</p>
        )}
      </section>
      {mode && (
        <div className="overlay">
          <section
            className="modal partner-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="partner-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
          >
            <div className="hierarchy-toolbar">
              <h2 ref={heading} tabIndex={-1} id="partner-title">
                {readOnly
                  ? `Ver ${typeName(partnerType).toLowerCase()}`
                  : draft.id
                    ? `Editar ${typeName(partnerType).toLowerCase()}`
                    : `Nuevo ${typeName(partnerType).toLowerCase()}`}
              </h2>
              {partnerType === "customer" && <CustomerBalance accounts={accounts} currency={data.currency||"GTQ"}/>}
              <AppButton className="secondary" disabled={busy} onClick={close}>
                Cerrar
              </AppButton>
            </div>
            {error && (
              <p role="alert" className="error">
                <AppIcon name="status.error" />
                {error}
              </p>
            )}
            <form onSubmit={save}>
              {mode === "edit" && matches.length > 0 && <aside className="sheet-warning partner-matches" role="status">
                <strong>Posibles coincidencias · puedes continuar guardando</strong>
                <p>Revisa si ya existe este socio antes de crear otro. Las coincidencias de contacto no bloquean el registro.</p>
                {matches.map((match) => <div className="form-actions" key={match.id}>
                  <span>{match.code} · {match.name}</span>
                  {!draft.id && match[partnerType === "courier" ? "is_courier" : partnerType === "customer" ? "is_customer" : "is_supplier"] && <AppButton type="button" className="secondary" disabled={busy} onClick={async () => {
                    if (dirty && !(await confirmAction("¿Usar este socio existente? Se descartarán los datos nuevos y se abrirá su ficha, sin duplicar el registro."))) return;
                    await open(match, true);
                  }}>Usar socio existente</AppButton>}
                </div>)}
              </aside>}
              <fieldset disabled={readOnly || busy}>
                <legend>Datos generales</legend>
                {field("code", `Código de ${typeName(partnerType).toLowerCase()} · automático`, { max: 40 })}
                {field("alternate_code", "Código alterno · opcional", { max: 40 })}
                <p className="form-wide muted">El código definitivo se asigna al guardar.</p>
                {field("name", "Nombre comercial o nombre completo", {
                  max: 160,
                  required: true,
                })}
                {partnerType === "supplier" && <>
                  {field("legal_name", "Razón social")}
                  {field("tax_id", "NIT / identificación fiscal", { max: 80 })}
                </>}
                {partnerType === "customer" && <>
                  {field("instagram", "Instagram · usuario", { max: 200 })}
                  {field("facebook", "Facebook · usuario o perfil", { max: 200 })}
                </>}
                {field("phone", "Teléfono principal", { max: 40, inputType: "tel" })}
                {partnerType === "courier" && field("phone_secondary", "Teléfono secundario · opcional", {max:40,inputType:"tel"})}
                {partnerType === "customer" && <>
                  {field("phone_secondary", "Teléfono secundario · opcional", { max: 40, inputType: "tel" })}
                  <label><input type="checkbox" checked={!!draft.whatsapp_same} onChange={(e) => change("whatsapp_same", e.target.checked)} /> Mismo número que WhatsApp</label>
                </>}
                {field("whatsapp", "WhatsApp", { max: 40, inputType: "tel" })}
                {field("email", "Correo electrónico", {
                  max: 254,
                  inputType: "email",
                })}
                <label>
                  Estado
                  <SearchSelect
                    value={String(draft.active)}
                    onChange={(e) =>
                      change("active", e.target.value === "true")
                    }
                  >
                    <option value="true">Activo</option>
                    <option value="false">Inactivo</option>
                  </SearchSelect>
                </label>
                {partnerType === "supplier" && draft.contact && (
                  <p className="form-wide">
                    Contacto anterior: {draft.contact}
                  </p>
                )}
                {partnerType === "supplier" && draft.website_url && (
                  <p className="form-wide">
                    Página registrada: {draft.website_url}
                  </p>
                )}
                {partnerType !== "customer" && field("notes", "Observaciones generales", {
                  multiline: true,
                  max: 4000,
                })}
              </fieldset>
              {partnerType !== "courier" && <fieldset disabled={readOnly || busy}>
                <legend>Direcciones</legend>
                <p className="form-wide muted">
                  Hasta 20 direcciones por socio. Marca una como principal.
                </p>
                {draft.addresses.map((a: Row, index: number) => (
                  <fieldset
                    className="partner-address"
                    key={a.id || a.key || index}
                  >
                    <legend>Dirección {index + 1}</legend>
                    {partnerType === "customer" && <label>Nombre de dirección
                      <input required maxLength={100} value={a.label||""} onChange={e=>change("addresses",draft.addresses.map((row:Row,i:number)=>i===index?{...row,label:e.target.value}:row))}/>
                    </label>}
                    {partnerType === "customer" && <label>Departamento
                      <SearchSelect value={a.department || ""} onChange={e=>change("addresses",draft.addresses.map((row:Row,i:number)=>i===index?{...row,department:e.target.value}:row))}>
                        <option value="">Sin departamento definido</option>
                        {departments.map(department=><option key={department} value={department}>{department}</option>)}
                      </SearchSelect>
                      <small>Se utilizará para sugerir la tarifa de mensajería por departamento.</small>
                    </label>}
                    {partnerType === "customer" && <label>Zona
                      <SearchSelect value={a.zone==null?"":String(a.zone)} onChange={e=>change("addresses",draft.addresses.map((row:Row,i:number)=>i===index?{...row,zone:e.target.value}:row))}>
                        <option value="">Sin zona definida</option>
                        {Array.from({length:21},(_,i)=>String(i+1)).map(zone=><option key={zone} value={zone}>Zona {zone}</option>)}
                      </SearchSelect>
                      <small>Se utilizará cuando la mensajería tenga tarifas por zona.</small>
                    </label>}
                    {[
                      ["label", "Nombre o referencia", 100],
                      ["phone", "Teléfono de contacto", 40],
                      ["address", "Dirección completa", 1000],
                      ["instructions", "Indicaciones adicionales", 1000],
                    ].filter(([key]) => partnerType === "supplier" || !["label", "phone", "instructions"].includes(String(key))).map(([key, label, max]) => (
                      <label
                        key={key}
                        className={
                          ["address", "instructions"].includes(String(key))
                            ? "form-wide"
                            : ""
                        }
                      >
                        {label}
                        {["address", "instructions"].includes(String(key)) ? (
                          <textarea
                            required={key === "address"}
                            maxLength={Number(max)}
                            value={a[key] || ""}
                            onChange={(e) =>
                              change(
                                "addresses",
                                draft.addresses.map((row: Row, i: number) =>
                                  i === index
                                    ? { ...row, [key]: e.target.value }
                                    : row,
                                ),
                              )
                            }
                          />
                        ) : (
                          <input
                            required={key === "label"}
                            type={key === "phone" ? "tel" : "text"}
                            maxLength={Number(max)}
                            value={a[key] || ""}
                            onChange={(e) =>
                              change(
                                "addresses",
                                draft.addresses.map((row: Row, i: number) =>
                                  i === index
                                    ? { ...row, [key]: e.target.value }
                                    : row,
                                ),
                              )
                            }
                          />
                        )}
                      </label>
                    ))}
                    <label className={a.is_primary ? "partner-primary is-primary form-wide" : "partner-primary form-wide"}>
                      <input
                        type="radio"
                        name="primary_address"
                        checked={!!a.is_primary}
                        onChange={() =>
                          change(
                            "addresses",
                            draft.addresses.map((row: Row, i: number) => ({
                              ...row,
                              is_primary: i === index,
                            })),
                          )
                        }
                      />
                      Dirección principal
                    </label>
                    {!readOnly && (
                      <AppButton
                        type="button"
                        className="secondary"
                        onClick={() =>
                          change(
                            "addresses",
                            draft.addresses.filter(
                              (_: Row, i: number) => i !== index,
                            ),
                          )
                        }
                      >
                        Quitar dirección
                      </AppButton>
                    )}
                  </fieldset>
                ))}
                {!draft.addresses.length && <p>Sin direcciones registradas.</p>}
                {!readOnly && (
                  <div className="form-actions">
                    <AppButton
                      type="button"
                      className="secondary"
                      disabled={draft.addresses.length >= 20}
                      onClick={() =>
                        change("addresses", [
                          ...draft.addresses,
                          {
                            key: crypto.randomUUID(),
                            label: "",
                            address: "",
                            department: "",
                            zone: "",
                            instructions: "",
                            phone: "",
                            is_primary: !draft.addresses.length,
                          },
                        ])
                      }
                    >
                      Agregar dirección
                    </AppButton>
                  </div>
                )}
              </fieldset>}
              {partnerType !== "courier" && <fieldset disabled={readOnly || busy}>
                <legend>Información comercial · {typeName(partnerType)}</legend>
                {partnerType === "customer" && <label>Lista de precios
                  <SearchSelect value={draft.price_list_id || data.default_price_list || ""} onChange={e => change("price_list_id", e.target.value)}>
                    <option value="">Sin lista disponible</option>
                    {draft.price_list_id && !(data.price_lists || []).some((l: Row) => l.id === draft.price_list_id) && <option value={draft.price_list_id}>Lista asignada · inactiva</option>}
                    {(data.price_lists || []).map((l: Row) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </SearchSelect>
                  <small>Se utiliza para sugerir los precios de sus nuevas ventas.</small>
                </label>}
                {partnerType === "customer" && <label>Preferencia de pago · opcional
                  <SearchSelect value={draft.payment_preference || ""} onChange={(e) => change("payment_preference", e.target.value)}>
                    <option value="">Sin preferencia</option>
                    {paymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                  </SearchSelect>
                  <small>Solo se sugiere al crear pedidos; no registra pagos.</small>
                </label>}
                {field("commercial_notes", "Observaciones comerciales", {
                  multiline: true,
                  max: 4000,
                })}
                {partnerType === "supplier"
                  ? field("purchase_terms", "Condiciones de compra", {
                      multiline: true,
                      max: 2000,
                    })
                  : field(
                      "delivery_instructions",
                      "Indicaciones habituales de entrega",
                      { multiline: true, max: 2000 },
                    )}
              </fieldset>}
              <div className="form-actions">
                {!readOnly && <AppButton disabled={busy}>Guardar</AppButton>}
                <AppButton
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={close}
                >
                  {readOnly ? "Volver" : "Cancelar"}
                </AppButton>
              </div>
            </form>
            {draft.id && (
              <section className="partner-history">
                <h3>Relaciones e historial</h3>
                <p className="muted">
                  Hasta 100 registros recientes por sección, según tus permisos.
                </p>
                {Object.entries(related).map(([key, records]) => (
                  <section key={key}>
                    <h4>
                      {{
                        presentations: "Materiales y presentaciones",
                        prices: "Historial de precios",
                        purchases: "Compras",
                        orders: "Pedidos y ventas",
                      }[key] || key}
                    </h4>
                    {(records as Row[]).length ? (
                      <ul>
                        {(records as Row[]).map((record, index) => (
                          <li key={index}>
                            {key === "presentations"
                              ? `${record.material} · ${record.quantity} ${record.unit} · ${record.active ? "Activa" : "Inactiva"}`
                              : key === "orders"
                                ? `#${record.number} · ${orderStatus[record.status] || record.status} · ${money(record.total, record.currency)}${Number(record.gift_units)>0 ? ` · Regalos: ${record.gift_units} unidades` : ""}`
                                : `${record.effective_on || record.received_on || "Sin fecha"} · ${record.material || record.reference || ""} · ${money(record.amount, record.currency)}`}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>Sin registros.</p>
                    )}
                  </section>
                ))}
              </section>
            )}
          </section>
        </div>
      )}
    </>
  );
}
