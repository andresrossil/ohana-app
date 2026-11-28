import InventoryWallToWall from "./InventoryWallToWall";
import PurchaseReceiptEditor from "./PurchaseReceiptEditor";
import PurchasePlanning from "./PurchasePlanning";
import InventoryAdjustment from "./InventoryAdjustment";
import { CuringProductionTable, curingCount, summarizeCuringProducts, useCuringProduction } from "./CuringProduction";
import { useMaterialTypes, MaterialTypeLabel } from "./MaterialTypesContext";
import { materialTypeName } from "./material-types-model";
import ResponsiveTable from "./ResponsiveTable";
import { SearchField } from "./PoolControls";
import { AppButton, AppIcon } from "./AppIcon";
import { useEffect, useState } from "react";
import {
  operation,
  mutate,
  useOperation,
  money,
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
  const [viewReceipt, setViewReceipt] = useState<Row | null>(null);
  const [showPurchasePlan, setShowPurchasePlan] = useState(false);
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
    [form, setForm] = useState<"receive" | "adjust" | "count" | "wall-to-wall" | null>(null),
    [query, setQuery] = useState("");
  async function load() {
    const [d, r] = await Promise.all([
      operation(company, "inventory"),
      purchases ? operation(company, "purchase_documents") : Promise.resolve([]),
    ]);
    setData(d);
    setReceipts(r);
  }
  useEffect(() => {
    state.run(load);
  }, [company, purchases]);
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
          {purchases && <AppButton className="secondary" iconKey={showPurchasePlan ? "action.back" : "action.add"}
            onClick={() => setShowPurchasePlan(value => !value)}>
            {showPurchasePlan ? "Compras recibidas" : "Orden de compra"}
          </AppButton>}
          {!purchases && (
            <AppButton className="secondary" iconKey="status.pending" onClick={() => setShowCuring(true)}>
              Productos en curación
            </AppButton>
          )}
          {state.canWrite && (
            <>
              <AppButton
                onClick={() => {
                  state.setError("");
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
          {!purchases&&<AppButton className="secondary" onClick={()=>setForm("wall-to-wall")}>Levantamientos de inventario</AppButton>}
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
      {form==="wall-to-wall"&&<InventoryWallToWall key={company} company={company}
        onClose={()=>setForm(null)} onPosted={load}/>}
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
        <PurchaseReceiptEditor key={company} data={data} currency={currency} busy={state.busy} error={state.error}
          onClose={() => setForm(null)}
          onSave={values => state.run(async () => {
            await mutate(company, "receive_document", values);
            setForm(null);
            state.setNotice("Compra guardada. Las existencias están actualizadas.");
            await load();
          })}
        />
      )}
      {purchases && viewReceipt && (
        <div className="overlay">
          <section className="modal operations-dialog" role="dialog" aria-modal="true" aria-labelledby="purchase-detail-title">
            <header className="hierarchy-toolbar">
              <h2 id="purchase-detail-title">Compra recibida{viewReceipt.reference ? ` · ${viewReceipt.reference}` : ""}</h2>
              <AppButton className="secondary" onClick={() => setViewReceipt(null)}>Cerrar</AppButton>
            </header>
            <p>{viewReceipt.received_on} · {data.suppliers.find((s: Row) => s.id === viewReceipt.supplier_id)?.name || viewReceipt.supplier_name || "Sin proveedor"}</p>
            <div className="table-wrap"><ResponsiveTable>
              <thead><tr><th>Material</th><th>Cantidad recibida</th><th>Importe</th><th>Estado</th></tr></thead>
              <tbody>{viewReceipt.lines.map((line: Row) => <tr key={line.id}>
                <td>{line.material_name}</td>
                <td>{line.quantity} {data.units.find((u: Row) => u.id === line.unit_id)?.symbol}</td>
                <td>{money(line.amount, line.currency)}</td>
                <td>{line.cancelled_at ? "Cancelada" : "Confirmada"}</td>
              </tr>)}</tbody>
            </ResponsiveTable></div>
            <p><strong>Total registrado {money(viewReceipt.total, viewReceipt.currency)}</strong></p>
          </section>
        </div>
      )}
      {purchases && showPurchasePlan ? (
        <PurchasePlanning key={company} company={company} catalog={data} refresh={curingRevision} />
      ) : purchases ? (
        <section className="catalog">
          <h2>Compras recibidas</h2>
          <div className="table-wrap">
            <ResponsiveTable>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Proveedor</th>
                  <th>Líneas</th>
                  <th>Importe real</th>
                  <th>Referencia</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td>{r.received_on}</td>
                    <td>{data.suppliers.find((s: Row) => s.id === r.supplier_id)?.name || r.supplier_name || "Sin proveedor"}</td>
                    <td>{r.lines.length}</td>
                    <td>{money(r.total, r.currency)}</td>
                    <td>{r.reference || "—"}</td>
                    <td>{r.cancelled_count === r.lines.length ? "Cancelada" : r.cancelled_count > 0 ? "Parcialmente cancelada" : "Confirmada"}</td>
                    <td><AppButton className="secondary" iconKey="action.expand" onClick={() => setViewReceipt(r)}>Ver compra</AppButton></td>
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
