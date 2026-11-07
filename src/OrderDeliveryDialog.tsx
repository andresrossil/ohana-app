import { useEffect, useState } from "react";
import SearchSelect from "./SearchSelect";
import ResponsiveTable from "./ResponsiveTable";
import MoneyInput from "./MoneyInput";
import { AppButton, AppIcon } from "./AppIcon";
import { confirmAction } from "./ConfirmDialog";
import { keyedRequest, money, today, useOperation, type Row } from "./operations";
import { courierRead } from "./delivery-model";
import OrderDeliverySummary from "./OrderDeliverySummary";
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
  {value.method==="transfer"&&<label className="form-wide"><input type="checkbox" checked={!!value.confirmed} onChange={e=>change("confirmed",e.target.checked)}/> Ya confirmé que el dinero ingresó al banco</label>}
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
 const [data,setData]=useState<Row|null>(null),[payment,setPayment]=useState<Row>(blankPayment),[voiding,setVoiding]=useState<Row|null>(null),[reason,setReason]=useState(""),[credit,setCredit]=useState("");
 const load=async()=>{const d=await courierRead(company,"order",{order:orderId});setData(d);return d;};
 useEffect(()=>{void state.run(async()=>{const d=await load();setPayment(blankPayment(d.order.payment));});},[company,orderId]);
 const close=async()=>{if(state.busy)return;if((payment.amount!==""||credit!==""||voiding)&&!(await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?")))return;onClose();};
 const active=data&&!['cancelled','expired'].includes(data.order.status);
 const currency=data?.order.currency||"GTQ";
 const due=data?(data.summary.balance??Math.max(0,roundMoney(Number(data.order.total)-Number(data.summary.paid)))):0;
 const registerPayment=()=>state.run(async()=>{
  const latest=await courierRead(company,"order",{order:orderId});
  setData(latest);
  const remaining=Math.max(0,roundMoney(Number(latest.order.total)-Number(latest.summary.paid)));
  if(remaining<=0)throw Error("La factura ya está pagada; no admite nuevos pagos.");
  const amount=roundMoney(Number(payment.amount)),difference=roundMoney(amount-remaining);
  if(difference!==0&&!(await confirmAction(`Total de factura: ${money(latest.order.total,currency)}\nPagado anteriormente: ${money(latest.summary.paid,currency)}\nPendiente: ${money(remaining,currency)}\nPago a registrar: ${money(amount,currency)}\nDiferencia: ${money(Math.abs(difference),currency)} (${difference>0?"excedente a favor":"faltante por pagar"}).\n¿Es correcto el monto?`,{title:"Revisar importe del pago",confirmText:"Sí, registrar pago"})))return;
  await keyedRequest(company,"courier_operations",{...payment,order:orderId,expected_due:remaining,discrepancy_confirmed:difference!==0},"payment_add");
  setPayment(blankPayment(latest.order.payment));await load();await onSaved();
 });
 const availableCredit=Math.max(0,Number(data?.account?.find((a:Row)=>a.currency===currency)?.credit||0)-Number(data?.summary.excess||0));
 return <div className="overlay"><section className="modal operations-dialog courier-dialog" role="dialog" aria-modal="true" aria-label="Pagar factura" data-navigation-dirty={payment.amount!==""||credit!==""||!!voiding}>
  <header className="hierarchy-toolbar"><h2>Pagar factura · #{data?.order.number||"…"}</h2><AppButton className="secondary" disabled={state.busy} onClick={close}>Cerrar</AppButton></header>
  {state.error&&<p className="error" role="alert"><AppIcon name="status.error"/>{state.error}</p>}
  {data&&<>
   <p>{data.order.customer_snapshot.name} · Total del pedido: <strong>{money(data.order.total,currency)}</strong></p>
   <div className="delivery-summary"><span>Recibido por Ohana: {money(data.summary.ohana_received,currency)}</span><span>Cobrado por mensajero, pendiente: {money(data.summary.courier_pending,currency)}</span><span>Cobros del mensajero liquidados: {money(data.summary.courier_settled,currency)}</span><strong>Saldo del cliente: {money(due,currency)}</strong></div>
   <OrderDeliverySummary order={data.order} delivery={data.delivery}/>
   <h3>Historial de pagos</h3>
   <div className="table-wrap"><ResponsiveTable><thead><tr><th>Fecha</th><th>Importe</th><th>Método</th><th>Recibido por</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{data.payments.map((p:Row)=><tr key={p.id}><td>{p.received_on}</td><td data-sort-value={p.amount}>{money(p.amount,currency)}</td><td>{p.method==="cash"?"Efectivo":"Transferencia"}</td><td>{p.receiver==="courier"?"Mensajero":"Ohana"}<small>{p.notes}</small></td><td>{p.voided_at?"Anulado":p.route_collection&&!p.confirmed?"Efectivo pendiente de liquidación de ruta":!p.confirmed?"Transferencia por confirmar":p.settled?"Liquidado":p.receiver==="courier"?"Pendiente de liquidar":"Recibido"}<small>{p.void_reason}</small></td><td>{!p.voided_at&&!p.confirmed&&!p.route_collection&&p.method==="transfer"&&state.canWrite&&<AppButton disabled={state.busy} onClick={()=>state.run(async()=>{if(!(await confirmAction("¿Confirmas que esta transferencia ya ingresó al banco?")))return;await keyedRequest(company,"customer_finance",{id:p.id},"payment_confirm");await load();await onSaved();})}>Confirmar ingreso</AppButton>}{!p.voided_at&&!p.settled&&!(p.route_collection&&!p.confirmed)&&state.canWrite&&<AppButton className="danger" disabled={state.busy} onClick={()=>{setVoiding(p);setReason("");}}>Anular pago</AppButton>}</td></tr>)}</tbody></ResponsiveTable></div>
   {active&&state.canWrite&&availableCredit>0&&Number(data.summary.paid)<Number(data.order.total)&&<form onSubmit={e=>{e.preventDefault();void state.run(async()=>{await keyedRequest(company,"customer_finance",{order:orderId,amount:credit},"credit_apply");setCredit("");await load();await onSaved();});}}><label>Usar saldo a favor · disponible {money(availableCredit,currency)}<MoneyInput required min="0.01" max={Math.min(availableCredit,Number(data.order.total)-Number(data.summary.paid))} currency={currency} value={credit} onChange={e=>setCredit(e.target.value)}/></label><div className="form-actions"><AppButton disabled={state.busy}>Aplicar saldo a favor</AppButton></div></form>}
   {data.credit_applications?.length>0&&<><h3>Historial de aplicaciones de saldo a favor</h3><div className="table-wrap"><ResponsiveTable><thead><tr><th>Factura origen</th><th>Factura destino</th><th>Importe</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{data.credit_applications.map((a:Row)=><tr key={a.id}><td>#{a.source_number}</td><td>#{a.target_number}</td><td data-sort-value={a.amount}>{money(a.amount,currency)}</td><td>{a.voided_at?"Anulada":"Aplicada"}<small>{a.void_reason}</small></td><td>{!a.voided_at&&state.canWrite&&<AppButton className="secondary" disabled={state.busy} onClick={()=>{setVoiding({...a,kind:"credit"});setReason("");}}>Revertir aplicación</AppButton>}</td></tr>)}</tbody></ResponsiveTable></div></>}
   {!data.payments.length&&<p>{data.order.paid_at?"El pedido conserva su confirmación de pago histórica.":"Sin pagos registrados."}</p>}
   {voiding&&<form onSubmit={e=>{e.preventDefault();void state.run(async()=>{if(!(await confirmAction("¿Anular este pago o aplicación de saldo? Se conservará su historial; no se emite un reembolso automáticamente.")))return;await keyedRequest(company,voiding.kind==="credit"?"customer_finance":"courier_operations",{id:voiding.id,reason},voiding.kind==="credit"?"credit_void":"payment_void");setVoiding(null);await load();await onSaved();});}}><label>Motivo de anulación<input required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="form-actions"><AppButton disabled={state.busy}>Confirmar anulación</AppButton><AppButton type="button" className="secondary" onClick={()=>setVoiding(null)}>Cancelar</AppButton></div></form>}
   {active&&state.canWrite&&due>0&&<form data-dirty-managed aria-busy={state.busy} onSubmit={e=>{e.preventDefault();void registerPayment();}}><fieldset disabled={state.busy}><legend>Agregar pago recibido</legend><PaymentFields value={payment} onChange={setPayment} courier={!data.settled&&!!data.delivery?.courier_id} currency={currency} fullAmount={due}/><div className="form-actions"><AppButton>Registrar pago</AppButton></div></fieldset></form>}
   {active&&due<=0&&<p className="order-payment-closed" role="status">Factura pagada. No se pueden registrar más pagos.</p>}
   {active&&due>0&&data.order.payment==="cash"&&!data.settled&&<p className="order-payment-closed" role="status">Efectivo pendiente de liquidación de ruta. Si no se registra un pago recibido antes, el saldo seguirá pendiente hasta la liquidación correspondiente.</p>}
   {active&&due>0&&data.settled&&<p className="order-payment-closed" role="status">Ruta liquidada. La factura conserva un saldo pendiente; los pagos posteriores recibidos directamente por Ohana se registran aquí.</p>}
  </>}
 </section></div>;
}
