import { plannedProductionUnits } from "./formula-model";
import SearchSelect from "./SearchSelect";
import MaterialRequirements from "./MaterialRequirements";
import VariantWeightCapture, { type WeighedUnit } from "./VariantWeightCapture";
import { weightMatches } from "./variant-weights";
import { IconDetails } from "./PoolControls";
import { plannedLineQuantity, recipeLineKinds } from "./formula-model";
import ResponsiveTable from "./ResponsiveTable";
import { confirmAction } from "./ConfirmDialog";
import { AppButton, AppIcon } from "./AppIcon";
import Formulas from "./Formulas";
import { request } from "./commerce";
import BatchTrace, { lotCode } from "./BatchTrace";
import { useEffect, useState } from "react";
import {
  keyedRequest,
  operation,
  mutate,
  useOperation,
  today,
  type Row,
} from "./operations";
const ignoreDirty = () => {};
export default function Production(props: {
  company: string;
  formulasOnly?: boolean;
  manager?: boolean;
  onDirty?: (dirty: boolean) => void;
}) {
  return props.formulasOnly ? (
    <Formulas company={props.company} onDirty={ignoreDirty} />
  ) : (
    <ProductionBatches
      company={props.company}
      manager={props.manager}
      onDirty={props.onDirty || ignoreDirty}
    />
  );
}
function ProductionBatches({
  company,
  manager = false,
  onDirty,
}: {
  company: string;
  manager?: boolean;
  onDirty: (dirty: boolean) => void;
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
    [date, setDate] = useState(today()),
    [draftProduct, setDraftProduct] = useState(""),
    [draftFormula, setDraftFormula] = useState(""),
    [traceId, setTraceId] = useState<string | null>(null),
    [dirty, setDirty] = useState(false),
    [draftScale, setDraftScale] = useState("1"),
    [consumed, setConsumed] = useState<Record<string, string>>({}),
    [outputUnits, setOutputUnits] = useState<Record<string, string>>({}),
    [outputWeights, setOutputWeights] = useState<Record<string, string>>({}),
    [weighedUnits, setWeighedUnits] = useState<WeighedUnit[]>([]),
    [pendingUnitWeight, setPendingUnitWeight] = useState(false);
  async function load() {
    const [c, f, b] = await Promise.all([
      operation(company, "production_catalog"),
      request("formula_command", { p_company: company, p_action: "list" }),
      request("production_command", { p_company: company, p_action: "list" }),
    ]);
    setCatalog(c);
    setFormulas(f);
    setBatches(b);
  }
  useEffect(() => {
    state.run(load);
  }, [company]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (pendingUnitWeight) setDirty(true);
  }, [pendingUnitWeight]);
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
  async function close() {
    if (state.busy) return;
    if (
      dirty &&
      !(await confirmAction("Hay cambios sin guardar. ¿Descartarlos?"))
    )
      return;
    setMode(null);
    setDirty(false);
  }
  const formula = formulas.find((f) => f.id === selected?.formula_id);
  const requiresCuring =
    formula?.requires_curing ?? selected?.requires_curing ?? true;
  const estimating = formulas.find(
    (f) => f.id === (mode === "start" ? draftFormula : selected?.formula_id),
  );
  const draftUnits = plannedProductionUnits(
    estimating?.estimated_units,
    draftScale,
  );
  const plannedAvailable = (() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
    const d = new Date(date + "T12:00:00Z");
    d.setUTCDate(
      d.getUTCDate() +
        (estimating?.requires_curing ? Number(estimating.curing_days) || 0 : 0),
    );
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
  })();
  const factor =
    mode === "start"
      ? Number(draftScale)
      : Number(selected?.formula_scale || 1);
  const producedUnits = Object.values(outputUnits).reduce(
    (sum, n) => sum + Number(n || 0),
    0,
  );
  const variableWeight = estimating?.production_mode === "variable_weight";
  const perUnitMaterials = (estimating?.ingredients || []).filter(
    (i: Row) =>
      i.line_kind === "packaging" ||
      (i.line_kind === "auxiliary" && i.quantity_basis === "unit"),
  );
  const realWeight = weighedUnits.reduce((sum, u) => sum + u.weight, 0);
  const neededUnits =
    mode === "start"
      ? Number(draftUnits)
      : producedUnits > 0
        ? producedUnits
        : Number(selected?.planned_quantity || 0);
  const suggested = (r: Row) =>
    plannedLineQuantity(
      r.quantity,
      r.quantity_basis || "recipe",
      factor,
      neededUnits,
    );
  return (
    <>
      <section className="intro">
        <div>
          <p className="eyebrow">DE LA RECETA AL PRODUCTO</p>
          <h1 className="module-title">
            <AppIcon name="module.production" />
            Producción
          </h1>
          <p>
            Finaliza con consumos reales y reparte el lote entre variantes. Sin
            curado, el producto queda disponible al confirmar. Si requiere
            curado, se conserva su fecha de disponibilidad.
          </p>
        </div>
        <div className="actions">
          {state.canWrite && (
            <AppButton
              onClick={() => {
                setSelected(null);
                setDraftScale("1");
                setDate(today());
                setDraftProduct("");
                setDraftFormula("");
                setDirty(false);
                setMode("start");
              }}
            >
              Nuevo lote
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
                  start: "Lote borrador",
                  finish: "Confirmar producción",
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
              data-dirty-managed
              onChange={() => setDirty(true)}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                let payload: Row = Object.fromEntries(f);
                let action = "";
                if (mode === "start") {
                  if (
                    draftUnits == null ||
                    !Number.isInteger(draftUnits) ||
                    draftUnits > 2147483647
                  ) {
                    state.setError(
                      draftUnits == null
                        ? "Selecciona una fórmula con Unidades estimadas y un número válido de lotes a producir."
                        : "La multiplicación debe dar un número entero de unidades. Ajusta los lotes a producir.",
                    );
                    return;
                  }
                  action = "draft_save";
                  payload = {
                    ...payload,
                    id: selected?.id,
                    product: draftProduct,
                    formula: draftFormula,
                    quantity: draftUnits,
                  };
                } else if (mode === "finish") {
                  if (pendingUnitWeight) {
                    state.setError(
                      "Registra la unidad pesada o borra el peso pendiente antes de confirmar.",
                    );
                    return;
                  }
                  const manualMismatch = catalog.variants.some((v: Row) => {
                    const weight = f.get("weight_" + v.id);
                    if (
                      v.product_id !== selected!.product_id ||
                      Number(f.get("output_" + v.id)) !== 1 ||
                      weight == null ||
                      weight === ""
                    )
                      return false;
                    const matches = weightMatches(
                      catalog.variants.filter(
                        (r: Row) => r.product_id === selected!.product_id,
                      ),
                      v.attributes || {},
                      weight,
                    );
                    return matches.length !== 1 || matches[0].id !== v.id;
                  });
                  if (manualMismatch) {
                    state.setError(
                      "Un peso individual no corresponde a la variante seleccionada o no tiene un rango válido. Usa Registrar por peso unitario.",
                    );
                    return;
                  }
                  action = "batch_finish";
                  payload = {
                    batch: selected!.id,
                    expected_revision: formula!.edit_revision,
                    scrap: f.get("scrap"),
                    weight: variableWeight ? realWeight : f.get("weight"),
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
                        ...(weighedUnits.some((u) => u.variant === v.id)
                          ? {
                              unit_weights: weighedUnits
                                .filter((u) => u.variant === v.id)
                                .map((u) => u.weight),
                              unit_materials: weighedUnits
                                .filter((u) => u.variant === v.id)
                                .map((u) => u.materialQuantities || {}),
                            }
                          : {}),
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
                  if (mode === "start")
                    await keyedRequest(
                      company,
                      "production_command",
                      payload,
                      action,
                    );
                  else await mutate(company, action, payload);
                  setMode(null);
                  setDirty(false);
                  state.setNotice("Operación guardada");
                  await load();
                });
              }}
            >
              {mode === "start" ? (
                <div className="settings-grid">
                  <label>
                    Producto
                    <SearchSelect
                      required
                      value={draftProduct}
                      onChange={(e) => {
                        setDraftProduct(e.target.value);
                        setDraftFormula("");
                      }}
                    >
                      <option value="">Seleccionar</option>
                      {catalog.products.map((p: Row) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </SearchSelect>
                  </label>
                  <label>
                    Fórmula
                    <SearchSelect
                      name="formula"
                      required
                      value={draftFormula}
                      onChange={(e) => setDraftFormula(e.target.value)}
                    >
                      <option value="">
                        Elegir una versión antes de preparar
                      </option>
                      {formulas
                        .filter(
                          (f) =>
                            f.state !== "inactive" &&
                            f.product_id === draftProduct,
                        )
                        .map((f) => (
                          <option value={f.id} key={f.id}>
                            {f.product_name} · {f.code} · {f.name} · v
                            {f.version}
                          </option>
                        ))}
                    </SearchSelect>
                  </label>
                  <label>
                    Lotes a producir
                    <input
                      name="formula_scale"
                      type="number"
                      min="0.00000001"
                      step="any"
                      required
                      value={draftScale}
                      onChange={(e) => setDraftScale(e.target.value)}
                    />
                  </label>
                  <label>
                    Unidades previstas · automático
                    <input
                      name="quantity"
                      value={draftUnits ?? ""}
                      readOnly
                      placeholder="Pendiente de fórmula y unidades estimadas"
                      type="number"
                      min="1"
                      step="1"
                      required
                    />
                    <small>
                      {draftUnits == null
                        ? "Define las Unidades estimadas en la fórmula para calcularlas aquí."
                        : !Number.isInteger(draftUnits)
                          ? "El resultado debe ser un número entero de unidades."
                          : `${estimating?.estimated_units} unidades por lote × ${draftScale} lotes a producir`}
                    </small>
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
                      readOnly
                      value={plannedAvailable}
                      aria-label="Disponibilidad calculada según el curado de la fórmula"
                    />
                    <small>
                      {estimating?.requires_curing
                        ? `${estimating.curing_days} días de curado según la fórmula`
                        : "Sin curado: disponible al confirmar la fabricación"}
                    </small>
                  </label>
                  <label>
                    Notas
                    <textarea
                      name="notes"
                      maxLength={1000}
                      defaultValue={selected?.notes || ""}
                    />
                  </label>
                </div>
              ) : mode === "finish" ? (
                <>
                  <h3>Consumo real de materiales</h3>
                  <p>
                    Las cantidades sugeridas provienen de la fórmula y los lotes
                    a producir. Registra el total utilizado, incluyendo derrames
                    o material dañado. No se descontará otra merma adicional.
                  </p>
                  {formula?.ingredients.map((r: Row) => (
                    <label key={r.material_id}>
                      {r.name} ({r.unit})
                      <small>
                        {
                          recipeLineKinds[
                            (r.line_kind ||
                              "ingredient") as keyof typeof recipeLineKinds
                          ]
                        }
                        {r.line_kind === "auxiliary"
                          ? r.quantity_basis === "unit"
                            ? " · por unidad producida"
                            : " · fija por lote"
                          : " · escalado de receta"}
                      </small>
                      {r.reference_notes && (
                        <IconDetails className="formula-line-notes">
                          <summary>Referencia / Observaciones</summary>
                          <p>{r.reference_notes}</p>
                        </IconDetails>
                      )}
                      <input
                        name={"consume_" + r.material_id}
                        onChange={(e) =>
                          setConsumed((old) => ({
                            ...old,
                            [r.material_id]: e.target.value,
                          }))
                        }
                        type="number"
                        min="0"
                        step="any"
                        required
                        value={consumed[r.material_id] ?? suggested(r) ?? ""}
                      />
                    </label>
                  ))}
                  <h3>Variantes obtenidas</h3>
                  <VariantWeightCapture
                    variants={catalog.variants.filter(
                      (v: Row) => v.product_id === selected!.product_id,
                    )}
                    units={weighedUnits}
                    busy={state.busy}
                    onPending={setPendingUnitWeight}
                    showCosts={false}
                    unitMaterials={
                      variableWeight
                        ? perUnitMaterials.map((m: Row) => ({
                            id: m.material_id,
                            name: m.name,
                            unit: m.unit,
                            quantity: consumed[m.material_id] ?? suggested(m),
                          }))
                        : []
                    }
                    onReplace={(units) => {
                      setWeighedUnits(units);
                      const amounts: Record<string, string> = {},
                        weights: Record<string, string> = {};
                      catalog.variants
                        .filter(
                          (v: Row) => v.product_id === selected!.product_id,
                        )
                        .forEach((v: Row) => {
                          const group = units.filter((u) => u.variant === v.id);
                          amounts[v.id] = String(group.length);
                          weights[v.id] = group.length
                            ? String(
                                Math.round(
                                  group.reduce((s, u) => s + u.weight, 0) *
                                    10000,
                                ) / 10000,
                              )
                            : "";
                        });
                      if (!variableWeight)
                        catalog.variants.forEach((v: Row) => {
                          if (
                            v.weight_min == null &&
                            !weighedUnits.some((u) => u.variant === v.id) &&
                            !units.some((u) => u.variant === v.id)
                          ) {
                            delete amounts[v.id];
                            delete weights[v.id];
                          }
                        });
                      setOutputUnits((old) => ({ ...old, ...amounts }));
                      setOutputWeights((old) => ({ ...old, ...weights }));
                      setDirty(true);
                    }}
                  />
                  <p>
                    Las variantes con rango de peso se registran unidad por
                    unidad arriba. Para las demás puedes capturar la cantidad y,
                    opcionalmente, el peso total.
                  </p>
                  {catalog.variants
                    .filter((v: Row) => v.product_id === selected!.product_id)
                    .map((v: Row) => (
                      <div className="ingredient-row" key={v.id}>
                        <label>
                          {variantLabel(v)}
                          <input
                            name={"output_" + v.id}
                            onChange={(e) =>
                              setOutputUnits((old) => ({
                                ...old,
                                [v.id]: e.target.value,
                              }))
                            }
                            type="number"
                            min="0"
                            step="1"
                            value={outputUnits[v.id] || "0"}
                            readOnly={
                              v.weight_min != null ||
                              variableWeight ||
                              weighedUnits.some((u) => u.variant === v.id)
                            }
                          />
                        </label>
                        <label>
                          Peso total de esta variante (g)
                          <input
                            name={"weight_" + v.id}
                            type="number"
                            step="any"
                            min="0.0001"
                            value={outputWeights[v.id] || ""}
                            onChange={(e) =>
                              setOutputWeights((old) => ({
                                ...old,
                                [v.id]: e.target.value,
                              }))
                            }
                            readOnly={
                              v.weight_min != null ||
                              variableWeight ||
                              weighedUnits.some((u) => u.variant === v.id)
                            }
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
                      Unidades dañadas (opcional)
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
                        readOnly={variableWeight}
                        value={variableWeight ? realWeight || "" : undefined}
                        type="number"
                        min="0.0001"
                        step="any"
                      />
                    </label>
                  </div>
                  <p>
                    Solo las unidades buenas ingresan al inventario. Las
                    unidades dañadas son informativas; los materiales se
                    descuentan según el consumo real registrado.
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
              {estimating && mode === "start" && (
                <MaterialRequirements
                  company={company}
                  formula={estimating.id}
                  scale={factor}
                  units={Number(draftUnits)}
                />
              )}
              <div className="form-actions">
                <AppButton disabled={state.busy}>
                  {mode === "finish"
                    ? !requiresCuring
                      ? "Confirmar producción y dejar disponible"
                      : "Confirmar producción y enviar a curado"
                    : mode === "release"
                      ? "Liberar existencias"
                      : "Guardar borrador"}
                </AppButton>
                <AppButton
                  type="button"
                  className="secondary"
                  disabled={state.busy}
                  onClick={close}
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
          <ResponsiveTable>
            <thead>
              <tr>
                <th>Lote / producto</th>
                <th>Estado</th>
                <th>Rendimiento</th>
                <th>Disponibilidad estimada</th>
                <th>Variantes / acciones</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>
                    {lotCode(b.batch_number)}
                    <small>{b.product_name}</small>
                    <small>{b.production_date}</small>
                    <small>
                      {b.formula_code
                        ? `${b.formula_code} · v${b.formula_version}`
                        : "Sin versión seleccionada"}
                    </small>
                  </td>
                  <td>
                    <AppIcon
                      name={
                        b.state === "released"
                          ? "status.success"
                          : b.state === "cancelled"
                            ? "status.archived"
                            : "status.pending"
                      }
                    />
                    {
                      {
                        draft: "Borrador",
                        in_progress: "En preparación",
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
                  <td className="actions">
                    <AppButton
                      className="secondary"
                      onClick={() => setTraceId(b.id)}
                    >
                      Ver lote
                    </AppButton>
                    {state.canWrite && b.state === "draft" && (
                      <>
                        <AppButton
                          className="secondary"
                          disabled={state.busy}
                          onClick={() => {
                            setSelected(b);
                            setDraftScale(String(b.formula_scale || 1));
                            setDate(b.production_date);
                            setDraftProduct(b.product_id);
                            setDraftFormula(b.formula_id || "");
                            setDirty(false);
                            setMode("start");
                          }}
                        >
                          Editar borrador
                        </AppButton>
                        <AppButton
                          disabled={state.busy}
                          onClick={() =>
                            state.run(async () => {
                              await keyedRequest(
                                company,
                                "production_command",
                                { id: b.id },
                                "start",
                              );
                              await load();
                              state.setNotice(
                                "Lote en preparación. Registra los consumos reales antes de confirmar.",
                              );
                            })
                          }
                        >
                          Preparar lote
                        </AppButton>
                      </>
                    )}
                    {b.outputs?.map((o: Row) => (
                      <small key={o.id}>
                        {o.quantity} × {o.variant_name}
                      </small>
                    ))}
                    {state.canWrite && b.state === "in_progress" && (
                      <AppButton
                        onClick={() => {
                          setSelected(b);
                          setConsumed({});
                          setOutputUnits({});
                          setOutputWeights({});
                          setWeighedUnits([]);
                          setPendingUnitWeight(false);
                          setDirty(false);
                          setMode("finish");
                        }}
                      >
                        Confirmar producción
                      </AppButton>
                    )}
                    {state.canWrite && b.state === "curing" && (
                      <AppButton
                        disabled={b.available_on > today() && !manager}
                        onClick={() => {
                          setSelected(b);
                          setDirty(false);
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
          </ResponsiveTable>

          {!batches.length && (
            <p className="empty">No hay lotes de producción.</p>
          )}
        </div>
      </section>
      {traceId && (
        <BatchTrace
          company={company}
          id={traceId}
          showCosts={false}
          onClose={() => setTraceId(null)}
        />
      )}
    </>
  );
}
import { variantLabel } from "./variant-label";
