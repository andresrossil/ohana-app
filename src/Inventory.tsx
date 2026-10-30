import { useEffect, useState } from "react";
import {
  operation,
  mutate,
  useOperation,
  money,
  today,
  type Row,
} from "./operations";
export default function Inventory({
  company,
  purchases = false,
  currency = "GTQ",
}: {
  company: string;
  purchases?: boolean;
  currency?: string;
}) {
  const state = useOperation(company, "inventory"),
    [data, setData] = useState<Row>({
      balances: [],
      materials: [],
      variants: [],
      units: [],
      suppliers: [],
      movements: [],
    }),
    [receipts, setReceipts] = useState<Row[]>([]),
    [form, setForm] = useState<"receive" | "adjust" | null>(null),
    [material, setMaterial] = useState(""),
    [kind, setKind] = useState("material"),
    [query, setQuery] = useState("");
  async function load() {
    const [d, r] = await Promise.all([
      operation(company, "inventory"),
      operation(company, "receipts"),
    ]);
    setData(d);
    setReceipts(r);
  }
  useEffect(() => {
    state.run(load);
  }, [company]);
  const baseUnit = data.units.find(
    (u: Row) =>
      u.id === data.materials.find((m: Row) => m.id === material)?.unit_id,
  );
  const balances = data.balances.filter((r: Row) =>
    [r.name, r.sku, r.barcode, r.classification]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <section className="intro">
        <div>
          <p className="eyebrow">EXISTENCIAS REALES</p>
          <h1>{purchases ? "Compras" : "Inventario"}</h1>
          <p>
            {purchases
              ? "Registrar una compra recibida agrega existencias. Una cotización no mueve inventario."
              : "Disponible = físico − curación − reservado. Los movimientos conservan su origen y costo."}
          </p>
        </div>
        <div className="actions">
          {state.canWrite && (
            <>
              <button
                onClick={() => {
                  setMaterial("");
                  setForm("receive");
                }}
              >
                Recibir compra
              </button>
              <button className="secondary" onClick={() => setForm("adjust")}>
                Ajustar existencias
              </button>
            </>
          )}
          <button
            className="secondary"
            disabled={state.busy}
            onClick={() => state.run(load)}
          >
            Actualizar
          </button>
        </div>
      </section>
      {state.error && !form && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      {form && (
        <div className="overlay">
          <section
            className="modal operations-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={
              form === "receive" ? "Recibir compra" : "Ajustar existencias"
            }
          >
            <h2>
              {form === "receive" ? "Compra recibida" : "Ajuste de existencias"}
            </h2>
            {state.error && (
              <p className="error" role="alert">
                {state.error}
              </p>
            )}
            <form
              className="settings-grid"
              onSubmit={(e) => {
                e.preventDefault();
                const values = Object.fromEntries(
                  new FormData(e.currentTarget),
                );
                state.run(async () => {
                  await mutate(company, form, values);
                  setForm(null);
                  state.setNotice(
                    "Movimiento guardado. Las existencias están actualizadas.",
                  );
                  await load();
                });
              }}
            >
              {form === "receive" ? (
                <>
                  <label>
                    Material
                    <select
                      name="material"
                      required
                      value={material}
                      onChange={(e) => setMaterial(e.target.value)}
                    >
                      <option value="">Seleccionar</option>
                      {data.materials.map((m: Row) => (
                        <option key={m.id} value={m.id}>
                          {m.sku ? m.sku + " · " : ""}
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Proveedor
                    <select name="supplier">
                      <option value="">Sin proveedor</option>
                      {data.suppliers.map((s: Row) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Cantidad recibida
                    <input
                      name="quantity"
                      type="number"
                      min="0.00000001"
                      step="any"
                      required
                    />
                  </label>
                  <label>
                    Unidad
                    <select
                      name="unit"
                      key={material}
                      defaultValue={baseUnit?.id || ""}
                      required
                    >
                      <option value="">Seleccionar</option>
                      {data.units
                        .filter(
                          (u: Row) =>
                            !baseUnit || u.dimension === baseUnit.dimension,
                        )
                        .map((u: Row) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.symbol})
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Importe total pagado
                    <input
                      name="amount"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                    />
                  </label>
                  <label>
                    Moneda
                    <input
                      name="currency"
                      required
                      pattern="[A-Z]{3}"
                      maxLength={3}
                      defaultValue={currency}
                    />
                  </label>
                  <label>
                    Tipo de cambio hacia {currency}
                    <input
                      name="exchange_rate"
                      type="number"
                      min="0.00000001"
                      step="any"
                      placeholder="Obligatorio si la compra usa otra moneda"
                    />
                  </label>
                  <label>
                    Fecha de recepción
                    <input
                      name="date"
                      type="date"
                      defaultValue={today()}
                      max={today()}
                      required
                    />
                  </label>
                  <label>
                    Factura o referencia
                    <input name="reference" maxLength={250} />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Tipo
                    <select
                      name="kind"
                      value={kind}
                      onChange={(e) => setKind(e.target.value)}
                    >
                      <option value="material">Material</option>
                      <option value="variant">Variante de producto</option>
                    </select>
                  </label>
                  <label>
                    Artículo
                    <select name="item" required key={kind}>
                      <option value="">Seleccionar</option>
                      {data[kind === "material" ? "materials" : "variants"].map(
                        (r: Row) => (
                          <option key={r.id} value={r.id}>
                            {r.sku ? `${r.sku} · ` : ""}
                            {r.name}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    Cantidad que se agrega o retira
                    <input
                      type="number"
                      name="quantity"
                      step={kind === "variant" ? "1" : "any"}
                      required
                    />
                    <small>
                      Utiliza un número negativo para retirar. Materiales:
                      unidad base; variantes: unidades.
                    </small>
                  </label>
                  <label>
                    Costo por unidad base ({currency}, opcional)
                    <input name="unit_cost" type="number" min="0" step="any" />
                    <small>
                      Solo aplica a entradas. Si no se conoce, el costo queda
                      pendiente.
                    </small>
                  </label>
                  <label>
                    Motivo
                    <input
                      name="reason"
                      minLength={3}
                      maxLength={500}
                      required
                    />
                  </label>
                </>
              )}
              <div className="form-actions">
                <button disabled={state.busy}>Guardar movimiento</button>
                <button
                  type="button"
                  className="secondary"
                  disabled={state.busy}
                  onClick={() => setForm(null)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {purchases ? (
        <section className="catalog">
          <h2>Compras recibidas</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Material</th>
                  <th>Cantidad</th>
                  <th>Importe real</th>
                  <th>Referencia</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td>{r.received_on}</td>
                    <td>{r.material_name}</td>
                    <td>
                      {r.quantity}{" "}
                      {data.units.find((u: Row) => u.id === r.unit_id)?.symbol}
                    </td>
                    <td>{money(r.amount, r.currency)}</td>
                    <td>{r.reference || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!receipts.length && (
              <p className="empty">No hay compras recibidas.</p>
            )}
          </div>
        </section>
      ) : (
        <>
          <section className="catalog">
            <div className="toolbar">
              <h2>Existencias</h2>
              <input
                aria-label="Buscar existencias"
                placeholder="Nombre, SKU, código de barras o clasificación"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Artículo</th>
                    <th>Físico</th>
                    <th>En curación</th>
                    <th>Reservado</th>
                    <th>Disponible</th>
                    <th>Unidad</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((r: Row) => (
                    <tr key={r.item_kind + r.item_id}>
                      <td>
                        {r.name}
                        <small>
                          {r.sku || "Sin SKU"} ·{" "}
                          {r.classification || "Producto"}
                        </small>
                      </td>
                      <td>{Number(r.on_hand)}</td>
                      <td>{Number(r.blocked)}</td>
                      <td>{Number(r.reserved)}</td>
                      <td>
                        <strong>{Number(r.available)}</strong>
                      </td>
                      <td>{r.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!balances.length && (
                <p className="empty">
                  No hay existencias para esta búsqueda. Recibe una compra o
                  registra un ajuste inicial.
                </p>
              )}
            </div>
          </section>
          <section className="catalog">
            <h2>Últimos movimientos</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Artículo</th>
                    <th>Cantidad</th>
                    <th>Origen</th>
                    <th>Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {data.movements.map((r: Row) => (
                    <tr key={r.id}>
                      <td>{new Date(r.created_at).toLocaleString("es-GT")}</td>
                      <td>
                        {data.balances.find((b: Row) => b.item_id === r.item_id)
                          ?.name || r.item_id}
                      </td>
                      <td>{Number(r.quantity)}</td>
                      <td>
                        {{
                          receipt: "Compra",
                          adjustment: "Ajuste",
                          production_consumption: "Consumo",
                          production_output: "Producción",
                          release: "Liberación",
                          order_reservation: "Reserva",
                          order_dispatch: "Venta",
                          order_cancel: "Cancelación",
                        }[r.source_kind as string] || r.source_kind}
                      </td>
                      <td>{r.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
