import { useEffect, useRef, useState } from "react";
import SearchSelect from "./SearchSelect";
import ResponsiveTable from "./ResponsiveTable";
import MoneyInput from "./MoneyInput";
import { AppButton, AppIcon } from "./AppIcon";
import { confirmAction } from "./ConfirmDialog";
import { keyedRequest, money, today, useOperation, type Row } from "./operations";
import { courierRead } from "./delivery-model";
import OrderDeliverySummary from "./OrderDeliverySummary";
import { compactMoney } from "./commercial-compact";
import "./commercial-compact.css";
import { roundMoney } from "./sale-form-model";

export const blankPayment = (method="cash"):Row=>({key:crypto.randomUUID(),amount:"",method:method==="transfer"?"transfer":"cash",confirmed:false,receiver:"ohana",received_on:today(),notes:""});
export function PaymentFields({value,onChange,courier=false,currency="GTQ",fullAmount}:{value:Row;onChange:(v:Row)=>void;courier?:boolean;currency?:string;fullAmount?:number}){
 const change=(key:string,v:any)=>onChange({...value,[key]:v,...(key==="method"?{confirmed:false}:{}),...(key==="amount"?{pay_full:false}:{}),...(key==="receiver"&&v==="courier"?{method:"cash"}:{})});
 return <div className="settings-grid payment-fields">
  {fullAmount!=null&&fullAmount>0&&<label className="form-wide payment-full"><input type="checkbox" checked={!!value.pay_full} onChange={e=>onChange({...value,pay_full:e.target.checked,amount:e.target.checked?fullAmount.toFixed(2):""})}/> Pagar completa</label>}
  <label>Importe recibido<MoneyInput currency={currency} required min="0.01" value={value.amount} onChange={e=>change("amount",e.target.value)}/></label>
  <label>Fecha del pago<input type="date" required max={today()} value={value.received_on} onChange={e=>change("received_on",e.target.value)}/></label>
  <label>Método<SearchSelect value={value.method} disabled={value.receiver==="courier"} onChange={e=>change("method",e.target.value)}><option value="cash">Efectivo</option><option value="transfer">Transferencia bancaria</option></SearchSelect></label>
  <label>Quién recibió el dinero<SearchSelect value={value.receiver} onChange={e=>change("receiver",e.target.value)}><option value="ohana">Ohana directamente</option>{courier&&<option value="courier">Mensajero · efectivo pendiente de liquidar</option>}</SearchSelect></label>
  <label className="form-wide">Referencia del pago · opcional<input maxLength={1000} value={value.notes||""} onChange={e=>change("notes",e.target.value)}/></label>
  {value.method==="transfer"&&<p className="form-wide">Al guardar confirmarás que el dinero ya ingresó al banco. El pago quedará recibido, sin una segunda confirmación en el historial.</p>}
 </div>;
}
export function InitialPayments({rows,onChange,courier,currency,method}:{rows:Row[];onChange:(v:Row[])=>void;courier:boolean;currency:string;method:string}){
 return <fieldset className="form-wide"><legend>Pagos y comprobantes · opcional</legend>
  <p>Las transferencias quedan pendientes hasta confirmar el ingreso al banco. El exceso confirmado quedará como saldo a favor del cliente.</p>
  {rows.map((p,i)=><section className="payment-entry" key={p.key}><h4>Pago {i+1}</h4><PaymentFields value={p} onChange={v=>onChange(rows.map(x=>x.key===p.key?v:x))} courier={courier} currency={currency}/><AppButton type="button" className="secondary" onClick={()=>onChange(rows.filter(x=>x.key!==p.key))}>Quitar pago</AppButton></section>)}
  <AppButton type="button" className="secondary" disabled={rows.length>=30} onClick={()=>onChange([...rows,blankPayment(method)])}>Agregar pago</AppButton>
 </fieldset>;
}
export default function OrderDeliveryDialog({company,orderId,onClose,onSaved}:{company:string;orderId:string;onClose:()=>void;onSaved:()=>Promise<void>}){
 const state=useOperation(company,"sales");
 const submitting=useRef(false);
 const [paymentDirty,setPaymentDirty]=useState(false);
 const [data,setData]=useState<Row|null>(null),[payment,setPayment]=useState<Row>(blankPayment),[voiding,setVoiding]=useState<Row|null>(null),[reason,setReason]=useState(""),[credit,setCredit]=useState("");
 const load=async()=>{const d=await courierRead(company,"order",{order:orderId});setData(d);return d;};
 useEffect(()=>{void state.run(async()=>{const d=await load();setPaymentDirty(false);setPayment({...blankPayment(d.order.payment),amount:String(Math.max(0,roundMoney(Number(d.summary.balance||0)-Number(d.summary.pending_transfers||0))))});});},[company,orderId]);
 const close=async()=>{if(state.busy)return;if((paymentDirty||credit!==""||voiding)&&!(await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?")))return;onClose();};
 const active=data&&!['cancelled','expired'].includes(data.order.status);
 const currency=data?.order.currency||"GTQ";
 const due=data?(data.summary.balance??Math.max(0,roundMoney(Number(data.order.total)-Number(data.summary.paid)))):0;
 const pendingTransfers=Number(data?.summary.pending_transfers||0);
 const availableDue=Math.max(0,roundMoney(due-pendingTransfers));
 const full=payment.pay_full!==false;
 const amountShown=full?availableDue.toFixed(2):payment.amount;
 const registerPayment=async()=>{
  if(submitting.current||state.busy)return;
  submitting.current=true;
  try { await state.run(async()=>{
  const latest=await courierRead(company,"order",{order:orderId});
  setData(latest);
  const outstanding=Math.max(0,roundMoney(Number(latest.order.total)-Number(latest.summary.paid)));
  const remaining=Math.max(0,roundMoney(outstanding-Number(latest.summary.pending_transfers||0)));
  if(remaining<=0)throw Error(outstanding>0?"Hay transferencias pendientes que cubren la factura. Confirma el ingreso o anula los comprobantes duplicados antes de registrar otro pago.":"La factura ya está pagada; no admite nuevos pagos.");
  const amount=full?remaining:roundMoney(Number(payment.amount)),difference=roundMoney(amount-remaining);
  if(full&&remaining!==availableDue)throw Error("Cambió el saldo. Revisa el importe actualizado antes de registrar.");
  if(!Number.isFinite(amount)||amount<=0)throw Error("Ingresa un importe válido.");
  const transfer=payment.method==="transfer";
  if((difference>0)&&!(await confirmAction(`Total de factura: ${compactMoney(latest.order.total,currency)}\nPagado anteriormente: ${compactMoney(latest.summary.paid,currency)}\nPendiente sin comprobantes: ${compactMoney(remaining,currency)}\nPago a registrar: ${compactMoney(amount,currency)}${difference!==0?`\nDiferencia: ${compactMoney(Math.abs(difference),currency)} (${difference>0?"excedente a favor":"faltante por pagar"}).`:""}\n${transfer?"¿Confirmas que este importe ya ingresó al banco? Se registrará como recibido.":"¿Es correcto el monto?"}`,{title:transfer?"Confirmar pago recibido":"Revisar importe del pago",confirmText:"Sí, registrar pago"})))return;
  await keyedRequest(company,"courier_operations",{...payment,amount:amount.toFixed(2),confirmed:transfer,order:orderId,expected_due:remaining,discrepancy_confirmed:difference!==0},"payment_add");
  setPaymentDirty(false);setPayment(blankPayment(latest.order.payment));await load();await onSaved();
 }); } finally { submitting.current=false; }
 };
 const editPayment=(key:string,value:string)=>{setPayment(previous=>({...previous,[key]:value}));setPaymentDirty(true);};
 const availableCredit=Math.max(0,Number(data?.account?.find((a:Row)=>a.currency===currency)?.credit||0)-Number(data?.summary.excess||0));
 return <div className="overlay commercial-overlay"><section className="modal operations-dialog courier-dialog commercial-dialog" role="dialog" aria-modal="true" aria-label="Registrar pago" data-navigation-dirty={paymentDirty||credit!==""||!!voiding}>
  <header className="commercial-header"><div><h2>Registrar pago</h2>{data&&<small>#{data.order.invoice_number||data.order.number} · {data.order.customer_snapshot.name}</small>}</div><AppButton className="secondary" iconKey="action.cancel" aria-label="Cerrar" disabled={state.busy} onClick={close}>×</AppButton></header>
  <div className="commercial-body">
  {state.error&&<p className="error" role="alert"><AppIcon name="status.error"/>{state.error}</p>}
  {data&&<>
   <dl className="commercial-metrics"><div><dt>Total de factura</dt><dd>{compactMoney(data.order.total,currency)}</dd></div><div><dt>Total pagado</dt><dd>{compactMoney(data.summary.paid,currency)}</dd></div><div><dt>Saldo pendiente</dt><dd><strong>{compactMoney(due,currency)}</strong></dd></div></dl>
   {active&&state.canWrite&&availableDue>0&&<form id="direct-invoice-payment" data-dirty-managed onSubmit={e=>{e.preventDefault();void registerPayment();}}>
    <fieldset disabled={state.busy} className="commercial-fields">
     <div role="group" aria-label="Tipo de pago" className="commercial-toggle form-wide">
      {[true,false].map(option=><button key={String(option)} type="button" className="secondary" aria-pressed={full===option} onClick={()=>{setPayment({...payment,pay_full:option,amount:option?"":availableDue.toFixed(2)});setPaymentDirty(true);}}>{option?"Pago completo":"Pago parcial"}</button>)}
     </div>
     <label>Importe recibido<MoneyInput compact currency={currency} required readOnly={full} min="0.01" value={amountShown} onChange={e=>editPayment("amount",e.target.value)}/></label>
     <label>Fecha del pago<input type="date" required max={today()} value={payment.received_on} onChange={e=>editPayment("received_on",e.target.value)}/></label>
     <div role="group" aria-label="Método de pago" className="commercial-toggle form-wide">
      {[["cash","Efectivo"],["transfer","Transferencia"]].map(([method,label])=><button key={method} type="button" className="secondary" aria-pressed={payment.method===method} onClick={()=>editPayment("method",method)}>{label}</button>)}
     </div>
     {payment.method==="transfer"?<label className="form-wide">Referencia del pago<input maxLength={1000} value={payment.notes} onChange={e=>editPayment("notes",e.target.value)}/></label>:<details className="form-wide commercial-details"><summary>Referencia opcional</summary><label>Referencia del pago<input maxLength={1000} value={payment.notes} onChange={e=>editPayment("notes",e.target.value)}/></label></details>}
    </fieldset>
   </form>}
   {active&&state.canWrite&&availableDue>0&&payment.method==="transfer"&&<p className="muted">Registra la transferencia cuando el dinero haya ingresado al banco.</p>}
   {active&&pendingTransfers>0&&due>0&&<p role="status">Hay {compactMoney(pendingTransfers,currency)} en transferencias por confirmar. Saldo sin comprobantes {compactMoney(availableDue,currency)}.</p>}
   {active&&due<=0&&<p role="status">Factura pagada.</p>}
   <details className="commercial-details"><summary>Historial de pagos ({data.payments.length})</summary>
   <div className="table-wrap"><ResponsiveTable><thead><tr><th>Fecha</th><th>Importe</th><th>Método</th><th>Recibido por</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{data.payments.map((p:Row)=><tr key={p.id}><td>{p.received_on}</td><td data-sort-value={p.amount}>{compactMoney(p.amount,currency)}</td><td>{p.method==="cash"?"Efectivo":"Transferencia"}</td><td>{p.receiver==="courier"?"Mensajero":"Ohana"}<small>{p.notes}</small></td><td>{p.voided_at?"Anulado":p.route_collection&&!p.confirmed?"Efectivo pendiente de liquidación de ruta":!p.confirmed?"Transferencia por confirmar":p.settled?"Liquidado":p.receiver==="courier"?"Pendiente de liquidar":"Recibido"}<small>{p.void_reason}</small></td><td>{!p.voided_at&&!p.confirmed&&!p.route_collection&&p.method==="transfer"&&state.canWrite&&<AppButton disabled={state.busy} onClick={()=>state.run(async()=>{await keyedRequest(company,"customer_finance",{id:p.id},"payment_confirm");await load();await onSaved();})}>Confirmar ingreso</AppButton>}{!p.voided_at&&!p.settled&&!(p.route_collection&&!p.confirmed)&&state.canWrite&&<AppButton className="danger" disabled={state.busy} onClick={()=>{setVoiding(p);setReason("");}}>Anular pago</AppButton>}</td></tr>)}</tbody></ResponsiveTable></div>
   {active&&state.canWrite&&availableCredit>0&&Number(data.summary.paid)<Number(data.order.total)&&<form onSubmit={e=>{e.preventDefault();void state.run(async()=>{await keyedRequest(company,"customer_finance",{order:orderId,amount:credit},"credit_apply");setCredit("");await load();await onSaved();});}}><label>Usar saldo a favor · disponible {compactMoney(availableCredit,currency)}<MoneyInput required min="0.01" max={Math.min(availableCredit,Number(data.order.total)-Number(data.summary.paid))} currency={currency} value={credit} onChange={e=>setCredit(e.target.value)}/></label><div className="form-actions"><AppButton disabled={state.busy}>Aplicar saldo a favor</AppButton></div></form>}
   {data.credit_applications?.length>0&&<><h3>Historial de aplicaciones de saldo a favor</h3><div className="table-wrap"><ResponsiveTable><thead><tr><th>Factura origen</th><th>Factura destino</th><th>Importe</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{data.credit_applications.map((a:Row)=><tr key={a.id}><td>#{a.source_number}</td><td>#{a.target_number}</td><td data-sort-value={a.amount}>{compactMoney(a.amount,currency)}</td><td>{a.voided_at?"Anulada":"Aplicada"}<small>{a.void_reason}</small></td><td>{!a.voided_at&&state.canWrite&&<AppButton className="secondary" disabled={state.busy} onClick={()=>{setVoiding({...a,kind:"credit"});setReason("");}}>Revertir aplicación</AppButton>}</td></tr>)}</tbody></ResponsiveTable></div></>}
   {!data.payments.length&&<p>{data.order.paid_at?"El pedido conserva su confirmación de pago histórica.":"Sin pagos registrados."}</p>}
   {voiding&&<form onSubmit={e=>{e.preventDefault();void state.run(async()=>{if(!(await confirmAction("¿Anular este pago o aplicación de saldo? Se conservará su historial; no se emite un reembolso automáticamente.")))return;await keyedRequest(company,voiding.kind==="credit"?"customer_finance":"courier_operations",{id:voiding.id,reason},voiding.kind==="credit"?"credit_void":"payment_void");setVoiding(null);await load();await onSaved();});}}><label>Motivo de anulación<input required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="form-actions"><AppButton disabled={state.busy}>Confirmar anulación</AppButton><AppButton type="button" className="secondary" onClick={()=>setVoiding(null)}>Cancelar</AppButton></div></form>}
   </details>
   <details className="commercial-details"><summary>Información de entrega</summary><OrderDeliverySummary order={data.order} delivery={data.delivery} formatMoney={compactMoney}/></details>
   <details className="commercial-details"><summary>Detalle de cobros</summary>
    <dl className="commercial-metrics"><div><dt>Recibido por OHANA</dt><dd>{compactMoney(data.summary.ohana_received,currency)}</dd></div><div><dt>Pendiente de liquidación</dt><dd>{compactMoney(data.summary.courier_pending,currency)}</dd></div><div><dt>Liquidado por mensajería</dt><dd>{compactMoney(data.summary.courier_settled,currency)}</dd></div></dl>
   </details>
  </>}
  </div>
  {active&&state.canWrite&&availableDue>0&&<footer className="commercial-footer"><AppButton type="submit" form="direct-invoice-payment" disabled={state.busy}>Registrar pago · {compactMoney(Number(amountShown)||0,currency)}</AppButton></footer>}
 </section></div>;
}
