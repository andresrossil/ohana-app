import { useEffect, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import SearchSelect from "./SearchSelect";
import ResponsiveTable from "./ResponsiveTable";
import { money, keyedRequest, useOperation, type Row } from "./operations";
import { confirmAction } from "./ConfirmDialog";
import AutoTextarea from "./AutoTextarea";
import InventoryAdjustment, {
  inventoryRequest,
  inventoryKinds,
} from "./InventoryAdjustment";

export default function Kardex({
  company,
  currency,
  revision,
  onSaved,
}: {
  company: string;
  currency: string;
  revision: number;
  onSaved: () => Promise<void>;
}) {
  const [cancelReason, setCancelReason] = useState("");
  const state = useOperation(company, "inventory"),
    [filters, setFilters] = useState<Row>({ page: 0 }),
    [draft, setDraft] = useState<Row>({}),
    [result, setResult] = useState<Row>({ rows: [], stock: [], total: 0 }),
    [cat, setCat] = useState<Row>({ materials: [], variants: [], lots: [] }),
    [detail, setDetail] = useState<Row | null>(null),
    [source, setSource] = useState<Row | null>(null),
    [reverse, setReverse] = useState(""),
    [correction, setCorrection] = useState("");
  useEffect(() => {
    state.run(async () => {
      const [r, c] = await Promise.all([
        inventoryRequest(company, "ledger", filters),
        inventoryRequest(company, "catalog"),
      ]);
      setResult(r);
      setCat(c);
    });
  }, [company, revision, filters]);
  const articles: Row[] = [
    ...cat.materials.map((m: Row) => ({
      ...m,
      kind: "material",
      label: [m.sku, m.name].filter(Boolean).join(" · "),
    })),
    ...cat.variants.map((v: Row) => ({
      ...v,
      kind: "variant",
      label: [v.sku, v.product_name, v.label].filter(Boolean).join(" · "),
    })),
  ];
  const field = (key: string, value: string) =>
    setDraft({ ...draft, [key]: value });
  const names: Record<string, string> = {
    receipt: "Compra",
    inventory_document: "Ajuste / Inventario inicial",
    production_consumption: "Salida de materiales",
    production_output: "Ingreso de producto",
    order_reservation: "Reserva",
    order_dispatch: "Venta / Regalo",
    order_cancel: "Cancelación",
    release: "Liberación",
    adjustment: "Ajuste anterior",
    document_reversal: "Reversión de documento",
  };
  const products = new Map<string, Row>();
  for (const b of result.stock) {
    if (b.item_kind !== "variant") continue;
    const v = cat.variants.find((v: Row) => v.id === b.item_id);
    if (!v) continue;
    const p = products.get(v.product_id) || {
      id: v.product_id,
      name: v.product_name,
      on_hand: 0,
      blocked: 0,
      reserved: 0,
      available: 0,
      known_value: 0,
      pending_cost: 0,
    };
    for (const key of [
      "on_hand",
      "blocked",
      "reserved",
      "available",
      "known_value",
      "pending_cost",
    ])
      p[key] += Number(b[key] || 0);
    products.set(p.id, p);
  }
  return (
    <>
      <section className="catalog kardex">
        <header className="catalog-head">
          <h2>Kardex histórico</h2>
          <small>
            El saldo se calcula con todos los movimientos confirmados del
            artículo, antes de aplicar los filtros.
          </small>
        </header>
        <form
          className="inventory-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setFilters({ ...draft, page: 0 });
          }}
        >
          <label>
            Desde
            <input
              type="date"
              value={draft.from || ""}
              onChange={(e) => field("from", e.target.value)}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={draft.to || ""}
              onChange={(e) => field("to", e.target.value)}
            />
          </label>
          <label>
            Tipo de artículo
            <SearchSelect
              value={draft.kind || ""}
              onChange={(e) => {
                setDraft({ ...draft, kind: e.target.value, item: "", lot: "" });
              }}
            >
              <option value="">Todos</option>
              <option value="material">Materiales</option>
              <option value="variant">Productos terminados</option>
            </SearchSelect>
          </label>
          <label>
            Artículo / Variante
            <SearchSelect
              value={draft.item || ""}
              onChange={(e) =>
                setDraft({ ...draft, item: e.target.value, lot: "" })
              }
            >
              <option value="">Todos</option>
              {articles
                .filter((a) => !draft.kind || a.kind === draft.kind)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
            </SearchSelect>
          </label>
          <label>
            Tipo de movimiento
            <SearchSelect
              value={draft.type || ""}
              onChange={(e) => field("type", e.target.value)}
            >
              <option value="">Todos</option>
              {Object.entries({
                ...inventoryKinds,
                production_consumption: "Salida de materiales",
                production_output: "Ingreso de producto",
              })
                .filter(([k]) => !["production", "release"].includes(k))
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </SearchSelect>
          </label>
          <label>
            Documento origen
            <SearchSelect
              value={draft.source || ""}
              onChange={(e) => field("source", e.target.value)}
            >
              <option value="">Todos</option>
              {Object.entries(names)
                .filter(([k]) => k !== "release")
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </SearchSelect>
          </label>
          <label>
            Buscar
            <input
              value={draft.query || ""}
              placeholder="SKU, nombre, documento, unidad física…"
              onChange={(e) => field("query", e.target.value)}
            />
          </label>
          <div className="actions">
            <AppButton disabled={state.busy}>Filtrar</AppButton>
            <AppButton
              type="button"
              className="secondary"
              onClick={() => {
                setDraft({});
                setFilters({ page: 0 });
              }}
            >
              Limpiar
            </AppButton>
          </div>
        </form>
        {state.error && (
          <p className="error" role="alert">
            <AppIcon name="status.error" />
            {state.error}
          </p>
        )}
        <div className="table-wrap">
          <ResponsiveTable>
            <thead>
              <tr>
                {[
                  "Fecha",
                  "Documento",
                  "Tipo",
                  "SKU / Artículo / Variante",
                  "Entrada",
                  "Salida",
                  "Saldo",
                  "Unidad",
                  "Costo unitario",
                  "Valor",
                  "Unidades",
                  "Usuario / Registro",
                  "Observaciones",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r: Row) => (
                <tr key={r.id}>
                  <td data-sort-value={r.date}>{r.date}</td>
                  <td>
                    <AppButton
                      className="secondary"
                      onClick={() =>
                        state.run(async () => {
                          if (r.document_id)
                            setDetail(
                              await inventoryRequest(company, "detail", {
                                id: r.document_id,
                              }),
                            );
                          else
                            setSource(
                              await inventoryRequest(company, "source", {
                                id: r.id,
                              }),
                            );
                        })
                      }
                    >
                      {r.document_number}
                    </AppButton>
                  </td>
                  <td>
                    {(["production_consumption", "production_output"].includes(
                      r.source_kind,
                    )
                      ? names[r.source_kind]
                      : inventoryKinds[r.movement_type]) ||
                      names[r.source_kind] ||
                      r.movement_type}
                  </td>
                  <td>
                    {r.sku} · {r.name}
                    <small>{r.variant}</small>
                    {r.legacy && (
                      <small>
                        Movimiento previo · referencia histórica disponible
                      </small>
                    )}
                  </td>
                  <td data-sort-value={r.entry}>
                    <span
                      className={
                        Number(r.entry) > 0
                          ? "kardex-entry-quantity"
                          : undefined
                      }
                    >
                      {Number(r.entry)}
                    </span>
                  </td>
                  <td data-sort-value={r.exit}>
                    <span
                      className={
                        Number(r.exit) > 0 ? "kardex-exit-quantity" : undefined
                      }
                    >
                      {Number(r.exit)}
                    </span>
                  </td>
                  <td data-sort-value={r.balance}>
                    <strong>{Number(r.balance)}</strong>
                  </td>
                  <td>{r.unit}</td>
                  <td data-sort-value={r.unit_cost ?? ""}>
                    {money(r.unit_cost, r.currency)}
                    {r.cost_basis === "catalog_purchase" && (
                      <small>Precio de compra al confirmar</small>
                    )}
                    {r.cost_basis === "historical_reference" && (
                      <small>Referencia histórica simplificada</small>
                    )}
                  </td>
                  <td data-sort-value={r.value ?? ""}>
                    {money(r.value, r.currency)}
                  </td>
                  <td>
                    {r.units?.map((u: Row) => (
                      <small key={u.id}>
                        {u.code} ·{" "}
                        {u.weight == null ? "Sin peso real" : u.weight + " g"}
                      </small>
                    ))}
                  </td>
                  <td>
                    {r.created_by || "Histórico"}
                    <small>
                      {new Date(r.created_at).toLocaleString("es-GT")}
                    </small>
                  </td>
                  <td>{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </ResponsiveTable>
        </div>
        {!state.busy && !state.error && !result.rows.length && (
          <p className="empty">No hay movimientos con estos filtros.</p>
        )}
        <div className="actions">
          <AppButton
            className="secondary"
            disabled={state.busy || !filters.page}
            onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
          >
            Anterior
          </AppButton>
          <span>
            {result.total} movimientos · Página {Number(filters.page || 0) + 1}{" "}
            · Ordenación dentro de esta página
          </span>
          <AppButton
            className="secondary"
            disabled={
              state.busy ||
              (Number(filters.page || 0) + 1) * 100 >= result.total
            }
            onClick={() =>
              setFilters({ ...filters, page: Number(filters.page || 0) + 1 })
            }
          >
            Siguiente
          </AppButton>
        </div>
      </section>
      <section className="catalog">
        <h2>Valor de existencias</h2>
        <p>
          Valor simplificado con costos históricos conocidos. Los costos
          pendientes no se interpretan como cero; no es una valoración contable.
        </p>
        <div className="table-wrap">
          <ResponsiveTable>
            <thead>
              <tr>
                {[
                  "Artículo / Variante",
                  "Físico",
                  "Curación",
                  "Reservado",
                  "Disponible",
                  "Valor conocido",
                  "Cantidad sin costo",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.stock.map((b: Row) => {
                const a = articles.find((a) => a.id === b.item_id);
                return (
                  <tr key={b.item_kind + b.item_id}>
                    <td>{a?.label || b.item_id}</td>
                    <td>{Number(b.on_hand)}</td>
                    <td>{Number(b.blocked)}</td>
                    <td>{Number(b.reserved)}</td>
                    <td>{Number(b.available)}</td>
                    <td data-sort-value={b.known_value ?? ""}>
                      {money(b.known_value, currency)}
                    </td>
                    <td>{Number(b.pending_cost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </ResponsiveTable>
        </div>
        {!!products.size && (
          <details>
            <summary>Totales por producto</summary>
            <div className="table-wrap">
              <ResponsiveTable>
                <thead>
                  <tr>
                    {[
                      "Producto",
                      "Físico",
                      "Curación",
                      "Reservado",
                      "Disponible",
                      "Valor conocido",
                      "Cantidad sin costo",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...products.values()].map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      {["on_hand", "blocked", "reserved", "available"].map(
                        (k) => (
                          <td key={k}>{p[k]}</td>
                        ),
                      )}
                      <td>{money(p.known_value, currency)}</td>
                      <td>{p.pending_cost}</td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
          </details>
        )}
      </section>
      {detail?.header && (
        <div className="overlay">
          <section
            className="modal operations-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Documento de inventario"
          >
            <header className="catalog-head">
              <h2>INV-{String(detail.header.number).padStart(6, "0")}</h2>
              <AppButton className="secondary" onClick={() => setDetail(null)}>
                Cerrar
              </AppButton>
            </header>
            <p>
              {inventoryKinds[detail.header.kind]} ·{" "}
              {detail.header.effective_on} · {detail.header.reason}
            </p>
            <p>{detail.header.notes}</p>
            <small>
              Creado por {detail.header.created_by} ·{" "}
              {new Date(detail.header.created_at).toLocaleString("es-GT")}
            </small>
            {detail.header.reverses_id && (
              <p>Revierte el documento {detail.header.reverses_id}</p>
            )}
            <div className="table-wrap">
              <ResponsiveTable>
                <thead>
                  <tr>
                    {[
                      "Artículo",
                      "Cantidad",
                      "Unidad",
                      "Costo unitario",
                      "Valor",
                      "Unidad individual",
                      "Observaciones",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l: Row) => (
                    <tr key={l.id}>
                      <td>
                        {l.snapshot.sku} · {l.snapshot.name}
                        <small>{l.snapshot.variant}</small>
                      </td>
                      <td>{l.quantity}</td>
                      <td>{l.snapshot.input_unit}</td>
                      <td>{money(l.unit_cost, l.currency)}</td>
                      <td>{money(l.total_value, l.currency)}</td>
                      <td>
                        {l.individual_unit_id && (
                          <small>
                            {l.external_code || l.individual_unit_id} ·{" "}
                            {l.weight} g
                          </small>
                        )}
                      </td>
                      <td>{l.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
            <div className="actions">
              {state.canWrite && (
                <AppButton
                  className="secondary"
                  onClick={() => {
                    setCorrection(detail.header.id);
                    setDetail(null);
                  }}
                >
                  Registrar corrección
                </AppButton>
              )}
              {detail.header.corrects_id && (
                <AppButton
                  className="secondary"
                  onClick={() =>
                    state.run(async () =>
                      setDetail(
                        await inventoryRequest(company, "detail", {
                          id: detail.header.corrects_id,
                        }),
                      ),
                    )
                  }
                >
                  Ver documento corregido
                </AppButton>
              )}
              {state.canWrite &&
                detail.header.kind !== "reversal" &&
                !detail.reversal && (
                  <AppButton
                    className="danger"
                    onClick={() => {
                      setReverse(detail.header.id);
                      setDetail(null);
                    }}
                  >
                    Revertir documento
                  </AppButton>
                )}
              {detail.reversal && (
                <AppButton
                  className="secondary"
                  onClick={() =>
                    state.run(async () =>
                      setDetail(
                        await inventoryRequest(company, "detail", {
                          id: detail.reversal,
                        }),
                      ),
                    )
                  }
                >
                  Ver reversión
                </AppButton>
              )}
              {detail.header.reverses_id && (
                <AppButton
                  className="secondary"
                  onClick={() =>
                    state.run(async () =>
                      setDetail(
                        await inventoryRequest(company, "detail", {
                          id: detail.header.reverses_id,
                        }),
                      ),
                    )
                  }
                >
                  Ver documento original
                </AppButton>
              )}
            </div>
            <p>
              Documento confirmado: no se edita ni elimina. Para corregir,
              registra un ajuste o revierte y vuelve a registrar.
            </p>
          </section>
        </div>
      )}
      {source && (
        <div className="overlay">
          <section
            className="modal operations-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Documento origen"
            data-navigation-dirty={!!cancelReason}
          >
            <header className="catalog-head">
              <h2>{source.movement?.document_number}</h2>
              <AppButton className="secondary" onClick={() => setSource(null)}>
                Cerrar
              </AppButton>
            </header>
            <p>
              {names[source.movement?.source_kind]} · {source.movement?.date}
            </p>
            <p>
              {source.movement?.sku} · {source.movement?.name} ·{" "}
              {source.movement?.variant}
            </p>
            <p>
              {source.movement?.quantity} {source.movement?.unit} ·{" "}
              {money(source.movement?.value, source.movement?.currency)}
            </p>
            <p>{source.reference}</p>
            <p>{source.movement?.notes}</p>
            <div className="table-wrap">
              <ResponsiveTable>
                <thead>
                  <tr>
                    {[
                      "Artículo / Variante",
                      "Entrada",
                      "Salida",
                      "Unidad",
                      "Costo unitario",
                      "Valor",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {source.lines?.map((l: Row) => (
                    <tr key={l.id}>
                      <td>
                        {l.sku} · {l.name}
                        <small>{l.variant}</small>
                      </td>
                      <td data-sort-value={l.entry}>
                        <span
                          className={
                            Number(l.entry) > 0
                              ? "kardex-entry-quantity"
                              : undefined
                          }
                        >
                          {l.entry}
                        </span>
                      </td>
                      <td data-sort-value={l.exit}>
                        <span
                          className={
                            Number(l.exit) > 0
                              ? "kardex-exit-quantity"
                              : undefined
                          }
                        >
                          {l.exit}
                        </span>
                      </td>
                      <td>{l.unit}</td>
                      <td>{money(l.unit_cost, l.currency)}</td>
                      <td>{money(l.value, l.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
            {(source.cancellation?.reversal_id ||
              source.cancellation?.status === "cancelled") && (
              <p role="status">
                Documento cancelado / revertido.{" "}
                {source.cancellation.reason &&
                  "Motivo: " + source.cancellation.reason}
              </p>
            )}
            {source.reversal?.original_movement_id && (
              <AppButton
                className="secondary"
                onClick={() =>
                  state.run(async () =>
                    setSource(
                      await inventoryRequest(company, "source", {
                        id: source.reversal.original_movement_id,
                      }),
                    ),
                  )
                }
              >
                Ver documento original
              </AppButton>
            )}
            {source.cancellation?.can_cancel && (
              <div className="inventory-review">
                <label>
                  Motivo de cancelación
                  <AutoTextarea
                    value={cancelReason}
                    maxLength={500}
                    onChange={(e) => setCancelReason(e.target.value)}
                  />
                </label>
                <AppButton
                  className="danger"
                  disabled={state.busy || cancelReason.trim().length < 5}
                  onClick={() =>
                    state.run(async () => {
                      if (
                        !(await confirmAction(
                          "Se conservará el documento original y se registrarán movimientos inversos. Si hay una venta pagada, su reembolso quedará pendiente de gestionar.",
                          {
                            title: "Revertir documento",
                            confirmText: "Revertir documento",
                            iconKey: "status.warning",
                          },
                        ))
                      )
                        return;
                      await keyedRequest(
                        company,
                        "inventory_command",
                        {
                          movement_id: source.movement.id,
                          reason: cancelReason,
                        },
                        "cancel_document",
                      );
                      setSource(
                        await inventoryRequest(company, "source", {
                          id: source.movement.id,
                        }),
                      );
                      setCancelReason("");
                      await onSaved();
                      setResult(
                        await inventoryRequest(company, "ledger", filters),
                      );
                      setCat(await inventoryRequest(company, "catalog"));
                    })
                  }
                >
                  Cancelar / Revertir documento
                </AppButton>
              </div>
            )}
            {state.error && (
              <p className="error" role="alert">
                {state.error}
              </p>
            )}
          </section>
        </div>
      )}
      {reverse && (
        <InventoryAdjustment
          company={company}
          currency={currency}
          reversal={reverse}
          onClose={() => setReverse("")}
          onSaved={onSaved}
        />
      )}
      {correction && (
        <InventoryAdjustment
          key={company + correction}
          company={company}
          currency={currency}
          correction={correction}
          onClose={() => setCorrection("")}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
