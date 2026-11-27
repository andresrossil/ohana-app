import { useRef, useState } from "react";
import { AppButton } from "./AppIcon";
import { courierRead } from "./delivery-model";
import MoneyInput from "./MoneyInput";
import { keyedRequest, money, today, useOperation, type Row } from "./operations";
import ResponsiveTable from "./ResponsiveTable";
import SearchSelect from "./SearchSelect";

export default function AdminBatchPayments({ company, orders, onClose, onSaved }: {
  company: string; orders: Row[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const state = useOperation(company, "sales");
  const [method, setMethod] = useState("cash");
  const [date, setDate] = useState(today);
  const [amounts, setAmounts] = useState(() => Object.fromEntries(orders.map(order => [order.id, String(order.balance)])));

  const attempt = useRef<Row|null>(null);
  async function save() {
    if (!attempt.current) {
      const payments = [];
      for (const order of orders) {
        const latest = await courierRead(company, "order", { order: order.id });
        const remaining = Number((Number(latest.summary.balance) - Number(latest.summary.pending_transfers || 0)).toFixed(2));
        const amount = Number(amounts[order.id]);
        if (remaining <= 0 || amount > remaining) {
          throw Error(`Revisa el saldo de la factura #${order.invoice_number || order.number} antes de registrar el lote.`);
        }
        payments.push({ order: order.id, amount, expected_due: remaining });
      }
      attempt.current={method,date,payments};
    }
    await keyedRequest(company, "register_admin_payments", attempt.current);
    attempt.current=null;
    await onSaved();
    onClose();
  }

  return <div className="overlay"><section className="modal operations-dialog" role="dialog" aria-modal="true" aria-label="Registrar pagos">
    <header><h2>Registrar pagos</h2><AppButton className="secondary" disabled={state.busy} onClick={onClose}>Cerrar</AppButton></header>
    {state.error && <p className="error" role="alert">{state.error}</p>}
    <form onSubmit={event=>{event.preventDefault();void state.run(save);}}>
      <div className="settings-grid">
        <label>Método<SearchSelect disabled={state.busy} value={method} onChange={event=>{attempt.current=null;setMethod(event.target.value);}}><option value="cash">Efectivo</option><option value="transfer">Transferencia</option></SearchSelect></label>
        <label>Fecha<input type="date" disabled={state.busy} required max={today()} value={date} onChange={event=>{attempt.current=null;setDate(event.target.value);}}/></label>
      </div>
      <ResponsiveTable showAllMobileFields><thead><tr><th>Factura</th><th>Cliente</th><th>Total</th><th>Saldo</th><th>Importe a registrar</th></tr></thead>
        <tbody>{orders.map(order=><tr key={order.id}>
          <td>#{order.invoice_number || order.number}</td><td>{order.customer_snapshot.name}</td>
          <td data-sort-value={order.total}>{money(order.total,order.currency)}</td>
          <td data-sort-value={order.balance}>{money(order.balance,order.currency)}</td>
          <td data-sort-value={amounts[order.id]}><MoneyInput aria-label={`Importe factura ${order.invoice_number || order.number}`} currency={order.currency} min="0.01" max={order.balance} required disabled={state.busy} value={amounts[order.id]} onChange={event=>{attempt.current=null;setAmounts({...amounts,[order.id]:event.target.value});}}/></td>
        </tr>)}</tbody>
      </ResponsiveTable>
      <div className="form-actions"><AppButton disabled={state.busy}>Registrar {orders.length} pagos</AppButton></div>
    </form>
  </section></div>;
}
