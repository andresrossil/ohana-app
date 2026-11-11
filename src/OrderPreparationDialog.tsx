import { useEffect, useState } from "react";
import { request } from "./commerce";
import { keyedRequest, money, useOperation, type Row } from "./operations";
import { AppButton, AppIcon } from "./AppIcon";
import ResponsiveTable from "./ResponsiveTable";
import { confirmAction } from "./ConfirmDialog";
import OrderDeliverySummary from "./OrderDeliverySummary";
import CustomerCommercialInfo from "./CustomerCommercialInfo";
import { openSaleDocument } from "./SaleDocument";
import { saleLineTotals } from "./sale-form-model";
export const fulfillmentLabels:Row={draft:"Borrador",invoiced:"Facturado",preparing:"En preparación",finished:"Terminado",courier:"Mensajería",delivered:"Entregado"};
export default function OrderPreparationDialog({company,orderId,onClose,onSaved}:{company:string;orderId:string;onClose:()=>void;onSaved:()=>Promise<void>}){
 const state=useOperation(company,"sales"),[data,setData]=useState<Row|null>(null),[reverting,setReverting]=useState(false),[reason,setReason]=useState("");
 const load=async()=>setData(await request("sales_fulfillment",{p_company:company,p_action:"detail",p_data:{order:orderId}}));
 useEffect(()=>{void state.run(load);},[company,orderId]);
 const close=async()=>{if(state.busy)return;if(reverting&&reason!==""&&!(await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?")))return;onClose();};
 const stage=data?.order.fulfillment_stage||"invoiced";
 const action=stage==="invoiced"?"prepare":stage==="preparing"?"finish":stage==="finished"?"handoff":null;
 const actionLabel=action==="prepare"?"Iniciar preparación":action==="finish"?"Pedido terminado":data?.delivery?.kind==="courier"?"Entregado a mensajería":"Entregar al cliente";
 const advance=()=>state.run(async()=>{
  if(!action||!data)return;
  if(!(await confirmAction(action==="handoff"?"¿Confirmas la entrega del pedido? El inventario ya se descontó al terminarlo.":action==="finish"?"¿Confirmas que el pedido está terminado? Se descontarán las existencias de sus productos.":"¿Confirmas iniciar la preparación? No se descontará inventario todavía.")))return;
  await keyedRequest(company,"sales_fulfillment",{order:orderId,expected_stage:stage},action);await load();await onSaved();
 });
 return <div className="overlay"><section className="modal operations-dialog order-preparation" role="dialog" aria-modal="true" aria-label="Ver factura" data-navigation-dirty={reverting&&reason!==""}><header className="hierarchy-toolbar"><h2>Factura · #{data?.order.number||"…"}</h2><div className="actions">
 {data&&<AppButton iconKey="action.print" disabled={state.busy} onClick={()=>{
  if(!openSaleDocument(data))state.setError("Permite las ventanas emergentes para abrir la vista de impresión.");
 }}>Imprimir</AppButton>}
 <AppButton className="secondary" disabled={state.busy} onClick={close}>Cerrar</AppButton></div></header>
 {state.error&&<p className="error"><AppIcon name="status.error"/>{state.error}</p>}
 {data&&<><p><strong>{data.order.customer_snapshot.name}</strong> · {data.order.customer_snapshot.phone}</p><p>{fulfillmentLabels[stage]}</p><OrderDeliverySummary order={data.order} delivery={data.delivery}/><CustomerCommercialInfo info={data.commercial_info}/>
 <div className="table-wrap"><ResponsiveTable><thead><tr><th>Producto</th><th>Cantidad</th><th>Regalo</th><th>Precio unitario</th><th>Descuento</th><th>Subtotal</th></tr></thead><tbody>{data.lines.map((l:Row)=><tr key={l.id}><td>{l.description}</td><td data-sort-value={l.quantity}>{l.quantity}</td><td>{l.is_gift?"Sí":"—"}</td><td data-sort-value={l.unit_price}>{money(l.unit_price,data.order.currency)}</td><td data-sort-value={l.line_discount??0}>{money(l.line_discount??0,data.order.currency)}</td><td data-sort-value={saleLineTotals(l).net}>{money(saleLineTotals(l).net,data.order.currency)}</td></tr>)}</tbody></ResponsiveTable></div>
 <div className="order-preparation-total"><strong>Total de factura: {money(data.order.total,data.order.currency)}</strong><strong className={Number(data.order.total)>Number(data.summary.paid)?"balance-debt":"balance-zero"}>{stage==="draft"?"Pendiente de confirmación del cliente":<>Total pendiente: {money(data.summary.balance??Math.max(0,Number(data.order.total)-Number(data.summary.paid)),data.order.currency)}</>}</strong></div>
 <div className="form-actions">{state.canWrite&&!data.settled&&["pending","dispatched"].includes(data.order.status)&&action&&<AppButton iconKey={action==="handoff"?"action.confirm":"action.edit"} disabled={state.busy||reverting} onClick={advance}>{actionLabel}</AppButton>}{state.canWrite&&!data.settled&&["pending","dispatched"].includes(data.order.status)&&(!["draft","invoiced"].includes(stage)||data.order.status==="dispatched")&&<AppButton className="danger" iconKey="action.back" disabled={state.busy} onClick={()=>setReverting(true)}>Revertir</AppButton>}<AppButton className="secondary" disabled={state.busy} onClick={close}>Volver</AppButton></div>
 {data.settled&&<p>Ruta liquidada. Revierte primero la liquidación para reabrir esta factura.</p>}
 {reverting&&<form onSubmit={e=>{e.preventDefault();void state.run(async()=>{
  if(!(await confirmAction("¿Revertir y reabrir esta factura? Se devolverá el inventario que ya salió o se liberarán las reservas pendientes. Los pagos y el historial se conservarán.",{title:"Revertir pedido",confirmText:"Sí, revertir"})))return;
  await keyedRequest(company,"sales_fulfillment",{order:orderId,expected_stage:stage,reason},"revert");setReverting(false);setReason("");await onSaved();onClose();
 });}}><label>Motivo de reversión<input required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} disabled={state.busy}/></label><div className="form-actions"><AppButton disabled={state.busy}>Confirmar reversión</AppButton><AppButton type="button" className="secondary" disabled={state.busy} onClick={()=>setReverting(false)}>Cancelar</AppButton></div></form>}
 </>}
 </section></div>;
}
