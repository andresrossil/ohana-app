import { AppIcon } from "./AppIcon";
import { IconDetails } from "./PoolControls";
import ResponsiveTable from "./ResponsiveTable";
import type { Row } from "./operations";
import { money } from "./operations";
export const unitStatus: Record<string, string> = {
  curing: "En curación",
  available: "Disponible",
  reserved: "Reservada",
  sold: "Vendida",
  retired: "Retirada",
  released: "Reserva liberada",
};
export const unitLabel = (id: string) => "U-" + id.toUpperCase();
export function UnitState({ status }: { status: string }) {
  return (
    <span className={"physical-state unit-" + status}>
      <AppIcon
        name={
          status === "available"
            ? "status.active"
            : status === "sold" || status === "retired"
              ? "status.archived"
              : "status.pending"
        }
      />
      {unitStatus[status] || status}
    </span>
  );
}
export default function PhysicalUnits({
  units,
  query = "",
  history = [],
}: {
  units: Row[];
  query?: string;
  history?: Row[];
}) {
  const rows = units.filter((u) =>
    [
      u.id,
      u.batch_id,
      u.lot_id,
      u.variant_snapshot?.batch_number,
      unitLabel(u.id),
      u.variant_snapshot?.name,
      u.variant_snapshot?.sku,
      u.variant_snapshot?.product_name,
      u.weight,
      unitStatus[u.status],
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const unitHistory = new Map<string, Row[]>();
  for (const h of history) {
    const rows = unitHistory.get(h.unit_id) || [];
    rows.push(h);
    unitHistory.set(h.unit_id, rows);
  }
  return (
    <section className="catalog physical-units">
      <h2>Unidades físicas por peso</h2>
      <p className="muted">
        Cada unidad conserva peso, lote y variante originales. Las existencias
        generales incluyen también registros anteriores y productos sin
        seguimiento individual.
      </p>
      <div className="table-wrap">
        <ResponsiveTable>
          <thead>
            <tr>
              <th>Identificador</th>
              <th>Producto / variante original</th>
              <th>Lote</th>
              <th>Peso real</th>
              <th>Costos históricos / unidad</th>
              <th>Margen estimado al producir</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="unit-id" title={u.id}>
                  <IconDetails>
                    <summary>{unitLabel(u.id)}</summary>
                    <ul>
                      {(unitHistory.get(u.id) || []).map((h) => (
                        <li key={h.movement_id}>
                          {new Date(h.created_at).toLocaleString("es-GT")} ·{" "}
                          {unitStatus[h.status_before] || "Ingreso"} →{" "}
                          {unitStatus[h.status_after]}
                          <small>Movimiento: {h.movement_id}</small>
                        </li>
                      ))}
                    </ul>
                  </IconDetails>
                </td>
                <td className="admin-name">
                  {u.variant_snapshot.product_name}
                  <small>
                    {u.variant_snapshot.name} · {u.variant_snapshot.sku}
                  </small>
                </td>
                <td>
                  {u.variant_snapshot.batch_number
                    ? String(u.variant_snapshot.batch_number).padStart(6, "0")
                    : u.batch_id || "Ajuste · " + u.lot_id}
                </td>
                <td>
                  {Number(u.weight).toLocaleString("es-GT", {
                    maximumFractionDigits: 4,
                  })}{" "}
                  g
                </td>
                <td>
                  {u.cost_snapshot ? (
                    <>
                      <strong>
                        {money(
                          u.cost_snapshot.total_cost,
                          u.cost_snapshot.currency,
                        )}
                      </strong>
                      <small>
                        Fabricación:{" "}
                        {money(
                          u.cost_snapshot.manufacturing_cost,
                          u.cost_snapshot.currency,
                        )}
                      </small>
                      <small>
                        Comerciales:{" "}
                        {money(
                          u.cost_snapshot.commercial_cost,
                          u.cost_snapshot.currency,
                        )}
                      </small>
                      {u.cost_snapshot.overhead_cost !== undefined && (
                        <small>
                          Otros gastos:{" "}
                          {money(
                            u.cost_snapshot.overhead_cost,
                            u.cost_snapshot.currency,
                          )}
                        </small>
                      )}
                      <small>
                        {u.cost_snapshot.formula_code} · v
                        {u.cost_snapshot.formula_version}
                      </small>
                    </>
                  ) : (
                    "Sin desglose histórico"
                  )}
                </td>
                <td>
                  {u.cost_snapshot ? (
                    <>
                      {money(u.cost_snapshot.margin, u.cost_snapshot.currency)}
                      <small>
                        Sobre venta:{" "}
                        {u.cost_snapshot.margin_on_sale_percent == null
                          ? "Pendiente"
                          : Number(
                              u.cost_snapshot.margin_on_sale_percent,
                            ).toFixed(2) + " %"}
                      </small>
                      <small>
                        Recargo sobre costo:{" "}
                        {u.cost_snapshot.markup_on_cost_percent == null
                          ? "Pendiente"
                          : Number(
                              u.cost_snapshot.markup_on_cost_percent,
                            ).toFixed(2) + " %"}
                      </small>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <UnitState status={u.status} />
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5}>No hay unidades físicas para esta búsqueda.</td>
              </tr>
            )}
          </tbody>
        </ResponsiveTable>
      </div>
    </section>
  );
}
export function MovementUnits({
  movement,
  units,
  history,
}: {
  movement: string;
  units: Row[];
  history: Row[];
}) {
  const rows = history.filter((h) => h.movement_id === movement);
  return rows.length ? (
    <IconDetails>
      <summary>{rows.length} unidad(es)</summary>
      <ul>
        {rows.map((h) => {
          const u = units.find((x) => x.id === h.unit_id);
          return (
            <li key={h.unit_id}>
              <span className="unit-id">{unitLabel(h.unit_id)}</span> ·{" "}
              {u?.weight} g · {u?.variant_snapshot?.name} ·{" "}
              {unitStatus[h.status_after]}
            </li>
          );
        })}
      </ul>
    </IconDetails>
  ) : (
    <span>—</span>
  );
}
export function SaleUnits({ units }: { units: Row[] }) {
  return units?.length ? (
    <IconDetails>
      <summary>Unidades físicas · {units.length}</summary>
      <ul>
        {units.map((u) => (
          <li key={u.id}>
            <span className="unit-id">{unitLabel(u.id)}</span> ·{" "}
            {Number(u.weight).toLocaleString("es-GT", {
              maximumFractionDigits: 4,
            })}{" "}
            g · {u.variant_snapshot?.name} · {unitStatus[u.status] || u.status}
          </li>
        ))}
      </ul>
    </IconDetails>
  ) : null;
}
