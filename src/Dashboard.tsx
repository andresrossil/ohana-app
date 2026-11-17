import { useEffect, useState } from "react";
import { supabase } from "./client";
import { money } from "./operations";
import ResponsiveTable from "./ResponsiveTable";
import { AppButton } from "./AppIcon";
import "./dashboard.css";

type StockQuantity = number | string;
type AvailableProduct = { id: string; product: string; variant: string; available: StockQuantity; general_price?: StockQuantity | null };
type ReorderMaterial = { id: string; sku: string | null; name: string; unit: string | null; minimum: StockQuantity; available: StockQuantity };
type DashboardData = Record<string, unknown> & {
  available_products?: AvailableProduct[];
  reorder_materials?: ReorderMaterial[];
  price_list?: string | null;
  suppliers?: number;
  customers?: number;
  drafts?: number;
  invoices?: number;
  active_customers?: number;
  reorder?: number;
};

export default function Dashboard({ company, currency, materials, products }: {
  company: string; currency: string; materials?: number; products?: number;
}) {
  const [data, setData] = useState<DashboardData>();
  const [failed, setFailed] = useState(false);
  const [stockExpanded, setStockExpanded] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await supabase.rpc("company_dashboard", { p_company: company });
      if (active) {
        setFailed(Boolean(error));
        setData(error ? undefined : data);
      }
    }
    void load();
    window.addEventListener("focus", load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
    };
  }, [company]);

  const number = (value: number | string | null | undefined) =>
    value == null ? "—" : Number(value).toLocaleString("es-GT", { maximumFractionDigits: 2 });
  const amount = (key: string) => data?.[key] == null ? "—" : money(Number(data[key]), currency);
  const previous = Number(data?.sales_previous);
  const variation = previous > 0 ? number((Number(data?.sales_current) / previous - 1) * 100) + " %" : "—";
  const metric = (label: string, value: string, note?: string) => (
    <div className="dashboard-metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>
  );
  const missing = (key: string) => Number(data?.[key]) > 0 ? "Valor parcial · " + number(Number(data?.[key])) + " sin precio o costo" : undefined;

  return <>
    {failed && <p className="error" role="alert">No se pudieron cargar los indicadores del dashboard.</p>}
    {data?.available_products && (
      <section className="catalog dashboard-stock-list" aria-labelledby="dashboard-stock-title">
        <header className="dashboard-stock-heading">
          <h2 id="dashboard-stock-title">Productos disponibles</h2>
          <AppButton type="button" className="secondary"
            iconKey={stockExpanded ? "action.collapse" : "action.expand"}
            aria-expanded={stockExpanded} aria-controls="dashboard-stock-content"
            onClick={() => setStockExpanded(expanded => !expanded)}>
            {stockExpanded ? "Contraer" : "Expandir"}
          </AppButton>
        </header>
        <div id="dashboard-stock-content" hidden={!stockExpanded}>
          {stockExpanded && (data.available_products.length ? (
            <div className="table-wrap">
              <ResponsiveTable showAllMobileFields>
                <thead><tr><th>Producto</th><th>Variante</th><th>Disponible</th><th>Precio General</th></tr></thead>
                <tbody>{data.available_products.map(item => (
                  <tr key={item.id}>
                    <td>{item.product}</td>
                    <td>{item.variant || "—"}</td>
                    <td data-sort-value={item.available}><strong>{number(item.available)} ud</strong></td>
                    <td data-sort-value={item.general_price ?? ""}>{item.general_price == null ? "Sin precio" : money(item.general_price, currency)}</td>
                  </tr>
                ))}</tbody>
              </ResponsiveTable>
            </div>
          ) : <p className="empty">No hay productos con existencias disponibles.</p>)}
        </div>
      </section>
    )}
    <div className="dashboard-grid" aria-busy={!data && !failed}>
      {materials != null && <section className="catalog dashboard-card">
        <h2>Materiales</h2><div>{metric("Materiales activos", number(materials))}
        {metric("Valor de inventario", amount("material_value"), missing("material_missing"))}</div>
      </section>}
      {products != null && <section className="catalog dashboard-card">
        <h2>Productos</h2><div>{metric("Productos activos", number(products))}
        {metric("Valor de productos", data?.price_list ? amount("product_value") : "—",
          data?.price_list ? "Lista " + data.price_list + (missing("product_missing") ? " · " + missing("product_missing") : "")
          : data?.product_value != null ? "Sin lista General activa" : undefined)}</div>
      </section>}
      {(data?.suppliers != null || data?.customers != null) && <section className="catalog dashboard-card">
        <h2>Socios</h2><div>
          {data?.customers != null && metric("Clientes", number(data.customers))}
          {data?.suppliers != null && metric("Proveedores", number(data.suppliers))}
        </div>
      </section>}
      {data?.sales_current != null && <>
        <section className="catalog dashboard-card dashboard-sales">
          <h2>Ventas</h2><div>{metric("Mes en curso", amount("sales_current"))}
          {metric("Mes anterior", amount("sales_previous"))}
          {metric("Variación mensual", variation)}</div>
        </section>
        <section className="catalog dashboard-card dashboard-orders">
          <h2>Pedidos y facturas</h2><div>
            {metric("Pedidos en borrador", number(data.drafts))}
            {metric("Facturas del mes", number(data.invoices))}
            {metric("Drop size", amount("drop_size"), "Promedio por factura")}
            {metric("Clientes activos del mes", number(data.active_customers))}
          </div>
        </section>
      </>}
      {data?.reorder != null && <section className="catalog dashboard-card dashboard-reorder">
        <h2>Reorden</h2>
        <div>{metric("Materiales con disponible menor al mínimo", number(data.reorder_materials?.length ?? data.reorder))}</div>
        {data.reorder_materials?.length ? (
          <div className="table-wrap">
            <ResponsiveTable showAllMobileFields>
              <thead><tr><th>Material</th><th>SKU</th><th>Disponible</th><th>Mínimo</th></tr></thead>
              <tbody>{data.reorder_materials.map(item => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.sku || "—"}</td>
                  <td data-sort-value={item.available}>{number(item.available)} {item.unit}</td>
                  <td data-sort-value={item.minimum}>{number(item.minimum)} {item.unit}</td>
                </tr>
              ))}</tbody>
            </ResponsiveTable>
          </div>
        ) : null}
      </section>}
    </div>
  </>;
}
