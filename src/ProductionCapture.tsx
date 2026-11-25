import { useEffect, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import ProductionMenu from "./ProductionMenu";
import { confirmAction } from "./ConfirmDialog";
import { AppButton } from "./AppIcon";
import AutoTextarea from "./AutoTextarea";
import { money, type Row } from "./operations";
import ResponsiveTable from "./ResponsiveTable";
import { variantLabel } from "./variant-label";
import { weightMatches, weightRangeLabel, type WeightVariant } from "./variant-weights";

export const parseProductionWeights = (value = "") =>
  value.trim().split(/\s+/).filter(Boolean).map(weight => Number(weight.replace(",", ".")));
export const productionWeightTotal = (weights: number[]) =>
  weights.reduce((sum, weight) => sum + Math.round(weight * 10000), 0) / 10000;
export const usesProductionWeights = (openingWeights: boolean, variant: Row) =>
  openingWeights && variant.weight_min != null;

export default function ProductionCapture({
  variants, prices, priceStatus, openingWeights, units, weights, setValue, scrap, refresh, busy,
}: {
  variants: (Row & WeightVariant)[];
  prices: Map<string, Row>;
  priceStatus: "loading" | "ready" | "unavailable";
  openingWeights: boolean;
  units: Record<string, string>;
  weights: Record<string, string>;
  setValue: (id: string, value: string, weighed: boolean) => void;
  scrap: string;
  refresh: () => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState<"grams" | "price">(openingWeights ? "grams" : "price");
  const [input, setInput] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [showAll, setShowAll] = useState(false);
  const [message, setMessage] = useState("");
  const [edit, setEdit] = useState<{ id: string; kind: "quantity" | "weights" }>();
  const [editQuantity, setEditQuantity] = useState("");
  const [editWeights, setEditWeights] = useState("");
  const [removed, setRemoved] = useState<number[]>([]);
  const [unitIndex, setUnitIndex] = useState(0);
  const [editError, setEditError] = useState("");
  const [last, setLast] = useState<{ id: string; before: string; after: string; weighed: boolean; label: string }>();
  const captureInput = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLElement>(null);
  useEffect(() => {
    editor.current?.scrollIntoView({ block: "nearest" });
    editor.current?.querySelector<HTMLElement>("input, select")?.focus({ preventScroll: true });
  }, [edit]);
  const code = (variant: Row) => String(variant.commercial_code || variant.sku || variant.name || "Variante");
  const rows = variants.map(variant => {
    const weighed = usesProductionWeights(openingWeights, variant);
    const recorded = parseProductionWeights(weights[variant.id]);
    const count = weighed ? recorded.length : Number(units[variant.id] || 0);
    const price = prices.get(variant.id)?.price ?? null;
    return { variant, weighed, recorded, count, price };
  }).sort((a, b) => (a.variant.weight_min == null ? Infinity : Number(a.variant.weight_min)) -
    (b.variant.weight_min == null ? Infinity : Number(b.variant.weight_min)) || Number(a.variant.weight_max ?? 0) - Number(b.variant.weight_max ?? 0) || code(a.variant).localeCompare(code(b.variant), "es", { numeric: true }));
  const currency = prices.values().next().value?.currency ?? "GTQ";
  const totalUnits = rows.reduce((sum, row) => sum + row.count, 0);
  const totalWeight = productionWeightTotal(rows.flatMap(row => row.recorded));
  const pending = rows.reduce((sum, row) => sum + (row.variant.weight_min != null && !row.weighed ? row.count : 0), 0);
  const missingPrice = rows.some(row => row.count > 0 && row.price == null);
  const valueCents = rows.reduce((sum, row) => sum + row.count * Math.round(Number(row.price ?? 0) * 100), 0);
  const formatPrice = (value: number) => currency === "GTQ" ? "Q" + value.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : money(value, currency);
  const grams = (value: number) => Number.isFinite(value) ? value.toLocaleString("es-GT", { maximumFractionDigits: 4 }) + " g" : "Revisar pesos";

  const normalized = input.trim().replace(",", ".");
  const number = Number(normalized);
  const count = Number(quantity);
  const validWeight = (value: number, variant: WeightVariant) => {
    const candidates = weightMatches(variants, variant.attributes ?? {}, value);
    return candidates.length === 1 && candidates[0].id === variant.id;
  };
  const matches = normalized ? rows.filter(row => mode === "grams"
    ? weightMatches([row.variant], row.variant.attributes ?? {}, number).length > 0
    : priceStatus === "ready" && row.price != null && Number(row.price) === number) : [];
  const preview = matches.length === 1 ? matches[0] : undefined;
  const validInput = (mode === "grams" ? /^\d+(\.\d{1,4})?$/ : /^\d+(\.\d{1,2})?$/).test(normalized)
    && Number.isFinite(number) && (mode === "price" || number > 0);
  const captureWarning = !normalized ? "" :
    !validInput ? (mode === "grams" ? "Ingresa un peso positivo con hasta cuatro decimales." : "Ingresa un precio con hasta dos decimales.") :
    mode === "price" && priceStatus !== "ready" ? "Los precios BASE no están disponibles." :
    !preview ? (matches.length ? "Hay más de una variante que coincide. Usa la edición manual."
      : mode === "grams" ? "Ninguna variante coincide con ese peso." : "Ninguna variante coincide con ese precio BASE.") :
    preview.weighed && mode === "price" ? "El saldo inicial requiere el peso real de esta variante. Usa Gramos." :
    !/^\d+$/.test(quantity) || !Number.isInteger(count) || count < 1 || totalUnits + count > 10000 ? "Ingresa una cantidad válida. El máximo es de 10,000 unidades por lote." : "";

  function add() {
    if (busy || !validInput || !preview || captureWarning) return;
    const { variant, weighed } = preview;
    const before = (weighed ? weights : units)[variant.id] ?? "";
    const after = weighed ? [before.trim(), Array(count).fill(normalized).join("\n")].filter(Boolean).join("\n")
      : String(Number(before || 0) + count);
    const label = [`${count} × ${code(variant)}`, mode === "grams" ? grams(number) : null, preview.price == null ? "Precio pendiente" : formatPrice(Number(preview.price))].filter(Boolean).join(" · ");
    setValue(variant.id, after, weighed);
    setEdit(undefined);
    setLast({ id: variant.id, before, after, weighed, label });
    setMessage("");
    setInput("");
    setQuantity("1");
    captureInput.current?.focus();
  }

  const editing = edit && rows.find(row => row.variant.id === edit.id);
  const difference = Number(editQuantity) - (editing?.count ?? 0);
  const pickUnits = !!editing?.weighed && difference < 0 && new Set(editing.recorded).size > 1;
  type CaptureRow = (typeof rows)[number];

  function openEdit(row: CaptureRow, kind: "quantity" | "weights") {
    setEdit({ id: row.variant.id, kind });
    setEditQuantity(String(row.count));
    setUnitIndex(0);
    setEditWeights(kind === "weights" ? String(row.recorded[0] ?? "") : "");
    setRemoved([]);
    setEditError("");
  }

  function applyQuantity(row: CaptureRow) {
    const next = Number(editQuantity);
    if (!editQuantity.trim() || !Number.isInteger(next) || next < 0 || totalUnits + difference > 10000) {
      setEditError("Ingresa una cantidad entera válida. El máximo es de 10,000 unidades por lote.");
      return;
    }
    if (!row.weighed) setValue(row.variant.id, String(next), false);
    else if (difference > 0) {
      const entered = parseProductionWeights(editWeights);
      if ((entered.length !== 1 && entered.length !== difference) || entered.some(weight => !validWeight(weight, row.variant))) {
        setEditError("Ingresa un peso válido para repetir o un peso por cada unidad adicional, dentro del rango de esta variante.");
        return;
      }
      const additions = entered.length === 1 ? Array(difference).fill(entered[0]) : entered;
      setValue(row.variant.id, [...row.recorded, ...additions].join("\n"), true);
    } else if (difference < 0) {
      if (pickUnits && removed.length !== -difference) {
        setEditError("Selecciona exactamente " + -difference + " unidades para retirar.");
        return;
      }
      const result = pickUnits ? row.recorded.filter((_, index) => !removed.includes(index)) : row.recorded.slice(0, next);
      setValue(row.variant.id, result.join("\n"), true);
    }
    setEdit(undefined);
    setLast(undefined);
    setMessage("Cantidad actualizada.");
  }

  function changeWeight(row: CaptureRow, remove = false) {
    const updated = [...row.recorded];
    if (remove) updated.splice(unitIndex, 1);
    else {
      const [value, ...extra] = parseProductionWeights(editWeights);
      const matches = weightMatches(variants, row.variant.attributes ?? {}, value);
      const destination = matches.length === 1 ? rows.find(candidate => candidate.variant.id === matches[0].id && candidate.weighed) : undefined;
      if (!destination || extra.length) {
        setEditError("El peso debe corresponder a una sola variante de las mismas características.");
        return;
      }
      if (destination.variant.id === row.variant.id) updated[unitIndex] = value;
      else {
        updated.splice(unitIndex, 1);
        setValue(destination.variant.id, [...destination.recorded, value].join("\n"), true);
      }
    }
    setValue(row.variant.id, updated.join("\n"), true);
    setEdit(undefined);
    setLast(undefined);
    setMessage(remove ? "Unidad eliminada." : "Peso actualizado.");
  }

  async function removeRow(row: CaptureRow) {
    const code = row.variant.commercial_code || row.variant.sku || variantLabel(row.variant);
    if (!await confirmAction(
      `¿Deseas eliminar la variante ${code} de esta captura? Se retirarán ${row.count} unidades.\nPeso real retirado: ${row.recorded.length ? grams(productionWeightTotal(row.recorded)) : "Sin peso registrado"}.\nImporte descontado: ${row.price == null ? "Pendiente de precio BASE" : formatPrice(row.count * Number(row.price))}.`,
      { title: "Eliminar fila", confirmText: "Eliminar", cancelText: "Cancelar", danger: true },
    )) return;
    setValue(row.variant.id, "", row.weighed);
    setLast(undefined);
    setMessage("Fila eliminada.");
    if (edit?.id === row.variant.id) setEdit(undefined);
  }

  return <section className="production-capture">
    <h3>Captura rápida</h3>
    <div className="production-capture-feedback" role="group" aria-label="Modalidad de captura">
      {(["grams", "price"] as const).map(option => <AppButton key={option} type="button"
        className={mode === option ? "" : "secondary"} aria-pressed={mode === option}
        disabled={busy || (option === "grams" && !openingWeights)}
        onClick={() => { if (mode !== option) { setMode(option); setInput(""); } captureInput.current?.focus(); }}>
        {option === "grams" ? "Gramos" : "Precio BASE"}
      </AppButton>)}
    </div>
    <div className="production-capture-fields">
      <label>{mode === "grams" ? "Peso por unidad (g)" : "Precio por unidad (Q)"}
        <input ref={captureInput} inputMode="decimal" enterKeyHint="done" value={input} onChange={event => setInput(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
      </label>
      <label className="production-capture-quantity">Cantidad<input type="number" inputMode="numeric" min="1" max="10000" step="1" value={quantity}
        onChange={event => setQuantity(event.target.value)} onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); add(); }
        }} /></label>
      <AppButton type="button" disabled={busy || !preview || !validInput || !!captureWarning} onClick={add}>Agregar</AppButton>
    </div>
    {normalized && <div className="production-capture-preview" aria-live="polite">
      {validInput && preview && <>
        <span><strong>{preview.variant.commercial_code || preview.variant.sku || "Variante"}</strong>
          {preview.variant.name && <> · {preview.variant.name}</>}<br />
          <small>{weightRangeLabel(preview.variant)}{!!preview.variant.attributes?.aroma && <> · {String(preview.variant.attributes.aroma)}</>}</small></span>
        <strong className={preview.price == null ? "" : "production-capture-price"}>
          {preview.price == null ? "Precio BASE pendiente" : "Precio BASE: " + formatPrice(Number(preview.price))}
        </strong>
      </>}
      {captureWarning && <small className="production-capture-warning">{captureWarning}</small>}
    </div>}
    {!openingWeights && <small>La captura por gramos está disponible para el saldo inicial.</small>}
    {priceStatus !== "ready" && <small>{priceStatus === "loading" ? "Consultando precios BASE…" : "Precios BASE no disponibles."}</small>}
    <div className="production-capture-feedback">
      <small role="status">{last ? "Última captura: " + last.label : message}</small>
      {last && <AppButton type="button" className="secondary production-capture-small" disabled={busy || (last.weighed ? weights : units)[last.id] !== last.after}
        onClick={() => { setValue(last.id, last.before, last.weighed); setLast(undefined); setEdit(undefined); setMessage("Última captura deshecha."); captureInput.current?.focus(); }}>
        <Undo2 size={14} aria-hidden="true" /> Deshacer
      </AppButton>}
    </div>

    <div className="production-capture-feedback">
      <h3>Variantes obtenidas</h3>
      <AppButton type="button" className="secondary production-capture-small" iconKey="action.refresh" disabled={busy} onClick={refresh} aria-label="Actualizar variantes" title="Actualizar variantes" />
    </div>
    <label className="check-label"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} /> Mostrar todas las variantes</label>
    {editing && edit && <section ref={editor} className="production-capture-editor" aria-label={edit.kind === "quantity" ? "Editar cantidad" : "Editar pesos individuales"}
      onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
        event.preventDefault();
        if (!busy && edit.kind === "quantity") applyQuantity(editing);
      } }}>
      <strong>{variantLabel(editing.variant)}</strong>
      {edit.kind === "quantity" ? <>
        <label>Nueva cantidad<input type="number" inputMode="numeric" min="0" max="10000" step="1" value={editQuantity}
          onChange={event => { setEditQuantity(event.target.value); setRemoved([]); setEditError(""); }} /></label>
        {editing.weighed && difference > 0 && <label>Pesos adicionales (g)
          <AutoTextarea value={editWeights} onChange={event => setEditWeights(event.target.value)}
            placeholder="Un peso por unidad o un solo peso para repetir" />
        </label>}
        {pickUnits && <div className="production-capture-pick">
          <small>Selecciona { -difference } unidades para retirar.</small>
          {editing.recorded.map((weight, index) => <label key={index} className="check-label">
            <input type="checkbox" checked={removed.includes(index)} onChange={event =>
              setRemoved(previous => event.target.checked ? [...previous, index] : previous.filter(value => value !== index))} />
            Unidad {index + 1} · {grams(weight)}
          </label>)}
        </div>}
      </> : <>
        <label>Unidad<select value={unitIndex} onChange={event => {
          const next = Number(event.target.value);
          setUnitIndex(next); setEditWeights(String(editing.recorded[next] ?? "")); setEditError("");
        }}>{editing.recorded.map((weight, index) => <option key={index} value={index}>Unidad {index + 1} · {grams(weight)}</option>)}</select></label>
        <label>Peso real (g)<input inputMode="decimal" value={editWeights} onChange={event => setEditWeights(event.target.value)} /></label>
      </>}
      {editError && <small role="alert" className="production-capture-warning">{editError}</small>}
      <div className="production-capture-feedback">
        <AppButton type="button" className="secondary production-capture-small" onClick={() => setEdit(undefined)}>Cancelar</AppButton>
        {edit.kind === "weights" && <AppButton type="button" className="danger production-capture-small" disabled={busy}
          onClick={() => changeWeight(editing, true)}>Eliminar unidad</AppButton>}
        <AppButton type="button" className="production-capture-small" disabled={busy}
          onClick={() => edit.kind === "quantity" ? applyQuantity(editing) : changeWeight(editing)}>Guardar cambio</AppButton>
      </div>
    </section>}
    {rows.some(row => row.count > 0) || showAll ? <div className="table-wrap">
      <ResponsiveTable className="production-capture-table" showAllMobileFields compactRowActions sortable={false}>
        <thead><tr><th>Variante</th><th>Ud.</th><th>Peso real</th><th>P. BASE</th><th>Total</th><th>Acciones</th></tr></thead>
        <tbody>{rows.filter(row => showAll || row.count > 0).map(row => {
          const { variant, count, recorded, price } = row;
          const weight = recorded.length ? productionWeightTotal(recorded) : null;
          return <tr key={variant.id}>
            <td data-sort-value={variant.weight_min ?? ""}><strong>{code(variant)}</strong><br /><small>{weightRangeLabel(variant)}</small></td>
            <td data-sort-value={count}>{count}</td>
            <td data-sort-value={weight ?? ""}>{weight == null ? "—" : grams(weight)}</td>
            <td className="production-capture-money" data-sort-value={price ?? ""}>{price == null ? "Pendiente" : formatPrice(Number(price))}</td>
            <td className="production-capture-money" data-sort-value={price == null ? "" : count * Number(price)}>{price == null ? "Pendiente" : formatPrice(count * Number(price))}</td>
            <td><ProductionMenu document={variant.commercial_code || variant.sku || variantLabel(variant)}>
              <AppButton type="button" className="secondary" iconKey="action.edit" disabled={busy} onClick={() => openEdit(row, "quantity")}>Editar cantidad</AppButton>
              <AppButton type="button" className="secondary" iconKey="action.edit" disabled={busy || !recorded.length}
                onClick={() => openEdit(row, "weights")}>Editar pesos individuales</AppButton>
              <AppButton type="button" className="danger" disabled={busy || !count} onClick={() => void removeRow(row)}>Eliminar fila completa</AppButton>
            </ProductionMenu></td>
          </tr>;
        })}</tbody>
      </ResponsiveTable>
    </div> : <p>Agrega unidades o muestra todas las variantes para capturarlas manualmente.</p>}
    <dl className="production-capture-totals">
      <div><dt>Unidades buenas</dt><dd>{totalUnits}</dd></div>
      <div><dt>Peso real registrado</dt><dd>{grams(totalWeight)}</dd></div>
      {pending > 0 && <div><dt>Unidades pendientes de pesaje</dt><dd>{pending}</dd></div>}
      <div><dt>Unidades dañadas</dt><dd>{scrap || "0"}</dd></div>
      <div className="production-capture-total-value"><dt>Valor comercial estimado</dt><dd>{missingPrice ? `Incompleto · ${formatPrice(valueCents / 100)} con precio` : formatPrice(valueCents / 100)}</dd><small>Importe potencial de venta</small></div>
    </dl>
  </section>;
}
