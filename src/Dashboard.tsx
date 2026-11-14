import { useEffect, useState } from "react";
import { supabase } from "./client";
import { money } from "./operations";
import "./dashboard.css";

type DashboardData = Record<string, number | string | null>;

export default function Dashboard({ company, currency, materials, products }: {
  company: string; currency: string; materials?: number; products?: number;
}) {
  const [data, setData] = useState<DashboardData>();
  const [failed, setFailed] = useState(false);
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
  const amount = (key: string) => data?.[key] == null ? "—" : money(data[key], currency);
  const previous = Number(data?.sales_previous);
  const variation = previous > 0 ? number((Number(data?.sales_current) / previous - 1) * 100) + " %" : "—";
  const metric = (label: string, value: string, note?: string) => (
    <div className="dashboard-metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>
  );
  const missing = (key: string) => Number(data?.[key]) > 0 ? "Valor parcial · " + number(data?.[key]) + " sin precio o costo" : undefined;

  return <>
    {failed && <p className="error" role="alert">No se pudieron cargar los indicadores del dashboard.</p>}
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
      {data?.reorder != null && <section className="catalog dashboard-card">
        <h2>Reorden</h2><div>{metric("SKU con disponible menor al mínimo", number(data.reorder))}</div>
      </section>}
    </div>
  </>;
}
