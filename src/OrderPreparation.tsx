import { useEffect, useState } from "react";
import { AppButton } from "./AppIcon";
import { salesTodayRange, salesWorklist } from "./commerce";
import { useOperation, type Row } from "./operations";
import OrderPreparationDialog, { fulfillmentLabels } from "./OrderPreparationDialog";
import ResponsiveTable from "./ResponsiveTable";
import { variantLabel } from "./variant-label";
import "./sales-worklist.css";

const names = new Intl.Collator("es-GT", { sensitivity: "base", numeric: true });
const confirmationDate = new Intl.DateTimeFormat("es-GT", {
  timeZone: "America/Guatemala", dateStyle: "short", timeStyle: "short",
});
function preparationLine(line: Row) {
  const [product, ...size] = String(line.description ?? "").split(" · ");
  return { product, size: variantLabel({ ...line, name: size.join(" · ") }) };
}

export default function OrderPreparation({ company }: { company: string }) {
  const state = useOperation(company, "sales");
  const [filters, setFilters] = useState(salesTodayRange);
  const [applied, setApplied] = useState(filters);
  const [orders, setOrders] = useState<Row[]>([]);
  const [view, setView] = useState<"products" | "customers">("products");
  const [selected, setSelected] = useState<string | null>(null);

  async function load(range = applied) {
    const result = await salesWorklist(company, "preparation_list", range);
    setOrders(result);
    setApplied(range);
  }

  useEffect(() => { void state.run(() => load(filters)); }, [company]);

  const products = new Map<string, { product: string; size: string; quantity: number }>();
  const customers = new Map<string, { name: string; orders: Row[] }>();
  for (const order of orders) {
    const customer = customers.get(order.customer_id) ?? { name: order.customer_name, orders: [] as Row[] };
    customer.orders.push(order);
    customers.set(order.customer_id, customer);
    for (const line of order.lines as Row[]) {
      const item = products.get(line.variant_id) ?? { ...preparationLine(line), quantity: 0 };
      item.quantity += Number(line.quantity);
      products.set(line.variant_id, item);
    }
  }
  const sortedProducts = [...products].sort(([, a], [, b]) => names.compare(a.product, b.product) || names.compare(a.size, b.size));
  const sortedCustomers = [...customers].sort(([, a], [, b]) => names.compare(a.name, b.name));

  return <>
    <section className="intro">
      <div>
        <h1>Preparación de pedidos</h1>
        <p>Reúne los productos y luego separa las unidades de cada pedido.</p>
      </div>
      <AppButton className="secondary" disabled={state.busy} onClick={() => state.run(() => load())}>Actualizar</AppButton>
    </section>
    {state.error && <p className="error" role="alert">{state.error}</p>}
    <section className="catalog preparation-worklist">
      <form className="settings-grid worklist-filters" onSubmit={(event) => {
        event.preventDefault();
        void state.run(() => load(filters));
      }}>
        <label>Confirmados desde<input required type="date" value={filters.from} max={filters.to}
          onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
        <label>Confirmados hasta<input required type="date" value={filters.to} min={filters.from}
          onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
        <div className="form-actions">
          <AppButton iconKey="action.search" disabled={state.busy}>Filtrar</AppButton>
          <AppButton type="button" className="secondary" disabled={state.busy} onClick={() => {
            const next = salesTodayRange();
            setFilters(next);
            void state.run(() => load(next));
          }}>Hoy</AppButton>
        </div>
      </form>
      <div className="toolbar" aria-label="Vistas de preparación">
        <AppButton className="secondary" iconKey="module.products" aria-pressed={view === "products"}
          onClick={() => setView("products")}>Por producto y variante</AppButton>
        <AppButton className="secondary" iconKey="module.customers" aria-pressed={view === "customers"}
          onClick={() => setView("customers")}>Por cliente</AppButton>
        <span>{orders.length} {orders.length === 1 ? "pedido" : "pedidos"}</span>
      </div>
      {orders.length === 0 ? <p className="empty" role="status">
        {state.busy ? "Consultando pedidos…" : "No hay pedidos confirmados pendientes de preparar para esas fechas."}
      </p> : view === "products" ? <div className="table-wrap">
        <ResponsiveTable>
          <thead><tr><th>Producto</th><th>Variante</th><th>Unidades a reunir</th></tr></thead>
          <tbody>{sortedProducts.map(([id, item]) => <tr key={id}>
            <td>{item.product}</td><td>{item.size}</td><td>{item.quantity}</td>
          </tr>)}</tbody>
        </ResponsiveTable>
      </div> : sortedCustomers.map(([id, customer]) => (
        <section key={id} className="preparation-customer">
          <h2>{customer.name}</h2>
          <div className="table-wrap">
            <ResponsiveTable>
              <thead><tr><th>Pedido</th><th>Confirmado</th><th>Productos y variantes</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>{customer.orders.map((order) => <tr key={order.id}>
                <td data-sort-value={order.invoice_number || order.number}>#{order.invoice_number || order.number}</td>
                <td data-sort-value={order.confirmed_at}>{confirmationDate.format(new Date(order.confirmed_at))}</td>
                <td><ul className="preparation-items">
                  {(order.lines as Row[]).map((line) => {
                    const item = preparationLine(line);
                    return <li key={line.id}>{line.quantity} × {item.product} · {item.size}{line.is_gift ? " · Regalo" : ""}</li>;
                  })}
                </ul></td>
                <td>{fulfillmentLabels[order.stage]}</td>
                <td><AppButton className="secondary" iconKey="action.expand" onClick={() => setSelected(order.id)}>Ver pedido</AppButton></td>
              </tr>)}</tbody>
            </ResponsiveTable>
          </div>
        </section>
      ))}
    </section>
    {selected && <OrderPreparationDialog company={company} orderId={selected} onClose={() => setSelected(null)} onSaved={() => load()} />}
  </>;
}
