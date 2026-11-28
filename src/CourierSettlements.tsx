import { useEffect, useRef, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import SearchSelect from "./SearchSelect";
import ResponsiveTable from "./ResponsiveTable";
import MoneyInput from "./MoneyInput";
import { confirmAction } from "./ConfirmDialog";
import { courierRead } from "./delivery-model";
import { keyedRequest, today, useOperation, type Row } from "./operations";
import { courierBalanceText, settlementNumber } from "./courier-account";
import OrderPreparationDialog from "./OrderPreparationDialog";
import CourierAccountDialog from "./CourierAccountDialog";
import "./couriers.css";
import "./commercial-compact.css";
import { compactMoney as money, settlementResult, settlementTone } from "./commercial-compact";
import { deliveryZoneLabel } from "./delivery-address";

const dateLabel=(date:string)=>date?.split("-").reverse().join("/")||"—";
const searchText=(text:string)=>text.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase();
function InvoiceDelivery({company,invoice}:{company:string;invoice:Row}){
 const [detail,setDetail]=useState<Row|null>(null),[error,setError]=useState("");
 return <details className="commercial-details" onToggle={event=>{
  if(event.currentTarget.open&&!detail){
   setError("");
   void courierRead(company,"order",{order:invoice.order_id}).then(setDetail).catch(()=>setError("No se pudo consultar la entrega."));
  }
 }}><summary>Información de entrega</summary>
  <p>{detail?.delivery?.address||invoice.address||"Sin dirección"}</p>
  {detail?.summary?.balance!=null&&<small>Saldo de la factura {money(detail.summary.balance,detail.order?.currency)}</small>}
  {detail?.delivery?.guide&&<small>Guía {detail.delivery.guide}</small>}
  {detail?.order?.customer_snapshot?.phone&&<small>{detail.order.customer_snapshot.phone}</small>}
  {detail?.delivery?.notes&&<small>{detail.delivery.notes}</small>}
  {error&&<p role="alert">{error}</p>}
 </details>;
}

const emptyFilters={courier:"",state:"",from:"",to:""};
const states:Row={draft:"Borrador",pending:"Pendiente",partial:"Parcial",settled:"Liquidada",cancelled:"Cancelada"};
type Choice={selected:boolean;mark_collected:boolean;extra_cash:string};
const emptyChoice=():Choice=>({selected:false,mark_collected:false,extra_cash:""});
const blankExchange=()=>({actual_amount:"0",direction:"received",method:"cash",exchange_date:today(),exchange_notes:""});
export default function CourierSettlements({company,onDirty,initialId,onInitialOpen}:{company:string;onDirty:(dirty:boolean)=>void;initialId?:string;onInitialOpen?:()=>void}){
 const finalizing=useRef(false);
 const [success,setSuccess]=useState("");
 const [query,setQuery]=useState("");
 const [preparing,setPreparing]=useState<string|null>(null);
 const state=useOperation(company,"sales");
 const [history,setHistory]=useState<Row[]>([]),[couriers,setCouriers]=useState<Row[]>([]),[filters,setFilters]=useState(emptyFilters);
 const [document,setDocument]=useState<Row|null>(null),[items,setItems]=useState<Row[]>([]),[payments,setPayments]=useState<Row[]>([]),[paying,setPaying]=useState(false),[pending,setPending]=useState<Row[]>([]),[choices,setChoices]=useState<Record<string,Choice>>({});
 const [balance,setBalance]=useState(0),[dirty,setDirty]=useState(false),[exchangeDirty,setExchangeDirty]=useState(false),[exchange,setExchange]=useState(blankExchange);
 const [account,setAccount]=useState<Row|null>(null),[cancelling,setCancelling]=useState(false),[reason,setReason]=useState("");
 const load=async(criteria=filters)=>{const [h,o]=await Promise.all([courierRead(company,"settlements",criteria),courierRead(company,"options")]);setHistory(h);setCouriers(o.couriers);};
 useEffect(()=>{onDirty(dirty||exchangeDirty||cancelling);return()=>onDirty(false);},[dirty,exchangeDirty,cancelling,onDirty]);
 useEffect(()=>{let live=true;setPending([]);setBalance(0);if(!document?.courier_id)return;
  Promise.all([courierRead(company,"account",{courier:document.courier_id}),document.state==="draft"?courierRead(company,"pending",{courier:document.courier_id}):Promise.resolve([])])
   .then(([a,p])=>{if(live){setBalance(Number(a.balance));setPending(p);}}).catch(e=>{if(live)state.setError(e.message);});return()=>{live=false;};
 },[company,document?.courier_id,document?.id,document?.state,document?.revision]);
 const setDetail=(d:Row)=>{setDocument(d.document);setItems(d.items);setPayments(d.payments||[]);setBalance(Number(d.balance));const next:Record<string,Choice>={};for(const i of d.items){const previous=next[i.order_id]||emptyChoice();const extra=i.collection_pending||i.snapshot.recorded_receipt===false;next[i.order_id]={selected:true,mark_collected:previous.mark_collected||extra,extra_cash:String(Number(previous.extra_cash||0)+(extra?Number(i.amount):0))};}setChoices(next);setDirty(false);};
 const openDocument=async(id?:string)=>{setSuccess("");setExchange(blankExchange());setExchangeDirty(false);setPaying(false);setCancelling(false);setReason("");if(id){const d=await courierRead(company,"settlement",{id});setDetail(d);if(d.document.state!=="draft")setExchange({actual_amount:String(d.document.actual_amount??0),direction:d.document.exchange_direction||"received",method:d.document.exchange_method||"cash",exchange_date:d.document.exchanged_on||d.document.settled_on,exchange_notes:d.document.exchange_notes||""});}
  else{setDocument({courier_id:filters.courier,settled_on:today(),state:"draft",notes:""});setChoices({});setItems([]);setPayments([]);setDirty(false);}};
 const open=(id?:string)=>state.run(()=>openDocument(id));
 useEffect(()=>{
  let live=true;
  void Promise.all([courierRead(company,"settlements",filters),courierRead(company,"options")])
   .then(([h,o])=>{if(live){setHistory(h);setCouriers(o.couriers);}})
   .catch(error=>{if(live)state.setError(error.message);});
  return()=>{live=false;};
 },[company,filters]);
 useEffect(()=>{
  if(initialId){onInitialOpen?.();void open(initialId);}
 },[company,initialId]);
 const close=async()=>{if(state.busy)return;if((dirty||exchangeDirty||cancelling)&&!(await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?")))return;setDocument(null);setPaying(false);setDirty(false);setExchangeDirty(false);setCancelling(false);};
 useEffect(()=>{if(document?.state!=="draft")return;const transfers=new Set(pending.filter(p=>p.payment_method==="transfer").map(p=>p.order_id));if(items.some(i=>transfers.has(i.order_id)&&(i.payment_id||i.collection_pending)))setDirty(true);},[pending,items,document?.state]);
 const eligible=pending.filter(p=>!p.reserved_id||p.reserved_id===document?.id);
 const chosen=eligible.filter(p=>choices[p.order_id]?.selected);
 const draft=document?.state==="draft";
 const awaitingPreparation=draft&&chosen.some(p=>p.needs_preparation);
 const unresolvedCash=draft&&chosen.some(p=>p.payment_method!=="transfer"&&Number(p.expected_cash)>0&&
   (!choices[p.order_id]?.mark_collected||Math.round(Number(choices[p.order_id]?.extra_cash)*100)!==Math.round(Number(p.expected_cash)*100)));
 const preview=draft&&pending.length>0;
 const collected=preview?chosen.reduce((sum,p)=>sum+(p.payment_method==="transfer"?0:Number(p.collected)+(choices[p.order_id]?.mark_collected?Number(choices[p.order_id].extra_cash||0):0)),0):Number(document?.collected||0);
 const cost=preview?chosen.reduce((sum,p)=>sum+Number(p.shipping_cost),0):Number(document?.shipping_cost||0),net=Math.round((collected-cost)*100)/100;
 const remaining=draft?net:Number(document?.remaining||0),paidTotal=draft?0:Number(document?.paid_total||0);


 const courierName=couriers.find(c=>c.id===document?.courier_id)?.name||"el mensajero";
 const choose=(id:string,patch:Partial<Choice>)=>{setChoices(old=>({...old,[id]:{...(old[id]||emptyChoice()),...patch}}));setDirty(true);};
 const editExchange=(key:string,value:string)=>{setExchange(old=>({...old,[key]:value}));setExchangeDirty(true);};
 const draftPayload=()=>({
  id:document?.id,courier:document?.courier_id,date:document?.settled_on,notes:document?.notes,
  expected_revision:document?.revision,admin_draft:true,
  orders:chosen.map(p=>({order:p.order_id,mark_collected:p.payment_method!=="transfer"&&choices[p.order_id].mark_collected,
    extra_cash:p.payment_method==="transfer"?"0":choices[p.order_id].extra_cash||"0"})),
 });
 const save=()=>state.run(async()=>{if(!document)return;const differences=chosen.filter(p=>p.payment_method!=="transfer"&&choices[p.order_id].mark_collected&&Math.round(Number(choices[p.order_id].extra_cash||0)*100)!==Math.round(Number(p.expected_cash)*100));if(differences.length&&!(await confirmAction(differences.map(p=>`Pedido #${p.number} · ${p.customer}\nTotal de factura: ${money(p.invoice_total)} · Pendiente: ${money(p.expected_cash)}\nEfectivo adicional cobrado: ${money(choices[p.order_id].extra_cash)}\nDiferencia: ${money(Math.abs(Number(choices[p.order_id].extra_cash||0)-Number(p.expected_cash)))} (${Number(choices[p.order_id].extra_cash||0)>Number(p.expected_cash)?"excedente a favor":"faltante por pagar"})`).join("\n\n")+"\n¿Son correctos estos cobros?",{title:"Revisar efectivo cobrado",confirmText:"Sí, guardar cobros"})))return;const saved=await keyedRequest(company,"courier_operations",{...draftPayload(),cash_discrepancies_confirmed:differences.length>0},"settlement_save");setDetail(await courierRead(company,"settlement",{id:saved.id}));await load();});
 const finalize=async()=>{
  if(finalizing.current||state.busy||!draft||validation)return;
  finalizing.current=true;
  try {
   await state.run(async()=>{
    await keyedRequest(company,"finalize_courier_settlement",{
     draft:draftPayload(),expected_collected:Math.round(collected*100)/100,expected_shipping:Math.round(cost*100)/100,
     method:exchange.method,exchange_date:exchange.exchange_date,exchange_notes:exchange.exchange_notes,
    });
    setDocument(null);setDirty(false);setExchangeDirty(false);setCancelling(false);
    setSuccess("Liquidación finalizada.");
    setQuery("");
    if(Object.values(filters).some(Boolean))setFilters(emptyFilters);
    else await load();
   });
  } finally {finalizing.current=false;}
 };
 const beginPayment=()=>{setExchange({...blankExchange(),actual_amount:String(Math.abs(remaining)),direction:remaining>=0?"received":"paid"});setExchangeDirty(false);setPaying(true);};
 const confirm=()=>state.run(async()=>{if(!document)return;const amount=Number(exchange.actual_amount||0),left=Math.abs(remaining)-amount;
  if(amount<0||left<0||(!draft&&amount===0))throw Error("El pago no puede superar el saldo pendiente.");
  if(!(await confirmAction(`${courierBalanceText(remaining,courierName)}.\nImporte pagado: ${money(amount)}.\nSaldo pendiente después del pago: ${money(left)}.\n¿${draft?"Liquidar el documento":"Registrar este pago"}?`)))return;
  await keyedRequest(company,"courier_operations",{id:document.id,amount:exchange.actual_amount,method:exchange.method,date:exchange.exchange_date,notes:exchange.exchange_notes,expected_revision:document.revision,expected_remaining:remaining},"settlement_payment");
  setDetail(await courierRead(company,"settlement",{id:document.id}));setPaying(false);setExchangeDirty(false);setExchange(blankExchange());await load();
 });
 const displayed=history.filter(row=>searchText(settlementNumber(row.number)+" "+row.courier_name).includes(searchText(query.trim())));
 const openAccount=()=>setAccount(couriers.find(c=>c.id===filters.courier)||null);
 const canSettle=state.canWrite&&document?.id&&!paying&&document.state!=="cancelled"&&!draft&&Math.abs(remaining)>0;
 const canSave=state.canWrite&&draft&&!paying;
 const disabledSettle=state.busy;
 const validation=!document?.courier_id?"Selecciona un mensajero.":!chosen.length?"Selecciona al menos una factura.":
  chosen.length>300?"Selecciona hasta 300 facturas.":awaitingPreparation?"Confirma la preparación de las facturas seleccionadas.":
  unresolvedCash?"Confirma el efectivo pendiente y resuelve las diferencias antes de liquidar.":
  !document.settled_on||document.settled_on>today()?"Indica una fecha del documento actual o anterior.":
  !exchange.exchange_date||exchange.exchange_date>today()?"Indica una fecha del intercambio actual o anterior.":"";
 const invoiceCount=draft?chosen.length:new Set(items.map(i=>i.order_id)).size;
 const filtersActive=query.trim()||Object.values(filters).some(Boolean);
 return <>
  <header className="commercial-list-header settlement-list-header"><h1><AppIcon name="module.settlements"/> Liquidaciones</h1>
   {state.canWrite&&<AppButton iconKey="action.add" disabled={state.busy} onClick={()=>open()}>+ Nueva</AppButton>}
   <AppButton className="secondary" iconKey="action.refresh" aria-label="Actualizar" title="Actualizar" disabled={state.busy} onClick={()=>state.run(load)}>×</AppButton>
  </header>
  {!document&&state.error&&<p className="error"><AppIcon name="status.error"/>{state.error}</p>}
  {success&&<p role="status">{success}</p>}
  <section className="settlement-list">
   <input type="search" aria-label="Buscar liquidaciones" placeholder="Número de liquidación o mensajero" value={query} onChange={e=>setQuery(e.target.value)}/>
   <div className="commercial-toggle settlement-status-filters" role="group" aria-label="Estado de liquidación">
    {[["","Todas"],["draft","Borradores"],["settled","Liquidadas"],["cancelled","Canceladas"],["pending","Pendientes"],["partial","Parciales"]].map(([key,label])=><button key={key} type="button" className="secondary" aria-pressed={filters.state===key} onClick={()=>setFilters({...filters,state:key})}>{label}</button>)}
   </div>
   <div className="commercial-filter-actions">
    <details className="commercial-details"><summary>Más filtros</summary><div className="commercial-fields">
      <label>Mensajero<SearchSelect value={filters.courier} onChange={e=>setFilters({...filters,courier:e.target.value})}><option value="">Todos los mensajeros</option>{couriers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</SearchSelect></label>
      <label>Fecha desde<input type="date" value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/></label>
      <label>Fecha hasta<input type="date" min={filters.from||undefined} value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})}/></label>
    </div></details>
    {filtersActive&&<button className="secondary" type="button" onClick={()=>{setQuery("");setFilters(emptyFilters);}}>Limpiar filtros</button>}
    {filters.courier&&<button className="secondary" type="button" onClick={openAccount}>Ver cuenta del mensajero</button>}
   </div>
   <div className="commercial-desktop table-wrap"><ResponsiveTable><thead><tr><th>Número</th><th>Fecha</th><th>Mensajero</th><th>Pedidos</th><th>Efectivo</th><th>Envíos</th><th>Resultado</th><th>Liquidado</th><th>Saldo</th><th>Estado</th></tr></thead><tbody>{displayed.map(s=><tr key={s.id}><td data-sort-value={s.number}><button className="commercial-link" type="button" onClick={()=>open(s.id)}>{settlementNumber(s.number)}</button></td><td data-sort-value={s.settled_on}>{dateLabel(s.settled_on)}</td><td>{s.courier_name}</td><td data-sort-value={s.order_count}>{s.order_count}</td><td data-sort-value={s.collected}>{money(s.collected)}</td><td data-sort-value={s.shipping_cost}>{money(s.shipping_cost)}</td><td data-sort-value={s.net} data-tone={settlementTone(Number(s.net),s.state)}>{settlementResult(Number(s.net),s.state)}</td><td data-sort-value={s.paid_total}>{money(s.paid_total)}</td><td data-sort-value={s.remaining}>{money(s.remaining)}</td><td><span className="commercial-chip" data-state={s.state}>{states[s.state]||s.state}</span></td></tr>)}</tbody></ResponsiveTable></div>
   <div className="commercial-mobile">{displayed.map(s=><article className="commercial-card" key={s.id}>
    <button type="button" className="commercial-card-open" onClick={()=>open(s.id)}>
     <span className="commercial-card-heading"><strong>{settlementNumber(s.number)}</strong><span className="commercial-chip" data-state={s.state}>{states[s.state]||s.state}</span></span>
     <span>{s.courier_name} · {dateLabel(s.settled_on)} · {s.order_count} {Number(s.order_count)===1?"pedido":"pedidos"}</span>
     <span className="settlement-card-amounts"><small>Efectivo {money(s.collected)}</small><small>Envíos {money(s.shipping_cost)}</small></span>
     <strong data-tone={settlementTone(Number(s.net),s.state)}>{settlementResult(Number(s.net),s.state)}</strong>
    </button>
    <details className="commercial-details"><summary aria-label="Importe liquidado y saldo pendiente">Detalles</summary><p>Liquidado {money(s.paid_total)} · Saldo pendiente {money(s.remaining)}</p></details>
   </article>)}</div>
   {!displayed.length&&<p className="empty">No hay liquidaciones para estos filtros.</p>}
  </section>
  {document&&<div className="overlay commercial-overlay"><section className="modal courier-dialog settlement-dialog commercial-dialog" role="dialog" aria-modal="true" aria-label="Liquidación de mensajería" data-navigation-dirty={dirty||exchangeDirty||cancelling}>
   <header className="commercial-header"><div><h2>{document.number?settlementNumber(document.number):"Nueva liquidación"}</h2><small><span className="commercial-chip" data-state={document.state}>{states[document.state]}</span> · {dateLabel(document.settled_on)}</small></div><AppButton className="secondary" iconKey="action.cancel" aria-label="Cerrar" disabled={state.busy} onClick={close}>×</AppButton></header>
   <div className="commercial-body">
   {state.error&&<p className="error"><AppIcon name="status.error"/>{state.error}</p>}
   <form id="settlement-draft" data-dirty-managed onSubmit={e=>{e.preventDefault();const button=(e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null;if(button?.value==="finalize")void finalize();else void save();}}><fieldset className="commercial-fields" disabled={!state.canWrite||state.busy||!draft}>
    <label>Mensajero<SearchSelect required value={document.courier_id} onChange={e=>{setDocument({...document,courier_id:e.target.value});setChoices({});setDirty(true);}}><option value="">Seleccionar mensajero</option>{couriers.filter(c=>c.active||c.id===document.courier_id).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</SearchSelect></label>
    <label>Fecha del documento<input type="date" required value={document.settled_on} onChange={e=>{setDocument({...document,settled_on:e.target.value});setDirty(true);}}/></label>
    <details className="form-wide commercial-details"><summary>Observaciones del documento</summary><input aria-label="Observaciones del documento" maxLength={2000} value={document.notes} onChange={e=>{setDocument({...document,notes:e.target.value});setDirty(true);}}/></details>
   </fieldset>
   {draft?<>
    <div className="settlement-invoice-heading"><h3>Facturas disponibles <small>{chosen.length} de {eligible.length} seleccionadas</small></h3><label className="settlement-check"><input type="checkbox" disabled={!state.canWrite||state.busy||!eligible.length} checked={eligible.length>0&&chosen.length===eligible.length} onChange={e=>{const checked=e.target.checked;setChoices(old=>Object.fromEntries(eligible.map(p=>[p.order_id,{...(old[p.order_id]||emptyChoice()),selected:checked}])));setDirty(true);}}/> Seleccionar todos</label></div>
    <div className="commercial-invoices">{pending.map(p=>{
     const choice=choices[p.order_id]||emptyChoice(),reserved=!!p.reserved_id&&p.reserved_id!==document.id;
     const disabled=reserved||!state.canWrite||state.busy;
     const invoiceBalance=p.balance??(p.payment_method==="transfer"?null:p.expected_cash);
     return <article className="commercial-card" key={p.order_id}>
      <label className="settlement-check"><input aria-label={`Incluir pedido ${p.number}`} type="checkbox" disabled={disabled} checked={choice.selected} onChange={e=>choose(p.order_id,{selected:e.target.checked})}/> <strong>{p.customer}</strong></label>
      <div className="commercial-card-heading"><small>#{p.invoice_number||p.number}{p.zone?" · "+deliveryZoneLabel(p.zone):p.department?" · "+p.department:p.address?" · "+p.address.split(/[·,]/)[0].slice(0,44):""}</small><span className="commercial-chip">{p.needs_preparation?"Pendiente de preparar":"Preparada"}</span></div>
      {reserved&&<small>Reservada en {settlementNumber(p.reserved_number)}</small>}
      <dl className="commercial-metrics"><div><dt>Total</dt><dd>{money(p.invoice_total)}</dd></div><div><dt>Pagado a OHANA</dt><dd>{money(p.direct_paid??0)}</dd></div><div><dt>Pendiente</dt><dd><strong>{invoiceBalance==null?"Ver entrega":money(invoiceBalance)}</strong></dd></div></dl>
      <div className="commercial-card-heading"><small>Costo real del envío</small><strong>{money(p.shipping_cost)}</strong></div>
      {p.needs_preparation&&<button type="button" className="secondary" disabled={disabled} onClick={()=>setPreparing(p.order_id)}>Confirmar preparación</button>}
      {p.payment_method==="transfer"?<small>Transferencia · solo envío</small>:<>
       {Number(p.collected)>0&&<small>Efectivo ya registrado {money(p.collected)}</small>}
       {!p.needs_preparation&&Number(p.expected_cash)>0&&<div className="settlement-cash">
        <label className="settlement-check"><input type="checkbox" checked={choice.mark_collected} disabled={disabled||!choice.selected} onChange={e=>choose(p.order_id,{mark_collected:e.target.checked,extra_cash:e.target.checked?String(p.expected_cash):""})}/> Confirmar efectivo cobrado</label>
        {choice.mark_collected&&choice.selected&&<label>Importe cobrado<MoneyInput compact required min="0.01" disabled={disabled} value={choice.extra_cash} onChange={e=>choose(p.order_id,{extra_cash:e.target.value})}/></label>}
       </div>}
      </>}
      <InvoiceDelivery company={company} invoice={p}/>
     </article>;
    })}</div>
    {!pending.length&&<p>No hay pedidos disponibles para este mensajero.</p>}
   </>:<div className="table-wrap"><ResponsiveTable><thead><tr><th>Pedido</th><th>Fecha de entrega</th><th>Cliente</th><th>Concepto</th><th>Importe histórico</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>#{i.snapshot.number}</td><td>{i.snapshot.delivered_at?new Date(i.snapshot.delivered_at).toLocaleDateString("es-GT"):"—"}</td><td>{i.snapshot.customer}</td><td>{i.delivery_id?"Costo de envío":"Efectivo cobrado"}</td><td data-sort-value={i.amount}>{money(i.amount)}</td></tr>)}</tbody></ResponsiveTable></div>}
   </form>
   <section className="settlement-summary"><h3>Resumen · {invoiceCount} {invoiceCount===1?"factura":"facturas"}</h3><dl>
    <div><dt>Efectivo cobrado</dt><dd>{money(collected)}</dd></div><div><dt>Costo de envíos</dt><dd>{money(cost)}</dd></div>
    <div className="settlement-final"><dt>Resultado neto</dt><dd data-tone={settlementTone(net,document.state)}>{settlementResult(net,document.state)}</dd></div>
    {!draft&&document.state!=="cancelled"&&<><div><dt>Importe liquidado</dt><dd>{money(paidTotal)}</dd></div><div><dt>Saldo pendiente</dt><dd data-tone={settlementTone(remaining,document.state)}>{settlementResult(remaining,document.state)}</dd></div></>}
   </dl>{document.courier_id&&<p className="muted">Saldo acumulado de {courierName} · {courierBalanceText(balance,courierName)}</p>}</section>
   {canSave&&<fieldset form="settlement-draft" className="commercial-fields settlement-exchange" disabled={state.busy}>
    <div className="form-wide"><strong data-tone={settlementTone(net,"draft")}>{net>0?`OHANA recibe de ${courierName}`:net<0?`OHANA paga a ${courierName}`:"Sin intercambio de dinero"} · {money(Math.abs(net))}</strong></div>
    <label>{net>0?"Importe recibido":net<0?"Importe pagado":"Importe del intercambio"}<MoneyInput compact readOnly value={Math.abs(net).toFixed(2)}/></label>
    <label>Fecha del intercambio<input type="date" max={today()} value={exchange.exchange_date} onChange={e=>editExchange("exchange_date",e.target.value)}/></label>
    <div role="group" aria-label="Método del intercambio" className="commercial-toggle form-wide">
     {[["cash","Efectivo"],["transfer","Transferencia"]].map(([method,label])=><button key={method} type="button" className="secondary" aria-pressed={exchange.method===method} onClick={()=>editExchange("method",method)}>{label}</button>)}
    </div>
    <details className="form-wide commercial-details"><summary>Observaciones del intercambio</summary><input aria-label="Observaciones del intercambio" maxLength={2000} value={exchange.exchange_notes} onChange={e=>editExchange("exchange_notes",e.target.value)}/></details>
   </fieldset>}
   {canSave&&validation&&<p role="status">{validation}</p>}
   {paying&&state.canWrite&&<form id="settlement-final-payment" onSubmit={e=>{e.preventDefault();void confirm();}}><fieldset className="commercial-fields" disabled={state.busy}>
    <legend>Registrar pago</legend><p className="form-wide settlement-balance">{courierBalanceText(remaining,courierName)}</p>
    <label>Importe realmente pagado<MoneyInput compact required min="0.01" max={Math.abs(remaining)} value={exchange.actual_amount} onChange={e=>editExchange("actual_amount",e.target.value)}/></label>
    <label>Método<SearchSelect value={exchange.method} onChange={e=>editExchange("method",e.target.value)}><option value="cash">Efectivo</option><option value="transfer">Transferencia bancaria</option></SearchSelect></label>
    <label>Fecha<input required type="date" max={today()} value={exchange.exchange_date} onChange={e=>editExchange("exchange_date",e.target.value)}/></label>
    <label>Observaciones · opcional<input maxLength={2000} value={exchange.exchange_notes} onChange={e=>editExchange("exchange_notes",e.target.value)}/></label>
   </fieldset></form>}
   {!draft&&<><h3>Historial de pagos</h3><div className="table-wrap"><ResponsiveTable><thead><tr><th>Fecha</th><th>Importe</th><th>Método</th><th>Observaciones</th><th>Estado</th></tr></thead><tbody>{payments.map(p=><tr key={p.id}><td>{p.occurred_on}</td><td data-sort-value={Math.abs(Number(p.signed_amount))}>{money(Math.abs(Number(p.signed_amount)))}</td><td>{p.method==="cash"?"Efectivo":p.method==="transfer"?"Transferencia":"No registrado"}</td><td>{p.notes||"—"}</td><td>{p.reversed?"Revertido":"Registrado"}</td></tr>)}</tbody></ResponsiveTable></div>{!payments.length&&<p>Sin pagos registrados.</p>}{document.state==="cancelled"&&<p>Liquidación anulada; se conserva su historial.</p>}</>}
   {document.id&&document.state!=="cancelled"&&state.canWrite&&<div className="form-actions"><AppButton className="secondary settlement-annul" disabled={state.busy} onClick={()=>{setCancelling(true);setReason("");}}>Anular liquidación</AppButton></div>}
   {cancelling&&<form onSubmit={e=>{e.preventDefault();void state.run(async()=>{if(!(await confirmAction("¿Anular esta liquidación? Se revertirán sus movimientos y cobros generados; se conservará el historial. Si existen compensaciones posteriores, primero deberás revertirlas. No se realizan devoluciones bancarias automáticamente.")))return;await keyedRequest(company,"courier_operations",{id:document.id,reason},"settlement_cancel");setDetail(await courierRead(company,"settlement",{id:document.id}));setCancelling(false);setExchangeDirty(false);await load();});}}><label>Motivo<input required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="form-actions"><AppButton disabled={state.busy}>Confirmar anulación</AppButton><AppButton type="button" className="secondary" onClick={()=>setCancelling(false)}>Cancelar</AppButton></div></form>}
   {document.cancel_reason&&<p>Motivo: {document.cancel_reason}</p>}
   </div>
   {(canSave||canSettle||(paying&&state.canWrite))&&<footer className="commercial-footer">
    {paying&&state.canWrite&&<><AppButton type="button" className="secondary" disabled={state.busy} onClick={()=>{setPaying(false);setExchangeDirty(false);}}>Cancelar</AppButton><AppButton type="submit" form="settlement-final-payment" disabled={dirty||state.busy}>Guardar pago</AppButton></>}
    {canSave&&<><AppButton className="secondary" type="submit" form="settlement-draft" disabled={state.busy||!chosen.length}>Guardar borrador</AppButton>
     <AppButton type="submit" form="settlement-draft" value="finalize" disabled={state.busy||!!validation}>Liquidar{net!==0?" "+money(Math.abs(net)):""}</AppButton></>}
    {canSettle&&<AppButton disabled={disabledSettle} onClick={beginPayment}>Registrar pago</AppButton>}
   </footer>}
  </section></div>}
  {account&&<CourierAccountDialog company={company} courier={account} onClose={()=>setAccount(null)} onSaved={load}/>}
 {preparing&&<OrderPreparationDialog finishOnly company={company} orderId={preparing} onClose={()=>setPreparing(null)} onSaved={async()=>{
   if(document?.courier_id)setPending(await courierRead(company,"pending",{courier:document.courier_id}));
 }}/>}
 </>;
}
