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
export default function Production({
  company,
  formulasOnly = false,
  manager = false,
}: {
  company: string;
  formulasOnly?: boolean;
  manager?: boolean;
}) {
  const state = useOperation(company, "production"),
    [catalog, setCatalog] = useState<Row>({
      products: [],
      materials: [],
      units: [],
      variants: [],
    }),
    [formulas, setFormulas] = useState<Row[]>([]),
    [batches, setBatches] = useState<Row[]>([]),
    [mode, setMode] = useState<
      "formula" | "start" | "finish" | "release" | null
    >(null),
    [selected, setSelected] = useState<Row | null>(null),
    [ingredients, setIngredients] = useState<Row[]>([
      { key: crypto.randomUUID(), material: "" },
    ]),
    [date, setDate] = useState(today());
  async function load() {
    const [c, f, b] = await Promise.all([
      operation(company, "production_catalog"),
      operation(company, "formulas"),
      operation(company, "batches"),
    ]);
    setCatalog(c);
    setFormulas(f);
    setBatches(b);
  }
  useEffect(() => {
    state.run(load);
  }, [company]);
  const formula = formulas.find((f) => f.id === selected?.formula_id);
  return (
    <>
      <section className="intro">
        <div>
          <p className="eyebrow">DE LA RECETA AL PRODUCTO</p>
          <h1>{formulasOnly ? "Fórmulas" : "Producción"}</h1>
          <p>
            {formulasOnly
              ? "Cada fórmula conserva su versión, materiales y rendimiento esperado."
              : "Finaliza con consumos reales y reparte el lote entre variantes. Libera el producto manualmente al terminar el curado."}
          </p>
        </div>
        <div className="actions">
          {state.canWrite && (
            <AppButton
              onClick={() => {
                setSelected(null);
                setIngredients([{ key: crypto.randomUUID(), material: "" }]);
                setDate(today());
                setMode(formulasOnly ? "formula" : "start");
              }}
            >
              {formulasOnly ? "Crear versión de fórmula" : "Iniciar lote"}
            </AppButton>
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
      {state.error && !mode && (
        <p className="error" role="alert">
          <AppIcon name="status.error" />
          {state.error}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      {mode && (
        <div className="overlay">
          <section
            className="modal operations-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Registrar producción"
          >
            <h2>
              {
                {
                  formula: "Nueva versión de fórmula",
                  start: "Iniciar lote",
                  finish: "Finalizar producción",
                  release: "Liberación manual",
                }[mode]
              }
            </h2>
            <>
              {state.error && (
                <p className="error" role="alert">
                  <AppIcon name="status.error" />
                  {state.error}
                </p>
              )}
            </>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                let payload: Row = Object.fromEntries(f);
                let action = "";
                if (mode === "formula") {
                  action = "formula_create";
                  payload = {
                    product: f.get("product"),
                    name: f.get("name"),
                    yield: f.get("yield"),
                    ingredients: ingredients.map((item) => ({
                      material: f.get("material_" + item.key),
                      quantity: f.get("quantity_" + item.key),
                      unit: f.get("unit_" + item.key),
                    })),
                  };
                } else if (mode === "start") action = "batch_start";
                else if (mode === "finish") {
                  action = "batch_finish";
                  payload = {
                    batch: selected!.id,
                    scrap: f.get("scrap"),
                    weight: f.get("weight"),
                    consumptions: formula!.ingredients.map((r: Row) => ({
                      material: r.material_id,
                      unit: r.unit_id,
                      quantity: f.get("consume_" + r.material_id),
                    })),
                    outputs: catalog.variants
                      .filter(
                        (v: Row) =>
                          v.product_id === selected!.product_id &&
                          Number(f.get("output_" + v.id)) > 0,
                      )
                      .map((v: Row) => ({
                        variant: v.id,
                        quantity: f.get("output_" + v.id),
                        weight: f.get("weight_" + v.id),
                      })),
                  };
                } else {
                  action = "batch_release";
                  payload = {
                    batch: selected!.id,
                    reason: f.get("reason"),
                    override: f.get("override") === "on",
                  };
                }
                state.run(async () => {
                  await mutate(company, action, payload);
                  setMode(null);
                  state.setNotice("Operación guardada");
                  await load();
                });
              }}
            >
              {mode === "formula" ? (
                <>
                  <div className="settings-grid">
                    <label>
                      Producto
                      <select name="product" required>
                        <option value="">Seleccionar</option>
                        {catalog.products.map((p: Row) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Nombre de fórmula
                      <input name="name" maxLength={120} required />
                    </label>
                    <label>
                      Rendimiento esperado (unidades)
                      <input
                        name="yield"
                        type="number"
                        min="1"
                        step="1"
                        required
                      />
                    </label>
                  </div>
                  <h3>Materiales para este rendimiento</h3>
                  {ingredients.map((ingredient, i) => {
                    const material = ingredient.material,
                      key = ingredient.key;
                    const base = catalog.units.find(
                      (u: Row) =>
                        u.id ===
                        catalog.materials.find((m: Row) => m.id === material)
                          ?.unit_id,
                    );
                    return (
                      <div className="ingredient-row" key={key}>
                        <label>
                          Material
                          <select
                            name={"material_" + key}
                            required
                            value={material}
                            onChange={(e) =>
                              setIngredients(
                                ingredients.map((s, j) =>
                                  i === j
                                    ? { ...s, material: e.target.value }
                                    : s,
                                ),
                              )
                            }
                          >
                            <option value="">Seleccionar</option>
                            {catalog.materials.map((m: Row) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Cantidad
                          <input
                            type="number"
                            step="any"
                            min="0.00000001"
                            name={"quantity_" + key}
                            required
                          />
                        </label>
                        <label>
                          Unidad
                          <select
                            key={material}
                            name={"unit_" + key}
                            required
                            defaultValue={base?.id || ""}
                          >
                            <option value="">Seleccionar</option>
                            {catalog.units
                              .filter(
                                (u: Row) =>
                                  !base || base.dimension === u.dimension,
                              )
                              .map((u: Row) => (
                                <option key={u.id} value={u.id}>
                                  {u.symbol}
                                </option>
                              ))}
                          </select>
                        </label>
                        {ingredients.length > 1 && (
                          <AppButton
                            type="button"
                            className="secondary"
                            onClick={() =>
                              setIngredients(
                                ingredients.filter((_, j) => i !== j),
                              )
                            }
                          >
                            Quitar
                          </AppButton>
                        )}
                      </div>
                    );
                  })}
                  <AppButton
                    type="button"
                    className="secondary"
                    disabled={ingredients.length >= 100}
                    onClick={() =>
                      setIngredients([
                        ...ingredients,
                        { key: crypto.randomUUID(), material: "" },
                      ])
                    }
                  >
                    Añadir material
                  </AppButton>
                </>
              ) : mode === "start" ? (
                <div className="settings-grid">
                  <label>
                    Fórmula
                    <select name="formula" required>
                      <option value="">Seleccionar</option>
                      {formulas.map((f) => (
                        <option value={f.id} key={f.id}>
                          {f.product_name} · {f.name} · v{f.version}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Unidades previstas
                    <input
                      name="quantity"
                      type="number"
                      min="1"
                      step="1"
                      required
                    />
                  </label>
                  <label>
                    Fecha de producción
                    <input
                      name="date"
                      type="date"
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <label>
                    Disponibilidad estimada
                    <input
                      name="available_on"
                      type="date"
                      required
                      min={date}
                      defaultValue={date}
                    />
                  </label>
                  <label>
                    Notas
                    <textarea name="notes" maxLength={1000} />
                  </label>
                </div>
              ) : mode === "finish" ? (
                <>
                  <h3>Consumo real de materiales</h3>
                  <p>
                    Las cantidades sugeridas provienen de la fórmula y las
                    unidades previstas. Corrige con lo que realmente utilizaste.
                  </p>
                  {formula?.ingredients.map((r: Row) => (
                    <label key={r.material_id}>
                      {r.name} ({r.unit})
                      <input
                        name={"consume_" + r.material_id}
                        type="number"
                        min="0"
                        step="any"
                        required
                        defaultValue={
                          (Number(r.quantity) * selected!.planned_quantity) /
                          formula.standard_yield
                        }
                      />
                    </label>
                  ))}
                  <h3>Variantes obtenidas</h3>
                  <p>
                    Deja en cero las variantes que no produjo este lote. El peso
                    total de cada variante es opcional.
                  </p>
                  {catalog.variants
                    .filter((v: Row) => v.product_id === selected!.product_id)
                    .map((v: Row) => (
                      <div className="ingredient-row" key={v.id}>
                        <label>
                          {v.name}
                          <input
                            name={"output_" + v.id}
                            type="number"
                            min="0"
                            step="1"
                            defaultValue="0"
                          />
                        </label>
                        <label>
                          Peso total de esta variante (g)
                          <input
                            name={"weight_" + v.id}
                            type="number"
                            step="any"
                            min="0.0001"
                          />
                        </label>
                      </div>
                    ))}
                  {!catalog.variants.some(
                    (v: Row) => v.product_id === selected!.product_id,
                  ) && (
                    <p className="error">
                      <AppIcon name="status.error" />
                      Primero crea variantes en Productos.
                    </p>
                  )}
                  <div className="settings-grid">
                    <label>
                      Unidades de merma
                      <input
                        name="scrap"
                        type="number"
                        min="0"
                        step="1"
                        defaultValue="0"
                      />
                    </label>
                    <label>
                      Peso total real del lote (g, opcional)
                      <input
                        name="weight"
                        type="number"
                        min="0.0001"
                        step="any"
                      />
                    </label>
                  </div>
                  <p>
                    El costo se reparte por peso real o por el punto medio del
                    rango. Si faltan pesos o costos de materiales, quedará
                    pendiente.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Confirma que este lote está listo para vender. Fecha
                    estimada: {selected?.available_on}.
                  </p>
                  <label>
                    Nota de liberación
                    <input
                      name="reason"
                      maxLength={500}
                      required
                      minLength={5}
                    />
                  </label>
                  {selected!.available_on > today() && manager && (
                    <label>
                      <input name="override" type="checkbox" required />{" "}
                      Autorizo la liberación anticipada y he registrado el
                      motivo
                    </label>
                  )}
                </>
              )}
              <div className="form-actions">
                <AppButton disabled={state.busy}>
                  {mode === "finish"
                    ? "Finalizar y enviar a curación"
                    : mode === "release"
                      ? "Liberar existencias"
                      : "Guardar"}
                </AppButton>
                <AppButton
                  type="button"
                  className="secondary"
                  disabled={state.busy}
                  onClick={() => setMode(null)}
                >
                  Cancelar
                </AppButton>
              </div>
            </form>
          </section>
        </div>
      )}
      <section className="catalog">
        <div className="table-wrap">
          {formulasOnly ? (
            <table>
              <thead>
                <tr>
                  <th>Producto / fórmula</th>
                  <th>Versión</th>
                  <th>Rendimiento</th>
                  <th>Materiales</th>
                </tr>
              </thead>
              <tbody>
                {formulas.map((f) => (
                  <tr key={f.id}>
                    <td>
                      {f.product_name}
                      <small>{f.name}</small>
                    </td>
                    <td>{f.version}</td>
                    <td>{f.standard_yield} ud</td>
                    <td>
                      {f.ingredients?.map((r: Row) => (
                        <small key={r.material_id}>
                          {r.name}: {r.quantity} {r.unit}
                        </small>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Lote / producto</th>
                  <th>Estado</th>
                  <th>Rendimiento</th>
                  <th>Disponibilidad estimada</th>
                  <th>Costo real</th>
                  <th>Variantes / acciones</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td>
                      {b.id.slice(0, 8)}
                      <small>{b.product_name}</small>
                      <small>{b.production_date}</small>
                    </td>
                    <td>
                      {
                        {
                          in_progress: "En producción",
                          curing: "En curación",
                          released: "Liberado",
                          cancelled: "Cancelado",
                        }[b.state as string]
                      }
                    </td>
                    <td>
                      {b.actual_quantity ?? "—"} / {b.planned_quantity}
                      <small>Merma: {b.scrap_quantity}</small>
                    </td>
                    <td>{b.available_on}</td>
                    <td>
                      {money(b.total_cost, b.currency)}
                      {b.outputs?.map((o: Row) => (
                        <small key={o.id}>
                          {o.variant_name}: {money(o.unit_cost, b.currency)} /
                          ud {o.estimated_cost ? "(estimado por rango)" : ""}
                        </small>
                      ))}
                    </td>
                    <td>
                      {b.outputs?.map((o: Row) => (
                        <small key={o.id}>
                          {o.quantity} × {o.variant_name}
                        </small>
                      ))}
                      {state.canWrite && b.state === "in_progress" && (
                        <AppButton
                          onClick={() => {
                            setSelected(b);
                            setMode("finish");
                          }}
                        >
                          Finalizar
                        </AppButton>
                      )}
                      {state.canWrite && b.state === "curing" && (
                        <AppButton
                          disabled={b.available_on > today() && !manager}
                          onClick={() => {
                            setSelected(b);
                            setMode("release");
                          }}
                        >
                          Liberar lote
                        </AppButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!(formulasOnly ? formulas : batches).length && (
            <p className="empty">
              {formulasOnly
                ? "Crea la primera fórmula para poder iniciar la producción."
                : "No hay lotes de producción."}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
