import { AppIcon } from "./AppIcon";
import { IconDetails } from "./PoolControls";
import ResponsiveTable from "./ResponsiveTable";
import { money, type Row } from "./operations";
import { costCatalogNames } from "./additional-costs";
import "./additional-costs.css";
export default function AdditionalCostsPanel({
  quote,
  items = [],
  laborId = "",
  advertisingId = "",
  onSelect,
  baseCost,
  historical = false,
}: {
  quote: Row;
  items?: Row[];
  laborId?: string;
  advertisingId?: string;
  onSelect?: (field: string, id: string) => void;
  baseCost: number | null;
  historical?: boolean;
}) {
  const total =
    baseCost !== null && quote.additional_total !== null
      ? baseCost + Number(quote.additional_total)
      : null;
  const amount = (v: unknown) =>
    v == null ? "Pendiente" : money(v, quote.currency);
  return (
    <IconDetails className="formula-disclosure additional-costs">
      <summary>
        <AppIcon name="action.calculate" /> Costos adicionales
        {historical ? " · histórico confirmado" : ""}
      </summary>
      <div className="additional-costs-content">
        {onSelect && (
          <div className="settings-grid">
            {(["labor", "advertising"] as const).map((kind) => {
              const id = kind === "labor" ? laborId : advertisingId;
              return (
                <label key={kind}>
                  {costCatalogNames[kind]}
                  <select
                    value={id}
                    onChange={(e) =>
                      onSelect(
                        kind === "labor"
                          ? "labor_level_id"
                          : "advertising_level_id",
                        e.target.value,
                      )
                    }
                  >
                    <option value="">Sin nivel</option>
                    {items
                      .filter(
                        (x) => x.kind === kind && (x.active || x.id === id),
                      )
                      .map((x) => (
                        <option key={x.id} value={x.id} disabled={!x.active}>
                          {x.name} ·{" "}
                          {Number(x.percent).toLocaleString("es-GT", {
                            maximumFractionDigits: 2,
                          })}{" "}
                          %{!x.active ? " · Inactivo" : ""}
                        </option>
                      ))}
                  </select>
                </label>
              );
            })}
          </div>
        )}
        <p className="muted">
          Precio de venta de la presentación:{" "}
          {quote.sale_price == null
            ? "Pendiente de precio"
            : amount(quote.sale_price)}
          . Unidades estimadas:{" "}
          {quote.estimated_units == null
            ? "Sin definir"
            : Number(quote.estimated_units).toLocaleString("es-GT", {
                maximumFractionDigits: 2,
              })}
          .
        </p>
        <div className="table-wrap">
          <ResponsiveTable>
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Nivel / porcentaje</th>
                <th>Por unidad</th>
                <th>Por lote</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Otros gastos</td>
                <td>Total de conceptos activos</td>
                <td>{amount(quote.overhead_unit)}</td>
                <td>{amount(quote.overhead_total)}</td>
              </tr>
              {["labor", "advertising"].map((kind) => {
                const row = quote[kind];
                const pending = row.id && quote.sale_price == null;
                return (
                  <tr key={kind}>
                    <td>{costCatalogNames[kind]}</td>
                    <td>
                      {row.id
                        ? `${row.name} · ${Number(row.percent).toLocaleString("es-GT", { maximumFractionDigits: 2 })} %`
                        : "Sin nivel"}
                    </td>
                    <td>
                      {pending ? "Pendiente de precio" : amount(row.unit)}
                    </td>
                    <td>
                      {pending ? "Pendiente de precio" : amount(row.total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </ResponsiveTable>
        </div>
        {quote.overhead_total == null && (
          <p className="sheet-warning">
            Hay gastos en otra moneda. Actualiza su moneda y precio en
            Configuración; no se convierten automáticamente.
          </p>
        )}
        <div className="formula-summary">
          <div>
            <span>Costos adicionales por lote</span>
            <strong>{amount(quote.additional_total)}</strong>
          </div>
          <div>
            <span>
              Total estimado · MP + empaque + insumos + costos adicionales
            </span>
            <strong>{amount(total)}</strong>
          </div>
          <div>
            <span>Costo estimado por unidad</span>
            <strong>
              {amount(
                total !== null && Number(quote.estimated_units) > 0
                  ? total / Number(quote.estimated_units)
                  : null,
              )}
            </strong>
          </div>
        </div>
        <p className="muted">
          Otros gastos se aplica una sola vez por lote. Mano de obra y
          Publicidad son estimaciones sobre el precio de venta; no generan pagos
          ni movimientos de inventario.{" "}
          {historical
            ? "Estos importes no cambian con los catálogos actuales."
            : "Se conservarán al confirmar la producción."}
        </p>
      </div>
    </IconDetails>
  );
}
