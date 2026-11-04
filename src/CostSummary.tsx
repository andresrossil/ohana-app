import ResponsiveTable from "./ResponsiveTable";
import { money, type Row } from "./operations";
import { financialSummary } from "./financial-summary";
export default function CostSummary({
  product,
  materials,
  quote,
  variable = false,
  historical = false,
}: {
  product: string;
  materials: Row;
  quote: Row;
  variable?: boolean;
  historical?: boolean;
}) {
  const s = financialSummary(materials, quote),
    currency = quote.currency || "GTQ";
  const amount = (value: number | null) =>
    value == null ? "Pendiente" : money(value, currency);
  const rows: [string, number | null, number | null, string?][] = [
    ["Empaque", s.unit(materials.packaging), materials.packaging],
    ["Materias primas", s.unit(materials.ingredients), materials.ingredients],
    ["Insumos adicionales", s.unit(materials.supplies), materials.supplies],
    [
      "Total de materiales",
      s.unit(s.materialTotal),
      s.materialTotal,
      "subtotal",
    ],
    ["Precio de venta · Lista base", s.price, s.sales, "sale"],
    ["Resultado antes de gastos", s.unit(s.before), s.before, "subtotal"],
    ["Otros gastos", s.unit(s.groups.overhead), s.groups.overhead],
    ["Mano de obra", s.unit(s.groups.labor), s.groups.labor],
    ["Publicidad", s.unit(s.groups.advertising), s.groups.advertising],
    ["Costo total estimado", s.unit(s.totalCost), s.totalCost, "subtotal"],
    ["Utilidad estimada", s.unit(s.profit), s.profit, "profit"],
    ["Margen estimado sobre venta", s.margin, s.margin, "percent"],
  ];
  return (
    <section className="cost-summary" aria-label="Resumen de costos y utilidad">
      <header className="cost-summary-heading">
        <h3>Resumen de costos y utilidad{historical ? " · histórico" : ""}</h3>
        <div>
          <strong>{product}</strong>
          <span>
            Unidades por lote:{" "}
            {s.n == null
              ? "Sin definir"
              : s.n.toLocaleString("es-GT", { maximumFractionDigits: 2 })}
          </span>
        </div>
      </header>
      <div className="table-wrap">
        <ResponsiveTable>
          <thead>
            <tr>
              <th>Concepto</th>
              <th>{variable ? "Unidad · promedio" : "Unidad"}</th>
              <th>Lote</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, unit, batch, kind]) => (
              <tr key={label} className={"summary-row-" + (kind || "normal")}>
                <td>{label}</td>
                <td data-sort-value={unit ?? ""}>
                  {kind === "percent"
                    ? unit == null
                      ? "Pendiente"
                      : unit.toLocaleString("es-GT", {
                          maximumFractionDigits: 2,
                        }) + " %"
                    : amount(unit)}
                </td>
                <td data-sort-value={batch ?? ""}>
                  {kind === "percent"
                    ? batch == null
                      ? "Pendiente"
                      : batch.toLocaleString("es-GT", {
                          maximumFractionDigits: 2,
                        }) + " %"
                    : amount(batch)}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      </div>
      <p className="muted">
        Margen sobre venta = utilidad ÷ ventas.{" "}
        {variable
          ? "La columna Unidad muestra un promedio; cada barra conserva su propio peso y costo. "
          : ""}
        {!historical && variable
          ? "Sin pesos y precios de las variantes obtenidas, las ventas y la utilidad permanecen pendientes. "
          : ""}
        Los gastos fijos se aplican una vez por lote.
      </p>
    </section>
  );
}
