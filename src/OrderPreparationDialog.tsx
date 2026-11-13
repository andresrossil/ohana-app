import { useEffect, useState } from "react";
import { request } from "./commerce";
import { keyedRequest, money, useOperation, type Row } from "./operations";
import { AppButton, AppIcon } from "./AppIcon";
import ResponsiveTable from "./ResponsiveTable";
import { confirmAction } from "./ConfirmDialog";
import OrderDeliverySummary from "./OrderDeliverySummary";
import CustomerCommercialInfo from "./CustomerCommercialInfo";
import { openSaleDocument, saleDocumentLine } from "./SaleDocument";
import { saleLineTotals } from "./sale-form-model";
export const fulfillmentLabels:Row={draft:"Borrador",invoiced:"Facturado",preparing:"En preparación",finished:"Terminado",courier:"Mensajería",delivered:"Entregado"};
export default function OrderPreparationDialog({company,orderId,onClose,onSaved}:{company:string;orderId:string;onClose:()=>void;onSaved:()=>Promise<void>}){
 const state=useOperation(company,"sales"),[data,setData]=useState<Row|null>(null),[reverting,setReverting]=useState(false),[reason,setReason]=useState("");
 const [finishing,setFinishing]=useState(false);
 const [packaging,setPackaging]=useState<Record<string,string>>({});
 const hasPackaging=Object.values(packaging).some(Boolean);
 const load=async()=>setData(await request("sales_fulfillment",{p_company:company,p_action:"detail",p_data:{order:orderId}}));
 useEffect(()=>{void state.run(load);},[company,orderId]);
 const close=async()=>{if(state.busy)return;if(((reverting&&reason!=="")||(finishing&&hasPackaging))&&!(await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?")))return;onClose();};
 const stage=data?.order.fulfillment_stage||"invoiced";
 const action=stage==="invoiced"?"prepare":stage==="preparing"?"finish":stage==="finished"?"handoff":null;
 const actionLabel=action==="prepare"?"Iniciar preparación":action==="finish"?"Pedido terminado":data?.delivery?.kind==="courier"?"Entregado a mensajería":"Entregar al cliente";
 const advance=()=>state.run(async()=>{
  if(!action||!data)return;
  if(action==="finish"){setFinishing(true);return;}
  if(!(await confirmAction(action==="handoff"?"¿Confirmas la entrega del pedido? El inventario ya se descontó al terminarlo.":"¿Confirmas iniciar la preparación? No se descontará inventario todavía.")))return;
  await keyedRequest(company,"sales_fulfillment",{order:orderId,expected_stage:stage},action);await load();await onSaved();
 });
 return <div className="overlay"><section className="modal operations-dialog order-preparation" role="dialog" aria-modal="true" aria-label="Ver factura" data-navigation-dirty={(reverting&&reason!=="")||(finishing&&hasPackaging)}><header className="hierarchy-toolbar"><h2>Factura · #{data?.order.invoice_number||data?.order.number||"…"}</h2><div className="actions">
 {data&&<AppButton iconKey="action.print" disabled={state.busy} onClick={()=>{
  if(!openSaleDocument(data))state.setError("Permite las ventanas emergentes para abrir la vista de impresión.");
 }}>Imprimir</AppButton>}
 {data&&<AppButton className="secondary" iconKey="action.print" disabled={state.busy} onClick={()=>{
  if(!openSaleDocument(data,"label"))state.setError("Permite las ventanas emergentes para abrir la vista de impresión.");
 }}>Imprimir etiqueta</AppButton>}
 <AppButton className="secondary" disabled={state.busy} onClick={close}>Cerrar</AppButton></div></header>
 {state.error&&<p className="error"><AppIcon name="status.error"/>{state.error}</p>}
 {data&&<><p><strong>{data.order.customer_snapshot.name}</strong> · {data.order.customer_snapshot.phone}</p><p>{fulfillmentLabels[stage]}</p><OrderDeliverySummary order={data.order} delivery={data.delivery}/><CustomerCommercialInfo info={data.commercial_info}/>
 <div className="table-wrap"><ResponsiveTable><thead><tr><th>Producto</th><th>Tamaño</th><th>Cantidad</th><th>Regalo</th><th>Precio unitario</th><th>Descuento</th><th>Subtotal</th></tr></thead><tbody>{data.lines.map((l:Row)=><tr key={l.id}><td>{saleDocumentLine(l).product}</td><td>{saleDocumentLine(l).size}</td><td data-sort-value={l.quantity}>{l.quantity}</td><td>{l.is_gift?"Sí":"—"}</td><td data-sort-value={l.unit_price}>{money(l.unit_price,data.order.currency)}</td><td data-sort-value={l.line_discount??0}>{money(l.line_discount??0,data.order.currency)}</td><td data-sort-value={saleLineTotals(l).net}>{money(saleLineTotals(l).net,data.order.currency)}</td></tr>)}</tbody></ResponsiveTable></div>
 <div className="order-preparation-total"><strong>Total de factura: {money(data.order.total,data.order.currency)}</strong><strong className={Number(data.order.total)>Number(data.summary.paid)?"balance-debt":"balance-zero"}>{stage==="draft"?"Pendiente de confirmación del cliente":<>Total pendiente: {money(data.summary.balance??Math.max(0,Number(data.order.total)-Number(data.summary.paid)),data.order.currency)}</>}</strong></div>
 <div className="form-actions">{state.canWrite&&!data.settled&&["pending","dispatched"].includes(data.order.status)&&action&&<AppButton iconKey={action==="handoff"?"action.confirm":"action.edit"} disabled={state.busy||reverting||finishing} onClick={advance}>{actionLabel}</AppButton>}{state.canWrite&&!data.settled&&["pending","dispatched"].includes(data.order.status)&&(!["draft","invoiced"].includes(stage)||data.order.status==="dispatched")&&<AppButton className="danger" iconKey="action.back" disabled={state.busy||finishing} onClick={()=>setReverting(true)}>Revertir</AppButton>}<AppButton className="secondary" disabled={state.busy} onClick={close}>Volver</AppButton></div>
 {finishing&&<form data-dirty-managed onSubmit={e=>{e.preventDefault();void state.run(async()=>{
  const supplies=Object.entries(packaging).filter(([,quantity])=>quantity!==""&&Number(quantity)>0)
    .map(([material,quantity])=>({material,quantity}));
  await keyedRequest(company,"sales_fulfillment",{order:orderId,expected_stage:"preparing",packaging:supplies},"finish");
  setFinishing(false);setPackaging({});await load();await onSaved();
 });}}>
  <h3>¿Qué empaque adicional usaste?</h3>
  <p className="muted">Indica las cantidades utilizadas o continúa sin agregar insumos. Al terminar se descontarán los productos y el empaque registrado.</p>
  <label>Agregar insumo<select value="" disabled={state.busy} onChange={e=>{const id=e.target.value;if(id)setPackaging(previous=>({...previous,[id]:"1"}));}}>
    <option value="">Seleccionar</option>
    {(data.packaging_options||[]).filter((item:Row)=>!(item.id in packaging)).map((item:Row)=><option key={item.id} value={item.id}>{item.sku ? item.sku+" · " : ""}{item.name} · {item.available} {item.unit} disponibles</option>)}
  </select></label>
  <div className="form-grid">{(data.packaging_options||[]).filter((item:Row)=>item.id in packaging).map((item:Row)=><div key={item.id} className="form-actions">
    <label>{item.name} · {item.unit}<input type="number" inputMode="decimal" required min={0.00000001} max={item.available} step="any" disabled={state.busy}
      value={packaging[item.id]} onChange={e=>setPackaging({...packaging,[item.id]:e.target.value})}/></label>
    <AppButton type="button" className="secondary" disabled={state.busy} onClick={()=>setPackaging(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>id!==item.id)))}>Quitar</AppButton>
  </div>)}</div>
  <div className="form-actions"><AppButton type="submit" iconKey="action.confirm" disabled={state.busy}>Confirmar pedido terminado</AppButton>
    <AppButton type="button" className="secondary" disabled={state.busy} onClick={()=>{setFinishing(false);setPackaging({});}}>Cancelar</AppButton></div>
 </form>}
 {data.settled&&<p>Ruta liquidada. Revierte primero la liquidación para reabrir esta factura.</p>}
 {reverting&&<form onSubmit={e=>{e.preventDefault();void state.run(async()=>{
  if(!(await confirmAction("¿Revertir y reabrir esta factura? Se devolverá el inventario que ya salió o se liberarán las reservas pendientes. Los pagos y el historial se conservarán.",{title:"Revertir pedido",confirmText:"Sí, revertir"})))return;
  await keyedRequest(company,"sales_fulfillment",{order:orderId,expected_stage:stage,reason},"revert");setReverting(false);setReason("");await onSaved();onClose();
 });}}><label>Motivo de reversión<input required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} disabled={state.busy}/></label><div className="form-actions"><AppButton disabled={state.busy}>Confirmar reversión</AppButton><AppButton type="button" className="secondary" disabled={state.busy} onClick={()=>setReverting(false)}>Cancelar</AppButton></div></form>}
 </>}
 </section></div>;
}
