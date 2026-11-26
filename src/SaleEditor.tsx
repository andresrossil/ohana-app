import { useEffect, useRef, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import SearchSelect from "./SearchSelect";
import MoneyInput from "./MoneyInput";
import ResponsiveTable from "./ResponsiveTable";
import { confirmAction } from "./ConfirmDialog";
import { request, sales } from "./commerce";
import { keyedRequest, money, useOperation, type Row } from "./operations";
import { blankDelivery, courierRead } from "./delivery-model";
import { applyDeliveryAddress, deliveryTariff, restoreShippingChoice } from "./delivery-address";
import DeliveryFields from "./DeliveryFields";
import { paymentMethods } from "./payment-methods";
import CustomerCommercialInfo from "./CustomerCommercialInfo";
import { distributeSaleDiscount, roundMoney, saleLineTotals, saleTotals } from "./sale-form-model";
import "./sales-compact.css";

const emptyLine = () => ({ key: crypto.randomUUID(), variant: "", quantity: "1", unit_price: "" });
function revealInvalid(event: React.InvalidEvent) {
  const input = event.target as HTMLElement;
  for (let section = input.closest("details"); section; section = section.parentElement?.closest("details") ?? null) section.open = true;
}

export default function SaleEditor({company,orderId,currency,onClose,onSaved}:{company:string;orderId?:string;currency:string;onClose:()=>void;onSaved:()=>Promise<void>}){
 const state=useOperation(company,"sales");
 const [catalog,setCatalog]=useState<Row>({customers:[],variants:[]}),[options,setOptions]=useState<Row>({}),[original,setOriginal]=useState<Row|null>(null),[commercialInfo,setCommercialInfo]=useState<Row|null>(null),[ready,setReady]=useState(false),[dirty,setDirty]=useState(false);
 const [customer,setCustomer]=useState(""),[contact,setContact]=useState({name:"",phone:"",email:""}),[payment,setPayment]=useState(""),[delivery,setDelivery]=useState<Row>(blankDelivery),[lines,setLines]=useState<Row[]>([]),[credit,setCredit]=useState(""),[accounts,setAccounts]=useState<Row[]>([]);
 const [lineEdit,setLineEdit]=useState<{line:Row; existing:boolean}|null>(null);
 const [lineError,setLineError]=useState("");
 const captureForm=useRef<HTMLFormElement>(null);
 const returnFocus=useRef<HTMLElement|null>(null);
 const [headerEdit, setHeaderEdit] = useState<{ mode: "amount" | "percent"; value: string } | null>(null);
 useEffect(()=>{void state.run(async()=>{
  const [data,o,detail]=await Promise.all([sales(company),courierRead(company,"options"),orderId?request("sales_fulfillment",{p_company:company,p_action:"detail",p_data:{order:orderId}}):Promise.resolve(null)]);setCommercialInfo(detail?.commercial_info??null);setCatalog(data);setOptions(o);
  if(orderId){const current=detail?.order?{...detail.order,lines:detail.lines,delivery_info:detail.delivery,payment_summary:detail.summary,settled:detail.settled}:null;if(!current)throw Error("La factura ya no está disponible. Actualiza el listado.");if(current.settled)throw Error("La factura ya está liquidada por mensajería.");if(current.status!=="pending"||!["draft","invoiced"].includes(current.fulfillment_stage))throw Error("La factura ya fue preparada. Usa Ver factura y Revertir antes de editar.");setOriginal(current);setCustomer(current.customer_id);setPayment(current.payment);setDelivery(current.delivery_info?restoreShippingChoice(current.delivery_info):{...blankDelivery(),kind:current.delivery==="pickup"?"pickup":"own",shipping_charged:current.shipping,shipping_cost:current.shipping,single_shipping_cost:false});const savedLines = current.lines.filter((l:Row)=>l.quantity>0).map((l:Row)=>({key:crypto.randomUUID(),variant:l.variant_id,quantity:String(l.quantity),unit_price:String(l.unit_price),is_gift:!!l.is_gift,line_discount_input:String(l.line_discount??""),line_discount_mode:"amount"}));setLines(Number(current.discount) > 0 ? distributeSaleDiscount(savedLines, Number(current.discount), true) : savedLines);}
  else setLines([]);setReady(true);
 });},[company,orderId]);
 useEffect(()=>{let live=true;setAccounts([]);if(customer)request("customer_finance",{p_company:company,p_action:"account",p_data:{customer}}).then(r=>{if(live)setAccounts(r);}).catch(e=>{if(live)state.setError(e.message);});return()=>{live=false;};},[company,customer]);
 const selectedList=original&&customer===original.customer_id?(original.price_list_id||catalog.customers.find((c:Row)=>c.id===customer)?.price_list_id||catalog.default_price_list):(catalog.customers.find((c:Row)=>c.id===customer)?.price_list_id||catalog.default_price_list);
 const suggestedPrice=(variant:string,list=selectedList)=>catalog.price_entries?.find((p:Row)=>p.list_id===list&&p.variant_id===variant&&p.currency===currency)?.price;
 const stockFor=(v:Row)=>Number(v.available||0)+(original?.lines||[]).filter((l:Row)=>l.variant_id===v.id).reduce((n:number,l:Row)=>n+Number(original?.status==="dispatched"?l.quantity:l.reserved_quantity||0),0);
 const variantText=(v:Row)=>[v.product_name||v.name,v.size||"Sin tamaño",v.weight_max!=null?`${Number(v.weight_max).toLocaleString("es-GT",{maximumFractionDigits:2})} g`:"Sin peso"].join(" - ")+" ## "+stockFor(v).toLocaleString("es-GT",{maximumFractionDigits:2});
 const isDraft = !original || original.fulfillment_stage === "draft";
 const totals = saleTotals(lines, delivery);
 function changeHeaderDiscount(mode: "amount" | "percent", value: string) {
  setHeaderEdit({ mode, value });
  const input = Number(value);
  if (!Number.isFinite(input) || input < 0 || input > (mode === "percent" ? 100 : totals.subtotal)) return;
  const amount = mode === "percent" ? roundMoney(totals.subtotal * input / 100) : input;
  setLines((current) => distributeSaleDiscount(current, amount));
  setDirty(true);
 }
 const account=accounts.find(a=>a.currency===currency);
 const available=Math.max(0,Number(account?.credit||0)-Number(original?.payment_summary?.excess||0));

 const due=Math.max(0,totals.total-Number(original?.payment_summary?.paid||0));
 const close=async()=>{if(state.busy)return;if(dirty&&!(await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?")))return;onClose();};
 const updateLine=(field:string,value:any)=>{setLineEdit(current=>{
  if(!current)return current;
  const l=current.line;
  const line=(()=>{
   if(field==="discount_amount"||field==="discount_percent")return {...l,line_discount_input:value,line_discount_mode:field==="discount_percent"?"percent":"amount"};
   if(field==="variant")return {...l,variant:value,unit_price:l.is_gift?"0":String(suggestedPrice(value)??""),regular_price:String(suggestedPrice(value)??"")};
   if(field==="is_gift")return {...l,is_gift:value,regular_price:value?l.unit_price:l.regular_price,unit_price:value?"0":String(l.regular_price??suggestedPrice(l.variant)??"")};
   return {...l,[field]:value};
  })();
  return {...current,line};
 });};
 const displayMoney=(n:number|string)=>money(n,currency).replace(/^(?:GTQ|Q)\s+/,"Q");
 const clientName=catalog.customers.find((c:Row)=>c.id===customer)?.name || (customer===original?.customer_id ? original?.customer_snapshot?.name : contact.name);
 const listName=catalog.price_lists?.find((p:Row)=>p.id===selectedList)?.name || "Sin lista activa";
 const paymentName=paymentMethods.find(method=>method.value===payment)?.label || "Forma de pago pendiente";
 const courier=options.couriers?.find((c:Row)=>c.id===delivery.courier_id);
 const tariff=deliveryTariff({...delivery,destination:courier?.mode==="zone"?String(delivery.zone||""):courier?.mode==="department"?delivery.department||"":"general"},options);
 const deliveryName=courier?.name || (delivery.kind==="pickup"?"Recoger pedido":delivery.kind==="own"?"Entrega propia":"Mensajería pendiente");
 const unitCount=lines.reduce((sum,line)=>sum+Number(line.quantity),0);
 const closeLine=()=>{setLineEdit(null);setLineError("");requestAnimationFrame(()=>returnFocus.current?.focus({preventScroll:true}));};
 const openLine=(line?:Row)=>{
  returnFocus.current=document.activeElement as HTMLElement|null;
  setLineError("");
  setLineEdit({line:line?{...line}:emptyLine(),existing:!!line});
 };
 const focusVariant=()=>requestAnimationFrame(()=>captureForm.current?.querySelector<HTMLInputElement>("input[data-search-select]")?.focus());
 useEffect(()=>{if(lineEdit)focusVariant();},[lineEdit?.line.key]);
 function saveLine(continueAdding:boolean){
  if(!lineEdit||state.busy||!state.canWrite)return;
  const {line,existing}=lineEdit;
  if(!line.variant||!Number.isInteger(Number(line.quantity))||Number(line.quantity)<1||Number(line.quantity)>1000||!saleLineTotals(line).valid){
   setLineError("Revisa la variante, la cantidad y el descuento de la línea.");return;
  }
  if(!existing&&lines.length>=30)return;
  const next=existing?lines.map(item=>item.key===line.key?line:item):[...lines,line];
  setLines(next);setDirty(true);setLineError("");
  if(continueAdding&&next.length<30)setLineEdit({line:emptyLine(),existing:false});
  else closeLine();
 }
 const changeCustomer=(id:string)=>{const list=catalog.customers.find((c:Row)=>c.id===id)?.price_list_id||catalog.default_price_list;setLines(old=>old.map(l=>({...l,regular_price:String(suggestedPrice(l.variant,list)??""),unit_price:l.is_gift?"0":String(suggestedPrice(l.variant,list)??"")})));setCustomer(id);setCredit("");setPayment(catalog.customers.find((x:Row)=>x.id===id)?.payment_preference||"");const a=options.addresses?.find((x:Row)=>x.partner_id===id&&x.is_primary);setDelivery(old=>applyDeliveryAddress(old,a||{address:catalog.customers.find((x:Row)=>x.id===id)?.address||""},options));setDirty(true);};
 const l=lineEdit?.line;
 return <><div className="overlay sale-editor-overlay" inert={!!lineEdit}><section className="modal operations-dialog sale-editor sale-editor-redesign" role="dialog" aria-modal="true" aria-label={orderId?"Editar factura":"Nueva factura"} data-navigation-dirty={dirty}>
  <header className="hierarchy-toolbar"><h2>{original?`Editar factura #${original.invoice_number || original.number}`:"Nueva factura"}</h2><AppButton type="button" className="secondary catalog-icon-button" iconKey="action.cancel" aria-label="Cerrar factura" title="Cerrar factura" disabled={state.busy} onClick={close} /></header>
  {state.error&&<p className="error" role="alert"><AppIcon name="status.error"/>{state.error}</p>}
  {ready&&<form className="sale-main-form" data-dirty-managed onInvalidCapture={revealInvalid} aria-busy={state.busy} onChange={()=>setDirty(true)} onSubmit={e=>{e.preventDefault();if(!lines.length||lineEdit||!state.canWrite||state.busy)return;if(lines.some(l=>!saleLineTotals(l).valid)){state.setError("Revisa los descuentos por línea. No pueden superar el importe de la línea ni el 100 %.");return;}if(totals.discount<0||totals.discount>totals.subtotal){state.setError("Revisa el descuento; no puede superar el subtotal.");return;}void state.run(async()=>{
   const payload={...(original?{order:original.id,expected_revision:original.revision}:{}),draft:!original,customer_id:customer||undefined,customer:contact,payment,delivery:delivery.kind==="pickup"?"pickup":"delivery",delivery_info:delivery,
    items:lines.map(l=>({variant:l.variant,quantity:Number(l.quantity),unit_price:l.is_gift?"0":l.unit_price,is_gift:!!l.is_gift,discount:{mode:l.line_discount_mode||"amount",value:l.line_discount_input||"0"}})),discount:{mode:"amount",value:"0"},expected_total:totals.total.toFixed(2),credit_amount:isDraft?"0":credit||"0",};
   await keyedRequest(company,original?"edit_sale":"sales",payload,original?undefined:"create");setDirty(false);await onSaved();onClose();
  });}}>
   <div className="sale-editor-scroll">
   <fieldset className="sale-main-fields" disabled={state.busy||!state.canWrite}>
   <details className="sale-section" open={!orderId}><summary><strong>Cliente</strong><small>{clientName || "Cliente pendiente"} · {paymentName} · {listName}</small></summary><div className="sale-section-content"><div className="settings-grid"><label>Cliente<SearchSelect required={!!original} disabled={!!original?.invoice_number} value={customer} onChange={e=>changeCustomer(e.target.value)}><option value="">Nuevo contacto</option>{original&&!catalog.customers.some((c:Row)=>c.id===customer)&&<option value={customer}>{original.customer_snapshot.name}</option>}{catalog.customers.filter((c:Row)=>c.active||c.id===customer).map((c:Row)=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</SearchSelect></label>
    <label>Forma de pago habitual<SearchSelect required value={payment} onChange={e=>setPayment(e.target.value)}><option value="">Seleccionar</option>{paymentMethods.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</SearchSelect><small>Elegir transferencia no confirma un pago.</small></label>
    {!customer&&<><label>Nombre<input required minLength={2} maxLength={120} value={contact.name} onChange={e=>setContact({...contact,name:e.target.value})}/></label><label>Teléfono<input required type="tel" maxLength={25} value={contact.phone} onChange={e=>setContact({...contact,phone:e.target.value})}/></label><label>Correo · opcional<input type="email" maxLength={254} value={contact.email} onChange={e=>setContact({...contact,email:e.target.value})}/></label></>}
   </div>
   <CustomerCommercialInfo info={catalog.customers.find((c:Row)=>c.id===customer) ?? (customer===original?.customer_id?commercialInfo:null)} />
   <p className="muted">Lista de precios: <strong>{catalog.price_lists?.find((p:Row)=>p.id===selectedList)?.name||"Sin lista activa"}</strong></p></div></details>
   <details className="sale-section"><summary><strong>Mensajería y entrega</strong><small>{deliveryName} · {tariff?.delivery_schedule || "Sin horario"} · Envío {displayMoney(delivery.shipping_cost || 0)}</small></summary>
   <DeliveryFields value={delivery} options={options} customerId={customer} currency={currency} onChange={v=>{setDelivery(v);setDirty(true);}}/></details>
   <section className="sale-line-list"><h3>Productos ({lines.length})</h3>
    {lines.length? <ResponsiveTable className="sale-lines-table" showAllMobileFields compactRowActions onSortRows={indexes=>setLines(old=>indexes.map(i=>old[i]))}>
      <thead><tr><th>Producto y variante</th><th>Cantidad</th><th>Precio unitario</th><th>Total</th><th>Acciones</th></tr></thead>
      <tbody>{lines.map(line=>{
        const variant=catalog.variants.find((v:Row)=>v.id===line.variant);
        const historical=original?.lines.find((v:Row)=>v.variant_id===line.variant);
        const amounts=saleLineTotals(line);
        return <tr key={line.key}>
          <td className="sale-line-title"><strong>{variant?.product_name||variant?.name||historical?.description||"Producto"}</strong>
            {variant&&<small>{[variant.size, ...Object.values(variant.attributes || {}).filter(value=>typeof value==="string"&&value), variant.weight_min!=null&&variant.weight_max!=null?`${variant.weight_min}–${variant.weight_max} g`:null].filter(Boolean).join(" · ")}</small>}
            {line.is_gift&&<small>Regalo</small>}
            {amounts.discount>0&&<small>Descuento: {displayMoney(amounts.discount)}</small>}
          </td>
          <td data-sort-value={line.quantity}>{line.quantity}</td>
          <td data-sort-value={line.unit_price}>{displayMoney(line.unit_price)}</td>
          <td data-sort-value={amounts.net}><strong>{displayMoney(amounts.net)}</strong></td>
          <td><div className="sale-line-actions">
            <AppButton type="button" className="secondary catalog-icon-button" iconKey="action.edit" aria-label="Editar línea" title="Editar línea" onClick={()=>openLine(line)} />
            <AppButton type="button" className="danger catalog-icon-button" iconKey="action.delete" aria-label="Eliminar línea" title="Eliminar línea"
              onClick={async()=>{if(await confirmAction("¿Eliminar este producto de la factura?",{confirmText:"Eliminar",danger:true})){
                setLines(old=>old.filter(item=>item.key!==line.key));setDirty(true);
              }}} />
          </div></td>
        </tr>;
      })}</tbody>
    </ResponsiveTable>:<p className="muted">Agrega productos para comenzar.</p>}
   </section>
   <details className="sale-section"><summary><strong>Descuentos y totales</strong><small>Subtotal {displayMoney(totals.subtotal)} · Descuentos {displayMoney(totals.discount)} · Envío {displayMoney(totals.shipping)} · Total {displayMoney(totals.total)}</small></summary>
   <div className="sale-discounts"><strong>Subtotal: {displayMoney(totals.subtotal)}</strong>
    <label>Descuento · monto<MoneyInput currency={currency} min="0" max={totals.subtotal} value={headerEdit?.mode==="amount"?headerEdit.value:String(totals.discount)} onBlur={()=>setHeaderEdit(null)} onChange={e=>changeHeaderDiscount("amount",e.target.value)}/></label>
    <label>Descuento · %<input type="number" min="0" max="100" step="0.01" value={headerEdit?.mode==="percent"?headerEdit.value:String(totals.percent)} onBlur={()=>setHeaderEdit(null)} onChange={e=>changeHeaderDiscount("percent",e.target.value)}/></label>
   </div>

   {isDraft&&<p className="muted">Borrador pendiente de confirmación del cliente. El inventario se reserva al confirmar.</p>}
   {payment==="cash"&&!isDraft&&<p className="muted">Efectivo pendiente de liquidación de ruta. Guardar la factura no registra dinero recibido ni reduce su saldo.</p>}
   {customer&&!isDraft&&<div className="sale-credit"><strong>Saldo a favor disponible: {displayMoney(available)}</strong><label>Aplicar saldo a esta factura<MoneyInput currency={currency} min="0" max={Math.min(available,due)} disabled={available<=0||due<=0} value={credit} onChange={e=>setCredit(e.target.value)}/></label></div>}
   </details></fieldset></div>
   <footer className="sale-redesign-footer">
    <div className="sale-totals-strip"><small>{unitCount} {unitCount===1?"unidad":"unidades"} · {lines.length} {lines.length===1?"línea":"líneas"} · Envío {displayMoney(totals.shipping)}</small><strong>Total a pagar: {displayMoney(totals.total)}</strong></div>
    <div className="sale-footer-buttons">
      <AppButton type="button" iconKey="action.add" disabled={state.busy||!state.canWrite||lines.length>=30} onClick={()=>openLine()}>Agregar producto</AppButton>
      <AppButton type="submit" disabled={state.busy||!state.canWrite||!lines.length}>{isDraft?"Guardar borrador":"Guardar cambios"}</AppButton>
      <AppButton type="button" className="secondary" disabled={state.busy||!state.canWrite} onClick={close}>Volver</AppButton>
    </div>
   </footer>
  </form>}
 </section></div>
 {lineEdit&&l&&<div className="overlay sale-capture-overlay"><section className="modal operations-dialog sale-line-dialog" role="dialog" aria-modal="true"
   aria-label={lineEdit.existing?"Editar producto":"Agregar producto"} data-navigation-dirty={!!l.variant || l.quantity!=="1"} onKeyDown={event=>{if(event.key==="Escape")closeLine();}}>
   <h2>{lineEdit.existing?"Editar producto":"Agregar producto"}</h2>
   <form key={l.key} ref={captureForm} onInvalidCapture={revealInvalid} onSubmit={event=>{event.preventDefault();saveLine((event.nativeEvent as SubmitEvent).submitter?.getAttribute("value")==="continue");}}>
    {lineError&&<p className="error" role="alert">{lineError}</p>}
    <div className="sale-capture-fields">
     <div><label>Producto y variante<SearchSelect aria-label="Producto y variante" required value={l.variant} onChange={e=>updateLine("variant",e.target.value)}><option value="">{isDraft ? "Seleccionar producto" : "Seleccionar producto con existencias"}</option>{!catalog.variants.some((v:Row)=>v.id===l.variant)&&l.variant&&<option value={l.variant}>{original?.lines.find((x:Row)=>x.variant_id===l.variant)?.description||"Variante del pedido"}</option>}{catalog.variants.filter((v:Row)=>v.currency===currency&&(isDraft||stockFor(v)>0||v.id===l.variant)).map((v:Row)=><option key={v.id} value={v.id}>{variantText(v)}</option>)}</SearchSelect></label></div>
     <div><label>Cantidad<input inputMode="numeric" aria-label="Cantidad" required type="number" min="1" max="1000" step="1" value={l.quantity} onChange={e=>updateLine("quantity",e.target.value)}/></label></div>
     <div><label className="sale-gift"><input type="checkbox" aria-label="Regalo" checked={!!l.is_gift} onChange={e=>updateLine("is_gift",e.target.checked)}/> Regalo</label></div>
     <div><label>Precio unitario<MoneyInput disabled={!!l.is_gift} aria-label="Precio unitario" required currency={currency} min="0" value={l.unit_price} onChange={e=>updateLine("unit_price",e.target.value)}/></label></div>
<details className="sale-section"><summary>Descuentos</summary>     <label>Descuento por monto
      <MoneyInput aria-label="Monto de descuento de línea" currency={currency} min="0" max={saleLineTotals(l).gross} disabled={!!l.is_gift}
        value={l.is_gift?"0":l.line_discount_mode==="percent"?String(saleLineTotals(l).discount):l.line_discount_input??""}
        onChange={e=>updateLine("discount_amount",e.target.value)} />
     </label>
     <label>Descuento por porcentaje
      <input aria-label="Porcentaje de descuento de línea" type="number" min="0" max="100" step="0.01" disabled={!!l.is_gift}
        value={l.is_gift?"0":l.line_discount_mode==="percent"?l.line_discount_input:String(saleLineTotals(l).percent)}
        onChange={e=>updateLine("discount_percent",e.target.value)} />
     </label>
</details>    </div>
    <p><strong>Subtotal de la línea: {displayMoney(saleLineTotals(l).net)}</strong></p>
    <div className="sale-footer-buttons">
      {!lineEdit.existing&&<AppButton type="submit" value="continue">Agregar y continuar</AppButton>}
      <AppButton type="submit">{lineEdit.existing?"Guardar línea":"Agregar y cerrar"}</AppButton>
      <AppButton type="button" className="secondary" onClick={closeLine}>Cancelar</AppButton>
    </div>
   </form>
 </section></div>}
 </>;
}
