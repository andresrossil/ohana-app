import { useEffect, useState } from "react";
import { request } from "./commerce";
import {
  keyedRequest,
  money,
  today,
  useOperation,
  type Row,
} from "./operations";
import SearchSelect from "./SearchSelect";
import ResponsiveTable from "./ResponsiveTable";
import MoneyInput from "./MoneyInput";
import AutoTextarea from "./AutoTextarea";
import { AppButton, AppIcon } from "./AppIcon";
import { confirmAction } from "./ConfirmDialog";
import { parseTSV, formatTSV, parseNumber } from "./sheet-model";
import { priceCost } from "./price-cost";
import { weightMatches } from "./variant-weights";
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
const columns = [
  ["article", "Artículo (SKU o nombre)"],
  ["weight", "Peso real (g)"],
  ["lot", "Lote"],
  ["external_code", "Identificador individual"],
  ["quantity", "Cantidad"],
  ["unit", "Unidad"],
  ["unit_cost", "Costo unitario"],
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
  currency,
  onClose,
  onSaved,
  reversal,
  correction,
}: {
  company: string;
  currency: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  reversal?: string;
  correction?: string;
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
      reversal ? "reversal" : correction ? "adjust_in" : "opening",
    ),
    [date, setDate] = useState(today()),
    [reason, setReason] = useState(""),
    [notes, setNotes] = useState(""),
    [review, setReview] = useState<Row | null>(null),
    [ack, setAck] = useState(false),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    state.run(async () => {
      const c = await inventoryRequest(company, "catalog");
      const [math, formulas] = await Promise.all([
        request("formula_catalog", { p_company: company }).catch(() => null),
        request("formula_command", {
          p_company: company,
          p_action: "list",
        }).catch(() => []),
      ]);
      setCat({ ...c, math, formulas });
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
    const estimate =
      a?.item_kind === "variant" && cat.math
        ? priceCost(a, cat.formulas, cat.math).manufacturingCost
        : null;
    return {
      ...r,
      article: key,
      item_kind: a?.item_kind,
      item_id: a?.id,
      unit_id: unit || "",
      unit_cost: outgoing ? "" : (estimate ?? a?.suggested_cost ?? ""),
      cost_manual: false,
      lot_id: "",
      individual_unit_id: "",
      external_code: "",
      unresolved: "",
      quantity: a?.weight_min != null ? "1" : r.quantity,
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
      "peso real (g)": "weight",
      peso: "weight",
      lote: "lot",
      cantidad: "quantity",
      unidad: "unit",
      um: "unit",
      "costo unitario": "unit_cost",
      costo: "unit_cost",
      observaciones: "notes",
      "identificador individual": "external_code",
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
      r = resolveWeight(r);
      next[idx] = r;
    });
    changed();
    setRows(next);
    state.setError(errors.join("\n"));
  }
  function resolveWeight(r: Row): Row {
    if (outgoing || r.item_kind !== "variant" || !r.weight) return r;
    const selected = cat.variants.find((v: Row) => v.id === r.item_id);
    if (!selected) return r;
    const matches = weightMatches(
      cat.variants.filter(
        (v: Row) => v.product_id === selected.product_id && v.active,
      ),
      selected.attributes || {},
      Number(r.weight),
    );
    if (matches.length !== 1) return r;
    const match = matches[0];
    const a = articles.find((a) => a.id === match.id);
    const estimate =
      a && cat.math
        ? priceCost(
            {
              ...a,
              weight_min: Number(r.weight),
              weight_max: Number(r.weight),
            },
            cat.formulas,
            cat.math,
          ).manufacturingCost
        : null;
    return {
      ...r,
      item_id: match.id,
      article: "v:" + match.id,
      quantity: "1",
      ...(!r.cost_manual
        ? { unit_cost: estimate ?? a?.suggested_cost ?? "" }
        : {}),
    };
  }
  function payload() {
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
              unit_cost: r.unit_cost === "" ? null : r.unit_cost,
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
      setReview(await inventoryRequest(company, "review", payload()));
      setAck(false);
    });
  }
  return (
    <div className="overlay">
      <section
        className="modal inventory-adjustment"
        role="dialog"
        aria-modal="true"
        aria-label="Ajuste de existencias"
        data-navigation-dirty={dirty}
        aria-busy={state.busy}
      >
        <header className="catalog-head">
          <h2>Ajuste de existencias</h2>
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
            <label>
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
            </label>
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
                <small>
                  Pega aquí sin crear filas. Usa SKU, nombre exacto o código de
                  barras existente. Una fila por barra con su peso real. Las
                  cantidades siempre son positivas; el tipo determina entrada o
                  salida.
                </small>
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
                      {columns.map((c) => (
                        <th key={c[0]}>{c[1]}</th>
                      ))}
                      <th>Valor</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const a = articles.find((a) => a.key === r.article),
                        bu = cat.units.find((u: Row) => u.id === a?.unit_id),
                        u = cat.units.find((u: Row) => u.id === r.unit_id),
                        lot = cat.lots.find((l: Row) => l.id === r.lot_id),
                        physical = cat.physical.find(
                          (p: Row) => p.id === r.individual_unit_id,
                        ),
                        historic =
                          physical?.cost_snapshot?.manufacturing_cost ??
                          lot?.unit_cost,
                        cost = outgoing
                          ? historic == null
                            ? null
                            : Number(historic) *
                              (a?.item_kind === "material"
                                ? Number(u?.base_factor) /
                                  Number(bu?.base_factor)
                                : 1)
                          : parseNumber(String(r.unit_cost)),
                        qty = parseNumber(String(r.quantity));
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
                                    const unit = cat.units.find(
                                      (u: Row) => u.id === e.target.value,
                                    );
                                    update(i, {
                                      unit_id: e.target.value,
                                      ...(!r.cost_manual && !outgoing && a
                                        ? {
                                            unit_cost:
                                              a.suggested_cost == null
                                                ? ""
                                                : (Number(a.suggested_cost) *
                                                    Number(unit?.base_factor)) /
                                                  Number(bu?.base_factor),
                                          }
                                        : {}),
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
                              ) : key === "lot" ? (
                                outgoing ? (
                                  <SearchSelect
                                    value={r.lot_id}
                                    onChange={(e) =>
                                      update(i, {
                                        lot_id: e.target.value,
                                        individual_unit_id: "",
                                      })
                                    }
                                  >
                                    <option value="">Seleccionar lote</option>
                                    {cat.lots
                                      .filter(
                                        (l: Row) =>
                                          l.item_id === r.item_id &&
                                          l.item_kind === r.item_kind &&
                                          Number(l.remaining) > 0 &&
                                          !l.blocked,
                                      )
                                      .map((l: Row) => (
                                        <option key={l.id} value={l.id}>
                                          {l.label || l.id} · Disponible:{" "}
                                          {l.remaining}
                                        </option>
                                      ))}
                                  </SearchSelect>
                                ) : (
                                  <input
                                    value={r.lot_label}
                                    maxLength={120}
                                    onChange={(e) =>
                                      update(i, { lot_label: e.target.value })
                                    }
                                  />
                                )
                              ) : key === "external_code" &&
                                outgoing &&
                                a?.item_kind === "variant" ? (
                                <SearchSelect
                                  value={r.individual_unit_id || ""}
                                  onChange={(e) => {
                                    const p = cat.physical.find(
                                      (p: Row) => p.id === e.target.value,
                                    );
                                    update(i, {
                                      individual_unit_id: p?.id || "",
                                      lot_id: p?.lot_id || r.lot_id,
                                      quantity: p ? "1" : r.quantity,
                                      weight: p?.weight || "",
                                      external_code: "",
                                    });
                                  }}
                                >
                                  <option value="">
                                    Seleccionar unidad física
                                  </option>
                                  {cat.physical
                                    .filter(
                                      (p: Row) =>
                                        p.variant_id === r.item_id &&
                                        (!r.lot_id || p.lot_id === r.lot_id),
                                    )
                                    .map((p: Row) => (
                                      <option key={p.id} value={p.id}>
                                        {p.external_code || "U-" + p.id} ·{" "}
                                        {p.weight == null
                                          ? "Sin peso real"
                                          : p.weight + " g"}
                                      </option>
                                    ))}
                                </SearchSelect>
                              ) : key === "unit_cost" ? (
                                outgoing ? (
                                  <span>{money(cost, currency)}</span>
                                ) : (
                                  <MoneyInput
                                    currency={currency}
                                    value={r.unit_cost}
                                    min={0}
                                    onChange={(e) =>
                                      update(i, {
                                        unit_cost: e.target.value,
                                        cost_manual: true,
                                      })
                                    }
                                  />
                                )
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
                                  disabled={
                                    key === "external_code" &&
                                    (r.item_kind !== "variant" ||
                                      a?.weight_min == null)
                                  }
                                  step="any"
                                  min="0"
                                  readOnly={outgoing && key === "weight"}
                                  value={r[key] ?? ""}
                                  onChange={(e) =>
                                    update(
                                      i,
                                      key === "weight"
                                        ? resolveWeight({
                                            ...r,
                                            weight: e.target.value,
                                          })
                                        : { [key]: e.target.value },
                                    )
                                  }
                                />
                              )}
                            </td>
                          ))}
                          <td>
                            {money(
                              qty == null || cost == null ? null : qty * cost,
                              currency,
                            )}
                          </td>
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
              <p>
                {inventoryKinds[review.kind]} · {review.date} · {review.reason}
              </p>
              <p>
                {review.quantity_totals
                  ?.map((x: Row) => `${x.quantity} ${x.unit}`)
                  .join(" · ")}{" "}
                · Valor conocido: {money(review.known_total, currency)}
                {Number(review.pending_costs) > 0 &&
                  ` · ${review.pending_costs} costos pendientes`}
              </p>
              <div className="table-wrap">
                <ResponsiveTable>
                  <thead>
                    <tr>
                      {[
                        "Artículo",
                        "Cantidad",
                        "Unidad",
                        "Costo unitario",
                        "Valor",
                        "Lote / Unidad",
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {review.lines.map((r: Row) => (
                      <tr key={r.line_key}>
                        <td>
                          {r.snapshot.sku} · {r.snapshot.name}
                          <small>{r.snapshot.variant}</small>
                        </td>
                        <td>{r.quantity}</td>
                        <td>{r.snapshot.input_unit}</td>
                        <td>{money(r.unit_cost, currency)}</td>
                        <td>{money(r.total_value, currency)}</td>
                        <td>
                          {r.lot_label || r.lot_id}
                          {r.weight && (
                            <small>
                              {r.weight} g ·{" "}
                              {r.external_code ||
                                r.individual_unit_id ||
                                "ID automático"}
                            </small>
                          )}
                        </td>
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
                      { ...payload(), proof: review.proof, acknowledged: ack },
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
