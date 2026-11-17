import { useState } from "react";
import { AppButton } from "./AppIcon";
import MoneyInput from "./MoneyInput";
import SearchSelect from "./SearchSelect";
import { money, today, type Row } from "./operations";

type Line = { id: string; material: string; unit: string; quantity: string; amount: string };
const newLine = (): Line => ({ id: crypto.randomUUID(), material: "", unit: "", quantity: "", amount: "" });

export default function PurchaseReceiptEditor({ currency, data, busy, error, onClose, onSave }: {
  currency: string;
  data: Row;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (values: Row) => void;
}) {
  const [paymentCurrency, setPaymentCurrency] = useState(currency);
  const [lines, setLines] = useState(() => [newLine()]);
  const update = (id: string, patch: Partial<Line>) =>
    setLines(current => current.map(line => line.id === id ? { ...line, ...patch } : line));
  const total = lines.reduce((sum, line) => sum + Math.round(Number(line.amount) * 100), 0) / 100;
  const foreignCurrency = paymentCurrency !== currency;

  return <div className="overlay">
    <section className="modal operations-dialog" role="dialog" aria-modal="true" aria-labelledby="purchase-receipt-title">
      <h2 id="purchase-receipt-title">Compra recibida</h2>
      {error && <p className="error" role="alert">{error}</p>}
      <form onSubmit={event => {
        event.preventDefault();
        const header = Object.fromEntries(new FormData(event.currentTarget));
        onSave({ ...header, lines: lines.map(({ material, unit, quantity, amount }) => ({ material, unit, quantity, amount })) });
      }}>
        <fieldset className="settings-grid" disabled={busy}>
          <legend>Encabezado</legend>
          <label>Proveedor<SearchSelect name="supplier">
            <option value="">Sin proveedor</option>
            {data.suppliers.map((supplier: Row) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </SearchSelect></label>
          <label>Fecha de recepción<input name="date" type="date" defaultValue={today()} max={today()} required /></label>
          <label>Factura o referencia<input name="reference" maxLength={250} /></label>
          <label>Moneda<input name="currency" required pattern="[A-Z]{3}" maxLength={3}
            value={paymentCurrency} onChange={event => setPaymentCurrency(event.target.value.toUpperCase())} /></label>
          {foreignCurrency && <label>Tipo de cambio hacia {currency}
            <input name="exchange_rate" type="number" min="0.00000001" step="any" required />
          </label>}
        </fieldset>
        <div className="hierarchy-toolbar">
          <h3>Detalle de materiales</h3>
          <AppButton type="button" className="secondary" disabled={busy || lines.length >= 100}
            onClick={() => setLines(current => [...current, newLine()])}>Agregar material</AppButton>
        </div>
        {lines.map((line, index) => {
          const material = data.materials.find((item: Row) => item.id === line.material);
          const baseUnit = data.units.find((unit: Row) => unit.id === material?.unit_id);
          return <fieldset key={line.id} className="settings-grid purchase-receipt-line" disabled={busy}>
            <legend>Material {index + 1}</legend>
            <label>Material<SearchSelect required value={line.material} onChange={event => {
              const selected = data.materials.find((item: Row) => item.id === event.target.value);
              update(line.id, { material: event.target.value, unit: selected?.unit_id || "" });
            }}>
              <option value="">Seleccionar</option>
              {data.materials.map((item: Row) => <option key={item.id} value={item.id}>{item.sku ? item.sku + " · " : ""}{item.name}</option>)}
            </SearchSelect></label>
            <label>Cantidad recibida<input type="number" min="0.00000001" step="any" required
              value={line.quantity} onChange={event => update(line.id, { quantity: event.target.value })} /></label>
            <label>Unidad<SearchSelect required value={line.unit} onChange={event => update(line.id, { unit: event.target.value })}>
              <option value="">Seleccionar</option>
              {data.units.filter((unit: Row) => !baseUnit || unit.dimension === baseUnit.dimension)
                .map((unit: Row) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}
            </SearchSelect></label>
            <label>Importe pagado por la línea<MoneyInput currency={paymentCurrency} min="0" step="0.01" required
              value={line.amount} onChange={event => update(line.id, { amount: event.target.value })} /></label>
            {lines.length > 1 && <AppButton type="button" className="secondary" aria-label={`Quitar material ${index + 1}`}
              onClick={() => setLines(current => current.filter(item => item.id !== line.id))}>Quitar material</AppButton>}
          </fieldset>;
        })}
        <p><strong>Total de la compra {money(total, /^[A-Z]{3}$/.test(paymentCurrency) ? paymentCurrency : currency)}</strong></p>
        <div className="form-actions">
          <AppButton disabled={busy}>Guardar compra</AppButton>
          <AppButton type="button" className="secondary" disabled={busy} onClick={onClose}>Cancelar</AppButton>
        </div>
      </form>
    </section>
  </div>;
}
