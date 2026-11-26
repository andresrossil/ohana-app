import { useEffect, useState } from "react";
import ProductionMenu from "./ProductionMenu";
import { roundMoney } from "./sale-form-model";
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
const beginning = "0001-01-01";
const salesDay = new Intl.DateTimeFormat("es-GT", { dateStyle: "short", timeZone: "UTC" });
const orderDate = new Intl.DateTimeFormat("es-GT", {
  timeZone: "America/Guatemala", dateStyle: "short", timeStyle: "short",
});

export default function Sales({ company, currency = "GTQ", initialDrafts = false }: { company: string; currency?: string; initialDrafts?: boolean }) {
  const state = useOperation(company, "sales");
  const [filters, setFilters] = useState(() => ({ ...(initialDrafts ? { ...salesTodayRange(), from: "0001-01-01" } : salesTodayRange()), customer: "", status: initialDrafts ? "draft" : "" }));
  const [applied, setApplied] = useState(filters);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [cancelOrder, setCancelOrder] = useState<Row | null>(null);
  const [editor, setEditor] = useState<Row | null | undefined>();
  const [viewOrder, setViewOrder] = useState<{ id: string; finishOnly?: boolean } | null>(null);
  const [labelDate, setLabelDate] = useState("");
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
  function printOrder(orderId: string, format: "invoice" | "label") {
    if (!openSaleDocument(() => salesWorklist(company, "detail", { order: orderId }), format)) {
      state.setError("Permite las ventanas emergentes para abrir la vista de impresión.");
    }
  }

  function printDayLabels(date: string) {
    if (!openSaleDocument(async () => {
      const candidates: Row[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const result = await salesWorklist(company, "invoice_headers", { from: date, to: date, offset });
        candidates.push(...result.orders.filter((order: Row) =>
          order.courier_name && !order.settled &&
          ["invoiced", "preparing", "finished", "courier"].includes(order.display_status)));
        if (!result.has_more) break;
      }
      const labels: Row[] = [];
      for (let offset = 0; offset < candidates.length; offset += 8) {
        const details = await Promise.all(candidates.slice(offset, offset + 8).map((order) =>
          salesWorklist(company, "detail", { order: order.id })));
        labels.push(...details.filter(({ delivery, order, settled }) =>
          delivery?.kind === "courier" && ["pending", "in_transit"].includes(delivery.status) &&
          ["pending", "dispatched"].includes(order.status) && order.fulfillment_stage !== "draft" && !settled));
      }
      return labels.reverse();
    }, "labels")) {
      state.setError("Permite las ventanas emergentes para imprimir las etiquetas.");
      return;
    }
    setLabelDate("");
  }

  const filterSummary = [
    applied.from === beginning ? "Desde el inicio" : salesDay.format(new Date(applied.from)),
    salesDay.format(new Date(applied.to)),
    customers.find(client => client.id === applied.customer)?.name || "Todos los clientes",
    statusLabels[applied.status] || "Todos los estados",
  ].join(" · ");

  return <div className="sales-worklist">
    <section className="sales-worklist-header">
      <div className="sales-worklist-title"><h1>Ventas y pedidos</h1>
        <AppButton className="secondary catalog-icon-button" iconKey="action.refresh" aria-label="Actualizar" title="Actualizar"
          disabled={state.busy} onClick={() => state.run(reload)} />
      </div>
      <div className="actions">
        {state.canWrite && <AppButton onClick={() => setEditor(null)}>Nueva factura</AppButton>}
        <AppButton className="secondary" iconKey="action.print" onClick={() => setLabelDate(salesTodayRange().from)}>Imprimir etiquetas del día</AppButton>
      </div>
    </section>
    {labelDate && <div className="overlay"><section className="modal operations-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-label-title"
      onKeyDown={(event) => { if (event.key === "Escape") setLabelDate(""); }}>
      <h2 id="bulk-label-title">Imprimir etiquetas del día</h2>
      <form onSubmit={(event) => { event.preventDefault(); printDayLabels(labelDate); }}>
        <label>Fecha del pedido<input type="date" required autoFocus value={labelDate}
          onChange={(event) => { if (event.target.value) setLabelDate(event.target.value); }} /></label>
        <div className="form-actions">
          <AppButton type="submit" iconKey="action.print">Abrir vista de impresión</AppButton>
          <AppButton type="button" className="secondary" onClick={() => setLabelDate("")}>Cancelar</AppButton>
        </div>
      </form>
    </section></div>}
    {state.error && !cancelOrder && <p className="error" role="alert" style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{state.error}</p>}
    <section className="catalog sales-worklist-list">
      <details className="sales-worklist-filters">
        <summary><strong>Filtros</strong><small>{filterSummary}</small></summary>
      <form className="settings-grid worklist-filters" onSubmit={(event) => {
        event.preventDefault();
        void state.run(() => load(filters, 0));
      }}>
        <label>Fecha desde<input type="date" value={filters.from === beginning ? "" : filters.from} max={filters.to}
          onChange={(e) => setFilters({ ...filters, from: e.target.value || beginning })} />
          {filters.from === beginning && <small>Desde el inicio</small>}</label>
        <label>Fecha hasta<input required type="date" value={filters.to} min={filters.from}
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
      </details>
      <div className="table-wrap" aria-busy={state.busy}>
        <ResponsiveTable className="sales-worklist-table" showAllMobileFields compactRowActions>
          <thead><tr><th>Cliente</th><th>Pedido</th><th>Fecha</th><th>Total</th><th>Pagado</th><th>Pendiente</th><th>Entrega</th><th>Forma de pago</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>{orders.map((order) => {
            const draft = order.fulfillment_stage === "draft";
            const closed = ["cancelled", "expired"].includes(order.status);
            const editable = state.canWrite && order.status === "pending" && !order.settled &&
              ["draft", "invoiced"].includes(order.fulfillment_stage);
            const active = state.canWrite && ["pending", "dispatched"].includes(order.status) && !order.settled;
            const balance = draft || closed || order.balance == null ? null : Number(order.balance);
            // The existing customer balance is total minus covered payments, floored at zero.
            const paid = balance == null ? null : roundMoney(Number(order.total) - balance);
            const pay = state.canWrite && balance != null && balance > 0;
            const manage = () => setManagedOrder(order.id);
            const view = (finishOnly = false) => setViewOrder({ id: order.id, finishOnly });
            const confirmDraft = () => state.run(async () => {
                if (!await confirmAction("¿El cliente confirmó el pedido? Se comprobarán las existencias y, si alcanzan, se reservarán las unidades del pedido.",
                  { title: "Confirmación del cliente", confirmText: "Confirmar pedido" })) return;
                try {
                  await keyedRequest(company, "sales_fulfillment", { order: order.id, expected_stage: "draft", expected_revision: order.revision }, "confirm_customer");
                } catch (error) {
                  const message = (error as { message?: string }).message;
                  const stockWarning = "El pedido sigue en borrador. Revisa estas existencias:";
                  if (!message?.startsWith(stockWarning)) throw error;
                  await confirmAction("El pedido sigue en borrador.\n\n" + message.slice(stockWarning.length).trim(),
                    { title: "Inventario insuficiente", confirmText: "Cerrar", cancelText: null });
                  return;
                }
                await reload();
              });
            let primary: { label: string; run: () => void } | undefined;
            if (active && order.status === "pending" && draft) primary = { label: "Confirmar", run: confirmDraft };
            else if (active && order.display_status === "invoiced") primary = { label: "Preparar", run: () => view() };
            else if (active && order.display_status === "preparing") primary = { label: "Terminar preparación", run: () => view(true) };
            else if (active && order.display_status === "finished") primary = { label: order.courier_name ? "Enviar" : "Confirmar entrega", run: () => view() };
            else if (pay) primary = { label: "Registrar pago", run: manage };
            const document = "#" + (order.invoice_number || order.number);
            return <tr key={order.id}>
              <td className="sales-row-client"><strong>{order.customer_snapshot.name}</strong></td>
              <td className="sales-row-number" data-sort-value={order.invoice_number || order.number}>{document}</td>
              <td className="sales-row-date" data-sort-value={order.created_at}>{orderDate.format(new Date(order.created_at))}</td>
              <td className="sales-row-total" data-sort-value={order.total}><strong>{money(order.total, order.currency)}</strong></td>
              <td className="sales-row-paid" data-sort-value={paid ?? ""}><strong className={paid == null ? "sales-amount-na" : "sales-amount-ok"}>{paid == null ? "—" : money(paid, order.currency)}</strong></td>
              <td className="sales-row-balance" data-sort-value={balance ?? ""}><strong className={balance == null ? "sales-amount-na" : balance > 0 ? "sales-amount-due" : "sales-amount-ok"}>{balance == null ? "—" : money(balance, order.currency)}</strong></td>
              <td className="sales-row-delivery">{order.courier_name || (order.delivery === "delivery" ? "Domicilio" : "Retiro")}</td>
              <td className="sales-row-method">{paymentMethods.find(method => method.value === order.payment)?.label || "—"}</td>
              <td className="sales-row-status"><span className="sales-status" data-status={order.display_status}>{statusLabels[order.display_status] ?? order.display_status}</span></td>
              <td className="sales-row-action"><div className="sales-row-buttons">
                <AppButton className="secondary" onClick={() => view()}>Ver factura</AppButton>
                {primary && <AppButton disabled={state.busy} onClick={primary.run}>{primary.label}</AppButton>}
                <ProductionMenu document={document}>
                  {editable && <AppButton className="secondary" onClick={() => setEditor(order)}>Editar factura</AppButton>}
                  <AppButton className="secondary" iconKey="action.print" onClick={() => printOrder(order.id, "invoice")}>Imprimir factura</AppButton>
                  <AppButton className="secondary" iconKey="action.print" onClick={() => printOrder(order.id, "label")}>Imprimir etiqueta</AppButton>
                  {pay && primary?.label !== "Registrar pago" && <AppButton className="secondary" onClick={manage}>Registrar pago</AppButton>}
                  {!draft && <AppButton className="secondary" onClick={manage}>Consultar pagos</AppButton>}
                  {active && <AppButton className="danger" onClick={() => setCancelOrder(order)}>Cancelar pedido</AppButton>}
                </ProductionMenu>
              </div></td>
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
    {viewOrder && <OrderPreparationDialog company={company} orderId={viewOrder.id} finishOnly={viewOrder.finishOnly} onClose={() => setViewOrder(null)} onSaved={reload} />}
    {managedOrder && <OrderDeliveryDialog company={company} orderId={managedOrder} onClose={() => setManagedOrder(null)} onSaved={reload} />}
    {cancelOrder && <div className="overlay">
      <section className="modal operations-dialog" role="dialog" aria-modal="true" aria-label="Cancelar pedido">
        <h2>Cancelar pedido</h2>
        {state.error && <p className="error" role="alert" style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{state.error}</p>}
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
  </div>;
}
