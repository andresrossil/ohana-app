import { useEffect, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import SearchSelect from "./SearchSelect";
import ResponsiveTable from "./ResponsiveTable";
import MoneyInput from "./MoneyInput";
import { confirmAction } from "./ConfirmDialog";
import { courierRead } from "./delivery-model";
import { keyedRequest, money, today, useOperation, type Row } from "./operations";
import { courierBalanceClass, courierBalanceText, settlementNumber } from "./courier-account";
import CourierAccountDialog from "./CourierAccountDialog";
import "./couriers.css";

const states:Row={draft:"Borrador",pending:"Pendiente",partial:"Parcial",settled:"Saldada",cancelled:"Anulada"};
type Choice={selected:boolean;mark_collected:boolean;extra_cash:string};
const emptyChoice=():Choice=>({selected:false,mark_collected:false,extra_cash:""});
const blankExchange=()=>({actual_amount:"0",direction:"received",method:"cash",exchange_date:today(),exchange_notes:""});
export default function CourierSettlements({company,onDirty}:{company:string;onDirty:(dirty:boolean)=>void}){
 const state=useOperation(company,"sales");
 const [history,setHistory]=useState<Row[]>([]),[couriers,setCouriers]=useState<Row[]>([]),[filters,setFilters]=useState({courier:"",state:"",from:"",to:""});
 const [document,setDocument]=useState<Row|null>(null),[items,setItems]=useState<Row[]>([]),[payments,setPayments]=useState<Row[]>([]),[paying,setPaying]=useState(false),[pending,setPending]=useState<Row[]>([]),[choices,setChoices]=useState<Record<string,Choice>>({});
 const [balance,setBalance]=useState(0),[dirty,setDirty]=useState(false),[exchangeDirty,setExchangeDirty]=useState(false),[exchange,setExchange]=useState(blankExchange);
 const [account,setAccount]=useState<Row|null>(null),[cancelling,setCancelling]=useState(false),[reason,setReason]=useState("");
 const load=async()=>{const [h,o]=await Promise.all([courierRead(company,"settlements",filters),courierRead(company,"options")]);setHistory(h);setCouriers(o.couriers);};
 useEffect(()=>{let live=true;void state.run(async()=>{const [h,o]=await Promise.all([courierRead(company,"settlements",filters),courierRead(company,"options")]);if(live){setHistory(h);setCouriers(o.couriers);}});return()=>{live=false;};},[company,filters]);
 useEffect(()=>{onDirty(dirty||exchangeDirty||cancelling);return()=>onDirty(false);},[dirty,exchangeDirty,cancelling,onDirty]);
 useEffect(()=>{let live=true;setPending([]);setBalance(0);if(!document?.courier_id)return;
  Promise.all([courierRead(company,"account",{courier:document.courier_id}),document.state==="draft"?courierRead(company,"pending",{courier:document.courier_id}):Promise.resolve([])])
   .then(([a,p])=>{if(live){setBalance(Number(a.balance));setPending(p);}}).catch(e=>{if(live)state.setError(e.message);});return()=>{live=false;};
 },[company,document?.courier_id,document?.id,document?.state,document?.revision]);
 const setDetail=(d:Row)=>{setDocument(d.document);setItems(d.items);setPayments(d.payments||[]);setBalance(Number(d.balance));const next:Record<string,Choice>={};for(const i of d.items){const previous=next[i.order_id]||emptyChoice();const extra=i.collection_pending||i.snapshot.recorded_receipt===false;next[i.order_id]={selected:true,mark_collected:previous.mark_collected||extra,extra_cash:String(Number(previous.extra_cash||0)+(extra?Number(i.amount):0))};}setChoices(next);setDirty(false);};
 const open=(id?:string)=>state.run(async()=>{setExchange(blankExchange());setExchangeDirty(false);setPaying(false);setCancelling(false);setReason("");if(id){const d=await courierRead(company,"settlement",{id});setDetail(d);if(d.document.state!=="draft")setExchange({actual_amount:String(d.document.actual_amount??0),direction:d.document.exchange_direction||"received",method:d.document.exchange_method||"cash",exchange_date:d.document.exchanged_on||d.document.settled_on,exchange_notes:d.document.exchange_notes||""});}
  else{setDocument({courier_id:filters.courier,settled_on:today(),state:"draft",notes:""});setChoices({});setItems([]);setPayments([]);setDirty(false);}});
 const close=async()=>{if(state.busy)return;if((dirty||exchangeDirty||cancelling)&&!(await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?")))return;setDocument(null);setPaying(false);setDirty(false);setExchangeDirty(false);setCancelling(false);};
 useEffect(()=>{if(document?.state!=="draft")return;const transfers=new Set(pending.filter(p=>p.payment_method==="transfer").map(p=>p.order_id));if(items.some(i=>transfers.has(i.order_id)&&(i.payment_id||i.collection_pending)))setDirty(true);},[pending,items,document?.state]);
 const eligible=pending.filter(p=>!p.reserved_id||p.reserved_id===document?.id);
 const chosen=eligible.filter(p=>choices[p.order_id]?.selected);
 const draft=document?.state==="draft";
 const preview=draft&&(!document?.id||dirty);
 const collected=preview?chosen.reduce((sum,p)=>sum+(p.payment_method==="transfer"?0:Number(p.collected)+(choices[p.order_id]?.mark_collected?Number(choices[p.order_id].extra_cash||0):0)),0):Number(document?.collected||0);
 const cost=preview?chosen.reduce((sum,p)=>sum+Number(p.shipping_cost),0):Number(document?.shipping_cost||0),net=collected-cost;
 const remaining=draft?net:Number(document?.remaining||0),paidTotal=draft?0:Number(document?.paid_total||0);


 const courierName=couriers.find(c=>c.id===document?.courier_id)?.name||"el mensajero";
 const choose=(id:string,patch:Partial<Choice>)=>{setChoices(old=>({...old,[id]:{...(old[id]||emptyChoice()),...patch}}));setDirty(true);};
 const editExchange=(key:string,value:string)=>{setExchange(old=>({...old,[key]:value}));setExchangeDirty(true);};
 const save=()=>state.run(async()=>{if(!document)return;const differences=chosen.filter(p=>p.payment_method!=="transfer"&&choices[p.order_id].mark_collected&&Math.round(Number(choices[p.order_id].extra_cash||0)*100)!==Math.round(Number(p.expected_cash)*100));if(differences.length&&!(await confirmAction(differences.map(p=>`Pedido #${p.number} · ${p.customer}\nTotal de factura: ${money(p.invoice_total)} · Pendiente: ${money(p.expected_cash)}\nEfectivo adicional cobrado: ${money(choices[p.order_id].extra_cash)}\nDiferencia: ${money(Math.abs(Number(choices[p.order_id].extra_cash||0)-Number(p.expected_cash)))} (${Number(choices[p.order_id].extra_cash||0)>Number(p.expected_cash)?"excedente a favor":"faltante por pagar"})`).join("\n\n")+"\n¿Son correctos estos cobros?",{title:"Revisar efectivo cobrado",confirmText:"Sí, guardar cobros"})))return;const saved=await keyedRequest(company,"courier_operations",{id:document.id,courier:document.courier_id,date:document.settled_on,notes:document.notes,expected_revision:document.revision,cash_discrepancies_confirmed:differences.length>0,orders:chosen.map(p=>({order:p.order_id,mark_collected:p.payment_method!=="transfer"&&choices[p.order_id].mark_collected,extra_cash:p.payment_method==="transfer"?"0":choices[p.order_id].extra_cash||"0"}))},"settlement_save");setDetail(await courierRead(company,"settlement",{id:saved.id}));await load();});
 const beginPayment=()=>{setExchange({...blankExchange(),actual_amount:String(Math.abs(remaining)),direction:remaining>=0?"received":"paid"});setExchangeDirty(false);setPaying(true);};
 const confirm=()=>state.run(async()=>{if(!document)return;const amount=Number(exchange.actual_amount||0),left=Math.abs(remaining)-amount;
  if(amount<0||left<0||(!draft&&amount===0))throw Error("El pago no puede superar el saldo pendiente.");
  if(!(await confirmAction(`${courierBalanceText(remaining,courierName)}.\nImporte pagado: ${money(amount)}.\nSaldo pendiente después del pago: ${money(left)}.\n¿${draft?"Liquidar el documento":"Registrar este pago"}?`)))return;
  await keyedRequest(company,"courier_operations",draft?{id:document.id,...exchange,expected_revision:document.revision}:{id:document.id,amount:exchange.actual_amount,method:exchange.method,date:exchange.exchange_date,notes:exchange.exchange_notes,expected_revision:document.revision,expected_remaining:remaining},draft?"settlement_confirm":"settlement_payment");
  setDetail(await courierRead(company,"settlement",{id:document.id}));setPaying(false);setExchangeDirty(false);setExchange(blankExchange());await load();
 });
 return <>
  <section className="intro"><div><h1><AppIcon name="module.settlements"/> Liquidaciones de mensajería</h1><p>Cobros, envíos e intercambios de dinero con cada mensajero.</p></div><div className="actions">{state.canWrite&&<AppButton disabled={state.busy} onClick={()=>open()}>Nueva liquidación</AppButton>}<AppButton className="secondary" disabled={state.busy} onClick={()=>state.run(load)}>Actualizar</AppButton></div></section>
  {!document&&state.error&&<p className="error"><AppIcon name="status.error"/>{state.error}</p>}
  <section className="catalog"><div className="settlement-filters settings-grid">
   <label>Mensajero<SearchSelect value={filters.courier} onChange={e=>setFilters({...filters,courier:e.target.value})}><option value="">Todos los mensajeros</option>{couriers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</SearchSelect></label>
   <label>Estado<SearchSelect value={filters.state} onChange={e=>setFilters({...filters,state:e.target.value})}><option value="">Todos los estados</option>{Object.entries(states).map(([k,v])=><option key={k} value={k}>{v}</option>)}</SearchSelect></label>
   <label>Desde<input type="date" value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/></label><label>Hasta<input type="date" min={filters.from||undefined} value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})}/></label>
   <div className="form-actions form-wide"><AppButton className="secondary" disabled={!filters.courier} onClick={()=>setAccount(couriers.find(c=>c.id===filters.courier)||null)}>Ver cuenta del mensajero</AppButton><AppButton className="secondary" onClick={()=>setFilters({courier:"",state:"",from:"",to:""})}>Limpiar filtros</AppButton></div>
  </div><div className="table-wrap"><ResponsiveTable><thead><tr><th>Número</th><th>Fecha</th><th>Mensajero</th><th>Pedidos</th><th>Efectivo cobrado</th><th>Costo de envíos</th><th>Resultado</th><th>Pagado</th><th>Saldo pendiente</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{history.map(s=><tr key={s.id}><td data-sort-value={s.number}>{settlementNumber(s.number)}</td><td>{s.settled_on}</td><td>{s.courier_name}</td><td data-sort-value={s.order_count}>{s.order_count}</td><td data-sort-value={s.collected}>{money(s.collected)}</td><td data-sort-value={s.shipping_cost}>{money(s.shipping_cost)}</td><td data-sort-value={s.net}>{courierBalanceText(Number(s.net),s.courier_name)}</td><td data-sort-value={s.paid_total}>{money(s.paid_total)}</td><td data-sort-value={s.remaining}>{courierBalanceText(Number(s.remaining),s.courier_name)}</td><td>{states[s.state]}</td><td><AppButton className="secondary" onClick={()=>open(s.id)}>Ver</AppButton></td></tr>)}</tbody></ResponsiveTable></div>{!history.length&&<p className="empty">No hay liquidaciones para estos filtros.</p>}</section>
  {document&&<div className="overlay"><section className="modal courier-dialog settlement-dialog" role="dialog" aria-modal="true" aria-label="Liquidación de mensajería" data-navigation-dirty={dirty||exchangeDirty||cancelling}>
   <header className="hierarchy-toolbar"><h2>{document.number?settlementNumber(document.number):"Nueva liquidación"} · {states[document.state]}</h2><AppButton className="secondary" disabled={state.busy} onClick={close}>Cerrar</AppButton></header>
   {state.error&&<p className="error"><AppIcon name="status.error"/>{state.error}</p>}
   <form data-dirty-managed onSubmit={e=>{e.preventDefault();void save();}}><fieldset className="settings-grid" disabled={!state.canWrite||state.busy||!draft}>
    <label>Mensajero<SearchSelect required value={document.courier_id} onChange={e=>{setDocument({...document,courier_id:e.target.value});setChoices({});setDirty(true);}}><option value="">Seleccionar mensajero</option>{couriers.filter(c=>c.active||c.id===document.courier_id).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</SearchSelect></label>
    <label>Fecha de liquidación<input type="date" required value={document.settled_on} onChange={e=>{setDocument({...document,settled_on:e.target.value});setDirty(true);}}/></label>
    <label className="form-wide">Observaciones · opcional<input maxLength={2000} value={document.notes} onChange={e=>{setDocument({...document,notes:e.target.value});setDirty(true);}}/></label>
   </fieldset>
   {draft?<>
    <div className="hierarchy-toolbar"><h3>Pedidos entregados pendientes de liquidar</h3><label className="settlement-check"><input type="checkbox" disabled={!state.canWrite||state.busy||!eligible.length} checked={eligible.length>0&&chosen.length===eligible.length} onChange={e=>{const checked=e.target.checked;setChoices(old=>Object.fromEntries(eligible.map(p=>[p.order_id,{...(old[p.order_id]||emptyChoice()),selected:checked}])));setDirty(true);}}/> Seleccionar todos</label></div>
    <p>Marca el efectivo que realmente cobró el mensajero. El saldo pendiente de una factura no se considera cobrado automáticamente.</p>
    <div className="table-wrap"><ResponsiveTable><thead><tr><th>Seleccionar</th><th>Pedido</th><th>Fecha de entrega</th><th>Cliente</th><th>Efectivo cobrado</th><th>Costo real del envío</th></tr></thead><tbody>{pending.map(p=>{const choice=choices[p.order_id]||emptyChoice(),reserved=!!p.reserved_id&&p.reserved_id!==document.id;return <tr key={p.order_id}>
     <td data-sort-value={choice.selected?1:0}><input aria-label={`Incluir pedido ${p.number}`} type="checkbox" disabled={reserved||!state.canWrite||state.busy} checked={choice.selected} onChange={e=>choose(p.order_id,{selected:e.target.checked})}/></td><td data-sort-value={p.number}>#{p.number}{reserved&&<small>Reservada en {settlementNumber(p.reserved_number)}</small>}</td><td data-sort-value={p.delivered_at}>{new Date(p.delivered_at).toLocaleDateString("es-GT")}</td><td>{p.customer}</td>
     <td data-sort-value={p.payment_method==="transfer"?0:Number(p.collected)+(choice.mark_collected?Number(choice.extra_cash||0):0)}>{p.payment_method==="transfer"?<small>Transferencia · solo envío</small>:<><strong>{money(Number(p.collected)+(choice.mark_collected?Number(choice.extra_cash||0):0))}</strong>{Number(p.collected)>0&&<small>Ya registrado en Ventas: {money(p.collected)}</small>}
      {Number(p.expected_cash)>0&&<><label className="settlement-check"><input type="checkbox" checked={choice.mark_collected} disabled={!choice.selected||!state.canWrite||state.busy} onChange={e=>choose(p.order_id,{mark_collected:e.target.checked,extra_cash:e.target.checked?String(p.expected_cash):""})}/> Confirmar efectivo recibido</label><MoneyInput aria-label={`Efectivo adicional cobrado del pedido ${p.number}`} required={choice.mark_collected&&choice.selected} min="0.01" disabled={!choice.mark_collected||!choice.selected||!state.canWrite||state.busy} value={choice.extra_cash} onChange={e=>choose(p.order_id,{extra_cash:e.target.value})}/><p className="settlement-invoice-balance">Pendiente de la factura: {money(p.expected_cash)}</p></>}
     </>}</td><td data-sort-value={p.shipping_cost}>{money(p.shipping_cost)}</td>
    </tr>;})}</tbody></ResponsiveTable></div>
    {!pending.length&&<p>No hay pedidos disponibles para este mensajero.</p>}
    {state.canWrite&&<div className="form-actions"><AppButton disabled={state.busy||!chosen.length}>Guardar borrador</AppButton></div>}
   </>:<div className="table-wrap"><ResponsiveTable><thead><tr><th>Pedido</th><th>Fecha de entrega</th><th>Cliente</th><th>Concepto</th><th>Importe histórico</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>#{i.snapshot.number}</td><td>{i.snapshot.delivered_at?new Date(i.snapshot.delivered_at).toLocaleDateString("es-GT"):"—"}</td><td>{i.snapshot.customer}</td><td>{i.delivery_id?"Costo de envío":"Efectivo cobrado"}</td><td data-sort-value={i.amount}>{money(i.amount)}</td></tr>)}</tbody></ResponsiveTable></div>}
   </form>
   <section className="settlement-summary"><h3>Resumen</h3><dl>
    <div><dt>Efectivo cobrado por el mensajero</dt><dd>{money(collected)}</dd></div><div><dt>Costo de envíos</dt><dd>{money(cost)}</dd></div>
    <div className="settlement-final"><dt>{draft?"Resultado":"Importe original"}</dt><dd>{courierBalanceText(net,courierName)}</dd></div>
    {!draft&&document.state!=="cancelled"&&<><div><dt>Importe pagado</dt><dd>{money(paidTotal)}</dd></div><div className="settlement-final"><dt>Saldo pendiente</dt><dd className={courierBalanceClass(remaining)}>{courierBalanceText(remaining,courierName)}</dd></div></>}
   </dl></section>
   <p className="muted">Saldo acumulado de {courierName}: {courierBalanceText(balance,courierName)}</p>
   {state.canWrite&&document.id&&!paying&&document.state!=="cancelled"&&(draft||Math.abs(remaining)>0)&&<div className="form-actions"><AppButton disabled={state.busy||dirty} onClick={beginPayment}>{draft?"Liquidar":"Registrar pago"}</AppButton>{dirty&&<span>Guarda primero el borrador.</span>}</div>}
   {paying&&state.canWrite&&<form onSubmit={e=>{e.preventDefault();void confirm();}}><fieldset className="settings-grid" disabled={state.busy}>
    <legend>{draft?"Liquidar":"Registrar pago"}</legend><p className="form-wide settlement-balance">{courierBalanceText(remaining,courierName)}</p>
    <label>Importe realmente pagado<MoneyInput required min={draft?"0":"0.01"} max={Math.abs(remaining)} value={exchange.actual_amount} onChange={e=>editExchange("actual_amount",e.target.value)}/></label>
    <label>Método<SearchSelect value={exchange.method} onChange={e=>editExchange("method",e.target.value)}><option value="cash">Efectivo</option><option value="transfer">Transferencia bancaria</option></SearchSelect></label>
    <label>Fecha<input required type="date" max={today()} value={exchange.exchange_date} onChange={e=>editExchange("exchange_date",e.target.value)}/></label>
    <label>Observaciones · opcional<input maxLength={2000} value={exchange.exchange_notes} onChange={e=>editExchange("exchange_notes",e.target.value)}/></label>
    <div className="form-actions form-wide"><AppButton disabled={dirty}>{draft?"Confirmar liquidación":"Guardar pago"}</AppButton><AppButton type="button" className="secondary" onClick={()=>{setPaying(false);setExchangeDirty(false);}}>Cancelar</AppButton></div>
   </fieldset></form>}
   {!draft&&<><h3>Historial de pagos</h3><div className="table-wrap"><ResponsiveTable><thead><tr><th>Fecha</th><th>Importe</th><th>Método</th><th>Observaciones</th><th>Estado</th></tr></thead><tbody>{payments.map(p=><tr key={p.id}><td>{p.occurred_on}</td><td data-sort-value={Math.abs(Number(p.signed_amount))}>{money(Math.abs(Number(p.signed_amount)))}</td><td>{p.method==="cash"?"Efectivo":p.method==="transfer"?"Transferencia":"No registrado"}</td><td>{p.notes||"—"}</td><td>{p.reversed?"Revertido":"Registrado"}</td></tr>)}</tbody></ResponsiveTable></div>{!payments.length&&<p>Sin pagos registrados.</p>}{document.state==="cancelled"&&<p>Liquidación anulada; se conserva su historial.</p>}</>}
   {document.id&&document.state!=="cancelled"&&state.canWrite&&<div className="form-actions"><AppButton className="danger" disabled={state.busy} onClick={()=>{setCancelling(true);setReason("");}}>Anular liquidación</AppButton></div>}
   {cancelling&&<form onSubmit={e=>{e.preventDefault();void state.run(async()=>{if(!(await confirmAction("¿Anular esta liquidación? Se revertirán sus movimientos y cobros generados; se conservará el historial. Si existen compensaciones posteriores, primero deberás revertirlas. No se realizan devoluciones bancarias automáticamente.")))return;await keyedRequest(company,"courier_operations",{id:document.id,reason},"settlement_cancel");setDetail(await courierRead(company,"settlement",{id:document.id}));setCancelling(false);setExchangeDirty(false);await load();});}}><label>Motivo<input required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="form-actions"><AppButton disabled={state.busy}>Confirmar anulación</AppButton><AppButton type="button" className="secondary" onClick={()=>setCancelling(false)}>Cancelar</AppButton></div></form>}
   {document.cancel_reason&&<p>Motivo: {document.cancel_reason}</p>}
  </section></div>}
  {account&&<CourierAccountDialog company={company} courier={account} onClose={()=>setAccount(null)} onSaved={load}/>}
 </>;
}
