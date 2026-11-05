import { recipeLineKinds } from "./formula-model";
import { IconDetails } from "./PoolControls";
import AdditionalCostsPanel from "./AdditionalCostsPanel";
import CostSummary from "./CostSummary";
import { materialCosts, weightSummaryQuote } from "./financial-summary";
import ResponsiveTable from "./ResponsiveTable";
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
        maximumFractionDigits: 2,
      }).format(Number(v));
export const lotCode = (n: number | string | undefined) =>
  n == null ? "Lote sin número" : `LOT-${String(n).padStart(4, "0")}`;
const num = (n: any) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("es-GT", { maximumFractionDigits: 2 }).format(
        Number(n),
      );
export default function BatchTrace({
  company,
  id,
  onClose,
  showCosts = true,
}: {
  company: string;
  id: string;
  onClose: () => void;
  showCosts?: boolean;
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
  const weightCosts = snapshot?.weight_costs;
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
            {snapshot && !showCosts ? (
              <>
                <p>
                  {snapshot.product.name} · {snapshot.formula.code} · v
                  {snapshot.formula.version}
                </p>
                <p>
                  {data.batch.actual_quantity} unidades buenas ·{" "}
                  {data.batch.scrap_quantity || 0} unidades dañadas
                </p>
                <p>
                  {snapshot.curing?.required === false
                    ? "Sin curado"
                    : `Disponibilidad: ${data.batch.available_on}`}
                </p>
                {!!data.batch.stock_warnings?.confirmation?.shortages
                  ?.length && (
                  <IconDetails>
                    <summary>Faltantes aceptados al confirmar</summary>
                    <ul>
                      {data.batch.stock_warnings.confirmation.shortages.map(
                        (r: Row) => (
                          <li key={r.material_id}>
                            {r.sku} · {r.name}: {num(r.shortage)} {r.unit}
                          </li>
                        ),
                      )}
                    </ul>
                  </IconDetails>
                )}
                <div className="table-wrap">
                  <ResponsiveTable>
                    <thead>
                      <tr>
                        <th>Material / Insumo</th>
                        <th>Planificado</th>
                        <th>Consumo real</th>
                        <th>Observaciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.lines.map((line: Row) => (
                        <tr key={line.material_id}>
                          <td>
                            {line.material_sku} · {line.material_name}
                            <small>
                              {
                                recipeLineKinds[
                                  (line.line_kind ||
                                    "ingredient") as keyof typeof recipeLineKinds
                                ]
                              }
                            </small>
                          </td>
                          <td>
                            {num(line.planned_quantity)}{" "}
                            {line.planned_unit.symbol}
                          </td>
                          <td>
                            {num(line.actual_quantity)}{" "}
                            {line.actual_unit.symbol}
                          </td>
                          <td>{line.reference_notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </ResponsiveTable>
                </div>
              </>
            ) : snapshot ? (
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
                  <ResponsiveTable>
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
                              {
                                recipeLineKinds[
                                  (line.line_kind ||
                                    "ingredient") as keyof typeof recipeLineKinds
                                ]
                              }{" "}
                              · {line.material_sku || line.material_id}
                            </small>
                            {line.reference_notes && (
                              <IconDetails className="formula-line-notes">
                                <summary>Referencia / Observaciones</summary>
                                <p>{line.reference_notes}</p>
                              </IconDetails>
                            )}
                          </td>
                          <td>
                            {num(line.planned_quantity)}{" "}
                            {line.planned_unit.symbol}
                            {line.line_kind === "auxiliary" && (
                              <small>
                                {num(line.configured_quantity)}{" "}
                                {line.planned_unit.symbol}{" "}
                                {line.quantity_basis === "unit"
                                  ? "por unidad producida"
                                  : "fija por lote"}
                              </small>
                            )}
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
                  </ResponsiveTable>
                </div>
                <p>
                  <strong>
                    {weightCosts
                      ? "Consumos históricos de materiales: "
                      : "Costo histórico de producción: "}
                    {money(snapshot.total_cost, snapshot.currency)}
                  </strong>
                </p>
                {weightCosts && (
                  <>
                    <AdditionalCostsPanel
                      quote={weightSummaryQuote(weightCosts)}
                      baseCost={snapshot.total_cost}
                      historical
                      hideTotals
                    />
                    <CostSummary
                      product={snapshot.product.name}
                      materials={materialCosts(
                        snapshot.lines || [],
                        "total_cost",
                      )}
                      quote={weightSummaryQuote(weightCosts)}
                      variable
                      historical
                    />
                    <p className="muted">
                      {weightCosts.weights_estimated
                        ? "Peso de referencia estimado: "
                        : "Peso real confirmado: "}
                      {num(
                        weightCosts.weights_estimated
                          ? weightCosts.reference_weight
                          : weightCosts.total_weight,
                      )}{" "}
                      g · Fabricación común por gramo:{" "}
                      {money(weightCosts.cost_per_gram, snapshot.currency)}.
                    </p>
                    <section className="formula-summary">
                      <div className="table-wrap form-wide">
                        <ResponsiveTable>
                          <thead>
                            <tr>
                              <th>Variante</th>
                              <th>
                                {weightCosts.weights_estimated
                                  ? "Peso estimado de referencia"
                                  : "Peso real"}
                              </th>
                              <th>Fabricación</th>
                              <th>Comerciales</th>
                              <th>Costo total</th>
                              <th>Precio base aplicado</th>
                              <th>Margen sobre venta</th>
                              <th>Recargo sobre costo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(weightCosts.units || []).map(
                              (u: Row, i: number) => (
                                <tr key={i}>
                                  <td>{u.variant_name || u.variant_id}</td>
                                  <td>
                                    {num(
                                      weightCosts.weights_estimated
                                        ? u.reference_weight
                                        : u.weight,
                                    )}{" "}
                                    g
                                  </td>
                                  <td>
                                    {money(u.manufacturing_cost, u.currency)}
                                  </td>
                                  <td>
                                    {money(u.commercial_cost, u.currency)}
                                    {u.overhead_cost !== undefined && (
                                      <small>
                                        Otros gastos:{" "}
                                        {money(u.overhead_cost, u.currency)}
                                      </small>
                                    )}
                                  </td>
                                  <td>{money(u.total_cost, u.currency)}</td>
                                  <td>
                                    {money(
                                      u.price_reference?.price,
                                      u.currency,
                                    )}
                                  </td>
                                  <td>
                                    {money(u.margin, u.currency)} ·{" "}
                                    {num(u.margin_on_sale_percent)} %
                                  </td>
                                  <td>{num(u.markup_on_cost_percent)} %</td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </ResponsiveTable>
                      </div>
                    </section>
                  </>
                )}
                {snapshot.additional_costs && !weightCosts && (
                  <AdditionalCostsPanel
                    quote={snapshot.additional_costs}
                    baseCost={
                      snapshot.total_cost == null
                        ? null
                        : Number(snapshot.total_cost)
                    }
                    historical
                    hideTotals
                  />
                )}
                {snapshot.additional_costs && !weightCosts && (
                  <CostSummary
                    product={snapshot.product.name}
                    materials={materialCosts(
                      snapshot.lines || [],
                      "total_cost",
                    )}
                    quote={snapshot.additional_costs}
                    historical
                  />
                )}
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
                    {showCosts && (
                      <p>
                        Costo registrado:{" "}
                        {money(data.batch.total_cost, data.batch.currency)}
                      </p>
                    )}
                    <div className="formula-table-scroll">
                      <ResponsiveTable>
                        <thead>
                          <tr>
                            <th>ID de materia prima</th>
                            <th>Consumo en unidad base registrada</th>
                            {showCosts && <th>Costo registrado</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {data.legacy_consumptions.map((line: Row) => (
                            <tr key={line.material_id}>
                              <td>{line.material_id}</td>
                              <td>{num(line.base_quantity)}</td>
                              {showCosts && (
                                <td>{money(line.cost, data.batch.currency)}</td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </ResponsiveTable>
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
