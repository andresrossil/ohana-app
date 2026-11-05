import MoneyInput from "./MoneyInput";
import { useMaterialTypes, MaterialTypeLabel } from "./MaterialTypesContext";
import { materialTypeName } from "./material-types-model";
import SearchSelect from "./SearchSelect";
import ResponsiveTable from "./ResponsiveTable";
import PhysicalUnits, { MovementUnits } from "./PhysicalUnits";
import { request } from "./commerce";
import AutoTextarea from "./AutoTextarea";
import { parseNumber } from "./sheet-model";
import { weightMatches } from "./variant-weights";
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
}: {
  company: string;
  purchases?: boolean;
  currency?: string;
}) {
  const types = useMaterialTypes();
  const [paymentCurrency, setPaymentCurrency] = useState(currency);
  const state = useOperation(company, "inventory"),
    [data, setData] = useState<Row>({
      balances: [],
      materials: [],
      variants: [],
      units: [],
      suppliers: [],
      movements: [],
    }),
    [physical, setPhysical] = useState<Row>({ units: [], history: [] }),
    [receipts, setReceipts] = useState<Row[]>([]),
    [form, setForm] = useState<"receive" | "adjust" | null>(null),
    [material, setMaterial] = useState(""),
    [kind, setKind] = useState("material"),
    [query, setQuery] = useState(""),
    [adjustItem, setAdjustItem] = useState(""),
    [adjustQuantity, setAdjustQuantity] = useState(""),
    [adjustWeights, setAdjustWeights] = useState("");
  useEffect(() => setPaymentCurrency(currency), [company, currency, form]);
  async function load() {
    const [d, r, p] = await Promise.all([
      operation(company, "inventory"),
      operation(company, "receipts"),
      request("physical_unit_catalog", { p_company: company }),
    ]);
    setData(d);
    setReceipts(r);
    setPhysical(p);
  }
  useEffect(() => {
    state.run(load);
  }, [company]);
  const baseUnit = data.units.find(
    (u: Row) =>
      u.id === data.materials.find((m: Row) => m.id === material)?.unit_id,
  );
  const selectedVariant =
    kind === "variant"
      ? data.variants.find((v: Row) => v.id === adjustItem)
      : null;
  const weightValues = adjustWeights.trim()
    ? adjustWeights.trim().split(/[\n;]/).filter(Boolean).map(parseNumber)
    : [];
  const weightPreviews = weightValues.map((weight: number | null) => ({
    weight,
    matches: weightMatches(
      data.variants.filter(
        (v: Row) => v.product_id === selectedVariant?.product_id,
      ),
      selectedVariant?.attributes || {},
      weight,
    ),
  }));
  const unitById = new Map<string, Row>(
    physical.units.map((u: Row) => [u.id, u]),
  );
  const movementNames = new Map<string, string>(
    physical.history.map((h: Row) => [
      h.movement_id,
      unitById.get(h.unit_id)?.variant_snapshot?.name,
    ]),
  );
  const balances = data.balances.filter((r: Row) =>
    [r.name, r.sku, r.barcode, materialTypeName(r.classification, types)]
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
                  setAdjustItem("");
                  setAdjustQuantity("");
                  setAdjustWeights("");
                  setForm("adjust");
                }}
              >
                Ajustar existencias
              </AppButton>
            </>
          )}
          <AppButton
            className="secondary"
            disabled={state.busy}
            onClick={() => state.run(load)}
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
                if (
                  form === "adjust" &&
                  selectedVariant?.weight_min != null &&
                  adjustWeights.trim()
                ) {
                  if (
                    !weightPreviews.length ||
                    weightPreviews.some((p) => p.matches.length !== 1)
                  ) {
                    state.setError(
                      "Hay pesos sin rango válido o ambiguos. Revisa cada unidad antes de guardar.",
                    );
                    return;
                  }
                  values.quantity = weightValues.length;
                  values.unit_weights = weightValues;
                }
                if (
                  form === "adjust" &&
                  selectedVariant?.weight_min != null &&
                  Number(values.quantity) > 0 &&
                  !adjustWeights.trim()
                ) {
                  state.setError(
                    "Registra un peso real por cada unidad que agregas.",
                  );
                  return;
                }
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
              ) : (
                <>
                  <label>
                    Tipo
                    <SearchSelect
                      name="kind"
                      value={kind}
                      onChange={(e) => {
                        setKind(e.target.value);
                        setAdjustItem("");
                        setAdjustWeights("");
                        setAdjustQuantity("");
                      }}
                    >
                      <option value="material">Material</option>
                      <option value="variant">Variante de producto</option>
                    </SearchSelect>
                  </label>
                  <label>
                    Artículo
                    <SearchSelect
                      name="item"
                      required
                      key={kind}
                      value={adjustItem}
                      onChange={(e) => {
                        setAdjustItem(e.target.value);
                        setAdjustWeights("");
                      }}
                    >
                      <option value="">Seleccionar</option>
                      {data[kind === "material" ? "materials" : "variants"].map(
                        (r: Row) => (
                          <option key={r.id} value={r.id}>
                            {r.sku ? `${r.sku} · ` : ""}
                            {r.name}
                          </option>
                        ),
                      )}
                    </SearchSelect>
                  </label>
                  <label>
                    Cantidad que se agrega o retira
                    <input
                      type="number"
                      name="quantity"
                      step={kind === "variant" ? "1" : "any"}
                      value={
                        adjustWeights.trim()
                          ? String(weightValues.length)
                          : adjustQuantity
                      }
                      readOnly={!!adjustWeights.trim()}
                      onChange={(e) => setAdjustQuantity(e.target.value)}
                      required
                    />
                    <small>
                      Utiliza un número negativo para retirar. Materiales:
                      unidad base; variantes: unidades.
                    </small>
                  </label>
                  {selectedVariant?.weight_min != null && (
                    <label className="form-wide">
                      Pesos individuales de entrada (g)
                      <AutoTextarea
                        value={adjustWeights}
                        onChange={(e) => setAdjustWeights(e.target.value)}
                        placeholder={"89.99\n90.00"}
                      />
                      <small>
                        Un peso por línea, hasta cuatro decimales. Se asigna la
                        variante automáticamente dentro del producto y atributos
                        seleccionados. Para retirar, deja los pesos vacíos y usa
                        cantidad negativa.
                      </small>
                      {weightPreviews.length > 0 && (
                        <ul>
                          {weightPreviews.map((p, i) => (
                            <li
                              key={i}
                              className={
                                p.matches.length === 1 ? "" : "sheet-warning"
                              }
                            >
                              {p.weight ?? "Peso inválido"} g ·{" "}
                              {p.matches.length === 1
                                ? p.matches[0].name
                                : "Sin rango válido o ambiguo"}
                            </li>
                          ))}
                        </ul>
                      )}
                    </label>
                  )}
                  <label>
                    Costo por unidad base ({currency}, opcional)
                    <MoneyInput
                      currency={currency}
                      name="unit_cost"
                      type="number"
                      min="0"
                      step="any"
                    />
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
            <div className="table-wrap">
              <ResponsiveTable>
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
                          {r.classification ? (
                            <MaterialTypeLabel typeKey={r.classification} />
                          ) : (
                            "Producto"
                          )}
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
              </ResponsiveTable>
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
              <ResponsiveTable>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Artículo</th>
                    <th>Cantidad</th>
                    <th>Origen</th>
                    <th>Nota</th>
                    <th>Unidades físicas</th>
                  </tr>
                </thead>
                <tbody>
                  {data.movements.map((r: Row) => (
                    <tr key={r.id}>
                      <td>{new Date(r.created_at).toLocaleString("es-GT")}</td>
                      <td>
                        {movementNames.get(r.id) ||
                          data.balances.find(
                            (b: Row) => b.item_id === r.item_id,
                          )?.name ||
                          r.item_id}
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
                      <td>
                        <MovementUnits
                          movement={r.id}
                          units={physical.units}
                          history={physical.history}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
          </section>
          <PhysicalUnits
            units={physical.units}
            query={query}
            history={physical.history}
          />
        </>
      )}
    </>
  );
}
