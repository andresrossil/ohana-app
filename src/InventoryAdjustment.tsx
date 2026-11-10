import { useEffect, useState } from "react";
import { request } from "./commerce";
import { keyedRequest, today, useOperation, type Row } from "./operations";
import SearchSelect from "./SearchSelect";
import ResponsiveTable from "./ResponsiveTable";
import AutoTextarea from "./AutoTextarea";
import { AppButton, AppIcon } from "./AppIcon";
import { confirmAction } from "./ConfirmDialog";
import { parseTSV, formatTSV, parseNumber } from "./sheet-model";
import { priceCost } from "./price-cost";
import "./inventory-documents.css";

export const inventoryRequest = (
  company: string,
  action: string,
  data: Row = {},
) =>
  request("inventory_command", {
    p_company: company,
    p_action: action,
    p_data: data,
  });
export const inventoryKinds: Record<string, string> = {
  opening: "Inventario inicial",
  adjust_in: "Entrada por ajuste",
  adjust_out: "Salida por ajuste",
  count: "Conteo de inventario",
  reversal: "Reversión",
  receipt: "Compra",
  production: "Producción",
  sale: "Venta",
  gift: "Regalo",
  order_reservation: "Reserva",
  order_cancel: "Cancelación",
  release: "Liberación",
  adjustment: "Ajuste anterior",
};
const columns: readonly (readonly [string, string])[] = [
  ["article", "Artículo (SKU o nombre)"],
  ["quantity", "Cantidad"],
  ["unit", "Unidad"],
  ["notes", "Observaciones"],
] as const;
const empty = (): Row => ({
  line_key: crypto.randomUUID(),
  article: "",
  quantity: "",
  unit_id: "",
  unit_cost: "",
  weight: "",
  lot_id: "",
  lot_label: "",
  external_code: "",
  notes: "",
});
const norm = (s: any) =>
  String(s ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export default function InventoryAdjustment({
  company,
  onClose,
  onSaved,
  reversal,
  correction,
  countMode = false,
}: {
  company: string;
  currency: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  reversal?: string;
  correction?: string;
  countMode?: boolean;
}) {
  const state = useOperation(company, "inventory");
  const [cat, setCat] = useState<Row>({
      materials: [],
      variants: [],
      units: [],
      lots: [],
      physical: [],
    }),
    [rows, setRows] = useState<Row[]>([]),
    [kind, setKind] = useState(
      countMode ? "count" : reversal ? "reversal" : correction ? "adjust_in" : "opening",
    ),
    [date, setDate] = useState(today()),
    [reason, setReason] = useState(countMode ? "Conteo físico de inventario" : ""),
    [notes, setNotes] = useState(""),
    [review, setReview] = useState<Row | null>(null),
    [ack, setAck] = useState(false),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    state.run(async () => {
      const c = await inventoryRequest(company, "catalog");
      setCat(c);
    });
  }, [company]);
  const articles: Row[] = [
    ...cat.materials.map((m: Row) => ({
      ...m,
      key: "m:" + m.id,
      item_kind: "material",
      label: [m.sku, m.name].filter(Boolean).join(" · "),
    })),
    ...cat.variants.map((v: Row) => ({
      ...v,
      key: "v:" + v.id,
      item_kind: "variant",
      label: [v.sku, v.product_name, v.label].filter(Boolean).join(" · "),
    })),
  ];
  const outgoing = kind === "adjust_out";
  const num=(n:any)=>n==null?"—":Number(n).toLocaleString("es-GT",{maximumFractionDigits:8});
  const displayColumns=columns.map(([key,label])=>[key,countMode&&key==="quantity"?"Cantidad real":label] as const);
  function countValues(r:Row){
    const a=articles.find(x=>x.key===r.article),unit=cat.units.find((u:Row)=>u.id===r.unit_id),base=cat.units.find((u:Row)=>u.id===a?.unit_id);
    const factor=a?.item_kind==="variant"?1:unit&&base?Number(unit.base_factor)/Number(base.base_factor):null;
    const balance=cat.balances?.find((b:Row)=>b.item_kind===r.item_kind&&b.item_id===r.item_id);
    const theoretical=a&&factor?Number(balance?.on_hand||0)/factor:null;
    return {theoretical,difference:theoretical!=null&&r.quantity!==""?Number(r.quantity)-theoretical:null};
  }
  function changed() {
    setDirty(true);
    setReview(null);
    setAck(false);
  }
  function update(index: number, patch: Row) {
    changed();
    setRows((old) => old.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  function selectArticle(r: Row, key: string): Row {
    const a = articles.find((x) => x.key === key);
    const unit =
      a?.item_kind === "material"
        ? a.unit_id
        : cat.units.find(
            (u: Row) =>
              u.dimension === "count" &&
              Number(u.base_factor) === 1 &&
              u.symbol === "ud",
          )?.id ||
          cat.units.find(
            (u: Row) => u.dimension === "count" && Number(u.base_factor) === 1,
          )?.id;
    return {
      ...r,
      article: key,
      item_kind: a?.item_kind,
      item_id: a?.id,
      unit_id: unit || "",
      lot_id: "",
      individual_unit_id: "",
      external_code: "",
      unresolved: "",
      quantity: r.quantity,
    };
  }
  function findArticle(value: string) {
    const n = norm(value);
    const exact = articles.filter((a) =>
      [a.sku, a.barcode, a.label, a.name].some((x) => x && norm(x) === n),
    );
    return exact.length === 1 ? exact[0] : undefined;
  }
  function paste(text: string, start = rows.length, col = 0) {
    const matrix = parseTSV(text).filter((r) => r.some((c) => c.trim()));
    if (!matrix.length) return;
    let mapping: string[] = columns.map((x) => x[0]);
    const aliases: Record<string, string> = {
      sku: "article",
      codigo: "article",
      "codigo de articulo": "article",
      articulo: "article",
      material: "article",
      nombre: "article",
      producto: "article",
      "peso real (g)": "ignore",
      peso: "ignore",
      lote: "ignore",
      cantidad: "quantity",
      "cantidad real": "quantity",
      unidad: "unit",
      um: "unit",
      "costo unitario": "ignore",
      costo: "ignore",
      "monto total": "ignore",
      valor: "ignore",
      observaciones: "notes",
      "identificador individual": "ignore",
    };
    const header = matrix[0].map(
      (v) =>
        aliases[norm(v)] || columns.find((c) => norm(c[1]) === norm(v))?.[0],
    );
    if (header.includes("article") && header.filter(Boolean).length >= 2) {
      mapping = header.map((x) => x || "ignore");
      const preferred = matrix[0].findIndex((v) =>
        ["sku", "codigo", "codigo de articulo"].includes(norm(v)),
      );
      if (preferred >= 0)
        mapping = mapping.map((f, i) =>
          f === "article" && i !== preferred ? "ignore" : f,
        );
      matrix.shift();
      col = 0;
    }
    if (matrix.length + start > 500) {
      state.setError("Máximo 500 filas por documento.");
      return;
    }
    const next = rows.map((r) => ({ ...r }));
    const errors: string[] = [];
    matrix.forEach((cells, j) => {
      const idx = start + j;
      let r = next[idx] || empty();
      cells.forEach((value, k) => {
        const field = mapping[k + col];
        if (!field) return;
        if (field === "article") {
          const a = findArticle(value);
          if (a) r = selectArticle(r, a.key);
          else {
            r.article = "";
            r.unresolved = value;
            errors.push(`Fila ${idx + 1}: artículo no identificado: ${value}`);
          }
        } else if (field === "unit") {
          const u = cat.units.filter(
            (u: Row) =>
              norm(u.symbol) === norm(value) || norm(u.name) === norm(value),
          );
          if (u.length === 1) r.unit_id = u[0].id;
          else if (value.trim())
            errors.push(`Fila ${idx + 1}: unidad no identificada: ${value}`);
        } else if (field === "lot") {
          if (outgoing) {
            const lots = cat.lots.filter(
              (l: Row) =>
                l.item_id === r.item_id &&
                (norm(l.label) === norm(value) || norm(l.id) === norm(value)),
            );
            r.lot_id = lots.length === 1 ? lots[0].id : "";
            if (value && !r.lot_id)
              errors.push(`Fila ${idx + 1}: lote no identificado`);
          } else r.lot_label = value;
        } else if (["quantity", "weight", "unit_cost"].includes(field)) {
          const n = value.trim() ? parseNumber(value) : null;
          if (value.trim() && n == null)
            errors.push(`Fila ${idx + 1}: número inválido`);
          r[field] = n == null ? "" : String(n);
          if (field === "unit_cost") r.cost_manual = true;
        } else if (field !== "ignore") r[field] = value;
      });
      next[idx] = r;
    });
    changed();
    setRows(next);
    state.setError(errors.join("\n"));
  }
  function payload(catalog = cat) {
    return {
      kind,
      ...(correction ? { corrects_id: correction } : {}),
      date,
      reason,
      notes,
      ...(reversal
        ? { reverses_id: reversal }
        : {
            lines: rows.map((r) => ({
              line_key: r.line_key,
              item_kind: r.item_kind,
              item_id: r.item_id,
              quantity: r.quantity,
              unit_id: r.unit_id || null,
              cost_mode: "current",
              unit_cost:
                r.item_kind === "variant" && catalog.math
                  ? (priceCost(
                      catalog.variants.find((v: Row) => v.id === r.item_id) ||
                        {},
                      catalog.formulas,
                      catalog.math,
                    ).manufacturingCost ?? null)
                  : null,
              weight: r.weight || null,
              lot_id: r.lot_id || null,
              lot_label: r.lot_label,
              individual_unit_id: r.individual_unit_id || null,
              external_code: r.external_code,
              notes: r.notes,
            })),
          }),
    };
  }
  async function currentPayload() {
    if (reversal) return payload();
    const c = await inventoryRequest(company, "catalog");
    if(countMode)setCat(c);
    if (!rows.some((r) => r.item_kind === "variant")) return payload(c);
    const [math, formulas] = await Promise.all([
      request("formula_catalog", { p_company: company }),
      request("formula_command", { p_company: company, p_action: "list" }),
    ]);
    return payload({ ...c, math, formulas });
  }
  async function close() {
    if (state.busy) return;
    if (
      !dirty ||
      (await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?"))
    )
      onClose();
  }
  async function preview() {
    await state.run(async () => {
      if (rows.some((r) => !r.item_id) && !reversal)
        throw Error("Selecciona un artículo válido en todas las filas.");
      setReview(
        await inventoryRequest(company, "review", await currentPayload()),
      );
      setAck(false);
    });
  }
  return (
    <div className="overlay">
      <section
        className="modal inventory-adjustment"
        role="dialog"
        aria-modal="true"
        aria-label={countMode?"Conteo de inventario":"Ajuste de existencias"}
        data-navigation-dirty={dirty}
        aria-busy={state.busy}
      >
        <header className="catalog-head">
          <h2>{countMode?"Conteo de inventario":"Ajuste de existencias"}</h2>
          <AppButton
            className="secondary"
            disabled={state.busy}
            onClick={close}
          >
            Cerrar
          </AppButton>
        </header>
        <fieldset disabled={state.busy}>
          <div className="settings-grid">
            {countMode?<label>Tipo de registro<input readOnly value="Conteo físico · entrada o salida automática"/></label>:<label>
              Tipo de movimiento
              <SearchSelect
                value={kind}
                disabled={!!reversal || state.busy}
                onChange={(e) => {
                  changed();
                  setKind(e.target.value);
                  setRows(
                    rows.map((r) => ({
                      ...r,
                      unit_cost: "",
                      lot_id: "",
                      individual_unit_id: "",
                    })),
                  );
                }}
              >
                {[
                  ...(correction ? [] : ["opening"]),
                  "adjust_in",
                  "adjust_out",
                  ...(reversal ? ["reversal"] : []),
                ].map((k) => (
                  <option key={k} value={k}>
                    {inventoryKinds[k]}
                  </option>
                ))}
              </SearchSelect>
            </label>}
            <label>
              Fecha efectiva
              <input
                type="date"
                max={today()}
                value={date}
                onChange={(e) => {
                  changed();
                  setDate(e.target.value);
                }}
              />
            </label>
            <label>
              Número de documento
              <input readOnly value="Automático al confirmar · INV-000001…" />
            </label>
            <label>
              Motivo obligatorio
              <AutoTextarea
                maxLength={500}
                value={reason}
                onChange={(e) => {
                  changed();
                  setReason(e.target.value);
                }}
              />
            </label>
            <label>
              Observaciones
              <AutoTextarea
                maxLength={2000}
                value={notes}
                onChange={(e) => {
                  changed();
                  setNotes(e.target.value);
                }}
              />
            </label>
          </div>
          {reversal && (
            <p className="inventory-hint">
              La reversión utiliza las líneas y costos históricos del documento
              original. Solo puede confirmarse si las existencias y unidades
              correspondientes están disponibles.
            </p>
          )}
          {correction && (
            <p className="inventory-hint">
              Corrección vinculada al documento {correction}. Registra
              únicamente la diferencia de entrada o salida; el original se
              conserva.
            </p>
          )}
          {state.error && (
            <p className="error" role="alert">
              <AppIcon name="status.error" />
              {state.error}
            </p>
          )}
          {!reversal && (
            <>
              <section className="inventory-paste">
                <label>
                  Pegar filas desde Excel
                  <textarea
                    rows={2}
                    placeholder={columns.map((c) => c[1]).join(" | ")}
                    value=""
                    onChange={() => {}}
                    onPaste={(e) => {
                      e.preventDefault();
                      paste(e.clipboardData.getData("text"));
                    }}
                  />
                </label>
                {countMode?<small>Captura la cantidad física total que encontraste, incluido cero. Solo se ajustarán los artículos capturados. El sistema comparará contra el físico teórico y registrará la diferencia; los costos se toman automáticamente. El teórico se valida nuevamente antes de confirmar.</small>:<small>
                  Pega aquí sin crear filas. Usa SKU, nombre exacto o código de
                  barras existente. Ingresa únicamente cantidades. El costo
                  vigente se asigna automáticamente al confirmar. Las cantidades
                  siempre son positivas; el tipo determina entrada o salida.
                </small>}
              </section>
              <div className="actions">
                <AppButton
                  className="secondary"
                  disabled={state.busy}
                  onClick={() => {
                    changed();
                    setRows([...rows, empty()]);
                  }}
                >
                  Agregar fila
                </AppButton>
                <AppButton
                  className="secondary"
                  onClick={() =>
                    state.run(async () => {
                      await navigator.clipboard.writeText(
                        formatTSV([
                          columns.map((c) => c[1]),
                          ...rows.map((r) =>
                            columns.map(([key]) =>
                              key === "article"
                                ? articles.find((a) => a.key === r.article)
                                    ?.sku ||
                                  r.unresolved ||
                                  ""
                                : key === "unit"
                                  ? cat.units.find(
                                      (u: Row) => u.id === r.unit_id,
                                    )?.symbol || ""
                                  : key === "lot"
                                    ? outgoing
                                      ? r.lot_id
                                      : r.lot_label
                                    : String(r[key] ?? ""),
                            ),
                          ),
                        ]),
                      );
                    })
                  }
                >
                  Copiar tabla
                </AppButton>
              </div>
              <div className="table-wrap">
                <ResponsiveTable
                  className="inventory-edit-table"
                  onSortRows={(indexes) => {
                    setReview(null);
                    setRows(indexes.map((i) => rows[i]));
                  }}
                >
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Tipo de artículo</th>
                      {displayColumns.map((c) => (
                        <th key={c[0]}>{c[1]}</th>
                      ))}
                      {countMode&&<><th>Teórico</th><th>Diferencia</th></>}
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const a = articles.find((a) => a.key === r.article),
                        bu = cat.units.find((u: Row) => u.id === a?.unit_id);
                      return (
                        <tr key={r.line_key}>
                          <td>{i + 1}</td>
                          <td>
                            {r.item_kind === "material"
                              ? "Material"
                              : r.item_kind === "variant"
                                ? "Producto terminado"
                                : "—"}
                          </td>
                          {columns.map(([key], ci) => (
                            <td
                              key={key}
                              onPaste={(e) => {
                                if (
                                  e.clipboardData
                                    .getData("text")
                                    .includes("\t") ||
                                  e.clipboardData.getData("text").includes("\n")
                                ) {
                                  e.preventDefault();
                                  paste(e.clipboardData.getData("text"), i, ci);
                                }
                              }}
                            >
                              {key === "article" ? (
                                <>
                                  <SearchSelect
                                    value={r.article}
                                    onChange={(e) =>
                                      update(
                                        i,
                                        selectArticle(r, e.target.value),
                                      )
                                    }
                                  >
                                    <option value="">
                                      Seleccionar artículo
                                    </option>
                                    {articles.map((a) => (
                                      <option key={a.key} value={a.key}>
                                        {a.label}
                                      </option>
                                    ))}
                                  </SearchSelect>
                                  {r.unresolved && (
                                    <small className="error">
                                      {r.unresolved}
                                    </small>
                                  )}
                                </>
                              ) : key === "unit" ? (
                                <SearchSelect
                                  value={r.unit_id}
                                  onChange={(e) => {
                                    update(i, {
                                      unit_id: e.target.value,
                                    });
                                  }}
                                >
                                  <option value="">Seleccionar</option>
                                  {cat.units
                                    .filter((x: Row) =>
                                      a?.item_kind === "variant"
                                        ? x.dimension === "count" &&
                                          Number(x.base_factor) === 1
                                        : !bu || x.dimension === bu.dimension,
                                    )
                                    .map((u: Row) => (
                                      <option key={u.id} value={u.id}>
                                        {u.name} ({u.symbol})
                                      </option>
                                    ))}
                                </SearchSelect>
                              ) : key === "notes" ? (
                                <AutoTextarea
                                  value={r.notes}
                                  maxLength={1000}
                                  onChange={(e) =>
                                    update(i, { notes: e.target.value })
                                  }
                                />
                              ) : (
                                <input
                                  type={
                                    ["weight", "quantity"].includes(key)
                                      ? "number"
                                      : "text"
                                  }
                                  step="any"
                                  min="0"
                                  readOnly={outgoing && key === "weight"}
                                  value={r[key] ?? ""}
                                  onChange={(e) =>
                                    update(i, { [key]: e.target.value })
                                  }
                                />
                              )}
                            </td>
                          ))}

                          {countMode&&<><td data-sort-value={countValues(r).theoretical}>{num(countValues(r).theoretical)}</td><td data-sort-value={countValues(r).difference} className={Number(countValues(r).difference)<0?"balance-debt":"balance-credit"}>{num(countValues(r).difference)}</td></>}
                          <td>
                            <AppButton
                              className="danger"
                              disabled={state.busy}
                              onClick={() => {
                                changed();
                                setRows(rows.filter((_, j) => j !== i));
                              }}
                            >
                              Quitar
                            </AppButton>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </ResponsiveTable>
              </div>
            </>
          )}
          {review && (
            <section className="inventory-review">
              <h3>Revisar documento · {review.line_count} líneas</h3>
              {countMode&&<p>{review.changed_count} artículos con diferencia · {review.unchanged_count} sin movimiento. Las filas sin diferencia se conservarán en la captura histórica y no generarán entradas ni salidas.</p>}
              <p>
                {inventoryKinds[review.kind]} · {review.date} · {review.reason}
              </p>
              <p>
                {review.quantity_totals
                  ?.map((x: Row) => `${x.quantity} ${x.unit}`)
                  .join(" · ")}{" "}
              </p>
              <div className="table-wrap">
                <ResponsiveTable>
                  <thead>
                    <tr>
                      {(countMode?["Artículo","Teórico","Cantidad real","Diferencia","Movimiento","Unidad"]:["Artículo", "Cantidad", "Unidad"]).map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(countMode?review.counts:review.lines).map((r: Row) => (
                      <tr key={r.line_key}>
                        <td>
                          {(r.snapshot||r).sku} · {(r.snapshot||r).name}
                          <small>{(r.snapshot||r).variant}</small>
                        </td>
                        {countMode?<><td data-sort-value={r.theoretical}>{num(r.theoretical)}</td><td data-sort-value={r.actual}>{num(r.actual)}</td><td data-sort-value={r.difference}>{num(r.difference)}</td><td>{Number(r.difference)>0?"Entrada":Number(r.difference)<0?"Salida":"Sin movimiento"}</td><td>{r.unit}</td></>:<><td>{r.quantity}</td><td>{r.snapshot.input_unit}</td></>}
                      </tr>
                    ))}
                  </tbody>
                </ResponsiveTable>
              </div>
              {review.warnings.length > 0 && (
                <>
                  <ul>
                    {review.warnings.map((s: string, i: number) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                    />
                    Entiendo las advertencias y confirmo el registro, incluyendo
                    los costos pendientes.
                  </label>
                </>
              )}
            </section>
          )}
          <div className="actions">
            <AppButton
              disabled={
                state.busy || !reason.trim() || (!reversal && !rows.length)
              }
              onClick={preview}
            >
              Revisar documento
            </AppButton>
            {review && (
              <AppButton
                disabled={state.busy || (review.warnings.length > 0 && !ack)}
                onClick={() =>
                  state.run(async () => {
                    await keyedRequest(
                      company,
                      "inventory_command",
                      {
                        ...(await currentPayload()),
                        proof: review.proof,
                        acknowledged: ack,
                      },
                      "confirm",
                    );
                    setDirty(false);
                    setReview(null);
                    try {
                      await onSaved();
                    } finally {
                      onClose();
                    }
                  })
                }
              >
                Confirmar documento
              </AppButton>
            )}
            <AppButton
              className="secondary"
              disabled={state.busy}
              onClick={close}
            >
              Cancelar
            </AppButton>
          </div>
        </fieldset>
      </section>
    </div>
  );
}
