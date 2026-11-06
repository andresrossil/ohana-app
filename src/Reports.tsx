import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { request } from "./commerce";
import { useOperation, money, type Row } from "./operations";
import ResponsiveTable from "./ResponsiveTable";
import ReportExport from "./ReportExport";
const Kardex = lazy(() => import("./Kardex"));
const PhysicalUnits = lazy(() => import("./PhysicalUnits"));
const MaterialRequirements = lazy(() => import("./MaterialRequirements"));
const reports = [
  ["summary", "Resumen"],
  ["sales", "Ventas entregadas"],
  ["purchases", "Compras recibidas"],
  ["stock", "Valor del inventario por moneda"],
  ["requirements", "Requerimientos de materiales"],
  ["kardex", "Kardex"],
  ["valuation", "Valor de existencias"],
  ["physical", "Unidades físicas"],
] as const;
function SummaryReport({ company, view }: { company: string; view: string }) {
  const state = useOperation(company, "reports"),
    [data, setData] = useState<Row | null>(null);
  useEffect(() => {
    state.run(async () =>
      setData(await request("report_summary", { p_company: company })),
    );
  }, [company]);
  if (state.error)
    return (
      <p className="error" role="alert">
        {state.error}
      </p>
    );
  if (!data) return <p role="status">Cargando reporte…</p>;
  const metrics = [
    ["Materiales", "materials"],
    ["Productos", "products"],
    ["Variantes", "variants"],
    ["Producciones", "batches"],
    ["Unidades disponibles", "units_available"],
    ["Unidades en curación", "units_curing"],
    ["Unidades reservadas", "units_reserved"],
    ["Pedidos pendientes", "orders_pending"],
  ];
  const rows: Row[] =
    view === "summary"
      ? metrics.map(([name, key]) => ({ name, quantity: Number(data[key]) }))
      : data[view === "stock" ? "stock_value" : view] || [];
  const headers =
    view === "summary"
      ? ["Indicador", "Cantidad"]
      : view === "sales"
        ? ["Moneda", "Pedidos", "Total", "Pendiente de cobro"]
        : view === "purchases"
          ? ["Moneda", "Compras", "Total"]
          : ["Moneda", "Valor conocido", "Registros con costo pendiente"];
  return (
    <section className="catalog">
      <h2>{reports.find(([key]) => key === view)?.[1]}</h2>
      <div className="table-wrap">
        <ResponsiveTable>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.currency || i}>
                {view === "summary" ? (
                  <>
                    <td>{r.name}</td>
                    <td data-sort-value={r.quantity}>{r.quantity}</td>
                  </>
                ) : (
                  <>
                    <td>{r.currency}</td>
                    {view !== "stock" && <td>{r.orders ?? r.receipts}</td>}
                    <td data-sort-value={r.total ?? r.known_value ?? ""}>
                      {money(r.total ?? r.known_value, r.currency)}
                    </td>
                    {view === "sales" && (
                      <td data-sort-value={r.unpaid ?? ""}>
                        {money(r.unpaid, r.currency)}
                      </td>
                    )}
                    {view === "stock" && <td>{r.unknown_lots}</td>}
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      </div>
      {!rows.length && <p className="empty">No hay datos para este reporte.</p>}
      {view === "stock" && (
        <p className="muted">
          Los costos pendientes no se interpretan como cero. Los importes se
          mantienen separados por moneda.
        </p>
      )}
    </section>
  );
}
function PhysicalReport({ company }: { company: string }) {
  const state = useOperation(company, "inventory"),
    [data, setData] = useState<Row | null>(null);
  useEffect(() => {
    state.run(async () =>
      setData(await request("physical_unit_catalog", { p_company: company })),
    );
  }, [company]);
  return state.error ? (
    <p className="error" role="alert">
      {state.error}
    </p>
  ) : data ? (
    <PhysicalUnits units={data.units} history={data.history} />
  ) : (
    <p role="status">Cargando unidades…</p>
  );
}
export default function Reports({
  company,
  currency = "GTQ",
  inventoryAllowed = false,
}: {
  company: string;
  currency?: string;
  inventoryAllowed?: boolean;
}) {
  const [view, setView] = useState(""),
    [revision, setRevision] = useState(0),
    target = useRef<HTMLDivElement>(null);
  const title = reports.find(([key]) => key === view)?.[1] || "Reportes";
  return (
    <>
      <section className="intro">
        <div>
          <p className="eyebrow">UNA EMPRESA A LA VEZ</p>
          <h1 className="module-title">
            <AppIcon name="module.reports" />
            Reportes
          </h1>
          <p>
            Selecciona el reporte que deseas consultar. Los datos se cargan al
            solicitarlo.
          </p>
        </div>
        {view && view !== "kardex" && (
          <AppButton
            iconKey="action.refresh"
            onClick={() => setRevision((r) => r + 1)}
          >
            Actualizar reporte
          </AppButton>
        )}
      </section>
      <div
        className="actions report-selectors"
        role="group"
        aria-label="Seleccionar reporte"
      >
        {reports
          .filter(
            ([key]) =>
              inventoryAllowed ||
              !["kardex", "valuation", "physical"].includes(key),
          )
          .map(([key, label]) => (
            <AppButton
              key={key}
              className={view === key ? "" : "secondary"}
              iconKey="module.reports"
              aria-pressed={view === key}
              onClick={() => setView(key === view ? "" : key)}
            >
              {label}
            </AppButton>
          ))}
      </div>
      {!view && <p className="empty">No se ha cargado ningún reporte.</p>}
      {view && (
        <>
          <ReportExport target={target} title={title} />
          {view === "kardex" && (
            <p className="muted">
              La copia y el Excel incluyen la página actual y respetan los
              filtros y el orden mostrado.
            </p>
          )}
          <div ref={target}>
            <Suspense fallback={<p role="status">Abriendo reporte…</p>}>
              {["summary", "sales", "purchases", "stock"].includes(view) && (
                <SummaryReport
                  key={company + view + revision}
                  company={company}
                  view={view}
                />
              )}
              {view === "requirements" && (
                <MaterialRequirements
                  key={company + revision}
                  company={company}
                  initialOpen
                />
              )}
              {view === "kardex" && inventoryAllowed && (
                <Kardex
                  key={company + view}
                  company={company}
                  currency={currency}
                  revision={revision}
                  onSaved={async () => {}}
                />
              )}
              {view === "valuation" && inventoryAllowed && (
                <Kardex
                  key={company + view + revision}
                  company={company}
                  currency={currency}
                  revision={revision}
                  view="valuation"
                  onSaved={async () => {}}
                />
              )}
              {view === "physical" && inventoryAllowed && (
                <PhysicalReport key={company + revision} company={company} />
              )}
            </Suspense>
          </div>
        </>
      )}
    </>
  );
}
