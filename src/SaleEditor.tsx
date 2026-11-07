import { useEffect, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import SearchSelect from "./SearchSelect";
import MoneyInput from "./MoneyInput";
import ResponsiveTable from "./ResponsiveTable";
import { confirmAction } from "./ConfirmDialog";
import { request, sales } from "./commerce";
import { keyedRequest, money, useOperation, type Row } from "./operations";
import { blankDelivery, courierRead } from "./delivery-model";
import { applyDeliveryAddress } from "./delivery-address";
import DeliveryFields from "./DeliveryFields";
import { InitialPayments } from "./OrderDeliveryDialog";
import { paymentMethods } from "./payment-methods";
import { saleTotals } from "./sale-form-model";
import "./sales-compact.css";

export default function SaleEditor({company,orderId,currency,onClose,onSaved}:{company:string;orderId?:string;currency:string;onClose:()=>void;onSaved:()=>Promise<void>}){
 const state=useOperation(company,"sales");
 const [catalog,setCatalog]=useState<Row>({customers:[],variants:[]}),[options,setOptions]=useState<Row>({}),[original,setOriginal]=useState<Row|null>(null),[ready,setReady]=useState(false),[dirty,setDirty]=useState(false);
 const [customer,setCustomer]=useState(""),[contact,setContact]=useState({name:"",phone:"",email:""}),[payment,setPayment]=useState(""),[delivery,setDelivery]=useState<Row>(blankDelivery),[lines,setLines]=useState<Row[]>([]),[payments,setPayments]=useState<Row[]>([]),[discountMode,setDiscountMode]=useState("amount"),[discountInput,setDiscountInput]=useState("0"),[credit,setCredit]=useState(""),[accounts,setAccounts]=useState<Row[]>([]);
 useEffect(()=>{void state.run(async()=>{
  const [data,o]=await Promise.all([sales(company),courierRead(company,"options")]);setCatalog(data);setOptions(o);
  if(orderId){const current=data.orders.find((x:Row)=>x.id===orderId);if(!current)throw Error("La factura ya no está disponible. Actualiza el listado.");if(current.settled)throw Error("La factura ya está liquidada por mensajería.");setOriginal(current);setCustomer(current.customer_id);setPayment(current.payment);setDelivery(current.delivery_info||{...blankDelivery(),kind:current.delivery==="pickup"?"pickup":"own",shipping_charged:current.shipping,shipping_cost:current.shipping,single_shipping_cost:false});setLines(current.lines.filter((l:Row)=>l.quantity>0).map((l:Row)=>({key:crypto.randomUUID(),variant:l.variant_id,quantity:String(l.quantity),unit_price:String(l.unit_price),is_gift:!!l.is_gift})));setDiscountMode(current.discount_basis||"amount");setDiscountInput(String(current.discount_input??current.discount??0));}
  else setLines([{key:crypto.randomUUID(),variant:"",quantity:"1",unit_price:""}]);setReady(true);
 });},[company,orderId]);
 useEffect(()=>{let live=true;setAccounts([]);if(customer)request("customer_finance",{p_company:company,p_action:"account",p_data:{customer}}).then(r=>{if(live)setAccounts(r);}).catch(e=>{if(live)state.setError(e.message);});return()=>{live=false;};},[company,customer]);
 const selectedList=original&&customer===original.customer_id?(original.price_list_id||catalog.customers.find((c:Row)=>c.id===customer)?.price_list_id||catalog.default_price_list):(catalog.customers.find((c:Row)=>c.id===customer)?.price_list_id||catalog.default_price_list);
 const suggestedPrice=(variant:string,list=selectedList)=>catalog.price_entries?.find((p:Row)=>p.list_id===list&&p.variant_id===variant&&p.currency===currency)?.price;
 const stockFor=(v:Row)=>Number(v.available||0)+(original?.lines||[]).filter((l:Row)=>l.variant_id===v.id).reduce((n:number,l:Row)=>n+Number(original?.status==="dispatched"?l.quantity:l.reserved_quantity||0),0);
 const variantText=(v:Row)=>[v.product_name||v.name,v.size||"Sin tamaño",v.weight_max!=null?`${Number(v.weight_max).toLocaleString("es-GT",{maximumFractionDigits:2})} g`:"Sin peso"].join(" - ")+" ## "+stockFor(v).toLocaleString("es-GT",{maximumFractionDigits:2});
 const totals=saleTotals(lines,delivery,discountMode,discountInput);
 const account=accounts.find(a=>a.currency===currency);
 const available=Math.max(0,Number(account?.credit||0)-Number(original?.payment_summary?.excess||0));
 const confirmedInitial=payments.reduce((s,p)=>s+((p.method==="cash"||p.confirmed)?Number(p.amount||0):0),0);
 const due=Math.max(0,totals.total-Number(original?.payment_summary?.paid||0)-confirmedInitial);
 const close=async()=>{if(state.busy)return;if(dirty&&!(await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?")))return;onClose();};
 const updateLine=(key:string,field:string,value:any)=>{setLines(old=>old.map(l=>{
  if(l.key!==key)return l;
  if(field==="variant")return {...l,variant:value,unit_price:l.is_gift?"0":String(suggestedPrice(value)??""),regular_price:String(suggestedPrice(value)??"")};
  if(field==="is_gift")return {...l,is_gift:value,regular_price:value?l.unit_price:l.regular_price,unit_price:value?"0":String(l.regular_price??suggestedPrice(l.variant)??"")};
  return {...l,[field]:value};
 }));setDirty(true);};
 const changeCustomer=(id:string)=>{const list=catalog.customers.find((c:Row)=>c.id===id)?.price_list_id||catalog.default_price_list;setLines(old=>old.map(l=>({...l,regular_price:String(suggestedPrice(l.variant,list)??""),unit_price:l.is_gift?"0":String(suggestedPrice(l.variant,list)??"")})));setCustomer(id);setCredit("");setPayment(catalog.customers.find((x:Row)=>x.id===id)?.payment_preference||"");const a=options.addresses?.find((x:Row)=>x.partner_id===id&&x.is_primary);setDelivery(old=>applyDeliveryAddress(old,a||{address:catalog.customers.find((x:Row)=>x.id===id)?.address||""},options));setDirty(true);};
 return <div className="overlay"><section className="modal operations-dialog sale-editor" role="dialog" aria-modal="true" aria-label={orderId?"Editar factura":"Registrar venta"} data-navigation-dirty={dirty}>
  <header className="hierarchy-toolbar"><h2>{original?`Editar factura #${original.number}`:"Registrar venta"}</h2><AppButton className="secondary" disabled={state.busy} onClick={close}>Cerrar</AppButton></header>
  {state.error&&<p className="error" role="alert"><AppIcon name="status.error"/>{state.error}</p>}
  {ready&&<form data-dirty-managed aria-busy={state.busy} onChange={()=>setDirty(true)} onSubmit={e=>{e.preventDefault();if(totals.discount<0||totals.discount>totals.subtotal){state.setError("Revisa el descuento; no puede superar el subtotal.");return;}void state.run(async()=>{
   const payload={...(original?{order:original.id,expected_revision:original.revision}:{}),customer_id:customer||undefined,customer:contact,payment,delivery:delivery.kind==="pickup"?"pickup":"delivery",delivery_info:delivery,
    items:lines.map(l=>({variant:l.variant,quantity:Number(l.quantity),unit_price:l.is_gift?"0":l.unit_price,is_gift:!!l.is_gift})),discount:{mode:discountMode,value:discountInput||"0"},expected_total:totals.total.toFixed(2),credit_amount:credit||"0",...(!original?{payments:payments.map(({key,...p})=>p)}:{})};
   await keyedRequest(company,original?"edit_sale":"sales",payload,original?undefined:"create");setDirty(false);await onSaved();onClose();
  });}}><fieldset disabled={state.busy||!state.canWrite}>
   <div className="settings-grid"><label>Cliente<SearchSelect required={!!original} value={customer} onChange={e=>changeCustomer(e.target.value)}><option value="">Nuevo contacto</option>{original&&!catalog.customers.some((c:Row)=>c.id===customer)&&<option value={customer}>{original.customer_snapshot.name}</option>}{catalog.customers.filter((c:Row)=>c.active||c.id===customer).map((c:Row)=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</SearchSelect></label>
    <label>Forma de pago habitual<SearchSelect required value={payment} onChange={e=>setPayment(e.target.value)}><option value="">Seleccionar</option>{paymentMethods.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</SearchSelect><small>Elegir transferencia no confirma un pago.</small></label>
    {!customer&&<><label>Nombre<input required minLength={2} maxLength={120} value={contact.name} onChange={e=>setContact({...contact,name:e.target.value})}/></label><label>Teléfono<input required type="tel" maxLength={25} value={contact.phone} onChange={e=>setContact({...contact,phone:e.target.value})}/></label><label>Correo · opcional<input type="email" maxLength={254} value={contact.email} onChange={e=>setContact({...contact,email:e.target.value})}/></label></>}
   </div>
   <p className="muted">Lista de precios: <strong>{catalog.price_lists?.find((p:Row)=>p.id===selectedList)?.name||"Sin lista activa"}</strong></p>
   <section><div className="hierarchy-toolbar"><h3>Productos</h3><AppButton type="button" className="secondary" disabled={lines.length>=30} onClick={()=>{setLines([...lines,{key:crypto.randomUUID(),variant:"",quantity:"1",unit_price:""}]);setDirty(true);}}>Agregar producto</AppButton></div>
    <div className="table-wrap"><ResponsiveTable onSortRows={indexes=>setLines(old=>indexes.map(i=>old[i]))}><thead><tr><th>Variante</th><th>Cantidad</th><th>Regalo</th><th>Precio unitario</th><th>Subtotal</th><th>Acciones</th></tr></thead><tbody>{lines.map(l=><tr key={l.key}>
     <td><SearchSelect required value={l.variant} onChange={e=>updateLine(l.key,"variant",e.target.value)}><option value="">Seleccionar producto con existencias</option>{!catalog.variants.some((v:Row)=>v.id===l.variant)&&l.variant&&<option value={l.variant}>{original?.lines.find((x:Row)=>x.variant_id===l.variant)?.description||"Variante del pedido"}</option>}{catalog.variants.filter((v:Row)=>v.currency===currency&&(stockFor(v)>0||v.id===l.variant)).map((v:Row)=><option key={v.id} value={v.id}>{variantText(v)}</option>)}</SearchSelect></td>
     <td data-sort-value={l.quantity}><input aria-label="Cantidad" required type="number" min="1" max="1000" step="1" value={l.quantity} onChange={e=>updateLine(l.key,"quantity",e.target.value)}/></td>
     <td data-sort-value={l.is_gift?1:0}><label className="sale-gift"><input type="checkbox" aria-label="Regalo" checked={!!l.is_gift} onChange={e=>updateLine(l.key,"is_gift",e.target.checked)}/> Regalo</label></td>
     <td data-sort-value={l.unit_price}><MoneyInput disabled={!!l.is_gift} aria-label="Precio unitario" required currency={currency} min="0" value={l.unit_price} onChange={e=>updateLine(l.key,"unit_price",e.target.value)}/></td>
     <td data-sort-value={l.is_gift?0:Number(l.quantity||0)*Number(l.unit_price||0)}>{money(l.is_gift?0:Number(l.quantity||0)*Number(l.unit_price||0),currency)}</td>
     <td><AppButton type="button" className="danger" disabled={lines.length===1} onClick={()=>{setLines(old=>old.filter(x=>x.key!==l.key));setDirty(true);}}>Quitar</AppButton></td>
    </tr>)}</tbody></ResponsiveTable></div>
   </section>
   <div className="sale-discounts"><strong>Subtotal: {money(totals.subtotal,currency)}</strong>
    <label>Descuento · monto<MoneyInput currency={currency} min="0" max={totals.subtotal} value={discountMode==="amount"?discountInput:String(totals.discount)} onChange={e=>{setDiscountMode("amount");setDiscountInput(e.target.value);}}/></label>
    <label>Descuento · %<input type="number" min="0" max="100" step="0.01" value={discountMode==="percent"?discountInput:String(totals.percent)} onChange={e=>{setDiscountMode("percent");setDiscountInput(e.target.value);}}/></label>
   </div>
   <DeliveryFields value={delivery} options={options} customerId={customer} currency={currency} onChange={v=>{setDelivery(v);setDirty(true);}}/>
   {!original&&<details className="sale-payments" open={payments.length>0||undefined}><summary>Pagos y transferencias · opcional</summary><InitialPayments rows={payments} onChange={v=>{setPayments(v);setDirty(true);}} courier={delivery.kind==="courier"&&!!delivery.courier_id} method={payment} currency={currency}/></details>}
   {customer&&<div className="sale-credit"><strong>Saldo a favor disponible: {money(available,currency)}</strong><label>Aplicar saldo a esta factura<MoneyInput currency={currency} min="0" max={Math.min(available,due)} disabled={available<=0||due<=0} value={credit} onChange={e=>setCredit(e.target.value)}/></label></div>}
   <footer className="form-actions sale-editor-footer"><strong>Total: {money(totals.total,currency)}</strong><small>Envío: {money(totals.shipping,currency)} · Descuento: {money(totals.discount,currency)}</small><AppButton>{original?"Guardar cambios":"Confirmar factura"}</AppButton><AppButton type="button" className="secondary" onClick={close}>Volver</AppButton></footer>
  </fieldset></form>}
 </section></div>;
}
