import { preparationComplete } from "./commercial-compact";
import { usePreparationChecklist } from "./preparation-checklist";
import { useEffect, useState } from "react";
import { AppButton } from "./AppIcon";
import { sales, salesTodayRange, salesWorklist } from "./commerce";
import { supabase } from "./client";
import { money, useOperation, type Row } from "./operations";
import { deliveryZoneLabel } from "./delivery-address";
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

function customerContacts(orders: Row[]) {
  const contacts = new Map<string, { phone: string; address: string; numbers: string[] }>();
  for (const order of orders) {
    const phone = String(order.phone ?? "").trim();
    const address = [order.address, order.department, deliveryZoneLabel(order.zone)].filter(Boolean).join(" · ");
    const key = JSON.stringify([phone, address]);
    const contact = contacts.get(key) ?? { phone, address, numbers: [] };
    contact.numbers.push("#" + (order.invoice_number || order.number));
    contacts.set(key, contact);
  }
  return [...contacts.entries()];
}

export default function OrderPreparation({ company, userId }: { company: string; userId?: string }) {
  const state = useOperation(company, "sales");
  const { marks, mark } = usePreparationChecklist(JSON.stringify(["orders", userId, company]));
  const lineKey = (order: Row, line: Row) => JSON.stringify([order.id, line.id, line.variant_id, Number(line.quantity)]);
  const [filters, setFilters] = useState(salesTodayRange);
  const [applied, setApplied] = useState(filters);
  const [orders, setOrders] = useState<Row[]>([]);
  const [listPrices, setListPrices] = useState(new Map<string, number>());
  const [view, setView] = useState<"products" | "customers">("products");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [finishing, setFinishing] = useState<string | null>(null);

  async function load(range = applied) {
    const result: Row[] = await salesWorklist(company, "preparation_list", range);
    setOrders(result);
    setApplied(range);
    setListPrices(new Map());
    const customerIds = [...new Set<string>(result.map((order) => order.customer_id).filter(Boolean))];
    if (result.length === 0) return;

    try {
      const customerBatches = [];
      for (let i = 0; i < customerIds.length; i += 100) {
        customerBatches.push(supabase.from("business_partners").select("id,price_list_id")
          .eq("company_id", company).eq("is_customer", true).in("id", customerIds.slice(i, i + 100)));
      }
      const [catalog, ...partners] = await Promise.all([sales(company), ...customerBatches]);
      const listsByCustomer = new Map<string, string | null>();
      for (const batch of partners) {
        if (batch.error) throw batch.error;
        for (const customer of batch.data) listsByCustomer.set(customer.id, customer.price_list_id);
      }
      const pricesByList = new Map<string, number>();
      for (const entry of catalog.price_entries as Row[]) {
        if (entry.price != null) {
          pricesByList.set(JSON.stringify([entry.list_id, entry.variant_id, entry.currency]), Number(entry.price));
        }
      }
      const prices = new Map<string, number>();
      for (const order of result) {
        if (order.customer_id && !listsByCustomer.has(order.customer_id)) continue;
        const list = listsByCustomer.get(order.customer_id) ?? catalog.default_price_list;
        for (const line of order.lines as Row[]) {
          const price = pricesByList.get(JSON.stringify([list, line.variant_id, order.currency]));
          if (price !== undefined) prices.set(lineKey(order, line), price);
        }
      }
      setListPrices(prices);
    } catch {
      state.setError("No se pudieron consultar los precios de lista. Usa Actualizar para volver a intentarlo.");
    }
  }

  useEffect(() => { void state.run(() => load(filters)); }, [company]);



  const products = new Map<string, { product: string; size: string; quantity: number; lines: string[] }>();
  const customers = new Map<string, { name: string; orders: Row[] }>();
  const pendingOrders = orders.filter((order) => ["invoiced", "preparing"].includes(order.stage));
  const showPendingOnly = view === "products" || pendingOnly;
  const visibleOrders = showPendingOnly ? pendingOrders : orders;
  for (const order of visibleOrders) {
    const customer = customers.get(order.customer_id) ?? { name: order.customer_name, orders: [] as Row[] };
    customer.orders.push(order);
    customers.set(order.customer_id, customer);
    if (view !== "products") continue;
    for (const line of order.lines as Row[]) {
      const item = products.get(line.variant_id) ?? { ...preparationLine(line), quantity: 0, lines: [] };
      item.quantity += Number(line.quantity);
      item.lines.push(lineKey(order, line));
      products.set(line.variant_id, item);
    }
  }
  const sortedProducts = [...products].sort(([, a], [, b]) => names.compare(a.product, b.product) || names.compare(a.size, b.size));
  const sortedCustomers = [...customers].sort(([, a], [, b]) => names.compare(a.name, b.name));
  const visibleCount = visibleOrders.length;

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
        {view === "customers" && <label className="preparation-check">
          <input type="checkbox" checked={pendingOnly} onChange={(event) => setPendingOnly(event.target.checked)} />
          Solo pendientes de preparar
        </label>}
        <span>{visibleCount} {visibleCount === 1 ? "pedido" : "pedidos"}</span>
      </div>
      {visibleCount === 0 ? <p className="empty" role="status">
        {state.busy ? "Consultando pedidos…" : showPendingOnly ? "No hay pedidos pendientes de preparar para esas fechas." : "No hay pedidos confirmados para esas fechas."}
      </p> : view === "products" ? <div className="table-wrap">
        <ResponsiveTable showAllMobileFields>
          <thead><tr><th>Producto</th><th>Variante</th><th>Unidades a reunir</th><th>Preparación</th></tr></thead>
          <tbody>{sortedProducts.map(([id, item]) => <tr key={id}>
            <td>{item.product}</td><td>{item.size}</td><td>{item.quantity}</td>
            <td data-sort-value={item.lines.every((key) => marks.has(key)) ? 1 : 0}>
              <label className="preparation-check">
                <input type="checkbox" aria-label={"Reunido: " + item.product + " · " + item.size}
                  checked={item.lines.every((key) => marks.has(key))}
                  ref={(node) => { if (node) node.indeterminate = item.lines.some((key) => marks.has(key)) && !node.checked; }}
                  onChange={(event) => mark(item.lines, event.target.checked)} />
                {item.lines.every((key) => marks.has(key)) ? "Reunido" : "Marcar reunido"}
              </label>
            </td>
          </tr>)}</tbody>
        </ResponsiveTable>
      </div> : sortedCustomers.map(([id, customer]) => (
        <section key={id} className="preparation-customer">
          <header className="preparation-customer-header">
            <h2>{customer.name}</h2>
            <div className="preparation-contacts">
              {customerContacts(customer.orders).map(([key, contact], _, contacts) => (
                <div className="preparation-contact" key={key}>
                  {contacts.length > 1 && <strong>{contact.numbers.join(", ")}</strong>}
                  <span><strong>Teléfono</strong> {contact.phone || "—"}</span>
                  <span><strong>Dirección</strong> {contact.address || "—"}</span>
                </div>
              ))}
            </div>
          </header>
          {customer.orders.map((order) => (
            <section key={order.id} className="preparation-customer">
              <header className="preparation-customer-header">
                <div className="preparation-contact">
                  <strong>Pedido #{order.invoice_number || order.number} · {money(order.total, order.currency)}</strong>
                  <span>{fulfillmentLabels[order.stage]}</span>
                  <time dateTime={order.confirmed_at}>{confirmationDate.format(new Date(order.confirmed_at))}</time>
                </div>
                <div className="preparation-contact">
                  <AppButton className="secondary" iconKey="action.expand" onClick={() => setSelected(order.id)}>Ver pedido</AppButton>
                  {state.canWrite && ["invoiced", "preparing"].includes(order.stage) &&
                    <AppButton iconKey="action.confirm" disabled={state.busy} onClick={() => setFinishing(order.id)}>
                      Confirmar preparación
                    </AppButton>}
                </div>
              </header>
              <div className="table-wrap">
                <ResponsiveTable showAllMobileFields aria-label={`Productos del pedido ${order.invoice_number || order.number}`}>
                  <thead><tr><th>Producto y variante</th><th>Cantidad</th><th>Precio unitario de lista</th><th>Preparación</th></tr></thead>
                  <tbody>{(order.lines as Row[]).map((line) => {
                    const item = preparationLine(line);
                    const key = lineKey(order, line);
                    const price = listPrices.get(key);
                    const complete = preparationComplete(order.stage);
                    const checked = complete || marks.has(key);
                    const description = [item.product, item.size].filter(Boolean).join(" · ");
                    return <tr key={line.id}>
                      <td>{description}{line.is_gift ? " · Regalo" : ""}</td>
                      <td data-sort-value={line.quantity}>{line.quantity}</td>
                      <td data-sort-value={price}>{price === undefined ? "—" : money(price, order.currency)}</td>
                      <td data-sort-value={checked ? 1 : 0}>
                        <label className="preparation-check">
                          <input type="checkbox" aria-label={"Reunido: " + description}
                            checked={checked} disabled={complete} onChange={(event) => mark([key], event.target.checked)} />
                          {checked ? "Reunido" : "Marcar reunido"}
                        </label>
                      </td>
                    </tr>;
                  })}</tbody>
                </ResponsiveTable>
              </div>
            </section>
          ))}
        </section>
      ))}
    </section>
    {selected && <OrderPreparationDialog company={company} orderId={selected} onClose={() => setSelected(null)} onSaved={() => load()} />}
    {finishing && <OrderPreparationDialog finishOnly company={company} orderId={finishing}
      onClose={() => setFinishing(null)} onSaved={async () => { await load(); setFinishing(null); }} />}
  </>;
}
