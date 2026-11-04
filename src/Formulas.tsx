import { MarginBadge } from "./MarginBadge";
import SearchSelect, { SortedDatalist } from "./SearchSelect";
import ProductImage from "./ProductImage";
import AutoTextarea from "./AutoTextarea";
import AdditionalCostsPanel from "./AdditionalCostsPanel";
import CostSummary from "./CostSummary";
import { additionalCosts, costSelectionError } from "./additional-costs";
import ResponsiveTable from "./ResponsiveTable";
import { confirmAction } from "./ConfirmDialog";
import { IconDetails, SearchField } from "./PoolControls";
// V2: compact dialog/mobile layout; reconsider separate capture group and visible informative loss.
import DecimalInput from "./DecimalInput";
import { useEffect, useRef, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { request } from "./commerce";
import { usePriceRefresh } from "./price-events";
import { formulaCost } from "./price-cost";
import { keyedRequest, money, useOperation, type Row } from "./operations";
import { recipeMath, roundQuantity, type RecipeLine } from "./formula-model";
import "./formulas.css";
import { productLabel, resolveProduct } from "./product-view";
import BatchTrace, { lotCode } from "./BatchTrace";

type Mode =
  | "new"
  | "version"
  | "variation"
  | "duplicate"
  | "view"
  | "edit"
  | "notes";
const labels: Record<string, string> = {
  testing: "En pruebas",
  current: "Vigente",
  inactive: "Inactiva",
};
const actionNames: Record<Mode, string> = {
  new: "Nueva fórmula",
  version: "Nueva versión",
  variation: "Crear variación",
  duplicate: "Duplicar fórmula",
  view: "Detalle de fórmula",
  edit: "Editar fórmula",
  notes: "Datos administrativos de fórmula",
};
const number = (n: number | null) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("es-GT", { maximumFractionDigits: 2 }).format(n);
const blankLine = (
  kind: RecipeLine["line_kind"] = "ingredient",
): RecipeLine => ({
  key: crypto.randomUUID(),
  material: "",
  unit: "",
  quantity: "",
  percentage: "",
  line_kind: kind,
  quantity_basis: kind === "auxiliary" ? "batch" : "recipe",
  reference_notes: "",
});
const initial = (): Row => ({
  product: "",
  production_mode: "fixed",
  name: "",
  code: "",
  capture_mode: "quantity",
  total_quantity: 1000,
  total_unit: "",
  state: "testing",
  own_reference: "",
  estimated_units: "",
  estimate_unit_id: "",
  estimate_variant_id: "",
  quantity_per_unit: "",
  labor_level_id: "",
  advertising_level_id: "",
  overhead_lines: [],
  loss_enabled: false,
  loss_percent: 5,
});
export default function Formulas({
  company,
  onDirty,
}: {
  company: string;
  onDirty: (dirty: boolean) => void;
}) {
  const state = useOperation(company, "production"),
    [catalog, setCatalog] = useState<Row>({
      products: [],
      materials: [],
      units: [],
      currency: "GTQ",
    }),
    [formulas, setFormulas] = useState<Row[]>([]),
    [mode, setMode] = useState<Mode | null>(null),
    [draft, setDraft] = useState<Row>(initial),
    [lines, setLines] = useState<RecipeLine[]>([blankLine()]),
    [query, setQuery] = useState(""),
    [productText, setProductText] = useState(""),
    [dirty, setDirty] = useState(false),
    [scale, setScale] = useState<number | string>(1),
    [duplicates, setDuplicates] = useState<Row[]>([]),
    [comparison, setComparison] = useState<string | null>(null),
    [traceId, setTraceId] = useState<string | null>(null);
  const generation = useRef(0),
    heading = useRef<HTMLHeadingElement>(null);
  async function load() {
    const ticket = ++generation.current;
    const [c, f] = await Promise.all([
      request("formula_catalog", { p_company: company }),
      request("formula_command", { p_company: company, p_action: "list" }),
    ]);
    if (ticket !== generation.current) return;
    setCatalog(c);
    setFormulas(f);
  }
  useEffect(() => {
    state.run(load);
    return () => {
      generation.current++;
    };
  }, [company]);
  usePriceRefresh(company, () => {
    request("formula_catalog", { p_company: company })
      .then(setCatalog)
      .catch((e) => state.setError(e.message));
  });
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
  const readOnly = mode === "view" || mode === "notes",
    math = recipeMath(
      lines,
      catalog.units,
      catalog.materials,
      draft.capture_mode,
      draft.total_quantity,
      draft.total_unit,
      readOnly ? Number(scale) : 1,
      draft.loss_enabled,
      Number(draft.loss_percent),
      draft.estimated_units,
    );
  const extraQuote = additionalCosts(
    catalog.additional_costs || [],
    catalog.currency,
    Number(draft.estimated_units) > 0
      ? Number(draft.estimated_units) * (readOnly ? Number(scale) : 1)
      : null,
    (catalog.presentations || []).find(
      (v: Row) => v.id === draft.estimate_variant_id,
    ),
    draft.labor_level_id,
    draft.advertising_level_id,
    draft.overhead_lines || [],
  );
  function changed() {
    setDirty(true);
    setDuplicates([]);
    setComparison(null);
    state.setError("");
  }
  function field(key: string, value: any) {
    setDraft((old) => ({ ...old, [key]: value }));
    if (!readOnly) changed();
  }
  function open(next: Mode, source?: Row) {
    const unit =
      catalog.units.find(
        (u: Row) =>
          u.dimension === "mass" && Number(u.base_factor) === 1 && u.active,
      ) || catalog.units.find((u: Row) => u.active);
    const copied = source?.ingredients.map((i: Row) => ({
      key: crypto.randomUUID(),
      material: i.material_id,
      unit: i.unit_id,
      quantity: Number(i.quantity),
      percentage: i.percentage == null ? "" : Number(i.percentage),
      line_kind: i.line_kind || "ingredient",
      quantity_basis: i.quantity_basis || "recipe",
      reference_notes: i.reference_notes || "",
      density_g_ml: i.density_g_ml ?? "",
    }));
    setDraft(
      source
        ? {
            ...source,
            overhead_lines: (source.overhead_lines || [])
              .filter(
                (line: Row) =>
                  ["view", "edit", "notes"].includes(next) ||
                  (catalog.additional_costs || []).some(
                    (x: Row) => x.id === line.cost_id && x.active,
                  ),
              )
              .map((line: Row) => ({ ...line })),
            labor_level_id:
              ["view", "edit", "notes"].includes(next) ||
              (catalog.additional_costs || []).some(
                (x: Row) => x.id === source.labor_level_id && x.active,
              )
                ? source.labor_level_id || ""
                : "",
            advertising_level_id:
              ["view", "edit", "notes"].includes(next) ||
              (catalog.additional_costs || []).some(
                (x: Row) => x.id === source.advertising_level_id && x.active,
              )
                ? source.advertising_level_id || ""
                : "",
            product: source.product_id,
            source: source.id,
            locked: ["view", "edit", "notes"].includes(next)
              ? source.locked
              : false,
            used_batches: ["view", "edit", "notes"].includes(next)
              ? source.used_batches
              : [],
            own_reference: ["version", "view", "edit", "notes"].includes(next)
              ? source.own_reference || ""
              : "",
            code: ["version", "view", "edit", "notes"].includes(next)
              ? source.code
              : catalog.next_code,
            name: (
              source.name +
              (next === "variation"
                ? " · variación"
                : next === "duplicate"
                  ? " · copia"
                  : "")
            ).slice(0, 120),
            state: ["view", "edit", "notes"].includes(next)
              ? source.state
              : "testing",
            total_quantity: source.total_quantity || 1000,
            total_unit: source.total_unit_id || unit?.id || "",
          }
        : { ...initial(), code: catalog.next_code, total_unit: unit?.id || "" },
    );
    const product = catalog.products.find(
      (p: Row) => p.id === source?.product_id,
    );
    setProductText(product ? productLabel(product) : "");
    setLines(copied || [blankLine()]);
    setScale(1);
    setMode(next);
    setDirty(false);
    setDuplicates([]);
    setComparison(null);
    state.setError("");
  }
  async function close() {
    if (state.busy) return;
    if (
      dirty &&
      !(await confirmAction("Hay cambios sin guardar. ¿Descartarlos?"))
    )
      return;
    setMode(null);
    setDirty(false);
    setDuplicates([]);
    state.setError("");
  }
  function changeLine(key: string, patch: Partial<RecipeLine>) {
    setLines((old) =>
      old.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
    changed();
  }
  function pickMaterial(line: RecipeLine, text: string) {
    const candidates = catalog.materials.filter(
      (m: Row) =>
        m.active &&
        (line.line_kind === "auxiliary"
          ? true
          : line.line_kind === "packaging"
            ? m.classification === "Material de empaque"
            : m.classification !== "Material de empaque"),
    );
    const found = candidates.find((m: Row) =>
      [materialLabel(m), m.name, m.sku].some(
        (s) => s && s.toLowerCase() === text.toLowerCase(),
      ),
    );
    if (
      found &&
      lines.some(
        (other) => other.key !== line.key && other.material === found.id,
      )
    ) {
      state.setError(
        "Esta materia prima ya está incluida. Modifica la cantidad de su fila.",
      );
      return;
    }
    changeLine(line.key, {
      search: found ? materialLabel(found) : text,
      material: found?.id || "",
      unit: found?.unit_id || line.unit,
    });
    state.setError("");
  }
  function materialLabel(m: Row) {
    return (m.sku ? m.sku + " · " : "") + m.name;
  }
  function switchCapture(next: "quantity" | "percentage") {
    if (next === draft.capture_mode) return;
    if (next === "percentage") {
      if (!math.compatible || !math.physicalTotal) {
        setDraft((old) => ({ ...old, capture_mode: next }));
        changed();
        state.setError("");
        return;
      }
      const first = math.rows.find((r) => r.line_kind === "ingredient")!,
        unit = first.unit!;
      setDraft((old) => ({
        ...old,
        capture_mode: next,
        total_quantity: roundQuantity(
          math.physicalTotal! / Number(unit.base_factor),
        ),
        total_unit: unit.id,
      }));
      setLines((old) =>
        old.map((line, i) => ({
          ...line,
          percentage:
            math.rows[i].percentage == null
              ? ""
              : roundQuantity(math.rows[i].percentage!),
        })),
      );
    } else {
      setLines((old) =>
        old.map((line, i) => ({
          ...line,
          quantity:
            math.rows[i].quantity == null
              ? line.quantity
              : math.rows[i].quantity!,
        })),
      );
      setDraft((old) => ({ ...old, capture_mode: next }));
    }
    changed();
    state.setError("");
  }
  async function save(confirmDuplicate = false) {
    if (mode === "notes") {
      await state.run(async () => {
        await keyedRequest(
          company,
          "formula_command",
          {
            id: draft.id,
            admin_notes: draft.admin_notes || "",
            own_reference: draft.own_reference || "",
          },
          "notes",
        );
        setMode(null);
        setDirty(false);
        state.setNotice("Notas administrativas guardadas.");
        await load();
      });
      return;
    }
    if (!draft.product) {
      state.setError("Selecciona un producto de la lista por nombre o SKU.");
      return;
    }
    const expenses: Row[] = draft.overhead_lines || [];
    const selectionError = costSelectionError(
      expenses,
      catalog.additional_costs || [],
    );
    if (selectionError) {
      state.setError(selectionError);
      return;
    }
    if (
      expenses.some(
        (line) =>
          !line.cost_id ||
          !Number.isFinite(Number(line.quantity)) ||
          Number(line.quantity) <= 0 ||
          Number(line.quantity) >= 1e12,
      ) ||
      new Set(expenses.map((line) => line.cost_id)).size !== expenses.length
    ) {
      state.setError(
        "Selecciona cada concepto de Otros gastos una sola vez e indica una cantidad válida.",
      );
      return;
    }
    if (math.errors.length) {
      state.setError(math.errors.join(" "));
      return;
    }
    await state.run(async () => {
      const payload = {
        ...draft,
        ...(draft.production_mode === "variable_weight"
          ? {
              estimate_variant_id: "",
              estimate_unit_id: "",
              quantity_per_unit: "",
            }
          : {}),
        labor_level_id: "",
        advertising_level_id: "",
        kind: mode,
        confirm_duplicate: confirmDuplicate,
        ingredients: lines.map((line, i) => ({
          ...line,
          quantity: math.rows[i].quantity,
          percentage: math.rows[i].percentage,
        })),
      };
      const result = await keyedRequest(
        company,
        "formula_command",
        payload,
        mode === "edit" ? "edit" : "save",
      );
      if (result.duplicates) {
        setDuplicates(result.duplicates);
        return;
      }
      setMode(null);
      setDirty(false);
      state.setNotice(
        mode === "edit"
          ? "Cambios guardados en la misma versión."
          : `Fórmula guardada · versión ${result.version}`,
      );
      await load();
    });
  }
  async function changeState(f: Row, next: string) {
    if (
      !(await confirmAction(
        `¿Marcar ${f.code} · v${f.version} como ${labels[next].toLowerCase()}?${next === "current" ? " La otra versión vigente de esta fórmula quedará inactiva." : " Los lotes anteriores conservarán su referencia."}`,
      ))
    )
      return;
    await state.run(async () => {
      await keyedRequest(
        company,
        "formula_command",
        { id: f.id, state: next },
        "state",
      );
      state.setNotice("Estado actualizado.");
      await load();
    });
  }
  function rowsTable(kind: RecipeLine["line_kind"]) {
    return (
      <section className="formula-lines">
        <h3>
          {kind === "ingredient"
            ? "Materias primas"
            : kind === "packaging"
              ? "Materiales de empaque"
              : "Insumos adicionales"}
        </h3>
        <div className="formula-line-frame">
          <div className="formula-table-scroll">
            <ResponsiveTable>
              <thead>
                <tr>
                  <th>
                    {kind === "ingredient"
                      ? "Materia prima"
                      : kind === "packaging"
                        ? "Empaque"
                        : "Insumo adicional"}
                  </th>
                  <th>Cantidad</th>
                  <th>Unidad</th>
                  <th>% costo MP</th>
                  {!readOnly &&
                    kind === "ingredient" &&
                    draft.capture_mode === "percentage" && (
                      <th>% composición</th>
                    )}
                  <th>Precio por presentación</th>
                  <th>Costo calculado</th>
                  {!readOnly && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  if (line.line_kind !== kind) return null;
                  const computed = math.rows[index],
                    material = catalog.materials.find(
                      (m: Row) => m.id === line.material,
                    ),
                    base = catalog.units.find(
                      (u: Row) => u.id === material?.unit_id,
                    ),
                    candidates = catalog.materials.filter(
                      (m: Row) =>
                        m.active &&
                        (kind === "auxiliary"
                          ? true
                          : kind === "packaging"
                            ? m.classification === "Material de empaque"
                            : m.classification !== "Material de empaque"),
                    );
                  return (
                    <tr key={line.key}>
                      <td>
                        {readOnly ? (
                          <span>
                            {material?.name || "Material no disponible"}
                          </span>
                        ) : (
                          <>
                            <input
                              disabled={state.busy}
                              aria-label={`Material fila ${index + 1}`}
                              list={`formula-material-${line.key}`}
                              value={
                                line.search ??
                                (material ? materialLabel(material) : "")
                              }
                              placeholder="Escribe nombre o SKU…"
                              required
                              onChange={(e) =>
                                pickMaterial(line, e.target.value)
                              }
                            />
                            <SortedDatalist id={`formula-material-${line.key}`}>
                              {candidates.map((m: Row) => (
                                <option key={m.id} value={materialLabel(m)} />
                              ))}
                            </SortedDatalist>
                          </>
                        )}
                        <IconDetails
                          className="formula-line-notes"
                          onToggle={(e) => {
                            if (e.currentTarget.open) {
                              const area =
                                e.currentTarget.querySelector("textarea");
                              if (area) {
                                area.style.height = "auto";
                                area.style.height = area.scrollHeight + "px";
                              }
                            }
                          }}
                        >
                          <summary>
                            Referencia / Observaciones
                            {line.reference_notes ? " · con nota" : ""}
                          </summary>
                          {readOnly ? (
                            <p>{line.reference_notes || "Sin observaciones"}</p>
                          ) : (
                            <AutoTextarea
                              aria-label={`Observaciones fila ${index + 1}`}
                              maxLength={2000}
                              disabled={state.busy}
                              value={line.reference_notes || ""}
                              placeholder="Indicaciones específicas de esta versión…"
                              onChange={(e) =>
                                changeLine(line.key, {
                                  reference_notes: e.target.value,
                                })
                              }
                            />
                          )}
                        </IconDetails>
                      </td>
                      <td>
                        {kind === "auxiliary" &&
                          (readOnly ? (
                            <small>
                              {line.quantity_basis === "unit"
                                ? "Por unidad producida"
                                : "Fija por lote"}{" "}
                              · {number(Number(line.quantity))}{" "}
                              {computed.unit?.symbol}
                            </small>
                          ) : (
                            <SearchSelect
                              aria-label={`Base de cantidad fila ${index + 1}`}
                              disabled={state.busy}
                              value={line.quantity_basis || "batch"}
                              onChange={(e) =>
                                changeLine(line.key, {
                                  quantity_basis: e.target.value as
                                    | "batch"
                                    | "unit",
                                })
                              }
                            >
                              <option value="batch">Por lote (fija)</option>
                              <option value="unit">Por unidad producida</option>
                            </SearchSelect>
                          ))}
                        {readOnly ? (
                          number(computed.plannedQuantity)
                        ) : (
                          <DecimalInput
                            disabled={state.busy}
                            aria-label={`Cantidad fila ${index + 1}`}
                            type="number"
                            min="0.00000001"
                            max="999999999999"
                            step="any"
                            required
                            readOnly={
                              kind === "ingredient" &&
                              draft.capture_mode === "percentage"
                            }
                            value={
                              kind === "ingredient" &&
                              draft.capture_mode === "percentage"
                                ? (computed.quantity ?? "")
                                : line.quantity
                            }
                            onChange={(e) =>
                              changeLine(line.key, { quantity: e.target.value })
                            }
                          />
                        )}
                        {!readOnly && kind === "auxiliary" && (
                          <small>
                            Previsto para el lote:{" "}
                            {number(computed.plannedQuantity)}{" "}
                            {computed.unit?.symbol}
                          </small>
                        )}
                      </td>
                      <td>
                        {readOnly ? (
                          computed.unit?.symbol
                        ) : (
                          <SearchSelect
                            disabled={state.busy}
                            aria-label={`Unidad fila ${index + 1}`}
                            value={line.unit}
                            required
                            onChange={(e) => {
                              const oldUnit = catalog.units.find(
                                  (u: Row) => u.id === line.unit,
                                ),
                                next = catalog.units.find(
                                  (u: Row) => u.id === e.target.value,
                                );
                              changeLine(line.key, {
                                unit: e.target.value,
                                quantity:
                                  oldUnit && next && line.quantity !== ""
                                    ? roundQuantity(
                                        (Number(line.quantity) *
                                          Number(oldUnit.base_factor)) /
                                          Number(next.base_factor),
                                      )
                                    : line.quantity,
                              });
                            }}
                          >
                            <option value="">Seleccionar</option>
                            {catalog.units
                              .filter(
                                (u: Row) =>
                                  u.active && u.dimension === base?.dimension,
                              )
                              .map((u: Row) => (
                                <option value={u.id} key={u.id}>
                                  {u.symbol}
                                </option>
                              ))}
                          </SearchSelect>
                        )}
                        {kind === "ingredient" &&
                          computed.unit?.dimension === "volume" && (
                            <label className="formula-density">
                              Densidad (g/ml)
                              <DecimalInput
                                aria-label={`Densidad fila ${index + 1}`}
                                type="number"
                                min="0.00000001"
                                max="999999.99999999"
                                step="any"
                                placeholder="Opcional"
                                readOnly={readOnly}
                                disabled={state.busy}
                                value={line.density_g_ml ?? ""}
                                onChange={(e) =>
                                  changeLine(line.key, {
                                    density_g_ml: e.target.value,
                                  })
                                }
                              />
                            </label>
                          )}
                      </td>
                      <td>
                        {computed.costPercentage == null
                          ? "—"
                          : new Intl.NumberFormat("es-GT", {
                              maximumFractionDigits: 2,
                            }).format(computed.costPercentage) + " %"}
                      </td>
                      {!readOnly &&
                        kind === "ingredient" &&
                        draft.capture_mode === "percentage" && (
                          <td>
                            {" "}
                            <DecimalInput
                              disabled={state.busy}
                              aria-label={`Porcentaje fila ${index + 1}`}
                              type="number"
                              min="0.00000001"
                              max="100"
                              step="any"
                              required
                              value={line.percentage}
                              onChange={(e) =>
                                changeLine(line.key, {
                                  percentage: e.target.value,
                                })
                              }
                            />
                          </td>
                        )}
                      <td>
                        {material?.presentation_price != null ? (
                          <>
                            <strong>
                              {money(
                                material.presentation_price,
                                catalog.currency,
                              )}
                            </strong>
                            <small>
                              {number(Number(material.presentation_quantity))}{" "}
                              {material.presentation_unit} ·{" "}
                              {material.presentation_name}
                            </small>
                            <small>
                              {material.price_basis === "undated"
                                ? "Referencia sin fecha"
                                : material.effective_on}
                            </small>
                          </>
                        ) : (
                          <span className="muted">Sin precio utilizable</span>
                        )}
                      </td>
                      <td>
                        {computed.cost == null ? (
                          <span className="muted">Sin precio utilizable</span>
                        ) : (
                          money(computed.cost, catalog.currency)
                        )}
                      </td>
                      {!readOnly && (
                        <td>
                          <AppButton
                            type="button"
                            className="secondary"
                            disabled={state.busy}
                            iconKey="action.delete"
                            aria-label={`Eliminar material fila ${index + 1}`}
                            onClick={() => {
                              setLines((old) =>
                                old.filter((r) => r.key !== line.key),
                              );
                              changed();
                            }}
                          >
                            Eliminar
                          </AppButton>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td
                    colSpan={
                      readOnly ||
                      kind !== "ingredient" ||
                      draft.capture_mode !== "percentage"
                        ? 5
                        : 6
                    }
                  >
                    {kind === "ingredient"
                      ? "Subtotal de materias primas"
                      : kind === "packaging"
                        ? "Subtotal de empaque"
                        : "Subtotal de insumos adicionales"}
                  </td>
                  <td>
                    {money(
                      kind === "ingredient"
                        ? math.ingredientCost
                        : kind === "packaging"
                          ? math.packagingCost
                          : math.suppliesCost,
                      catalog.currency,
                    )}
                  </td>
                  {!readOnly && <td />}
                </tr>
              </tfoot>
            </ResponsiveTable>
          </div>
          {!lines.some((l) => l.line_kind === kind) && (
            <p className="muted">
              {kind === "ingredient"
                ? "Añade una materia prima."
                : kind === "packaging"
                  ? "Sin empaque asociado."
                  : "Sin insumos adicionales."}
            </p>
          )}
          {!readOnly && (
            <AppButton
              type="button"
              className="secondary"
              disabled={state.busy || lines.length >= 100}
              onClick={() => {
                setLines((old) => [
                  ...old,
                  {
                    ...blankLine(kind),
                    quantity:
                      kind === "packaging" && Number(draft.estimated_units) > 0
                        ? Number(draft.estimated_units)
                        : "",
                  },
                ]);
                changed();
              }}
            >
              {kind === "ingredient"
                ? "Agregar ingrediente"
                : kind === "packaging"
                  ? "Agregar empaque"
                  : "Agregar insumo adicional"}
            </AppButton>
          )}
        </div>
      </section>
    );
  }
  const filtered = formulas.filter((f) =>
    [
      f.code,
      f.own_reference,
      f.name,
      f.product_name,
      labels[f.state],
      `v${f.version}`,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const compared = formulas.find((f) => f.id === comparison);
  return (
    <>
      <section className="intro formula-intro">
        <div>
          <p className="eyebrow">DE LA RECETA AL PRODUCTO</p>
          <h1 className="module-title">
            <AppIcon name="module.formulas" />
            Fórmulas
          </h1>
          <p>
            Composición, versiones y costos estimados, sin modificar
            existencias.
          </p>
        </div>
        <div className="form-actions">
          {state.canWrite && (
            <AppButton disabled={state.busy} onClick={() => open("new")}>
              Nueva fórmula
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
      {!mode && state.error && (
        <p role="alert" className="error">
          <AppIcon name="status.error" />
          {state.error}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      <section className="catalog formula-catalog">
        <div className="toolbar">
          <h2>Fórmulas y versiones</h2>
          <SearchField
            aria-label="Buscar fórmula"
            placeholder="Código, producto, fórmula o estado…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="formula-table-scroll formula-gallery">
          <ResponsiveTable>
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto / fórmula</th>
                <th>Versión</th>
                <th>Estado</th>
                <th>Precio de venta / unidad</th>
                <th>Costo estimado / unidad</th>
                <th>
                  Margen aprox.<small>Precio − costo</small>
                </th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => {
                const presentation = (catalog.presentations || []).find(
                  (v: Row) =>
                    v.id === f.estimate_variant_id &&
                    v.product_id === f.product_id,
                );
                const price =
                  presentation?.currency === catalog.currency &&
                  presentation.price != null &&
                  Number.isFinite(Number(presentation.price))
                    ? Number(presentation.price)
                    : null;
                const estimate = formulaCost(f, catalog, presentation);
                const margin =
                  price != null && estimate.cost != null
                    ? price - estimate.cost
                    : null;
                return (
                  <tr key={f.id}>
                    <td>{f.code}</td>
                    <td>
                      <div className="formula-product">
                        <div className="formula-product-image">
                          <ProductImage
                            path={
                              catalog.products.find(
                                (p: Row) => p.id === f.product_id,
                              )?.photo_path
                            }
                            name={f.product_name}
                          />
                        </div>
                        <div className="formula-product-text">
                          <strong>{f.product_name}</strong>
                          <small>{f.name}</small>
                        </div>
                      </div>
                    </td>
                    <td>v{f.version}</td>
                    <td>
                      <div className={"formula-state formula-state-" + f.state}>
                        <span className="formula-state-icon">
                          <AppIcon
                            name={
                              f.state === "current"
                                ? "status.active"
                                : f.state === "inactive"
                                  ? "status.archived"
                                  : "status.warning"
                            }
                          />
                        </span>
                        {state.canWrite ? (
                          <SearchSelect
                            aria-label={`Estado ${f.code} v${f.version}`}
                            value={f.state}
                            disabled={state.busy}
                            onChange={(e) => changeState(f, e.target.value)}
                          >
                            {Object.entries(labels).map(([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ))}
                          </SearchSelect>
                        ) : (
                          <span className="formula-state-label">
                            {labels[f.state]}
                          </span>
                        )}
                      </div>
                    </td>
                    <td
                      className="formula-amount"
                      data-sort-value={price ?? ""}
                    >
                      {price == null
                        ? f.production_mode === "variable_weight"
                          ? "Según variante"
                          : "Pendiente"
                        : money(price, catalog.currency)}
                      {price == null && (
                        <small>
                          {presentation
                            ? "Sin precio base vigente"
                            : f.production_mode === "variable_weight"
                              ? "Precio según variante y peso"
                              : "Sin presentación vinculada"}
                        </small>
                      )}
                    </td>
                    <td
                      className="formula-amount"
                      data-sort-value={estimate.cost ?? ""}
                    >
                      {estimate.cost == null
                        ? f.production_mode === "variable_weight"
                          ? "Según peso real"
                          : "Pendiente"
                        : money(estimate.cost, catalog.currency)}
                      {estimate.reason && <small>{estimate.reason}</small>}
                    </td>
                    <td
                      data-sort-value={margin ?? ""}
                      className={
                        "formula-amount" +
                        (margin == null || margin === 0
                          ? ""
                          : margin > 0
                            ? " formula-margin-positive"
                            : " formula-margin-negative")
                      }
                    >
                      {margin == null
                        ? f.production_mode === "variable_weight"
                          ? "Según peso real"
                          : "Pendiente"
                        : money(margin, catalog.currency)}
                      {margin != null && price != null && price > 0 && (
                        <MarginBadge value={(margin / price) * 100} />
                      )}
                    </td>
                    <td className="actions formula-actions">
                      <AppButton
                        className="secondary"
                        disabled={state.busy}
                        onClick={() => open("view", f)}
                      >
                        Ver / escalar
                      </AppButton>
                      {state.canWrite && (
                        <>
                          <AppButton
                            className="secondary"
                            disabled={state.busy}
                            iconKey="action.edit"
                            onClick={() => open(f.locked ? "notes" : "edit", f)}
                          >
                            Editar fórmula
                          </AppButton>
                          <AppButton
                            className="secondary"
                            disabled={state.busy}
                            onClick={() => open("version", f)}
                          >
                            Nueva versión
                          </AppButton>
                          <AppButton
                            className="secondary"
                            disabled={state.busy}
                            onClick={() => open("variation", f)}
                          >
                            Crear variación
                          </AppButton>
                          <AppButton
                            className="secondary"
                            disabled={state.busy}
                            onClick={() => open("duplicate", f)}
                          >
                            Duplicar fórmula
                          </AppButton>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </ResponsiveTable>
        </div>
        <small className="formula-cost-note">
          Importes por unidad estimada de cada versión, calculados con costos
          actuales y el precio de la lista base. Incluyen materiales, empaque,
          insumos y costos adicionales.
        </small>
        {!filtered.length && (
          <p className="empty">
            {state.busy
              ? "Cargando fórmulas…"
              : "No hay fórmulas que coincidan."}
          </p>
        )}
      </section>
      {mode && (
        <div className="overlay">
          <section
            className="modal formula-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="formula-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
          >
            <div className="hierarchy-toolbar">
              <h2 tabIndex={-1} ref={heading} id="formula-title">
                {actionNames[mode]}
                {readOnly ? ` · ${draft.code} · v${draft.version}` : ""}
              </h2>
              <AppButton
                className="secondary"
                disabled={state.busy}
                onClick={close}
              >
                Cerrar
              </AppButton>
            </div>
            {state.error && (
              <p role="alert" className="error">
                <AppIcon name="status.error" />
                {state.error}
              </p>
            )}
            <form
              data-dirty-managed
              onSubmit={(e) => {
                e.preventDefault();
                if (!readOnly || mode === "notes") save(false);
              }}
            >
              {draft.locked && (
                <p className="sheet-warning">
                  Esta versión ya tiene producción confirmada. Puedes editar
                  notas administrativas; para cambiar la receta crea una nueva
                  versión.
                </p>
              )}
              {mode === "edit" && (
                <p className="muted">
                  Corrección de captura en la misma versión. El producto y el
                  código se conservan; para otro producto utiliza Duplicar
                  fórmula.
                </p>
              )}
              <fieldset disabled={state.busy}>
                <legend>Identidad</legend>
                <label>
                  Código automático
                  <input
                    value={draft.code || "Se asignará al guardar"}
                    readOnly
                  />
                </label>
                <label>
                  Referencia propia
                  <input
                    maxLength={80}
                    value={draft.own_reference || ""}
                    disabled={mode === "view"}
                    onChange={(e) => {
                      setDraft((old) => ({
                        ...old,
                        own_reference: e.target.value,
                      }));
                      changed();
                    }}
                  />
                </label>
              </fieldset>
              <fieldset disabled={readOnly || state.busy}>
                <legend>Datos generales</legend>
                <label>
                  Producto
                  <input
                    list="formula-products"
                    required
                    placeholder="Escribe nombre o SKU…"
                    value={productText}
                    readOnly={
                      readOnly ||
                      ["version", "variation", "edit"].includes(mode!)
                    }
                    onChange={(e) => {
                      setProductText(e.target.value);
                      const selected = resolveProduct(
                        catalog.products,
                        e.target.value,
                      );
                      field("product", selected?.id || "");
                      if (selected?.id !== draft.product) {
                        field("estimate_unit_id", "");
                        field("estimate_variant_id", "");
                        field("quantity_per_unit", "");
                      }
                    }}
                  />
                  <SortedDatalist id="formula-products">
                    {catalog.products
                      .filter((p: Row) => p.active)
                      .map((p: Row) => (
                        <option key={p.id} value={productLabel(p)} />
                      ))}
                  </SortedDatalist>
                </label>
                <label>
                  Nombre de fórmula
                  <input
                    value={draft.name}
                    maxLength={120}
                    required
                    onChange={(e) => field("name", e.target.value)}
                  />
                </label>
                <label>
                  Modalidad de captura
                  <SearchSelect
                    value={draft.capture_mode}
                    onChange={(e) =>
                      switchCapture(e.target.value as "quantity" | "percentage")
                    }
                  >
                    <option value="quantity">Por cantidades</option>
                    <option value="percentage">Por porcentajes</option>
                  </SearchSelect>
                </label>
                <label>
                  Estado
                  <SearchSelect
                    value={draft.state}
                    onChange={(e) => field("state", e.target.value)}
                  >
                    {Object.entries(labels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </SearchSelect>
                </label>
                {draft.capture_mode === "percentage" && (
                  <>
                    <label>
                      {readOnly
                        ? "Cantidad total base"
                        : "Cantidad total a preparar"}
                      <DecimalInput
                        type="number"
                        min="0.00000001"
                        max="999999999999"
                        step="any"
                        value={draft.total_quantity}
                        required
                        onChange={(e) =>
                          field("total_quantity", e.target.value)
                        }
                      />
                    </label>
                    <label>
                      Unidad del total
                      <SearchSelect
                        required
                        value={draft.total_unit}
                        onChange={(e) => field("total_unit", e.target.value)}
                      >
                        {catalog.units
                          .filter(
                            (u: Row) => u.active || u.id === draft.total_unit,
                          )
                          .map((u: Row) => (
                            <option key={u.id} value={u.id}>
                              {u.symbol}
                            </option>
                          ))}
                      </SearchSelect>
                    </label>
                  </>
                )}
              </fieldset>
              <fieldset disabled={readOnly || state.busy}>
                <legend>Producción estimada · opcional</legend>
                <label>
                  Modalidad de producción
                  <SearchSelect
                    value={draft.production_mode || "fixed"}
                    onChange={(e) => field("production_mode", e.target.value)}
                  >
                    <option value="fixed">Producción fija</option>
                    <option value="variable_weight">
                      Producción variable por peso
                    </option>
                  </SearchSelect>
                  <small>
                    {draft.production_mode === "variable_weight"
                      ? "Una misma fórmula produce distintas variantes. Los pesos reales se registran al terminar el lote."
                      : "Presentación definida y costo según las unidades obtenidas."}
                  </small>
                </label>
                <label>
                  Unidades estimadas
                  <DecimalInput
                    type="number"
                    min="1"
                    max="999999999999"
                    step="1"
                    value={
                      readOnly && Number(draft.estimated_units) > 0
                        ? Number(draft.estimated_units) * Number(scale)
                        : (draft.estimated_units ?? "")
                    }
                    onChange={(e) => field("estimated_units", e.target.value)}
                  />
                </label>
                {draft.production_mode !== "variable_weight" && (
                  <>
                    <label>
                      Presentación comercial
                      <SearchSelect
                        value={draft.estimate_variant_id || ""}
                        onChange={(e) => {
                          field("estimate_variant_id", e.target.value);
                          const v = (catalog.presentations || []).find(
                            (v: Row) => v.id === e.target.value,
                          );
                          if (
                            v?.weight_min != null &&
                            Number(v.weight_min) === Number(v.weight_max)
                          ) {
                            const unit = catalog.units.find(
                              (u: Row) =>
                                u.active &&
                                u.dimension === "mass" &&
                                Number(u.base_factor) === 1,
                            );
                            if (unit) {
                              field("estimate_unit_id", unit.id);
                              field("quantity_per_unit", Number(v.weight_min));
                            }
                          }
                        }}
                      >
                        <option value="">Sin definir</option>
                        {(catalog.presentations || [])
                          .filter(
                            (v: Row) =>
                              v.product_id === draft.product &&
                              (v.active || v.id === draft.estimate_variant_id),
                          )
                          .map((v: Row) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                      </SearchSelect>
                      <small>
                        {(catalog.presentations || []).some(
                          (v: Row) =>
                            v.product_id === draft.product && v.active,
                        )
                          ? "Selecciona el formato comercial del producto. Su contenido exacto se completa cuando está definido."
                          : "Este producto aún no tiene presentaciones comerciales. Configúralas en Productos → Variantes y existencias."}
                      </small>
                    </label>
                    <label>
                      Unidad del contenido
                      <SearchSelect
                        value={draft.estimate_unit_id || ""}
                        onChange={(e) => {
                          field("estimate_unit_id", e.target.value);
                          const v = (catalog.presentations || []).find(
                              (v: Row) => v.id === draft.estimate_variant_id,
                            ),
                            u = catalog.units.find(
                              (u: Row) => u.id === e.target.value,
                            );
                          if (
                            v?.weight_min != null &&
                            Number(v.weight_min) === Number(v.weight_max) &&
                            u?.dimension === "mass"
                          )
                            field(
                              "quantity_per_unit",
                              Number(v.weight_min) / Number(u.base_factor),
                            );
                        }}
                      >
                        <option value="">Sin definir</option>
                        {catalog.units
                          .filter((u: Row) => {
                            const product = catalog.products.find(
                                (p: Row) => p.id === draft.product,
                              ),
                              base = catalog.units.find(
                                (b: Row) => b.id === product?.unit_id,
                              );
                            return (
                              u.id === draft.estimate_unit_id ||
                              (u.active &&
                                (base || draft.estimate_variant_id) &&
                                (u.dimension === base?.dimension ||
                                  (draft.estimate_variant_id &&
                                    u.dimension === "mass")) &&
                                ["g", "kg", "ml", "l"].includes(
                                  u.symbol.toLowerCase(),
                                ))
                            );
                          })
                          .map((u: Row) => (
                            <option key={u.id} value={u.id}>
                              {u.symbol}
                            </option>
                          ))}
                      </SearchSelect>
                      <small>
                        Usa la unidad configurada en el producto o una
                        equivalente.
                      </small>
                    </label>
                    <label>
                      Contenido por unidad
                      <DecimalInput
                        type="number"
                        min="0.00000001"
                        max="999999999999"
                        step="any"
                        readOnly={(catalog.presentations || []).some(
                          (v: Row) =>
                            v.id === draft.estimate_variant_id &&
                            v.weight_min != null &&
                            Number(v.weight_min) === Number(v.weight_max),
                        )}
                        value={draft.quantity_per_unit ?? ""}
                        onChange={(e) =>
                          field("quantity_per_unit", e.target.value)
                        }
                      />
                    </label>
                  </>
                )}
                <label>
                  Peso teórico de ingredientes
                  <input
                    readOnly
                    value={
                      number(math.theoreticalGrams) +
                      " g" +
                      (math.massPartial ? " · cálculo parcial" : "")
                    }
                  />
                  <small>
                    Solo ingredientes con masa o densidad conocida. No equivale
                    al peso terminado ni calcula merma.
                  </small>
                </label>
              </fieldset>
              <IconDetails className="formula-disclosure" hidden>
                <summary>
                  Merma informativa
                  {draft.loss_enabled
                    ? " · " + draft.loss_percent + " %"
                    : " · sin aplicar"}
                </summary>
                <fieldset disabled={readOnly || state.busy}>
                  {" "}
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.loss_enabled}
                      onChange={(e) => field("loss_enabled", e.target.checked)}
                    />
                    Aplicar merma
                  </label>
                  {draft.loss_enabled && (
                    <label>
                      Porcentaje de merma
                      <DecimalInput
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        value={draft.loss_percent}
                        required
                        onChange={(e) => field("loss_percent", e.target.value)}
                      />
                    </label>
                  )}
                </fieldset>
                {draft.loss_enabled && (
                  <div className="formula-loss">
                    <h4>
                      Merma informativa · {draft.loss_percent} % de ingredientes
                    </h4>
                    <p>
                      {math.lossGroups
                        .map((g) => `${number(g.quantity)} ${g.unit}`)
                        .join(" · ") || "Completa las cantidades"}
                    </p>
                    <p>
                      Costo estimado de merma:{" "}
                      {money(math.lossCost, catalog.currency)}
                    </p>
                    <small>
                      Se muestra separado del costo base. No aumenta el consumo
                      ni descuenta inventario.
                    </small>
                  </div>
                )}
                <p className="muted">
                  No incrementa consumos ni descuenta inventario adicional.
                </p>
              </IconDetails>
              {mode === "view" && (
                <label className="formula-scale">
                  Factor de escala para esta vista
                  <DecimalInput
                    type="number"
                    min="0.00000001"
                    max="1000000"
                    step="any"
                    value={scale}
                    onChange={(e) => setScale(e.target.value)}
                  />
                  <small>
                    Escala ingredientes, empaque y estimación. Conserva la
                    versión guardada.
                  </small>
                  {Number(scale) <= 0 && (
                    <small role="alert">
                      Ingresa un factor mayor que cero.
                    </small>
                  )}
                </label>
              )}
              <IconDetails className="formula-disclosure" open>
                <summary>Materias primas</summary>
                {rowsTable("ingredient")}
              </IconDetails>
              <IconDetails className="formula-disclosure">
                <summary>
                  Materiales de empaque ·{" "}
                  {lines.filter((l) => l.line_kind === "packaging").length}
                </summary>
                {rowsTable("packaging")}
              </IconDetails>
              <IconDetails className="formula-disclosure">
                <summary>
                  Insumos adicionales ·{" "}
                  {lines.filter((l) => l.line_kind === "auxiliary").length}
                </summary>
                <p className="muted">
                  Por lote: cantidad fija, independiente del factor de escala.
                  Por unidad: cantidad × unidades estimadas del lote. Al
                  producir, confirma el consumo real. No se suman al porcentaje
                  de composición ni al peso teórico.
                </p>
                {rowsTable("auxiliary")}
              </IconDetails>
              <p className="muted">
                % costo MP = costo del ingrediente ÷ subtotal de materias
                primas. Excluye el empaque y los insumos adicionales; si falta
                un precio, el total y los porcentajes quedan pendientes.
              </p>
              <AdditionalCostsPanel
                quote={{
                  ...extraQuote,
                  variable_weight: draft.production_mode === "variable_weight",
                }}
                items={catalog.additional_costs || []}
                overheadLines={draft.overhead_lines || []}
                onOverheadChange={
                  !readOnly && !state.busy
                    ? (rows) => field("overhead_lines", rows)
                    : undefined
                }
                baseCost={math.totalCost}
                hideTotals
              />
              <CostSummary
                product={
                  catalog.products.find((p: Row) => p.id === draft.product)
                    ?.name ||
                  draft.name ||
                  "Producto sin seleccionar"
                }
                materials={{
                  ingredients: math.ingredientCost,
                  packaging: math.packagingCost,
                  supplies: math.suppliesCost,
                }}
                quote={extraQuote}
                variable={draft.production_mode === "variable_weight"}
              />
              {math.missingCosts > 0 && (
                <p className="muted">
                  Hay {math.missingCosts} fila(s) sin precio utilizable. Los
                  costos faltantes permanecen pendientes.
                </p>
              )}
              {duplicates.length > 0 && (
                <section className="formula-duplicates" role="status">
                  <h3>Hay una composición idéntica para este producto</h3>
                  <p>Revísala antes de guardar una copia intencional.</p>
                  {duplicates.map((f) => (
                    <div key={f.id}>
                      <AppButton
                        type="button"
                        className="secondary"
                        onClick={() =>
                          setComparison(comparison === f.id ? null : f.id)
                        }
                      >
                        Consultar {f.code} · v{f.version} · {f.name}
                      </AppButton>
                    </div>
                  ))}
                  {compared && (
                    <ul>
                      {compared.ingredients.map((i: Row) => (
                        <li key={i.material_id}>
                          {i.name} · {number(Number(i.quantity))} {i.unit}
                          {i.line_kind === "packaging"
                            ? " · empaque"
                            : i.line_kind === "auxiliary"
                              ? " · insumo adicional"
                              : ""}
                          {i.reference_notes && ` · ${i.reference_notes}`}
                        </li>
                      ))}
                    </ul>
                  )}
                  <AppButton
                    type="button"
                    disabled={state.busy}
                    onClick={() => save(true)}
                  >
                    Guardar de todos modos
                  </AppButton>
                </section>
              )}
              <IconDetails
                className="formula-disclosure"
                open={mode === "notes"}
              >
                <summary>Notas administrativas</summary>
                <label className="form-wide">
                  Notas administrativas
                  <textarea
                    maxLength={4000}
                    value={draft.admin_notes || ""}
                    disabled={mode === "view" || state.busy}
                    onChange={(e) => {
                      setDraft((old) => ({
                        ...old,
                        admin_notes: e.target.value,
                      }));
                      changed();
                    }}
                  />
                </label>
              </IconDetails>
              {draft.used_batches?.length > 0 && (
                <section>
                  <h3>Lotes que utilizan esta versión</h3>
                  {draft.used_batches.map((b: Row) => (
                    <div key={b.id}>
                      <AppButton
                        type="button"
                        className="secondary"
                        onClick={() => setTraceId(b.id)}
                      >
                        {lotCode(b.batch_number)} ·{" "}
                        {b.confirmed ? "Confirmado" : "Sin confirmar"} ·{" "}
                        {b.production_date}
                      </AppButton>
                    </div>
                  ))}
                </section>
              )}
              <div className="form-actions">
                {(mode === "view" || mode === "notes" || mode === "edit") &&
                  state.canWrite && (
                    <>
                      {mode === "view" && (
                        <AppButton
                          type="button"
                          className="secondary"
                          onClick={() =>
                            open(draft.locked ? "notes" : "edit", {
                              ...draft,
                              product_id: draft.product,
                              total_unit_id: draft.total_unit,
                              ingredients: lines.map((l) => ({
                                material_id: l.material,
                                unit_id: l.unit,
                                density_g_ml: l.density_g_ml,
                                quantity: l.quantity,
                                percentage: l.percentage,
                                line_kind: l.line_kind,
                                quantity_basis: l.quantity_basis,
                                reference_notes: l.reference_notes,
                              })),
                            })
                          }
                        >
                          Editar fórmula
                        </AppButton>
                      )}
                      <AppButton
                        type="button"
                        className="secondary"
                        onClick={() =>
                          open("version", {
                            ...draft,
                            product_id: draft.product,
                            total_unit_id: draft.total_unit,
                            ingredients: lines.map((l) => ({
                              material_id: l.material,
                              unit_id: l.unit,
                              density_g_ml: l.density_g_ml,
                              quantity: l.quantity,
                              percentage: l.percentage,
                              line_kind: l.line_kind,
                              quantity_basis: l.quantity_basis,
                              reference_notes: l.reference_notes,
                            })),
                          })
                        }
                      >
                        Crear nueva versión
                      </AppButton>
                    </>
                  )}
                {(!readOnly || mode === "notes") && (
                  <AppButton disabled={state.busy}>
                    {mode === "edit" || mode === "notes"
                      ? "Guardar cambios"
                      : "Guardar"}
                  </AppButton>
                )}
                <AppButton
                  type="button"
                  className="secondary"
                  disabled={state.busy}
                  onClick={close}
                >
                  {readOnly ? "Volver" : "Cancelar"}
                </AppButton>
              </div>
            </form>
          </section>
        </div>
      )}
      {traceId && (
        <BatchTrace
          company={company}
          id={traceId}
          onClose={() => setTraceId(null)}
        />
      )}
    </>
  );
}
