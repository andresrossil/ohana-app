import { useEffect, useRef, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { request } from "./commerce";
import { money, type Row } from "./operations";
import "./partners.css";

const typeName = (type: string) =>
  type === "supplier" ? "Proveedor" : "Cliente";
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
  onDirty,
  onSaved,
}: {
  company: string;
  onDirty: (dirty: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [data, setData] = useState<Row>({
      rows: [],
      total: 0,
      canManage: false,
    }),
    [query, setQuery] = useState(""),
    [type, setType] = useState(""),
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
    [canChangeType, setCanChangeType] = useState(true),
    [dirty, setDirty] = useState(false),
    [refresh, setRefresh] = useState(0);
  const generation = useRef(0),
    codeCustom = useRef(false),
    suggestion = useRef(0),
    heading = useRef<HTMLHeadingElement>(null);
  const api = (action: string, data: Row = {}) =>
    request("partners", { p_company: company, p_action: action, p_data: data });
  useEffect(() => {
    const ticket = ++generation.current;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      api("list", { query, type, status, page, sort, direction })
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
  }, [company, query, type, status, page, sort, direction, refresh]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
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
    setDraft((old) => ({ ...old, [key]: value }));
    setDirty(true);
  }
  function close() {
    if (busy) return;
    if (dirty && !confirm("Hay cambios sin guardar. ¿Descartarlos?")) return;
    setMode(null);
    setDirty(false);
    setError("");
    suggestion.current++;
  }
  async function open(row?: Row, edit = false) {
    setBusy(true);
    setError("");
    try {
      if (row) {
        const detail = await api("get", { id: row.id });
        setDraft({
          ...detail.partner,
          type: detail.partner.partner_type,
          addresses: detail.addresses,
        });
        setRelated(detail.related);
        setCanChangeType(detail.canChangeType);
      } else {
        const initial = blank();
        initial.code = (await api("suggest", { type: initial.type })).code;
        setDraft(initial);
        setRelated({});
        setCanChangeType(true);
      }
      setDirty(false);
      codeCustom.current = !!row;
      setMode(row && !edit ? "view" : "edit");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function changeType(value: string) {
    change("type", value);
    if (draft.id || codeCustom.current) return;
    const ticket = ++suggestion.current;
    try {
      const result = await api("suggest", { type: value });
      if (ticket === suggestion.current && !codeCustom.current)
        setDraft((old) => ({ ...old, code: result.code }));
    } catch (e: any) {
      setError(e.message);
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
          ? "El código o nombre de proveedor ya está registrado en esta empresa."
          : e.message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function toggle(row: Row) {
    if (
      !confirm(
        `${row.active ? "Desactivar" : "Activar"} a ${row.name}? ${row.active ? "Conservará su historial y dejará de estar disponible en nuevas operaciones." : "Volverá a estar disponible."}`,
      )
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
            pattern={
              key === "code" ? "[A-Za-z0-9][A-Za-z0-9._/\\-]{0,39}" : undefined
            }
            title={
              key === "code"
                ? "Usa letras, números, punto, guion, guion bajo o barra; máximo 40 caracteres."
                : undefined
            }
            onChange={(e) => {
              if (key === "code") {
                codeCustom.current = true;
                suggestion.current++;
              }
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
          <h1>Socios de negocio</h1>
          <p>
            Clientes y proveedores, cada uno con su información e historial.
          </p>
        </div>
        {data.canManage && (
          <AppButton
            disabled={busy || loading}
            iconKey="action.add"
            onClick={() => open()}
          >
            Nuevo socio
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
            Buscar socio
            <input
              type="search"
              placeholder="Código, nombre, teléfono o NIT…"
              value={query}
              maxLength={120}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Tipo
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {data.customerRead && <option value="customer">Clientes</option>}
              {data.supplierRead && (
                <option value="supplier">Proveedores</option>
              )}
            </select>
          </label>
          <label>
            Estado
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
          </label>
        </div>
        <div className="partner-table-scroll" aria-busy={loading}>
          <table>
            <thead>
              <tr>
                {[
                  ["code", "Código"],
                  ["name", "Nombre"],
                  ["partner_type", "Tipo"],
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
                      onClick={() => orderBy(key)}
                    >
                      {label}{" "}
                      {sort === key ? (direction === "asc" ? "↑" : "↓") : "↕"}
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
                  <td>{row.name}</td>
                  <td>{typeName(row.partner_type)}</td>
                  <td>{row.phone || "—"}</td>
                  <td>{row.active ? "Activo" : "Inactivo"}</td>
                  <td className="actions">
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
          </table>
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
                  ? "Ver socio"
                  : draft.id
                    ? "Editar socio"
                    : "Nuevo socio"}
              </h2>
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
              <fieldset disabled={readOnly || busy}>
                <legend>Datos generales</legend>
                {field("code", "Código", { max: 40, required: true })}
                <label>
                  Tipo de socio
                  <select
                    value={draft.type}
                    disabled={!canChangeType}
                    onChange={(e) => changeType(e.target.value)}
                  >
                    <option value="customer">Cliente</option>
                    <option value="supplier">Proveedor</option>
                  </select>
                </label>
                {!canChangeType && (
                  <p className="form-wide muted">
                    El tipo está protegido porque el socio tiene operaciones o
                    presentaciones relacionadas.
                  </p>
                )}
                {field("name", "Nombre comercial o nombre completo", {
                  max: 160,
                  required: true,
                })}
                {field("legal_name", "Razón social")}
                {field("tax_id", "NIT / identificación fiscal", { max: 80 })}
                {field("phone", "Teléfono", { max: 40, inputType: "tel" })}
                {field("whatsapp", "WhatsApp", { max: 40, inputType: "tel" })}
                {field("email", "Correo electrónico", {
                  max: 254,
                  inputType: "email",
                })}
                <label>
                  Estado
                  <select
                    value={String(draft.active)}
                    onChange={(e) =>
                      change("active", e.target.value === "true")
                    }
                  >
                    <option value="true">Activo</option>
                    <option value="false">Inactivo</option>
                  </select>
                </label>
                {draft.contact && (
                  <p className="form-wide">
                    Contacto anterior: {draft.contact}
                  </p>
                )}
                {draft.website_url && (
                  <p className="form-wide">
                    Página registrada: {draft.website_url}
                  </p>
                )}
                {field("notes", "Observaciones generales", {
                  multiline: true,
                  max: 4000,
                })}
              </fieldset>
              <fieldset disabled={readOnly || busy}>
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
                    {[
                      ["label", "Nombre o referencia", 100],
                      ["phone", "Teléfono de contacto", 40],
                      ["address", "Dirección completa", 1000],
                      ["instructions", "Indicaciones adicionales", 1000],
                    ].map(([key, label, max]) => (
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
                    <label>
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
              </fieldset>
              <fieldset disabled={readOnly || busy}>
                <legend>Información comercial · {typeName(draft.type)}</legend>
                {field("commercial_notes", "Observaciones comerciales", {
                  multiline: true,
                  max: 4000,
                })}
                {draft.type === "supplier"
                  ? field("purchase_terms", "Condiciones de compra", {
                      multiline: true,
                      max: 2000,
                    })
                  : field(
                      "delivery_instructions",
                      "Indicaciones habituales de entrega",
                      { multiline: true, max: 2000 },
                    )}
              </fieldset>
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
                                ? `#${record.number} · ${orderStatus[record.status] || record.status} · ${money(record.total, record.currency)}`
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
