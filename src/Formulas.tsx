import { useEffect, useRef, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { request } from "./commerce";
import { keyedRequest, money, useOperation, type Row } from "./operations";
import {
  recipeMath,
  roundQuantity,
  estimatedUnitCost,
  type RecipeLine,
} from "./formula-model";
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
    : new Intl.NumberFormat("es-GT", { maximumFractionDigits: 8 }).format(n);
const blankLine = (
  kind: "ingredient" | "packaging" = "ingredient",
): RecipeLine => ({
  key: crypto.randomUUID(),
  material: "",
  unit: "",
  quantity: "",
  percentage: "",
  line_kind: kind,
});
const initial = (): Row => ({
  product: "",
  name: "",
  code: "",
  capture_mode: "quantity",
  total_quantity: 1000,
  total_unit: "",
  state: "testing",
  own_reference: "",
  estimated_units: "",
  estimate_unit_id: "",
  quantity_per_unit: "",
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
      density_g_ml: i.density_g_ml ?? "",
    }));
    setDraft(
      source
        ? {
            ...source,
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
  function close() {
    if (state.busy) return;
    if (dirty && !confirm("Hay cambios sin guardar. ¿Descartarlos?")) return;
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
        (line.line_kind === "packaging"
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
    if (math.errors.length) {
      state.setError(math.errors.join(" "));
      return;
    }
    await state.run(async () => {
      const payload = {
        ...draft,
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
      !confirm(
        `¿Marcar ${f.code} · v${f.version} como ${labels[next].toLowerCase()}?${next === "current" ? " La otra versión vigente de esta fórmula quedará inactiva." : " Los lotes anteriores conservarán su referencia."}`,
      )
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
  function rowsTable(kind: "ingredient" | "packaging") {
    return (
      <section className="formula-lines">
        <h3>
          {kind === "ingredient" ? "Materias primas" : "Materiales de empaque"}
        </h3>
        <div className="formula-table-scroll">
          <table>
            <thead>
              <tr>
                <th>{kind === "ingredient" ? "Materia prima" : "Empaque"}</th>
                <th>Cantidad</th>
                <th>Unidad</th>
                <th>% costo MP</th>
                {!readOnly &&
                  kind === "ingredient" &&
                  draft.capture_mode === "percentage" && <th>% composición</th>}
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
                      (kind === "packaging"
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
                            onChange={(e) => pickMaterial(line, e.target.value)}
                          />
                          <datalist id={`formula-material-${line.key}`}>
                            {candidates.map((m: Row) => (
                              <option key={m.id} value={materialLabel(m)} />
                            ))}
                          </datalist>
                        </>
                      )}
                    </td>
                    <td>
                      {readOnly ? (
                        number(
                          computed.quantity === null
                            ? null
                            : computed.quantity * Number(scale),
                        )
                      ) : (
                        <input
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
                    </td>
                    <td>
                      {readOnly ? (
                        computed.unit?.symbol
                      ) : (
                        <select
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
                        </select>
                      )}
                      {kind === "ingredient" &&
                        computed.unit?.dimension === "volume" && (
                          <label className="formula-density">
                            Densidad (g/ml)
                            <input
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
                          <input
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
                    : "Subtotal de empaque"}
                </td>
                <td>
                  {money(
                    kind === "ingredient"
                      ? math.ingredientCost
                      : math.packagingCost,
                    catalog.currency,
                  )}
                </td>
                {!readOnly && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
        {!lines.some((l) => l.line_kind === kind) && (
          <p className="muted">
            {kind === "ingredient"
              ? "Añade una materia prima."
              : "Sin empaque asociado."}
          </p>
        )}
        {!readOnly && (
          <AppButton
            type="button"
            className="secondary"
            disabled={state.busy || lines.length >= 100}
            onClick={() => {
              setLines((old) => [...old, blankLine(kind)]);
              changed();
            }}
          >
            {kind === "ingredient" ? "Agregar ingrediente" : "Agregar empaque"}
          </AppButton>
        )}
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
      <section className="intro">
        <div>
          <p className="eyebrow">DE LA RECETA AL PRODUCTO</p>
          <h1>Fórmulas</h1>
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
      <section className="catalog">
        <div className="toolbar">
          <h2>Fórmulas y versiones</h2>
          <input
            aria-label="Buscar fórmula"
            placeholder="Código, producto, fórmula o estado…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="formula-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto / fórmula</th>
                <th>Versión</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => (
                <tr key={f.id}>
                  <td>{f.code}</td>
                  <td>
                    <strong>{f.product_name}</strong>
                    <small>{f.name}</small>
                  </td>
                  <td>v{f.version}</td>
                  <td>
                    <AppIcon
                      name={
                        f.state === "current" ? "status.success" : "status.info"
                      }
                    />{" "}
                    {state.canWrite ? (
                      <select
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
                      </select>
                    ) : (
                      labels[f.state]
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
              ))}
            </tbody>
          </table>
        </div>
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
                      if (selected?.id !== draft.product)
                        field("estimate_unit_id", "");
                    }}
                  />
                  <datalist id="formula-products">
                    {catalog.products
                      .filter((p: Row) => p.active)
                      .map((p: Row) => (
                        <option key={p.id} value={productLabel(p)} />
                      ))}
                  </datalist>
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
              </fieldset>
              <fieldset disabled={readOnly || state.busy}>
                <legend>Producción estimada · opcional</legend>
                <label>
                  Unidades estimadas
                  <input
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
                <label>
                  Presentación
                  <select
                    value={draft.estimate_unit_id || ""}
                    onChange={(e) => field("estimate_unit_id", e.target.value)}
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
                            base &&
                            u.dimension === base.dimension &&
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
                  </select>
                  <small>
                    Usa la unidad configurada en el producto o una equivalente.
                  </small>
                </label>
                <label>
                  Cantidad por unidad
                  <input
                    type="number"
                    min="0.00000001"
                    max="999999999999"
                    step="any"
                    value={draft.quantity_per_unit ?? ""}
                    onChange={(e) => field("quantity_per_unit", e.target.value)}
                  />
                </label>
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
              <details className="formula-disclosure">
                <summary>
                  Modalidad de captura y estado · {labels[draft.state]}
                </summary>
                <fieldset disabled={readOnly || state.busy}>
                  {" "}
                  <label>
                    Estado
                    <select
                      value={draft.state}
                      onChange={(e) => field("state", e.target.value)}
                    >
                      {Object.entries(labels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Modalidad de captura
                    <select
                      value={draft.capture_mode}
                      onChange={(e) =>
                        switchCapture(
                          e.target.value as "quantity" | "percentage",
                        )
                      }
                    >
                      <option value="quantity">Por cantidades</option>
                      <option value="percentage">Por porcentajes</option>
                    </select>
                  </label>
                  {draft.capture_mode === "percentage" && (
                    <>
                      <label>
                        {readOnly
                          ? "Cantidad total base"
                          : "Cantidad total a preparar"}
                        <input
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
                        <select
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
                        </select>
                      </label>
                    </>
                  )}
                </fieldset>
              </details>
              <details className="formula-disclosure">
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
                      <input
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
              </details>
              {mode === "view" && (
                <label className="formula-scale">
                  Factor de escala para esta vista
                  <input
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
              {rowsTable("ingredient")}
              <details className="formula-disclosure">
                <summary>
                  Materiales de empaque ·{" "}
                  {lines.filter((l) => l.line_kind === "packaging").length}
                </summary>
                {rowsTable("packaging")}
              </details>
              <p className="muted">
                % costo MP = costo del ingrediente ÷ subtotal de materias
                primas. Excluye el empaque; si falta un precio, el total y los
                porcentajes quedan pendientes.
              </p>
              <section className="formula-summary">
                <div>
                  <span>% de costos de MP · sin empaque</span>
                  <strong>
                    {math.ingredientCost !== null && math.ingredientCost > 0
                      ? "100 %"
                      : "Pendiente de costos"}
                  </strong>
                </div>
                <div>
                  <span>Subtotal de materias primas</span>
                  <strong>
                    {money(math.ingredientCost, catalog.currency)}
                  </strong>
                </div>
                <div>
                  <span>Empaque · costo estimado</span>
                  <strong>{money(math.packagingCost, catalog.currency)}</strong>
                </div>
                <div>
                  <span>Total MP + empaque</span>
                  <strong>{money(math.totalCost, catalog.currency)}</strong>
                </div>
                <div>
                  <span>Costo estimado por unidad</span>
                  <strong>
                    {estimatedUnitCost(
                      math.totalCost,
                      draft.estimated_units,
                      readOnly ? Number(scale) : 1,
                    ) !== null
                      ? money(
                          estimatedUnitCost(
                            math.totalCost,
                            draft.estimated_units,
                            readOnly ? Number(scale) : 1,
                          ),
                          catalog.currency,
                        )
                      : "Pendiente de unidades o costos"}
                  </strong>
                </div>
                {math.missingCosts > 0 && (
                  <p className="form-wide muted">
                    Hay {math.missingCosts} fila(s) sin precio utilizable en{" "}
                    {catalog.currency}. Subtotal conocido:{" "}
                    {money(math.knownCost, catalog.currency)}. No se sustituyen
                    precios faltantes por cero.
                  </p>
                )}
              </section>
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
                          {i.line_kind === "packaging" ? " · empaque" : ""}
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
              <details className="formula-disclosure" open={mode === "notes"}>
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
              </details>
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
