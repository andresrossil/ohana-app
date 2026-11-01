import { useEffect, useState } from "react";
import { request } from "./commerce";
import { AppButton, AppIcon } from "./AppIcon";
import { type Row } from "./operations";
import "./formulas.css";
const money = (v: any, c = "GTQ") =>
  v == null
    ? "No registrado"
    : new Intl.NumberFormat("es-GT", {
        style: "currency",
        currency: c,
        minimumFractionDigits: 2,
        maximumFractionDigits: 8,
      }).format(Number(v));
export const lotCode = (n: number | string | undefined) =>
  n == null ? "Lote sin número" : `LOT-${String(n).padStart(4, "0")}`;
const num = (n: any) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("es-GT", { maximumFractionDigits: 8 }).format(
        Number(n),
      );
export default function BatchTrace({
  company,
  id,
  onClose,
}: {
  company: string;
  id: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    request("production_command", {
      p_company: company,
      p_action: "detail",
      p_data: { id },
    })
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [company, id]);
  const snapshot = data?.snapshot;
  return (
    <div className="overlay">
      <section
        className="modal formula-dialog batch-trace"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trace-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="hierarchy-toolbar">
          <h2 id="trace-title">
            Detalle de lote{" "}
            {data ? `· ${lotCode(data.batch.batch_number)}` : ""}
          </h2>
          <AppButton className="secondary" onClick={onClose}>
            Cerrar detalle
          </AppButton>
        </div>
        {error && (
          <p role="alert" className="error">
            <AppIcon name="status.error" />
            {error}
          </p>
        )}
        {!data && !error && <p role="status">Cargando trazabilidad…</p>}
        {data && (
          <>
            <h3>Fórmula utilizada</h3>
            {snapshot ? (
              <>
                <p>
                  <strong>
                    {snapshot.formula.code} · {snapshot.formula.name} · v
                    {snapshot.formula.version}
                  </strong>
                </p>
                <p>Producto: {snapshot.product.name}</p>
                <p>
                  Confirmación:{" "}
                  {data.batch.confirmed_at
                    ? new Date(data.batch.confirmed_at).toLocaleString("es-GT")
                    : "Fecha no registrada"}{" "}
                  · Factor de escala: {num(snapshot.scale)}
                </p>
                <div className="formula-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Materia prima / empaque</th>
                        <th>Planificado</th>
                        <th>Real consumido</th>
                        <th>Porcentaje</th>
                        <th>Costo unitario aplicado</th>
                        <th>Costo histórico</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.lines.map((line: Row) => (
                        <tr key={line.material_id}>
                          <td>
                            <strong>{line.material_name}</strong>
                            <small>
                              {line.line_kind === "packaging"
                                ? "Empaque"
                                : "Ingrediente"}{" "}
                              · {line.material_sku || line.material_id}
                            </small>
                          </td>
                          <td>
                            {num(line.planned_quantity)}{" "}
                            {line.planned_unit.symbol}
                          </td>
                          <td>
                            {num(line.actual_quantity)}{" "}
                            {line.actual_unit.symbol}
                            <small>
                              {num(line.base_quantity)} {line.base_unit.symbol}{" "}
                              de inventario
                            </small>
                          </td>
                          <td>
                            {line.percentage == null
                              ? "—"
                              : `${num(line.percentage)} %`}
                          </td>
                          <td>
                            {money(line.applied_unit_cost, snapshot.currency)} /{" "}
                            {line.actual_unit.symbol}
                          </td>
                          <td>{money(line.total_cost, snapshot.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  <strong>
                    Costo histórico de producción:{" "}
                    {money(snapshot.total_cost, snapshot.currency)}
                  </strong>
                </p>
                <p>
                  Merma configurada:{" "}
                  {snapshot.loss.enabled
                    ? `${num(snapshot.loss.percent)} % (informativa)`
                    : "Desactivada"}
                  . El consumo registrado es el realmente confirmado.
                </p>
                <p className="muted">
                  Composición histórica conservada al confirmar. Los cambios
                  posteriores del catálogo o de la fórmula vigente no alteran
                  estos datos.
                </p>
              </>
            ) : (
              <>
                {data.batch.confirmed ? (
                  <>
                    <p className="sheet-warning">
                      Histórico parcial: este lote no tiene una copia de receta
                      guardada. No se reconstruyen nombres, cantidades
                      planificadas ni precios a partir del catálogo actual.
                    </p>
                    <p>
                      Costo registrado:{" "}
                      {money(data.batch.total_cost, data.batch.currency)}
                    </p>
                    <div className="formula-table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>ID de materia prima</th>
                            <th>Consumo en unidad base registrada</th>
                            <th>Costo registrado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.legacy_consumptions.map((line: Row) => (
                            <tr key={line.material_id}>
                              <td>{line.material_id}</td>
                              <td>{num(line.base_quantity)}</td>
                              <td>{money(line.cost, data.batch.currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p>
                    Este lote aún no tiene producción confirmada. La
                    composición, los consumos y los costos históricos se
                    guardarán al confirmar.
                  </p>
                )}
              </>
            )}
            <div className="form-actions">
              <AppButton className="secondary" onClick={onClose}>
                Volver
              </AppButton>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
