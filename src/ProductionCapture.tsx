import { useRef, useState } from "react";
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
  const [multiple, setMultiple] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [showAll, setShowAll] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [last, setLast] = useState<{ id: string; before: string; after: string; weighed: boolean; label: string }>();
  const captureInput = useRef<HTMLInputElement>(null);
  const rows = variants.map(variant => {
    const weighed = usesProductionWeights(openingWeights, variant);
    const recorded = parseProductionWeights(weights[variant.id]);
    const count = weighed ? recorded.length : Number(units[variant.id] || 0);
    const price = prices.get(variant.id)?.price ?? null;
    return { variant, weighed, recorded, count, price };
  }).sort((a, b) => (a.variant.weight_min == null ? Infinity : Number(a.variant.weight_min)) -
    (b.variant.weight_min == null ? Infinity : Number(b.variant.weight_min)) || variantLabel(a.variant).localeCompare(variantLabel(b.variant), "es"));
  const currency = prices.values().next().value?.currency ?? "GTQ";
  const totalUnits = rows.reduce((sum, row) => sum + row.count, 0);
  const totalWeight = productionWeightTotal(rows.flatMap(row => row.recorded));
  const pending = rows.reduce((sum, row) => sum + (row.variant.weight_min != null && !row.weighed ? row.count : 0), 0);
  const missingPrice = rows.some(row => row.count > 0 && row.price == null);
  const valueCents = rows.reduce((sum, row) => sum + row.count * Math.round(Number(row.price ?? 0) * 100), 0);
  const grams = (value: number) => Number.isFinite(value) ? value.toLocaleString("es-GT", { maximumFractionDigits: 4 }) + " g" : "Revisar pesos";

  function add() {
    if (busy) return;
    setError("");
    const normalized = input.trim().replace(",", ".");
    const number = Number(normalized);
    const count = multiple ? Number(quantity) : 1;
    if (!(mode === "grams" ? /^\d+(\.\d{1,4})?$/ : /^\d+(\.\d{1,2})?$/).test(normalized)
      || !Number.isFinite(number) || (mode === "grams" && number <= 0)) {
      setError(mode === "grams" ? "Ingresa un peso positivo con hasta cuatro decimales." : "Ingresa un precio con hasta dos decimales.");
      return;
    }
    if (!Number.isInteger(count) || count < 1 || totalUnits + count > 10000) {
      setError("Ingresa una cantidad entera positiva. El máximo es de 10,000 unidades por lote.");
      return;
    }
    if (mode === "price" && priceStatus !== "ready") {
      setError("Los precios BASE no están disponibles. Actualiza las variantes o usa la captura manual.");
      return;
    }
    const matches = rows.filter(row => mode === "grams"
      ? weightMatches([row.variant], row.variant.attributes ?? {}, number).length > 0
      : row.price != null && Number(row.price) === number);
    if (matches.length !== 1) {
      setError(matches.length > 1 ? "Hay más de una variante que coincide. Registra la unidad manualmente."
        : mode === "grams" ? "Ninguna variante coincide con ese peso." : "Ninguna variante coincide con ese precio BASE.");
      return;
    }
    const { variant, weighed } = matches[0];
    if (weighed && mode === "price") {
      setError("El saldo inicial requiere el peso real de cada unidad de esta variante. Usa Gramos.");
      return;
    }
    const before = (weighed ? weights : units)[variant.id] ?? "";
    const after = weighed ? [before.trim(), Array(count).fill(normalized).join("\n")].filter(Boolean).join("\n")
      : String(Number(before || 0) + count);
    const label = `${count} × ${variantLabel(variant)} · ${mode === "grams" ? grams(number) : money(number, currency)} por unidad`;
    setValue(variant.id, after, weighed);
    setLast({ id: variant.id, before, after, weighed, label });
    setMessage("");
    setInput("");
    setQuantity("1");
    captureInput.current?.focus();
  }

  return <section className="production-capture">
    <h3>Captura rápida</h3>
    <div className="production-capture-fields">
      <label>Modalidad<select value={mode} onChange={event => {
        setMode(event.target.value as "grams" | "price"); setInput(""); setError(""); captureInput.current?.focus();
      }}>
        <option value="grams" disabled={!openingWeights}>Gramos</option>
        <option value="price">Precio base (Q)</option>
      </select></label>
      <label>{mode === "grams" ? "Peso por unidad (g)" : "Precio por unidad"}
        <input ref={captureInput} inputMode="decimal" value={input} onChange={event => { setInput(event.target.value); setError(""); }}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
      </label>
      {multiple && <label>Cantidad<input type="number" min="1" max="10000" step="1" value={quantity}
        onChange={event => setQuantity(event.target.value)} onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); add(); }
        }} /></label>}
      <AppButton type="button" disabled={busy} onClick={add}>Agregar</AppButton>
    </div>
    <label className="check-label"><input type="checkbox" checked={multiple}
      onChange={event => { setMultiple(event.target.checked); setQuantity("1"); }} /> Registrar varias unidades iguales</label>
    {!openingWeights && <small>Esta confirmación guarda cantidades por variante. La captura por gramos está disponible para el saldo inicial.</small>}
    {priceStatus !== "ready" && <small>{priceStatus === "loading" ? "Consultando precios BASE…" : "Precios BASE no disponibles."}</small>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="production-capture-feedback">
      <span role="status">{last ? "Agregado: " + last.label : message}</span>
      {last && <AppButton type="button" className="secondary" disabled={busy || (last.weighed ? weights : units)[last.id] !== last.after}
        onClick={() => { setValue(last.id, last.before, last.weighed); setLast(undefined); setMessage("Última captura deshecha."); setError(""); captureInput.current?.focus(); }}>Deshacer última captura</AppButton>}
    </div>

    <div className="production-capture-feedback">
      <h3>Variantes obtenidas</h3>
      <AppButton type="button" className="secondary" disabled={busy} onClick={refresh}>Actualizar variantes</AppButton>
    </div>
    <label className="check-label"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} /> Mostrar todas las variantes</label>
    {rows.some(row => row.count > 0) || showAll ? <div className="table-wrap">
      <ResponsiveTable showAllMobileFields>
        <thead><tr><th>Variante</th><th>Unidades y pesos</th><th>Peso real</th><th>Precio BASE</th><th>Importe estimado</th></tr></thead>
        <tbody>{rows.filter(row => showAll || row.count > 0).map(({ variant, count, weighed, recorded, price }) => <tr key={variant.id}>
          <td data-sort-value={variant.weight_min ?? ""}>{variantLabel(variant)}<br /><small>{weightRangeLabel(variant)}</small></td>
          <td data-sort-value={count}>{weighed ? <details><summary>{count} · Editar pesos</summary>
            <AutoTextarea aria-label={"Pesos en gramos de " + variantLabel(variant)} placeholder="Un peso en gramos por unidad"
              value={weights[variant.id] ?? ""} onChange={event => setValue(variant.id, event.target.value, true)} />
          </details> : <input aria-label={"Unidades de " + variantLabel(variant)} type="number" min="0" max="10000" step="1"
            placeholder="0" value={units[variant.id] ?? ""} onChange={event => setValue(variant.id, event.target.value, false)} />}</td>
          <td data-sort-value={recorded.length ? productionWeightTotal(recorded) : ""}>{recorded.length ? grams(productionWeightTotal(recorded)) : "—"}</td>
          <td className="production-capture-money" data-sort-value={price ?? ""}>{price == null ? "Pendiente" : money(price, currency)}</td>
          <td className="production-capture-money" data-sort-value={price == null ? "" : count * Number(price)}>{price == null ? "Pendiente" : money(count * Number(price), currency)}</td>
        </tr>)}</tbody>
      </ResponsiveTable>
    </div> : <p>Agrega unidades o muestra todas las variantes para capturarlas manualmente.</p>}
    <dl className="production-capture-totals">
      <div><dt>Unidades buenas</dt><dd>{totalUnits}</dd></div>
      <div><dt>Peso real registrado</dt><dd>{grams(totalWeight)}</dd></div>
      {pending > 0 && <div><dt>Unidades pendientes de pesaje</dt><dd>{pending}</dd></div>}
      <div><dt>Unidades dañadas</dt><dd>{scrap || "0"}</dd></div>
      <div><dt>Valor comercial estimado</dt><dd>{missingPrice ? `Incompleto · ${money(valueCents / 100, currency)} con precio` : money(valueCents / 100, currency)}</dd></div>
    </dl>
  </section>;
}
