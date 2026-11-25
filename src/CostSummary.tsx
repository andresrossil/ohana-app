import { MarginBadge } from "./MarginBadge";
import ResponsiveTable from "./ResponsiveTable";
import { money, type Row } from "./operations";
import { financialSummary } from "./financial-summary";
export default function CostSummary({
  product,
  materials,
  quote,
  variable = false,
  historical = false,
  unitReference,
  referenceLabel,
  compact = false,
}: {
  product: string;
  materials: Row;
  quote: Row;
  variable?: boolean;
  historical?: boolean;
  unitReference?: { materials: Row; quote: Row };
  referenceLabel?: string;
  compact?: boolean;
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
    [
      "Utilidad estimada antes de impuestos",
      s.unit(s.profit),
      s.profit,
      "profit",
    ],
    ["Margen estimado sobre venta", s.margin, s.margin, "percent"],
  ];
  if (unitReference) {
    const u = financialSummary(unitReference.materials, unitReference.quote);
    const values = [
      unitReference.materials.packaging,
      unitReference.materials.ingredients,
      unitReference.materials.supplies,
      u.materialTotal,
      u.price,
      u.before,
      u.groups.overhead,
      u.groups.labor,
      u.groups.advertising,
      u.totalCost,
      u.profit,
      u.margin,
    ];
    rows.forEach((row, index) => {
      row[1] = values[index] ?? null;
    });
  }
  if ("intermediates" in materials) {
    rows.splice(3, 0, ["Productos intermedios",
      unitReference ? unitReference.materials.intermediates ?? null : s.unit(materials.intermediates),
      materials.intermediates]);
  }
  const financialOrder = [
    "Materias primas", "Productos intermedios", "Empaque", "Insumos adicionales",
    "Total de materiales", "Mano de obra", "Publicidad", "Otros gastos",
    "Costo total estimado", "Precio de venta · Lista base", "Resultado antes de gastos",
    "Utilidad estimada antes de impuestos", "Margen estimado sobre venta",
  ];
  const rank = new Map(financialOrder.map((label, index) => [label, index]));
  const displayed = compact
    ? [...rows].sort(([a], [b]) => (rank.get(a) ?? financialOrder.length) - (rank.get(b) ?? financialOrder.length))
    : rows;
  return (
    <section className={compact ? "cost-summary cost-summary-compact" : "cost-summary"} aria-label="Resumen de costos y utilidad">
      <div className="cost-summary-heading">
        {!compact && <h3>Resumen de costos y utilidad{historical ? " · histórico" : ""}</h3>}
        <div>
          <strong>{product}</strong>
          <span>
            Unidades por lote:{" "}
            {s.n == null
              ? "Sin definir"
              : s.n.toLocaleString("es-GT", { maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>
      {referenceLabel && <p className="cost-basis-panel">{referenceLabel}</p>}
      <div className="table-wrap">
        <ResponsiveTable showAllMobileFields={compact} mobileTable={compact}>
          <thead>
            <tr>
              <th>Concepto</th>
              <th>
                {compact ? "Unidad" : unitReference
                  ? "Unidad · variante central"
                  : variable
                    ? "Unidad · promedio"
                    : "Unidad"}
              </th>
              <th>{unitReference && !compact ? "Lote · receta completa" : "Lote"}</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map(([label, unit, batch, kind]) => (
              <tr key={label} className={"summary-row-" + (kind || "normal")}>
                <td>{label}</td>
                <td data-sort-value={unit ?? ""}>
                  {kind === "percent" ? (
                    unit == null ? (
                      "Pendiente"
                    ) : (
                      <MarginBadge value={unit} />
                    )
                  ) : (
                    amount(unit)
                  )}
                </td>
                <td data-sort-value={batch ?? ""}>
                  {kind === "percent" ? (
                    batch == null ? (
                      "Pendiente"
                    ) : (
                      <MarginBadge value={batch} />
                    )
                  ) : (
                    amount(batch)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      </div>
      <p className="muted">
        Margen sobre venta = utilidad ÷ ventas.{" "}
        {unitReference
          ? "La columna Unidad usa el peso promedio de la variante central. Lote conserva las cantidades completas de la receta y sus unidades previstas. "
          : variable
            ? "La columna Unidad muestra un promedio; cada barra conserva su propio peso y costo. "
            : ""}
        {!unitReference && !historical && variable
          ? "Sin pesos y precios de las variantes obtenidas, las ventas y la utilidad permanecen pendientes. "
          : ""}
        Otros gastos se calculan con las unidades del lote; el total no se
        aplica dos veces.
      </p>
    </section>
  );
}
