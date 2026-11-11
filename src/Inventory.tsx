import MoneyInput from "./MoneyInput";
import InventoryAdjustment from "./InventoryAdjustment";
import { CuringProductionTable, curingCount, summarizeCuringProducts, useCuringProduction } from "./CuringProduction";
import { useMaterialTypes, MaterialTypeLabel } from "./MaterialTypesContext";
import { materialTypeName } from "./material-types-model";
import SearchSelect from "./SearchSelect";
import ResponsiveTable from "./ResponsiveTable";
import { SearchField } from "./PoolControls";
import { AppButton, AppIcon } from "./AppIcon";
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
  productionRead = false,
}: {
  company: string;
  purchases?: boolean;
  currency?: string;
  productionRead?: boolean;
}) {
  const types = useMaterialTypes();
  const [paymentCurrency, setPaymentCurrency] = useState(currency);
  const [showCuring, setShowCuring] = useState(false);
  const [curingRevision, setCuringRevision] = useState(0);
  const curing = useCuringProduction(!purchases && productionRead ? company : null, curingRevision);
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
    [form, setForm] = useState<"receive" | "adjust" | "count" | null>(null),
    [material, setMaterial] = useState(""),
    [query, setQuery] = useState("");
  useEffect(() => setPaymentCurrency(currency), [company, currency, form]);
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
    [r.name, r.sku, r.barcode, materialTypeName(r.classification, types)]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const curingBalances = data.balances.filter(
    (row: Row) => row.item_kind === "variant" && Number(row.blocked) > 0,
  );
  const curingProducts = summarizeCuringProducts(curing.error ? [] : curing.batches ?? []).filter(([id, product]) =>
    product.name.toLowerCase().includes(query.toLowerCase()) ||
    data.variants.some((variant: Row) =>
      variant.product_id === id &&
      [variant.name, variant.sku].join(" ").toLowerCase().includes(query.toLowerCase()),
    ),
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
          {!purchases && (
            <AppButton className="secondary" iconKey="status.pending" onClick={() => setShowCuring(true)}>
              Productos en curación
            </AppButton>
          )}
          {state.canWrite && (
            <>
              <AppButton
                onClick={() => {
                  setMaterial("");
                  setForm("receive");
                }}
              >
                Recibir compra
              </AppButton>
              <AppButton
                className="secondary"
                onClick={() => {
                  setForm("adjust");
                }}
              >
                Ajustar existencias
              </AppButton>
              <AppButton className="secondary" onClick={()=>setForm("count")}>Conteo de inventario</AppButton>
            </>
          )}
          <AppButton
            className="secondary"
            disabled={state.busy}
            onClick={() => {
              setCuringRevision((revision) => revision + 1);
              state.run(load);
            }}
          >
            Actualizar
          </AppButton>
        </div>
      </section>
      {state.error && !form && (
        <p className="error" role="alert">
          <AppIcon name="status.error" />
          {state.error}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      {showCuring && (
        <div className="overlay">
          <section className="modal operations-dialog" role="dialog" aria-modal="true" aria-labelledby="curing-title">
            <header>
              <h2 id="curing-title">Productos en curación</h2>
              <AppButton className="secondary" onClick={() => setShowCuring(false)}>Cerrar</AppButton>
            </header>
            {productionRead ? (
              <CuringProductionTable state={curing} />
            ) : state.busy ? (
              <p className="empty" role="status">Consultando existencias…</p>
            ) : state.error ? (
              <p className="error" role="alert">No se pudieron consultar las existencias.</p>
            ) : curingBalances.length ? (
              <div className="table-wrap">
                <ResponsiveTable>
                  <thead><tr><th>Producto / variante</th><th>Unidades en curación</th></tr></thead>
                  <tbody>
                    {curingBalances.map((row: Row) => (
                      <tr key={row.item_id}><td>{row.name}</td><td>{Number(row.blocked)}</td></tr>
                    ))}
                  </tbody>
                </ResponsiveTable>
              </div>
            ) : (
              <p className="empty">No hay existencias en curación.</p>
            )}
          </section>
        </div>
      )}
      {(form === "adjust" || form === "count") && (
        <InventoryAdjustment
          key={company+form}
          company={company}
          currency={currency}
          countMode={form==="count"}
          onClose={() => setForm(null)}
          onSaved={async()=>{await load();if(form==="count")state.setNotice("Conteo registrado. Se ajustaron únicamente las diferencias de los artículos capturados.");}}
        />
      )}
      {form === "receive" && (
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
                <AppIcon name="status.error" />
                {state.error}
              </p>
            )}
            <form
              className="settings-grid"
              onSubmit={(e) => {
                e.preventDefault();
                const values: Row = Object.fromEntries(
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
              {
                <>
                  <label>
                    Material
                    <SearchSelect
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
                    </SearchSelect>
                  </label>
                  <label>
                    Proveedor
                    <SearchSelect name="supplier">
                      <option value="">Sin proveedor</option>
                      {data.suppliers.map((s: Row) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </SearchSelect>
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
                    <SearchSelect
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
                    </SearchSelect>
                  </label>
                  <label>
                    Importe total pagado
                    <MoneyInput
                      currency={paymentCurrency}
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
                      value={paymentCurrency}
                      onChange={(e) =>
                        setPaymentCurrency(e.target.value.toUpperCase())
                      }
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
              }
              <div className="form-actions">
                <AppButton disabled={state.busy}>Guardar movimiento</AppButton>
                <AppButton
                  type="button"
                  className="secondary"
                  disabled={state.busy}
                  onClick={() => setForm(null)}
                >
                  Cancelar
                </AppButton>
              </div>
            </form>
          </section>
        </div>
      )}
      {purchases ? (
        <section className="catalog">
          <h2>Compras recibidas</h2>
          <div className="table-wrap">
            <ResponsiveTable>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Material</th>
                  <th>Cantidad</th>
                  <th>Importe real</th>
                  <th>Referencia</th>
                  <th>Estado</th>
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
                    <td>{r.cancelled_at ? "Cancelada" : "Confirmada"}</td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
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
              <SearchField
                aria-label="Buscar existencias"
                placeholder="Nombre, SKU, código de barras o clasificación"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {productionRead && curing.error && (
              <p className="empty" role="status">No se pudieron consultar las unidades teóricas en curación.</p>
            )}
            <div className="table-wrap">
              <ResponsiveTable>
                <thead>
                  <tr>
                    <th>Artículo</th>
                    <th>Físico</th>
                    <th>En curación (registrado)</th>
                    {productionRead && <th>En curación (teórico)</th>}
                    <th>Reservado</th>
                    <th>Disponible</th>
                    <th>Unidad</th>
                  </tr>
                </thead>
                <tbody>
                  {curingProducts.map(([id, product]) => (
                    <tr key={`curing-${id}`}>
                      <td>{product.name}<small>Estimación por producto</small></td>
                      <td>—</td>
                      <td>—</td>
                      <td data-sort-value={product.known ? product.total : undefined}>
                        {product.known ? curingCount.format(product.total) : "Sin estimación"}
                        {product.known > 0 && product.missing > 0 && <small>Total parcial</small>}
                      </td>
                      <td>—</td>
                      <td>—</td>
                      <td>ud</td>
                    </tr>
                  ))}
                  {balances.map((r: Row) => (
                    <tr key={r.item_kind + r.item_id}>
                      <td>
                        {r.name}
                        <small>
                          {r.sku || "Sin SKU"} ·{" "}
                          {r.classification ? (
                            <MaterialTypeLabel typeKey={r.classification} />
                          ) : (
                            "Producto"
                          )}
                        </small>
                      </td>
                      <td>{Number(r.on_hand)}</td>
                      <td>{Number(r.blocked)}</td>
                      {productionRead && <td>—</td>}
                      <td>{Number(r.reserved)}</td>
                      <td>
                        <strong>{Number(r.available)}</strong>
                      </td>
                      <td>{r.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
              {!balances.length && !curingProducts.length && (
                <p className="empty">
                  No hay existencias para esta búsqueda. Recibe una compra o
                  registra un ajuste inicial.
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
