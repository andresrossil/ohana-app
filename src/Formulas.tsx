import { useEffect, useRef, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { request } from "./commerce";
import { keyedRequest, money, useOperation, type Row } from "./operations";
import { recipeMath, roundQuantity, type RecipeLine } from "./formula-model";
import "./formulas.css";

type Mode = "new" | "version" | "variation" | "duplicate" | "view";
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
  view: "Ver y escalar fórmula",
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
    [dirty, setDirty] = useState(false),
    [scale, setScale] = useState<number | string>(1),
    [duplicates, setDuplicates] = useState<Row[]>([]),
    [comparison, setComparison] = useState<string | null>(null);
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
  const readOnly = mode === "view",
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
    }));
    setDraft(
      source
        ? {
            ...source,
            product: source.product_id,
            source: source.id,
            code:
              next === "version" || next === "view"
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
            state: next === "view" ? source.state : "testing",
            total_quantity: source.total_quantity || 1000,
            total_unit: source.total_unit_id || unit?.id || "",
          }
        : { ...initial(), code: catalog.next_code, total_unit: unit?.id || "" },
    );
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
        "save",
      );
      if (result.duplicates) {
        setDuplicates(result.duplicates);
        return;
      }
      setMode(null);
      setDirty(false);
      state.setNotice(`Fórmula guardada · versión ${result.version}`);
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
                <th>Porcentaje</th>
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
                    </td>
                    <td>
                      {!readOnly &&
                      kind === "ingredient" &&
                      draft.capture_mode === "percentage" ? (
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
                            changeLine(line.key, { percentage: e.target.value })
                          }
                        />
                      ) : computed.percentage == null ? (
                        "—"
                      ) : (
                        `${number(computed.percentage)} %`
                      )}
                    </td>
                    <td>
                      {computed.cost == null ? (
                        <span className="muted">Sin precio vigente</span>
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
    [f.code, f.name, f.product_name, labels[f.state], `v${f.version}`]
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
                if (!readOnly) save(false);
              }}
            >
              <fieldset disabled={readOnly || state.busy}>
                <legend>Datos generales</legend>
                <label>
                  Producto
                  <select
                    required
                    disabled={mode === "version" || mode === "variation"}
                    value={draft.product}
                    onChange={(e) => field("product", e.target.value)}
                  >
                    <option value="">Seleccionar</option>
                    {catalog.products
                      .filter((p: Row) => p.active || p.id === draft.product)
                      .map((p: Row) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.active ? "" : " (inactivo)"}
                        </option>
                      ))}
                  </select>
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
                  Código de fórmula
                  <input
                    value={draft.code || ""}
                    maxLength={40}
                    required
                    readOnly={mode === "version"}
                    onChange={(e) => field("code", e.target.value)}
                  />
                </label>
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
                      switchCapture(e.target.value as "quantity" | "percentage")
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
              {readOnly && (
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
              {rowsTable("packaging")}
              <section className="formula-summary">
                <div>
                  <span>Porcentajes de ingredientes</span>
                  <strong>
                    {math.compatible || draft.capture_mode === "percentage"
                      ? `${number(math.percentageTotal)} %`
                      : math.rows.some(
                            (r) => r.quantity === null || !r.material,
                          )
                        ? "Pendiente de completar"
                        : "Unidades de distintas dimensiones"}
                  </strong>
                </div>
                <div>
                  <span>Ingredientes · costo base estimado</span>
                  <strong>
                    {money(math.ingredientCost, catalog.currency)}
                  </strong>
                </div>
                <div>
                  <span>Empaque · costo estimado</span>
                  <strong>{money(math.packagingCost, catalog.currency)}</strong>
                </div>
                <div>
                  <span>Total base estimado</span>
                  <strong>{money(math.totalCost, catalog.currency)}</strong>
                </div>
                {math.missingCosts > 0 && (
                  <p className="form-wide muted">
                    Hay {math.missingCosts} fila(s) sin precio vigente en{" "}
                    {catalog.currency}. Subtotal conocido:{" "}
                    {money(math.knownCost, catalog.currency)}. No se sustituyen
                    precios faltantes por cero.
                  </p>
                )}
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
              <div className="form-actions">
                {!readOnly && (
                  <AppButton disabled={state.busy}>Guardar</AppButton>
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
    </>
  );
}
