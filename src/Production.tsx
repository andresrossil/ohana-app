import { AppButton, AppIcon } from "./AppIcon";
import Formulas from "./Formulas";
import { request } from "./commerce";
import { useEffect, useState } from "react";
import {
  operation,
  mutate,
  useOperation,
  money,
  today,
  type Row,
} from "./operations";
const ignoreDirty = () => {};
export default function Production(props: {
  company: string;
  formulasOnly?: boolean;
  manager?: boolean;
}) {
  return props.formulasOnly ? (
    <Formulas company={props.company} onDirty={ignoreDirty} />
  ) : (
    <ProductionBatches company={props.company} manager={props.manager} />
  );
}
function ProductionBatches({
  company,
  manager = false,
}: {
  company: string;
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
    [mode, setMode] = useState<"start" | "finish" | "release" | null>(null),
    [selected, setSelected] = useState<Row | null>(null),
    [date, setDate] = useState(today());
  async function load() {
    const [c, f, b] = await Promise.all([
      operation(company, "production_catalog"),
      request("formula_command", { p_company: company, p_action: "list" }),
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
          <h1>Producción</h1>
          <p>
            Finaliza con consumos reales y reparte el lote entre variantes.
            Libera el producto manualmente al terminar el curado.
          </p>
        </div>
        <div className="actions">
          {state.canWrite && (
            <AppButton
              onClick={() => {
                setSelected(null);
                setDate(today());
                setMode("start");
              }}
            >
              Iniciar lote
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
                if (mode === "start") action = "batch_start";
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
              {mode === "start" ? (
                <div className="settings-grid">
                  <label>
                    Fórmula
                    <select name="formula" required>
                      <option value="">Seleccionar</option>
                      {formulas
                        .filter((f) => f.state !== "inactive")
                        .map((f) => (
                          <option value={f.id} key={f.id}>
                            {f.product_name} · {f.code} · {f.name} · v
                            {f.version}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Factor de escala de fórmula
                    <input
                      name="formula_scale"
                      type="number"
                      min="0.00000001"
                      step="any"
                      required
                      defaultValue="1"
                    />
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
                    Las cantidades sugeridas provienen de la versión y del
                    factor de escala. Corrige con lo que realmente utilizaste.
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
                          Number(r.quantity) *
                          Number(
                            selected!.formula_scale ??
                              (formula.standard_yield
                                ? selected!.planned_quantity /
                                  formula.standard_yield
                                : 1),
                          )
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
                        {o.variant_name}: {money(o.unit_cost, b.currency)} / ud{" "}
                        {o.estimated_cost ? "(estimado por rango)" : ""}
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

          {!batches.length && (
            <p className="empty">No hay lotes de producción.</p>
          )}
        </div>
      </section>
    </>
  );
}
