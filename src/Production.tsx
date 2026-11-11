import { plannedProductionUnits } from "./formula-model";
import SearchSelect from "./SearchSelect";
import MaterialRequirements from "./MaterialRequirements";
import { IconDetails } from "./PoolControls";
import { plannedLineQuantity, recipeLineKinds } from "./formula-model";
import ResponsiveTable from "./ResponsiveTable";
import { confirmAction } from "./ConfirmDialog";
import { AppButton, AppIcon } from "./AppIcon";
import Formulas from "./Formulas";
import { request } from "./commerce";
import AutoTextarea from "./AutoTextarea";
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
  const [cancelId, setCancelId] = useState(""),
    [cancelReason, setCancelReason] = useState("");
  const state = useOperation(company, "production"),
    [catalog, setCatalog] = useState<Row>({
      products: [],
      materials: [],
      units: [],
      variants: [],
    }),
    [formulas, setFormulas] = useState<Row[]>([]),
    [batches, setBatches] = useState<Row[]>([]),
    [mode, setMode] = useState<"start" | "finish" | "release" | "curing_edit" | null>(null),
    [selected, setSelected] = useState<Row | null>(null),
    [date, setDate] = useState(today()),
    [openingStock, setOpeningStock] = useState(false),
    [availableOverride, setAvailableOverride] = useState(""),
    [draftProduct, setDraftProduct] = useState(""),
    [draftFormula, setDraftFormula] = useState(""),
    [traceId, setTraceId] = useState<string | null>(null),
    [dirty, setDirty] = useState(false),
    [draftScale, setDraftScale] = useState("1"),
    [quantityMode, setQuantityMode] = useState("preparations"),
    [targetUnits, setTargetUnits] = useState(""),
    [consumed, setConsumed] = useState<Record<string, string>>({}),
    [outputUnits, setOutputUnits] = useState<Record<string, string>>({});
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
    !selected?.opening_stock &&
    (selected?.available_on_override
      ? selected.available_on > today()
      : formula?.requires_curing ?? selected?.requires_curing ?? true);
  const estimating = formulas.find(
    (f) => f.id === (mode === "start" ? draftFormula : selected?.formula_id),
  );
  const effectiveScale =
    quantityMode === "units"
      ? Number(estimating?.estimated_units) > 0 && Number(targetUnits) > 0
        ? Number(targetUnits) / Number(estimating?.estimated_units)
        : null
      : Number(draftScale);
  const draftUnits =
    quantityMode === "units"
      ? Number(targetUnits) > 0 && effectiveScale != null
        ? Number(targetUnits)
        : null
      : plannedProductionUnits(estimating?.estimated_units, draftScale);
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
      ? Number(effectiveScale)
      : Number(selected?.formula_scale || 1);
  const producedUnits = Object.values(outputUnits).reduce(
    (sum, n) => sum + Number(n || 0),
    0,
  );
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
            Finaliza con consumos reales y registra las unidades por variante.
            Sin curado, el producto queda disponible al confirmar. Si requiere
            curado, se conserva su fecha de disponibilidad.
          </p>
        </div>
        <div className="actions">
          {state.canWrite && (
            <AppButton
              onClick={() => {
                setSelected(null);
                setDraftScale("1");
                setQuantityMode("preparations");
                setTargetUnits("");
                setDate(today());
                setOpeningStock(false);
                setAvailableOverride("");
                setDraftProduct("");
                setDraftFormula("");
                setDirty(false);
                setMode("start");
              }}
            >
              Nueva producción
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
                  start: "Producción en preparación",
                  finish: "Confirmar producción",
                  release: "Liberación manual",
                  curing_edit: "Editar lote en curación",
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
                    !openingStock && (draftUnits == null ||
                    !Number.isInteger(draftUnits) ||
                    draftUnits > 2147483647)
                  ) {
                    state.setError(
                      draftUnits == null
                        ? "Selecciona una fórmula con Unidades estimadas y un número válido de preparaciones."
                        : "La multiplicación debe dar un número entero de unidades. Ajusta las preparaciones a realizar.",
                    );
                    return;
                  }
                  action = openingStock ? "opening_save" : "draft_save";
                  payload = {
                    ...payload,
                    id: selected?.id,
                    product: draftProduct,
                    formula: draftFormula,
                    formula_scale: openingStock ? 1 : effectiveScale,
                    available_on_override: availableOverride,
                    quantity: draftUnits,
                  };
                } else if (mode === "finish") {
                  action = "batch_finish";
                  payload = {
                    batch: selected!.id,
                    expected_revision: formula!.edit_revision,
                    scrap: Number(f.get("scrap") || 0),
                    capture_mode: selected!.opening_stock ? "weights" : "variant_units",
                    consumptions: (selected!.opening_stock ? [] : formula!.ingredients).map((r: Row) => ({
                      material: r.material_id,
                      unit: r.unit_id,
                      quantity: f.get("consume_" + r.material_id),
                    })),
                    outputs: catalog.variants
                      .filter(
                        (v: Row) =>
                          v.product_id === selected!.product_id &&
                          (Number(f.get("output_" + v.id)) > 0 || String(f.get("weights_" + v.id) || "").trim()),
                      )
                      .map((v: Row) => {
                        const weights = String(f.get("weights_" + v.id) || "")
                          .trim().split(/\s+/).filter(Boolean).map((weight) => Number(weight.replace(",", ".")));
                        return weights.length
                          ? { variant: v.id, quantity: weights.length, unit_weights: weights,
                              weight: weights.reduce((sum, weight) => sum + Math.round(weight * 10000), 0) / 10000 }
                          : { variant: v.id, quantity: f.get("output_" + v.id) };
                      }),
                  };
                  if (selected!.opening_stock && payload.outputs.some((output: Row) =>
                    output.unit_weights?.some((weight: number) => !Number.isFinite(weight) || weight <= 0 || Math.abs(weight * 10000 - Math.round(weight * 10000)) > 0.000001))) {
                    state.setError("Indica pesos positivos en gramos, con hasta cuatro decimales.");
                    return;
                  }
                  if (selected!.opening_stock && payload.outputs.every((output: Row) => output.unit_weights?.length)) {
                    payload.weight = payload.outputs.reduce((sum: number, output: Row) => sum + Math.round(output.weight * 10000), 0) / 10000;
                  }
                } else if (mode === "curing_edit") {
                  action = "curing_edit";
                  payload = {
                    ...payload,
                    id: selected!.id,
                    previous_production_date: selected!.production_date,
                    previous_available_on: selected!.available_on,
                    previous_notes: selected!.notes,
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
                  if ((mode === "start" && !openingStock) || (mode === "finish" && !selected?.opening_stock)) {
                    const stock = await request("production_command", {
                      p_company: company,
                      p_action: "stock_review",
                      p_data: {
                        ...payload,
                        stage: mode === "start" ? "draft" : "confirm",
                      },
                    });
                    if (stock.shortages.length) {
                      const n = (v: any) =>
                        Number(v).toLocaleString("es-GT", {
                          maximumFractionDigits: 8,
                        });
                      const message = stock.shortages
                        .map(
                          (r: Row) =>
                            `• ${r.sku || "Sin SKU"} · ${r.name}\nNecesario: ${n(r.required)} ${r.unit} · Disponible: ${n(r.available)} ${r.unit} · Faltante: ${n(r.shortage)} ${r.unit}`,
                        )
                        .join("\n\n");
                      const proceed = await confirmAction(
                        message +
                          "\n\n" +
                          (mode === "start"
                            ? "Puedes guardar el borrador sin mover inventario. Se volverá a revisar al confirmar la producción."
                            : "Si continúas, se descontará el consumo real y podrán quedar existencias negativas de estos materiales."),
                        {
                          title: "Materiales insuficientes",
                          iconKey: "status.warning",
                          confirmText:
                            mode === "start"
                              ? "Guardar borrador"
                              : "Continuar con negativos",
                          cancelText: "Volver a revisar",
                        },
                      );
                      if (!proceed) return;
                    }
                    payload = {
                      ...payload,
                      acknowledge_shortages: stock.shortages.length > 0,
                      stock_proof: stock.proof,
                    };
                  }
                  if (mode === "start" || mode === "curing_edit")
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
                  {!selected && <label className="form-wide">
                    <span><input type="checkbox" checked={openingStock} onChange={(e) => setOpeningStock(e.target.checked)} /> Lote de saldo inicial</span>
                    <small>Registra un lote ya fabricado en curación. Las variantes y pesos se capturan al terminar el curado.</small>
                  </label>}
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
                  {!openingStock && <><label>
                    Planificar por
                    <SearchSelect
                      value={quantityMode}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next === "units")
                          setTargetUnits(
                            draftUnits == null ? "" : String(draftUnits),
                          );
                        else if (effectiveScale != null)
                          setDraftScale(String(effectiveScale));
                        setQuantityMode(next);
                      }}
                    >
                      <option value="preparations">
                        Preparaciones de la fórmula
                      </option>
                      <option value="units">Unidades a producir</option>
                    </SearchSelect>
                  </label>
                  <label>
                    {quantityMode === "units"
                      ? "Unidades a producir"
                      : "Preparaciones a realizar"}
                    <input
                      type="number"
                      min={quantityMode === "units" ? "1" : "0.00000001"}
                      step={quantityMode === "units" ? "1" : "any"}
                      required
                      value={
                        quantityMode === "units" ? targetUnits : draftScale
                      }
                      onChange={(e) =>
                        quantityMode === "units"
                          ? setTargetUnits(e.target.value)
                          : setDraftScale(e.target.value)
                      }
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
                          : quantityMode === "units"
                            ? `${draftUnits} unidades de una fórmula de ${estimating?.estimated_units}. Los materiales se ajustan proporcionalmente.`
                            : `${estimating?.estimated_units} unidades por preparación × ${draftScale} preparaciones`}
                    </small>
                  </label>
                  </>}
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
                      name="available_on_override"
                      type="date"
                      required
                      min={date}
                      value={availableOverride || plannedAvailable}
                      onChange={(e) => setAvailableOverride(e.target.value)}
                    />
                    {availableOverride && <AppButton type="button" className="secondary" onClick={() => { setAvailableOverride(""); setDirty(true); }}>Usar fecha sugerida</AppButton>}
                  </label>
                  {estimating && (
                    <p className="production-curing-notice" role="status">
                      {availableOverride ? "Fecha de disponibilidad manual" : estimating.requires_curing
                        ? `${estimating.curing_days} días de curado según la fórmula`
                        : "Sin curado: disponible al confirmar la fabricación"}
                    </p>
                  )}
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
                  {!selected?.opening_stock && <><h3>Consumo real de materiales</h3>
                  <p>
                    Las cantidades sugeridas provienen de la fórmula y las
                    preparaciones a producir. Registra el total utilizado,
                    incluyendo derrames o material dañado. No se descontará otra
                    merma adicional.
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
                            : " · fija por preparación"
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
                  ))}</>}
                  <h3>Variantes obtenidas</h3>
                  <div className="actions">
                    <AppButton
                      type="button"
                      className="secondary"
                      disabled={state.busy}
                      onClick={() =>
                        state.run(async () =>
                          setCatalog(
                            await operation(company, "production_catalog"),
                          ),
                        )
                      }
                    >
                      Actualizar variantes
                    </AppButton>
                  </div>
                  <p>
                    Indica las unidades buenas obtenidas de cada variante. Si
                    falta alguna, agrégala en Productos y actualiza esta lista
                    antes de confirmar.
                  </p>
                  <div className="table-wrap">
                    <ResponsiveTable>
                      <thead>
                        <tr>
                          <th>Variante</th>
                          <th>{selected?.opening_stock ? "Pesos en gramos / unidades" : "Unidades obtenidas"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {catalog.variants
                          .filter(
                            (v: Row) => v.product_id === selected!.product_id,
                          )
                          .map((v: Row) => (
                            <tr key={v.id}>
                              <td>{variantLabel(v)}</td>
                              <td>
                                {selected?.opening_stock && v.weight_min != null ? (
                                  <AutoTextarea
                                    aria-label={"Pesos en gramos de " + variantLabel(v)}
                                    name={"weights_" + v.id}
                                    placeholder="Un peso en gramos por unidad"
                                  />
                                ) : (
                                <input
                                  aria-label={"Unidades de " + variantLabel(v)}
                                  name={"output_" + v.id}
                                  type="number"
                                  min="0"
                                  max="10000"
                                  step="1"
                                  placeholder="0"
                                  value={outputUnits[v.id] ?? ""}
                                  onChange={(e) =>
                                    setOutputUnits((old) => ({
                                      ...old,
                                      [v.id]: e.target.value,
                                    }))
                                  }
                                />
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </ResponsiveTable>
                  </div>
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
                  </div>
                  <p>
                    Solo las unidades buenas ingresan al inventario. Las
                    unidades dañadas son informativas. {selected?.opening_stock ? "Este lote de saldo inicial no registra consumo de materias primas." : "Los materiales se descuentan según el consumo real registrado."}
                  </p>
                </>
              ) : mode === "curing_edit" ? (
                <div className="settings-grid">
                  <p className="form-wide">{lotCode(selected!.batch_number)} · {selected!.product_name}</p>
                  <label>
                    Fecha de producción
                    <input name="production_date" type="date" required max={today()}
                      readOnly={selected!.confirmed || !selected!.opening_stock}
                      value={date} onChange={(e) => setDate(e.target.value)} />
                  </label>
                  <label>
                    Fecha de disponibilidad
                    <input name="available_on" type="date" required min={date} defaultValue={selected!.available_on} />
                  </label>
                  <label className="form-wide">
                    Notas
                    <AutoTextarea name="notes" maxLength={1000} defaultValue={selected!.notes ?? ""} />
                  </label>
                </div>
              ) : (
                <>
                  <p>
                    Confirma que esta producción está listo para vender. Fecha
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
              {estimating && mode === "start" && !openingStock && (
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
                      : mode === "curing_edit"
                        ? "Guardar cambios"
                        : openingStock ? "Registrar lote en curación" : "Guardar borrador"}
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
                <th>Documento / producto</th>
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
                      b.finalized_at ? "Terminado" : {
                        draft: "Borrador",
                        in_progress: "En preparación",
                        curing: "En curación",
                        released: "Liberado",
                        cancelled: "Cancelado",
                      }[b.state as string]
                    }
                  </td>
                  <td>
                    {b.actual_quantity ?? "—"} / {b.planned_quantity ?? "—"}
                    {b.opening_stock && <small>Saldo inicial{!b.confirmed ? " · Pesaje pendiente" : ""}</small>}
                    <small>Merma: {b.scrap_quantity}</small>
                  </td>
                  <td>{b.available_on}</td>
                  <td className="actions">
                    <AppButton
                      className="secondary"
                      onClick={() => setTraceId(b.id)}
                    >
                      Ver documento
                    </AppButton>
                    {state.canWrite && b.state !== "cancelled" && !b.finalized_at && (
                      <AppButton
                        className="danger"
                        disabled={state.busy}
                        onClick={() => {
                          setCancelId(b.id);
                          setCancelReason("");
                        }}
                      >
                        Cancelar documento
                      </AppButton>
                    )}
                    {state.canWrite && b.state === "released" && !b.finalized_at && (
                      <AppButton iconKey="status.success" disabled={state.busy} onClick={async () => {
                        if (!(await confirmAction(
                          `${lotCode(b.batch_number)} quedará cerrado y ya no se podrá cancelar.`,
                          { title: "Terminar producción", confirmText: "Marcar como terminado" },
                        ))) return;
                        await state.run(async () => {
                          await keyedRequest(company, "production_command", { id: b.id }, "finalize");
                          await load();
                          state.setNotice("Producción terminada.");
                        });
                      }}>
                        Terminado
                      </AppButton>
                    )}
                    {state.canWrite && b.state === "curing" && (
                      <AppButton className="secondary" iconKey="action.edit" disabled={state.busy} onClick={() => {
                        setSelected(b);
                        setDate(b.production_date);
                        setDirty(false);
                        setMode("curing_edit");
                      }}>
                        Editar
                      </AppButton>
                    )}
                    {state.canWrite && b.state === "draft" && (
                      <>
                        <AppButton
                          className="secondary"
                          disabled={state.busy}
                          onClick={() => {
                            setSelected(b);
                            setDraftScale(String(b.formula_scale || 1));
                            setQuantityMode("preparations");
                            setTargetUnits(String(b.planned_quantity || ""));
                            setDate(b.production_date);
                            setOpeningStock(false);
                            setAvailableOverride(b.available_on_override || "");
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
                                "Producción en preparación. Registra los consumos reales antes de confirmar.",
                              );
                            })
                          }
                        >
                          Preparar producción
                        </AppButton>
                      </>
                    )}
                    {b.outputs?.map((o: Row) => (
                      <small key={o.id}>
                        {o.quantity} × {o.variant_name}
                      </small>
                    ))}
                    {state.canWrite && (b.state === "in_progress" || (b.opening_stock && b.state === "curing" && !b.confirmed)) && (
                      <AppButton
                        disabled={b.opening_stock && b.available_on > today()}
                        onClick={() => {
                          setSelected(b);
                          setConsumed({});
                          setOutputUnits({});
                          setDirty(false);
                          setMode("finish");
                        }}
                      >
                        {b.opening_stock ? "Registrar pesos y variantes" : "Confirmar producción"}
                      </AppButton>
                    )}
                    {state.canWrite && b.state === "curing" && (!b.opening_stock || b.confirmed) && (
                      <AppButton
                        disabled={b.available_on > today() && !manager}
                        onClick={() => {
                          setSelected(b);
                          setDirty(false);
                          setMode("release");
                        }}
                      >
                        Liberar producción
                      </AppButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </ResponsiveTable>

          {!batches.length && (
            <p className="empty">No hay documentos de producción.</p>
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
      {cancelId && (
        <div className="overlay">
          <section
            className="modal operations-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Cancelar producción"
            data-navigation-dirty={!!cancelReason}
          >
            <h2>Cancelar documento de producción</h2>
            <p>
              Se conserva el original. Si ya está confirmado, se retira lo
              fabricado y se devuelven los materiales consumidos. Primero deben
              revertirse las ventas o reservas que utilicen esas unidades.
            </p>
            <label>
              Motivo
              <AutoTextarea
                value={cancelReason}
                maxLength={500}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </label>
            {state.error && (
              <p className="error" role="alert">
                {state.error}
              </p>
            )}
            <div className="actions">
              <AppButton
                className="danger"
                disabled={state.busy || cancelReason.trim().length < 5}
                onClick={() =>
                  state.run(async () => {
                    await keyedRequest(
                      company,
                      "production_command",
                      { id: cancelId, reason: cancelReason },
                      "cancel",
                    );
                    setCancelId("");
                    setCancelReason("");
                    await load();
                  })
                }
              >
                Revertir documento
              </AppButton>
              <AppButton
                className="secondary"
                disabled={state.busy}
                onClick={() => {
                  setCancelId("");
                  setCancelReason("");
                }}
              >
                Volver
              </AppButton>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
import { variantLabel } from "./variant-label";
