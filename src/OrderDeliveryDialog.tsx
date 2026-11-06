import { useEffect, useState } from "react";
import SearchSelect from "./SearchSelect";
import ResponsiveTable from "./ResponsiveTable";
import MoneyInput from "./MoneyInput";
import { AppButton, AppIcon } from "./AppIcon";
import { confirmAction } from "./ConfirmDialog";
import { keyedRequest, money, today, useOperation, type Row } from "./operations";
import { blankDelivery, courierRead } from "./delivery-model";
import DeliveryFields from "./DeliveryFields";

export const blankPayment = (method="cash"):Row=>({key:crypto.randomUUID(),amount:"",method:method==="transfer"?"transfer":"cash",receiver:"ohana",received_on:today(),notes:""});
export function PaymentFields({value,onChange,courier=false,currency="GTQ"}:{value:Row;onChange:(v:Row)=>void;courier?:boolean;currency?:string}){
 const change=(key:string,v:any)=>onChange({...value,[key]:v,...(key==="receiver"&&v==="courier"?{method:"cash"}:{})});
 return <div className="settings-grid payment-fields">
  <label>Importe recibido<MoneyInput currency={currency} required min="0.01" value={value.amount} onChange={e=>change("amount",e.target.value)}/></label>
  <label>Fecha del pago<input type="date" required max={today()} value={value.received_on} onChange={e=>change("received_on",e.target.value)}/></label>
  <label>Método<SearchSelect value={value.method} disabled={value.receiver==="courier"} onChange={e=>change("method",e.target.value)}><option value="cash">Efectivo</option><option value="transfer">Transferencia bancaria</option></SearchSelect></label>
  <label>Quién recibió el dinero<SearchSelect value={value.receiver} onChange={e=>change("receiver",e.target.value)}><option value="ohana">Ohana directamente</option>{courier&&<option value="courier">Mensajero · efectivo pendiente de liquidar</option>}</SearchSelect></label>
  <label className="form-wide">Referencia del pago · opcional<input maxLength={1000} value={value.notes||""} onChange={e=>change("notes",e.target.value)}/></label>
 </div>;
}
export function InitialPayments({rows,onChange,courier,currency,method}:{rows:Row[];onChange:(v:Row[])=>void;courier:boolean;currency:string;method:string}){
 return <fieldset className="form-wide"><legend>Pagos recibidos · opcional</legend>
  <p>Registra únicamente dinero ya recibido. Puedes combinar transferencia y efectivo; el cobro del mensajero queda pendiente de liquidación.</p>
  {rows.map((p,i)=><section className="payment-entry" key={p.key}><h4>Pago {i+1}</h4><PaymentFields value={p} onChange={v=>onChange(rows.map(x=>x.key===p.key?v:x))} courier={courier} currency={currency}/><AppButton type="button" className="secondary" onClick={()=>onChange(rows.filter(x=>x.key!==p.key))}>Quitar pago</AppButton></section>)}
  <AppButton type="button" className="secondary" disabled={rows.length>=30} onClick={()=>onChange([...rows,blankPayment(method)])}>Agregar pago</AppButton>
 </fieldset>;
}
export default function OrderDeliveryDialog({company,orderId,onClose,onSaved}:{company:string;orderId:string;onClose:()=>void;onSaved:()=>Promise<void>}){
 const state=useOperation(company,"sales");
 const [data,setData]=useState<Row|null>(null),[options,setOptions]=useState<Row>({}),[delivery,setDelivery]=useState<Row>(blankDelivery),[payment,setPayment]=useState<Row>(blankPayment),[dirty,setDirty]=useState(false),[voiding,setVoiding]=useState<Row|null>(null),[reason,setReason]=useState("");
 const load=async()=>{const [d,o]=await Promise.all([courierRead(company,"order",{order:orderId}),courierRead(company,"options")]);setData(d);setOptions(o);setDelivery(d.delivery||{...blankDelivery(),address:d.order.customer_snapshot.address||"",kind:d.order.delivery==="pickup"?"pickup":"own",shipping_charged:d.order.shipping});setDirty(false);};
 useEffect(()=>{void state.run(load);},[company,orderId]);
 const close=async()=>{if(state.busy)return;if((dirty||payment.amount!==""||voiding)&&!(await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?")))return;onClose();};
 const active=data&&!['cancelled','expired'].includes(data.order.status);
 const currency=data?.order.currency||"GTQ";
 return <div className="overlay"><section className="modal operations-dialog courier-dialog" role="dialog" aria-modal="true" aria-label="Entrega y pagos" data-navigation-dirty={dirty||payment.amount!==""||!!voiding}>
  <header className="hierarchy-toolbar"><h2>Entrega y pagos · #{data?.order.number||"…"}</h2><AppButton className="secondary" disabled={state.busy} onClick={close}>Cerrar</AppButton></header>
  {state.error&&<p className="error" role="alert"><AppIcon name="status.error"/>{state.error}</p>}
  {data&&<>
   <p>{data.order.customer_snapshot.name} · Total del pedido: <strong>{money(data.order.total,currency)}</strong></p>
   <div className="delivery-summary"><span>Recibido por Ohana: {money(data.summary.ohana_received,currency)}</span><span>Cobrado por mensajero, pendiente: {money(data.summary.courier_pending,currency)}</span><span>Cobros del mensajero liquidados: {money(data.summary.courier_settled,currency)}</span><strong>Saldo del cliente: {money(Number(data.order.total)-Number(data.summary.paid),currency)}</strong></div>
   <form data-dirty-managed aria-busy={state.busy} onSubmit={e=>{e.preventDefault();void state.run(async()=>{await keyedRequest(company,"courier_operations",{order:orderId,delivery},"delivery_save");await load();await onSaved();});}}>
    <fieldset disabled={!active||!state.canWrite||state.busy}><DeliveryFields value={delivery} options={options} onChange={v=>{setDelivery(v);setDirty(true);}} customerId={data.order.customer_id} currency={currency}/><div className="form-actions"><AppButton>Guardar entrega</AppButton></div></fieldset>
   </form>
   <h3>Historial de pagos</h3>
   <div className="table-wrap"><ResponsiveTable><thead><tr><th>Fecha</th><th>Importe</th><th>Método</th><th>Recibido por</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{data.payments.map((p:Row)=><tr key={p.id}><td>{p.received_on}</td><td data-sort-value={p.amount}>{money(p.amount,currency)}</td><td>{p.method==="cash"?"Efectivo":"Transferencia"}</td><td>{p.receiver==="courier"?"Mensajero":"Ohana"}<small>{p.notes}</small></td><td>{p.voided_at?"Anulado":p.settled?"Liquidado":p.receiver==="courier"?"Pendiente de liquidar":"Recibido"}<small>{p.void_reason}</small></td><td>{!p.voided_at&&!p.settled&&state.canWrite&&<AppButton className="danger" disabled={state.busy} onClick={()=>{setVoiding(p);setReason("");}}>Anular pago</AppButton>}</td></tr>)}</tbody></ResponsiveTable></div>
   {!data.payments.length&&<p>{data.order.paid_at?"El pedido conserva su confirmación de pago histórica.":"Sin pagos registrados."}</p>}
   {voiding&&<form onSubmit={e=>{e.preventDefault();void state.run(async()=>{if(!(await confirmAction("¿Anular este registro de pago? No se emite un reembolso automáticamente.")))return;await keyedRequest(company,"courier_operations",{id:voiding.id,reason},"payment_void");setVoiding(null);await load();await onSaved();});}}><label>Motivo de anulación<input required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="form-actions"><AppButton disabled={state.busy}>Confirmar anulación</AppButton><AppButton type="button" className="secondary" onClick={()=>setVoiding(null)}>Cancelar</AppButton></div></form>}
   {active&&state.canWrite&&Number(data.summary.paid)<Number(data.order.total)&&<form data-dirty-managed aria-busy={state.busy} onSubmit={e=>{e.preventDefault();if(dirty){state.setError("Guarda primero los cambios de entrega antes de registrar el pago.");return;}void state.run(async()=>{await keyedRequest(company,"courier_operations",{...payment,order:orderId},"payment_add");setPayment(blankPayment());await load();await onSaved();});}}><fieldset disabled={state.busy}><legend>Agregar pago recibido</legend><PaymentFields value={payment} onChange={setPayment} courier={!!data.delivery?.courier_id} currency={currency}/><div className="form-actions"><AppButton>Registrar pago</AppButton></div></fieldset></form>}
  </>}
 </section></div>;
}
