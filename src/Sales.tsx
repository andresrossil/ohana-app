import { useEffect, useState } from "react";
import { AppButton } from "./AppIcon";
import { confirmAction } from "./ConfirmDialog";
import { salesTodayRange, salesWorklist } from "./commerce";
import { keyedRequest, money, useOperation, type Row } from "./operations";
import OrderDeliveryDialog from "./OrderDeliveryDialog";
import OrderPreparationDialog, { fulfillmentLabels } from "./OrderPreparationDialog";
import ResponsiveTable from "./ResponsiveTable";
import SaleEditor from "./SaleEditor";
import SearchSelect from "./SearchSelect";
import { openSaleDocument } from "./SaleDocument";
import { paymentMethods } from "./payment-methods";
import "./couriers.css";
import "./sales-worklist.css";

const statusLabels: Record<string, string> = {
  ...fulfillmentLabels, settled: "Ruta liquidada", cancelled: "Cancelado", expired: "Vencido",
};
const pageSize = 50;
const orderDate = new Intl.DateTimeFormat("es-GT", {
  timeZone: "America/Guatemala", dateStyle: "short", timeStyle: "short",
});

export default function Sales({ company, currency = "GTQ" }: { company: string; currency?: string }) {
  const state = useOperation(company, "sales");
  const [filters, setFilters] = useState(() => ({ ...salesTodayRange(), customer: "", status: "" }));
  const [applied, setApplied] = useState(filters);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [cancelOrder, setCancelOrder] = useState<Row | null>(null);
  const [editor, setEditor] = useState<Row | null | undefined>();
  const [viewOrder, setViewOrder] = useState<string | null>(null);
  const [managedOrder, setManagedOrder] = useState<string | null>(null);

  async function load(next = applied, nextPage = page) {
    const result = await salesWorklist(company, "invoice_headers", { ...next, offset: nextPage * pageSize });
    if (nextPage > 0 && result.orders.length === 0) {
      await load(next, nextPage - 1);
      return;
    }
    setOrders(result.orders);
    setHasMore(result.has_more);
    setApplied(next);
    setPage(nextPage);
  }

  useEffect(() => {
    void state.run(async () => {
      const [clients] = await Promise.all([salesWorklist(company, "invoice_customers"), load(filters, 0)]);
      setCustomers(clients);
    });
  }, [company]);

  const reload = () => load();

  return <>
    <section className="intro">
      <div><h1>Ventas y pedidos</h1></div>
      <div className="actions">
        {state.canWrite && <AppButton onClick={() => setEditor(null)}>Ingresar factura</AppButton>}
        <AppButton className="secondary" disabled={state.busy} onClick={() => state.run(reload)}>Actualizar</AppButton>
      </div>
    </section>
    {state.error && !cancelOrder && <p className="error" role="alert">{state.error}</p>}
    <section className="catalog">
      <div className="toolbar"><h2>Facturas</h2></div>
      <form className="settings-grid worklist-filters" onSubmit={(event) => {
        event.preventDefault();
        void state.run(() => load(filters, 0));
      }}>
        <label>Desde<input required type="date" value={filters.from} max={filters.to}
          onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
        <label>Hasta<input required type="date" value={filters.to} min={filters.from}
          onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
        <label>Cliente<SearchSelect value={filters.customer} onChange={(e) => setFilters({ ...filters, customer: e.target.value })}>
          <option value="">Todos los clientes</option>
          {customers.map((client) => <option key={client.id} value={client.id}>{client.name}{client.code ? ` · ${client.code}` : ""}</option>)}
        </SearchSelect></label>
        <label>Estado<SearchSelect value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">Todos los estados</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SearchSelect></label>
        <div className="form-actions">
          <AppButton iconKey="action.search" disabled={state.busy}>Filtrar</AppButton>
          <AppButton type="button" className="secondary" disabled={state.busy} onClick={() => {
            const next = { ...salesTodayRange(), customer: "", status: "" };
            setFilters(next);
            void state.run(() => load(next, 0));
          }}>Hoy</AppButton>
        </div>
      </form>
      <div className="table-wrap" aria-busy={state.busy}>
        <ResponsiveTable>
          <thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Saldo</th><th>Entrega / pago</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>{orders.map((order) => {
            const editable = state.canWrite && order.status === "pending" && !order.settled &&
              ["draft", "invoiced"].includes(order.fulfillment_stage);
            const active = state.canWrite && ["pending", "dispatched"].includes(order.status) && !order.settled;
            return <tr key={order.id}>
              <td data-sort-value={order.number}>#{order.number}</td>
              <td data-sort-value={order.created_at}>{orderDate.format(new Date(order.created_at))}</td>
              <td>{order.customer_snapshot.name}</td>
              <td data-sort-value={order.total}>{money(order.total, order.currency)}</td>
              <td data-sort-value={order.balance}>
                {order.fulfillment_stage === "draft" ? "—" : <strong className={Number(order.balance) > 0 ? "balance-debt" : "balance-zero"}>{money(order.balance, order.currency)}</strong>}
              </td>
              <td>{order.courier_name || (order.delivery === "delivery" ? "Domicilio" : "Retiro")}
                <small>{paymentMethods.find((method) => method.value === order.payment)?.label}</small>
              </td>
              <td>{statusLabels[order.display_status] ?? order.display_status}</td>
              <td className="actions">
                <AppButton className="secondary" iconKey="action.expand" onClick={() => setViewOrder(order.id)}>Ver factura</AppButton>
                <AppButton className="secondary" iconKey="action.print" onClick={() => {
                  if (!openSaleDocument(() => salesWorklist(company, "detail", { order: order.id }))) {
                    state.setError("Permite las ventanas emergentes para abrir la vista de impresión.");
                  }
                }}>Imprimir</AppButton>
                {editable && <AppButton className="secondary" onClick={() => setEditor(order)}>Editar factura</AppButton>}
                {order.fulfillment_stage !== "draft" && <AppButton className="secondary" onClick={() => setManagedOrder(order.id)}>
                  {Number(order.balance) > 0 ? "Pagar factura" : "Ver pagos"}
                </AppButton>}
                {active && order.status === "pending" && order.fulfillment_stage === "draft" && <AppButton iconKey="action.confirm" disabled={state.busy}
                  onClick={() => state.run(async () => {
                    if (!await confirmAction("¿El cliente confirmó el pedido? Se reservarán las unidades disponibles para esta factura.",
                      { title: "Confirmación del cliente", confirmText: "Confirmar pedido" })) return;
                    await keyedRequest(company, "sales_fulfillment", { order: order.id, expected_stage: "draft", expected_revision: order.revision }, "confirm_customer");
                    await reload();
                  })}>Confirmación del cliente</AppButton>}
                {active && <AppButton className="secondary" onClick={() => setCancelOrder(order)}>Cancelar pedido</AppButton>}
              </td>
            </tr>;
          })}</tbody>
        </ResponsiveTable>
        {!orders.length && <p className="empty">{state.busy ? "Consultando facturas…" : "No hay facturas para los filtros seleccionados."}</p>}
      </div>
      {(page > 0 || hasMore) && <div className="toolbar">
        <AppButton className="secondary" disabled={state.busy || page === 0} onClick={() => state.run(() => load(applied, page - 1))}>Anterior</AppButton>
        <span>Página {page + 1}</span>
        <AppButton className="secondary" disabled={state.busy || !hasMore} onClick={() => state.run(() => load(applied, page + 1))}>Siguiente</AppButton>
      </div>}
    </section>
    {editor !== undefined && <SaleEditor company={company} orderId={editor?.id} currency={editor?.currency || currency} onClose={() => setEditor(undefined)} onSaved={reload} />}
    {viewOrder && <OrderPreparationDialog company={company} orderId={viewOrder} onClose={() => setViewOrder(null)} onSaved={reload} />}
    {managedOrder && <OrderDeliveryDialog company={company} orderId={managedOrder} onClose={() => setManagedOrder(null)} onSaved={reload} />}
    {cancelOrder && <div className="overlay">
      <section className="modal operations-dialog" role="dialog" aria-modal="true" aria-label="Cancelar pedido">
        <h2>Cancelar pedido</h2>
        {state.error && <p className="error" role="alert">{state.error}</p>}
        <p>Pedido #{cancelOrder.number} · {cancelOrder.customer_snapshot.name} · {money(cancelOrder.total, cancelOrder.currency)}</p>
        <form onSubmit={(event) => {
          event.preventDefault();
          const reason = new FormData(event.currentTarget).get("reason");
          void state.run(async () => {
            await keyedRequest(company, "sales", { order: cancelOrder.id, reason }, "cancel");
            setCancelOrder(null);
            await reload();
          });
        }}>
          <p>El saldo del documento quedará en cero. Si el inventario ya salió, se devolverá. Si hay reservas, se liberarán. Revierte los pagos y saldos aplicados antes de cancelar.</p>
          <label>Motivo de cancelación<input name="reason" required minLength={5} maxLength={500} /></label>
          <label><input type="checkbox" required /> Confirmo esta operación</label>
          <div className="form-actions">
            <AppButton disabled={state.busy}>Confirmar</AppButton>
            <AppButton type="button" className="secondary" disabled={state.busy} onClick={() => setCancelOrder(null)}>Volver</AppButton>
          </div>
        </form>
      </section>
    </div>}
  </>;
}
