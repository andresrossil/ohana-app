import { compactMoney } from "./commercial-compact";
import "./commercial-compact.css";
import { useEffect, useState } from "react";
import { request } from "./commerce";
import { keyedRequest, money, useOperation, type Row } from "./operations";
import { AppButton, AppIcon } from "./AppIcon";
import ResponsiveTable from "./ResponsiveTable";
import SearchSelect from "./SearchSelect";
import { confirmAction } from "./ConfirmDialog";
import OrderDeliverySummary from "./OrderDeliverySummary";
import CustomerCommercialInfo from "./CustomerCommercialInfo";
import { openSaleDocument, saleDocumentLine } from "./SaleDocument";
import { saleLineTotals } from "./sale-form-model";
export const fulfillmentLabels:Row={draft:"Pedido",invoiced:"Facturado",preparing:"En preparación",finished:"Terminado",courier:"Mensajería",delivered:"Entregado"};
export default function OrderPreparationDialog({company,orderId,onClose,onSaved,finishOnly=false}:{company:string;orderId:string;onClose:()=>void;onSaved:()=>Promise<void>;finishOnly?:boolean}){
 const state=useOperation(company,"sales"),[data,setData]=useState<Row|null>(null),[reverting,setReverting]=useState(false),[reason,setReason]=useState("");
 const [finishing,setFinishing]=useState(finishOnly);
 const [packaging,setPackaging]=useState<Record<string,string>>({});
 const [gifts,setGifts]=useState<Record<string,string>>({});
 const hasExtras=Object.keys(packaging).length>0||Object.keys(gifts).length>0;
 const load=async()=>setData(await request("sales_fulfillment",{p_company:company,p_action:"detail",p_data:{order:orderId}}));
 useEffect(()=>{void state.run(load);},[company,orderId]);
 const close=async()=>{if(state.busy)return;if(((reverting&&reason!=="")||(finishing&&hasExtras))&&!(await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?")))return;onClose();};
 const stage=data?.order.fulfillment_stage||"invoiced";
 const canPrepare=data?.order.status==="pending"&&["invoiced","preparing"].includes(stage);
 const packingRows=(data?.packaging_options||[]).filter((item:Row)=>item.id in packaging);
 const packingTotals=new Map<string,number>();
 for(const item of packingRows){
  if(item.unit_cost==null)continue;
  const currency=item.cost_currency||data?.order.currency;
  packingTotals.set(currency,(packingTotals.get(currency)||0)+Number(packaging[item.id]||0)*Number(item.unit_cost));
 }
 const showingForm=finishing&&canPrepare&&state.canWrite&&!data?.settled;
 const cancelPreparation=()=>{if(finishOnly){void close();return;}setFinishing(false);setPackaging({});setGifts({});};
 return <div className="overlay commercial-overlay"><section className="modal operations-dialog order-preparation commercial-dialog" role="dialog" aria-modal="true" aria-label={finishOnly?"Confirmar preparación":"Ver documento"} data-navigation-dirty={(reverting&&reason!=="")||(finishing&&hasExtras)}><header className="commercial-header"><div><h2>{finishing?"Confirmar preparación":stage==="draft"?"Pedido":"Factura"}</h2><small>#{data?.order.invoice_number||data?.order.number||"…"}</small></div><div className="actions">
 {data&&!finishOnly&&<AppButton iconKey="action.print" disabled={state.busy} onClick={()=>{
  if(!openSaleDocument(data))state.setError("Permite las ventanas emergentes para abrir la vista de impresión.");
 }}>Imprimir</AppButton>}
 {data&&!finishOnly&&<AppButton className="secondary" iconKey="action.print" disabled={state.busy} onClick={()=>{
  if(!openSaleDocument(data,"label"))state.setError("Permite las ventanas emergentes para abrir la vista de impresión.");
 }}>Imprimir etiqueta</AppButton>}
 <AppButton className="secondary" iconKey="action.cancel" aria-label="Cerrar" disabled={state.busy} onClick={close}>×</AppButton></div></header><div className="commercial-body">
 {state.error&&<p className="error"><AppIcon name="status.error"/>{state.error}</p>}
 {data&&<>{!finishOnly&&<><p><strong>{data.order.customer_snapshot.name}</strong> · {data.order.customer_snapshot.phone}</p><p>{fulfillmentLabels[stage]}</p><OrderDeliverySummary order={data.order} delivery={data.delivery}/><CustomerCommercialInfo info={data.commercial_info}/>
 <div className="table-wrap"><ResponsiveTable><thead><tr><th>Producto</th><th>Tamaño</th><th>Cantidad</th><th>Regalo</th><th>Precio unitario</th><th>Descuento</th><th>Subtotal</th></tr></thead><tbody>{data.lines.map((l:Row)=><tr key={l.id}><td>{saleDocumentLine(l).product}</td><td>{saleDocumentLine(l).size}</td><td data-sort-value={l.quantity}>{l.quantity}</td><td>{l.is_gift?"Sí":"—"}</td><td data-sort-value={l.unit_price}>{money(l.unit_price,data.order.currency)}</td><td data-sort-value={l.line_discount??0}>{money(l.line_discount??0,data.order.currency)}</td><td data-sort-value={saleLineTotals(l).net}>{money(saleLineTotals(l).net,data.order.currency)}</td></tr>)}</tbody></ResponsiveTable></div>
 <div className="order-preparation-total"><strong>Total de factura: {money(data.order.total,data.order.currency)}</strong><strong className={Number(data.order.total)>Number(data.summary.paid)?"balance-debt":"balance-zero"}>{stage==="draft"?"Pendiente de confirmación del cliente":<>Total pendiente: {money(data.summary.balance??Math.max(0,Number(data.order.total)-Number(data.summary.paid)),data.order.currency)}</>}</strong></div>
 <div className="form-actions">{state.canWrite&&!data.settled&&["pending","dispatched"].includes(data.order.status)&&canPrepare&&<AppButton iconKey="action.confirm" disabled={state.busy||reverting||finishing} onClick={()=>setFinishing(true)}>Confirmar preparación</AppButton>}{state.canWrite&&!data.settled&&["pending","dispatched"].includes(data.order.status)&&(!["draft","invoiced"].includes(stage)||data.order.status==="dispatched")&&<AppButton className="danger" iconKey="action.back" disabled={state.busy||finishing} onClick={()=>setReverting(true)}>Revertir</AppButton>}<AppButton className="secondary" disabled={state.busy} onClick={close}>Volver</AppButton></div>
 </>}
 {finishOnly&&!canPrepare&&<p role="status">La factura ya no está pendiente de preparar.</p>}
 {showingForm&&<form id="confirm-preparation" data-dirty-managed onSubmit={e=>{e.preventDefault();void state.run(async()=>{
  const supplies=Object.entries(packaging).filter(([,quantity])=>quantity!==""&&Number(quantity)>0)
    .map(([material,quantity])=>({material,quantity}));
  await keyedRequest(company,"sales_fulfillment",{order:orderId,expected_stage:stage,packaging:supplies,gifts:Object.entries(gifts).map(([variant,quantity])=>({variant,quantity}))},"finish");
  setFinishing(false);setPackaging({});setGifts({});await load();await onSaved();if(finishOnly)onClose();
 });}}>
  <section className="commercial-block"><h3>Empaque e insumos</h3>
   {packingRows.map((item:Row)=><div key={item.id} className="commercial-line">
    <div><strong>{item.name}</strong><small>{item.unit_cost==null?"Costo pendiente":compactMoney(item.unit_cost,item.cost_currency)+" / "+item.unit}</small></div>
    <input aria-label={"Cantidad de "+item.name} type="number" inputMode="decimal" required min={0.00000001} max={item.available} step="any" disabled={state.busy} value={packaging[item.id]} onChange={e=>setPackaging({...packaging,[item.id]:e.target.value})}/>
    <strong>{item.unit_cost==null?"—":compactMoney(Number(packaging[item.id]||0)*Number(item.unit_cost),item.cost_currency)}</strong>
    <AppButton type="button" className="secondary" iconKey="action.cancel" aria-label={"Quitar "+item.name} disabled={state.busy} onClick={()=>setPackaging(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>id!==item.id)))}>×</AppButton>
   </div>)}
   <label>Agregar insumo<SearchSelect value="" disabled={state.busy} onChange={e=>{const id=e.target.value;if(id)setPackaging(previous=>({...previous,[id]:"1"}));}}>
    <option value="">Buscar por descripción o código</option>
    {(data?.packaging_options||[]).filter((item:Row)=>!(item.id in packaging)).map((item:Row)=><option key={item.id} value={item.id}>{[item.sku,item.name,`${item.available} ${item.unit} disponibles`].filter(Boolean).join(" · ")}</option>)}
   </SearchSelect></label>
   <p><strong>Empaque estimado · {[...packingTotals].map(([currency,total])=>compactMoney(total,currency)).join(" + ")||compactMoney(0,data?.order.currency)}</strong>{packingRows.some((item:Row)=>item.unit_cost==null)&&" · Hay costos pendientes"}</p>
  </section>
  {Array.isArray(data?.gift_options)&&<section className="commercial-block"><h3>Productos de regalo</h3>
   {data?.gift_options.filter((item:Row)=>item.id in gifts).map((item:Row)=>{
    const [product,...variant]=item.name.split(" · ");
    return <div key={item.id} className="commercial-line gift">
     <div><strong>{product}</strong><small>{[item.sku,...variant].filter(Boolean).join(" · ")}</small></div>
     <input aria-label={"Cantidad de "+item.name} type="number" inputMode="numeric" required min={1} max={Math.min(1000,item.available)} step={1} disabled={state.busy} value={gifts[item.id]} onChange={e=>setGifts({...gifts,[item.id]:e.target.value})}/>
     <AppButton type="button" className="secondary" iconKey="action.cancel" aria-label={"Quitar regalo "+item.name} disabled={state.busy} onClick={()=>setGifts(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>id!==item.id)))}>×</AppButton>
    </div>;
   })}
   <label>Agregar regalo<SearchSelect value="" disabled={state.busy||Object.keys(gifts).length>=30} onChange={e=>{const id=e.target.value;if(id)setGifts(previous=>({...previous,[id]:"1"}));}}>
    <option value="">Buscar producto o variante</option>
    {data?.gift_options.filter((item:Row)=>!(item.id in gifts)).map((item:Row)=><option key={item.id} value={item.id}>{[item.name,item.sku,item.barcode,`${item.available} disponibles`].filter(Boolean).join(" · ")}</option>)}
   </SearchSelect></label>
  </section>}
  <p className="muted">Al confirmar, los insumos y regalos se descuentan del inventario sin cargo al cliente.</p>
 </form>}
 {data.settled&&<p>Ruta liquidada. Revierte primero la liquidación para reabrir esta factura.</p>}
 {reverting&&<form onSubmit={e=>{e.preventDefault();void state.run(async()=>{
  if(!(await confirmAction("¿Revertir y reabrir esta factura? Se devolverá el inventario que ya salió o se liberarán las reservas pendientes. Los pagos y el historial se conservarán.",{title:"Revertir pedido",confirmText:"Sí, revertir"})))return;
  await keyedRequest(company,"sales_fulfillment",{order:orderId,expected_stage:stage,reason},"revert");setReverting(false);setReason("");await onSaved();onClose();
 });}}><label>Motivo de reversión<input required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} disabled={state.busy}/></label><div className="form-actions"><AppButton disabled={state.busy}>Confirmar reversión</AppButton><AppButton type="button" className="secondary" disabled={state.busy} onClick={()=>setReverting(false)}>Cancelar</AppButton></div></form>}
 </>}
 </div>{showingForm&&<footer className="commercial-footer"><AppButton type="button" className="secondary" disabled={state.busy} onClick={cancelPreparation}>Cancelar</AppButton><AppButton type="submit" form="confirm-preparation" iconKey="action.confirm" disabled={state.busy}>Confirmar preparación</AppButton></footer>}
 </section></div>;
}
