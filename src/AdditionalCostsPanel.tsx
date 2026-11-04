import { AppIcon } from "./AppIcon";
import { IconDetails } from "./PoolControls";
import { money, type Row } from "./operations";
import FormulaOverheads from "./FormulaOverheads";
import "./additional-costs.css";
export default function AdditionalCostsPanel({
  quote,
  items = [],
  baseCost,
  historical = false,
  overheadLines = [],
  onOverheadChange,
  hideTotals = false,
}: {
  quote: Row;
  items?: Row[];
  baseCost: number | null;
  historical?: boolean;
  overheadLines?: Row[];
  onOverheadChange?: (lines: Row[]) => void;
  hideTotals?: boolean;
}) {
  const total =
    baseCost != null && quote.additional_total != null
      ? baseCost + Number(quote.additional_total)
      : null;
  const amount = (v: unknown) =>
    v == null ? "Pendiente" : money(v, quote.currency);
  const n = Number(quote.unit_basis_count ?? quote.estimated_units);
  return (
    <IconDetails className="formula-disclosure additional-costs">
      <summary>
        <AppIcon name="action.calculate" /> Costos adicionales
        {historical ? " · histórico confirmado" : ""}
      </summary>
      <div className="additional-costs-content">
        <p className="cost-basis-panel">
          Precio de venta base{quote.average ? " · promedio por unidad" : ""}:{" "}
          {quote.sale_price == null
            ? quote.variable_weight
              ? "Según las variantes obtenidas"
              : "Pendiente de precio"
            : amount(quote.sale_price)}
          .{" "}
          {n > 0
            ? `${n.toLocaleString("es-GT", { maximumFractionDigits: 2 })} unidades.`
            : "Unidades sin definir."}
        </p>
        <FormulaOverheads
          items={items}
          lines={overheadLines}
          quote={quote}
          onChange={onOverheadChange}
          historical={historical}
        />
        <p className="muted">
          Los gastos fijos se aplican una vez por lote. Mano de obra y
          Publicidad se estiman sobre el precio de venta base. No generan
          consumos de inventario.
        </p>
        {!hideTotals && (
          <div className="formula-summary">
            <div>
              <span>
                Costo estimado total · materiales y costos adicionales
              </span>
              <strong>{amount(total)}</strong>
            </div>
            <div>
              <span>Costo estimado por unidad</span>
              <strong>
                {amount(total != null && n > 0 ? total / n : null)}
              </strong>
            </div>
          </div>
        )}
      </div>
    </IconDetails>
  );
}
