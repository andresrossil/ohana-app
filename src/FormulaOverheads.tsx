import { AppButton } from "./AppIcon";
import ResponsiveTable from "./ResponsiveTable";
import DecimalInput from "./DecimalInput";
import { money, type Row } from "./operations";
export default function FormulaOverheads({
  items,
  lines,
  quote,
  onChange,
  historical = false,
}: {
  items: Row[];
  lines: Row[];
  quote: Row;
  onChange?: (lines: Row[]) => void;
  historical?: boolean;
}) {
  const display = onChange ? lines : quote.overhead_lines || [];
  const change = (index: number, patch: Row) =>
    onChange?.(
      lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  const amount = (n: unknown, currency = quote.currency) =>
    n == null ? "Pendiente" : money(n, currency);
  return (
    <section className="formula-overheads">
      <h3>Otros gastos seleccionados</h3>
      <p className="muted">
        {historical
          ? "Cantidades y precios conservados al confirmar el lote."
          : "Agrega únicamente los conceptos que aplican a esta versión. Se cobran una sola vez por lote y no descuentan inventario."}
      </p>
      {display.length > 0 && (
        <div className="table-wrap">
          <ResponsiveTable>
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Cantidad por lote</th>
                <th>Precio unitario</th>
                <th>Importe por lote</th>
                {onChange && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {display.map((line: Row, index: number) => {
                const row = onChange ? quote.overhead_lines?.[index] : line;
                return (
                  <tr key={index}>
                    <td>
                      {onChange ? (
                        <select
                          aria-label={`Gasto fila ${index + 1}`}
                          value={line.cost_id}
                          onChange={(e) => {
                            const item = items.find(
                              (x) => x.id === e.target.value,
                            );
                            change(index, {
                              cost_id: e.target.value,
                              quantity:
                                item && Number(item.quantity) > 0
                                  ? Number(item.quantity)
                                  : 1,
                            });
                          }}
                        >
                          <option value="">Seleccionar concepto</option>
                          {items
                            .filter(
                              (x) =>
                                x.kind === "overhead" &&
                                (x.active || x.id === line.cost_id) &&
                                !lines.some(
                                  (other, i) =>
                                    i !== index && other.cost_id === x.id,
                                ),
                            )
                            .map((x) => (
                              <option
                                key={x.id}
                                value={x.id}
                                disabled={!x.active}
                              >
                                {x.name}
                                {!x.active ? " · Inactivo" : ""}
                              </option>
                            ))}
                        </select>
                      ) : (
                        row.name
                      )}
                    </td>
                    <td>
                      {onChange ? (
                        <DecimalInput
                          aria-label={`Cantidad de gasto fila ${index + 1}`}
                          type="number"
                          min="0.00000001"
                          step="any"
                          required
                          value={line.quantity}
                          onChange={(e) =>
                            change(index, { quantity: e.target.value })
                          }
                        />
                      ) : (
                        Number(row.quantity).toLocaleString("es-GT", {
                          maximumFractionDigits: 2,
                        })
                      )}
                    </td>
                    <td>
                      {amount(row?.unit_price, row?.currency || quote.currency)}
                    </td>
                    <td>
                      {amount(row?.total, row?.currency || quote.currency)}
                    </td>
                    {onChange && (
                      <td className="actions">
                        <AppButton
                          type="button"
                          className="secondary"
                          iconKey="action.delete"
                          aria-label={`Quitar gasto fila ${index + 1}`}
                          onClick={() =>
                            onChange(lines.filter((_, i) => i !== index))
                          }
                        >
                          Quitar gasto
                        </AppButton>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </ResponsiveTable>
        </div>
      )}
      {!display.length && (
        <p className="muted">
          {historical && !quote.overhead_lines
            ? "Importe histórico aplicado conservado sin desglose de conceptos."
            : "Sin gastos seleccionados."}
        </p>
      )}
      <div className="form-actions">
        {onChange && (
          <AppButton
            type="button"
            className="secondary"
            iconKey="action.add"
            disabled={
              lines.length >= 100 ||
              lines.some((x) => !x.cost_id) ||
              !items.some(
                (x) =>
                  x.kind === "overhead" &&
                  x.active &&
                  !lines.some((line) => line.cost_id === x.id),
              )
            }
            onClick={() => onChange([...lines, { cost_id: "", quantity: 1 }])}
          >
            Agregar gasto
          </AppButton>
        )}
        <strong>Total por lote: {amount(quote.overhead_total)}</strong>
      </div>
    </section>
  );
}
