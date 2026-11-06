import { useCallback, useEffect, useState } from "react";
import BusinessPartners from "./BusinessPartners";
import { AppButton, AppIcon } from "./AppIcon";
import SearchSelect from "./SearchSelect";
import ResponsiveTable from "./ResponsiveTable";
import MoneyInput from "./MoneyInput";
import { confirmAction } from "./ConfirmDialog";
import { courierRead, deliveryStatus, tariffDestinations, tariffModes } from "./delivery-model";
import { keyedRequest, money, today, useOperation, type Row } from "./operations";
import "./couriers.css";

function Tariffs({company,courier,canManage,onClose}:{company:string;courier:Row;canManage:boolean;onClose:()=>void}){
 const state=useOperation(company,"sales");
 const [all,setAll]=useState<Row[]>([]),[mode,setMode]=useState("general"),[rows,setRows]=useState<Row[]>([]),[dirty,setDirty]=useState(false),[ready,setReady]=useState(false);
 function choose(value:string,source:Row[]){setMode(value);setRows(tariffDestinations(value).map(destination=>source.find(t=>t.mode===value&&t.destination===destination)||{destination,amount:"",available:false}));}
 useEffect(()=>{void state.run(async()=>{const d=await courierRead(company,"tariffs",{courier:courier.id});setAll(d.rows);choose(d.courier.courier_tariff_mode,d.rows);setReady(true);});},[company,courier.id]);
 const close=async()=>{if(state.busy)return;if(dirty&&!(await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?")))return;onClose();};
 return <div className="overlay"><section className="modal courier-dialog" role="dialog" aria-modal="true" aria-label="Tarifas de mensajería" data-navigation-dirty={dirty}>
  <header className="hierarchy-toolbar"><h2>Tarifas · {courier.name}</h2><AppButton className="secondary" disabled={state.busy} onClick={close}>Cerrar</AppButton></header>
  {state.error&&<p className="error" role="alert"><AppIcon name="status.error"/>{state.error}</p>}{state.notice&&<p role="status">{state.notice}</p>}
  <p>Una sola modalidad activa. Los importes son GTQ y deben capturarse manualmente. Las otras modalidades guardadas se conservan.</p>
  {ready&&<form data-dirty-managed aria-busy={state.busy} onSubmit={e=>{e.preventDefault();void state.run(async()=>{await keyedRequest(company,"courier_operations",{courier:courier.id,mode,rows},"tariffs_save");const d=await courierRead(company,"tariffs",{courier:courier.id});setAll(d.rows);choose(mode,d.rows);setDirty(false);state.setNotice("Tarifas guardadas. Los pedidos anteriores conservan sus importes.");});}}><fieldset disabled={!canManage||state.busy}>
   <label>Modalidad activa<SearchSelect value={mode} onChange={async e=>{const v=e.target.value;if(!(await confirmAction(dirty?"¿Cambiar de modalidad? Se conservarán las tarifas guardadas; se descartarán las ediciones sin guardar de esta tabla.":"¿Cambiar la modalidad activa? Las tarifas anteriores se conservarán y los pedidos existentes no cambiarán.")))return;choose(v,all);setDirty(true);}}>{Object.entries(tariffModes).map(([key,label])=><option value={key} key={key}>{label}</option>)}</SearchSelect></label>
   <div className="table-wrap"><ResponsiveTable><thead><tr><th>Destino</th><th>Tarifa GTQ</th><th>Disponible</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.destination}><td>{mode==="general"?"Todas las entregas":mode==="zone"?`Zona ${r.destination}`:r.destination}</td><td data-sort-value={r.amount}><MoneyInput currency="GTQ" min="0" required={r.available} value={r.amount??""} onChange={e=>{setRows(old=>old.map((x,j)=>j===i?{...x,amount:e.target.value}:x));setDirty(true);}}/></td><td><input aria-label={`Disponible ${r.destination}`} type="checkbox" checked={r.available} onChange={e=>{setRows(old=>old.map((x,j)=>j===i?{...x,available:e.target.checked}:x));setDirty(true);}}/></td></tr>)}</tbody></ResponsiveTable></div>
   <div className="form-actions"><AppButton disabled={!dirty}>Guardar tarifas</AppButton></div>
  </fieldset></form>}
 </section></div>;
}

function Settlements({company}:{company:string}){
 const state=useOperation(company,"sales");
 const [history,setHistory]=useState<Row[]>([]),[couriers,setCouriers]=useState<Row[]>([]),[document,setDocument]=useState<Row|null>(null),[items,setItems]=useState<Row[]>([]),[pending,setPending]=useState<Row[]>([]),[selected,setSelected]=useState<string[]>([]),[dirty,setDirty]=useState(false),[actual,setActual]=useState(""),[reason,setReason]=useState(""),[cancelling,setCancelling]=useState(false);
 async function load(){const [h,o]=await Promise.all([courierRead(company,"settlements"),courierRead(company,"options")]);setHistory(h);setCouriers(o.couriers);}
 useEffect(()=>{void state.run(load);},[company]);
 useEffect(()=>{let live=true;setPending([]);if(!document?.courier_id||document.state!=="draft")return;courierRead(company,"pending",{courier:document.courier_id}).then(r=>{if(live)setPending(r);}).catch(e=>{if(live)state.setError(e.message);});return()=>{live=false;};},[company,document?.courier_id,document?.state,document?.id]);
 const titleState:Row={draft:"Borrador",confirmed:"Confirmada",cancelled:"Anulada"};
 const chosen=pending.filter(p=>selected.includes(p.order_id));
 const collected=document?.state==="draft"?chosen.reduce((s,p)=>s+Number(p.collected),0):Number(document?.collected||0);
 const cost=document?.state==="draft"?chosen.reduce((s,p)=>s+Number(p.shipping_cost),0):Number(document?.shipping_cost||0);
 const net=collected-cost;
 async function open(id?:string){await state.run(async()=>{setActual("");setReason("");setCancelling(false);if(id){const d=await courierRead(company,"settlement",{id});setDocument(d.document);setItems(d.items);setSelected([...new Set<string>(d.items.map((i:Row)=>i.order_id))]);}else{setDocument({courier_id:"",settled_on:today(),state:"draft",notes:""});setItems([]);setSelected([]);}setDirty(false);});}
 const close=async()=>{if(state.busy)return;if((dirty||actual!==""||cancelling)&&!(await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?")))return;setDocument(null);};
 async function save(){if(!document)return;await state.run(async()=>{const r=await keyedRequest(company,"courier_operations",{id:document.id,courier:document.courier_id,date:document.settled_on,notes:document.notes,orders:selected},"settlement_save");const d=await courierRead(company,"settlement",{id:r.id});setDocument(d.document);setItems(d.items);setDirty(false);await load();});}
 return <section className="catalog"><div className="hierarchy-toolbar"><h2>Liquidaciones de mensajería</h2>{state.canWrite&&<AppButton disabled={state.busy} onClick={()=>open()}>Nueva liquidación</AppButton>}</div>
  {!document&&state.error&&<p className="error">{state.error}</p>}
  <p>Selecciona entregas de distintas fechas cuando corresponda. Una liquidación intercambia dinero; no genera otra venta ni duplica el gasto de envío.</p>
  <div className="table-wrap"><ResponsiveTable><thead><tr><th>Número</th><th>Mensajería</th><th>Fecha</th><th>Cobrado</th><th>Envíos</th><th>Saldo</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{history.map(s=><tr key={s.id}><td>LIQ-{s.number}</td><td>{s.courier_name}</td><td>{s.settled_on}</td><td data-sort-value={s.collected}>{money(s.collected)}</td><td data-sort-value={s.shipping_cost}>{money(s.shipping_cost)}</td><td data-sort-value={s.net}>{money(s.net)}</td><td>{titleState[s.state]}</td><td><AppButton className="secondary" disabled={state.busy} onClick={()=>open(s.id)}>Ver</AppButton></td></tr>)}</tbody></ResponsiveTable></div>
  {document&&<div className="overlay"><section className="modal courier-dialog" role="dialog" aria-modal="true" aria-label="Liquidación de mensajería" data-navigation-dirty={dirty||actual!==""||cancelling}>
   <header className="hierarchy-toolbar"><h2>{document.number?`LIQ-${document.number}`:"Nueva liquidación"} · {titleState[document.state]}</h2><AppButton className="secondary" disabled={state.busy} onClick={close}>Cerrar</AppButton></header>
   {state.error&&<p className="error" role="alert"><AppIcon name="status.error"/>{state.error}</p>}
   <form data-dirty-managed aria-busy={state.busy} onSubmit={e=>{e.preventDefault();void save();}}><fieldset className="settings-grid" disabled={!state.canWrite||state.busy||document.state!=="draft"}>
    <label>Mensajería<SearchSelect required value={document.courier_id} onChange={e=>{setDocument({...document,courier_id:e.target.value});setSelected([]);setDirty(true);}}><option value="">Seleccionar mensajería</option>{couriers.filter(c=>c.active||c.id===document.courier_id).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</SearchSelect></label>
    <label>Fecha de liquidación<input required type="date" value={document.settled_on} onChange={e=>{setDocument({...document,settled_on:e.target.value});setDirty(true);}}/></label>
    <label className="form-wide">Observaciones<input maxLength={2000} value={document.notes} onChange={e=>{setDocument({...document,notes:e.target.value});setDirty(true);}}/></label>
   </fieldset>
   {document.state==="draft"?<>
    <h3>Entregas pendientes de liquidar</h3>
    <div className="table-wrap"><ResponsiveTable><thead><tr><th>Seleccionar</th><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Efectivo cobrado</th><th>Costo de envío</th><th>Estado de entrega</th></tr></thead><tbody>{pending.map(p=><tr key={p.order_id}><td><input aria-label={`Incluir pedido ${p.number}`} disabled={!state.canWrite||state.busy} type="checkbox" checked={selected.includes(p.order_id)} onChange={e=>{setSelected(old=>e.target.checked?[...old,p.order_id]:old.filter(x=>x!==p.order_id));setDirty(true);}}/></td><td>#{p.number}</td><td>{new Date(p.created_at).toLocaleDateString("es-GT")}</td><td>{p.customer}</td><td data-sort-value={p.collected}>{money(p.collected)}</td><td data-sort-value={p.shipping_cost}>{money(p.shipping_cost)}</td><td>{deliveryStatus[p.status]}</td></tr>)}</tbody></ResponsiveTable></div>
    {!pending.length&&<p>Sin entregas pendientes para esta mensajería.</p>}
    {state.canWrite&&<div className="form-actions"><AppButton disabled={state.busy||!selected.length}>Guardar borrador</AppButton></div>}
   </>:<div className="table-wrap"><ResponsiveTable><thead><tr><th>Pedido</th><th>Cliente</th><th>Concepto</th><th>Importe histórico</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>#{i.snapshot.number}</td><td>{i.snapshot.customer}</td><td>{i.payment_id?"Efectivo cobrado":"Costo de envío"}</td><td data-sort-value={i.amount}>{money(i.amount)}</td></tr>)}</tbody></ResponsiveTable></div>}
   </form>
   <div className="delivery-summary"><span>Cobrado por mensajero: {money(collected)}</span><span>Costos de envío: {money(cost)}</span><strong>Saldo: {money(net)}</strong></div>
   <p className="settlement-balance">{net>0?`El mensajero entrega ${money(net)} a Ohana.`:net<0?`Ohana paga ${money(-net)} al mensajero.`:"Ambas partes quedan saldadas."}</p>
   {document.state==="draft"&&document.id&&state.canWrite&&<form onSubmit={e=>{e.preventDefault();void state.run(async()=>{if(!(await confirmAction("¿Confirmar la liquidación? Hazlo únicamente si ya se realizó el intercambio de dinero indicado.")))return;await keyedRequest(company,"courier_operations",{id:document.id,actual_amount:actual},"settlement_confirm");const d=await courierRead(company,"settlement",{id:document.id});setDocument(d.document);setItems(d.items);setActual("");await load();});}}><label>Importe efectivamente entregado o pagado<MoneyInput required currency="GTQ" min="0" value={actual} onChange={e=>setActual(e.target.value)}/><small>Debe coincidir con el saldo absoluto de la liquidación guardada.</small></label><div className="form-actions"><AppButton disabled={state.busy||dirty}>Confirmar intercambio y liquidación</AppButton></div>{dirty&&<p>Guarda primero los cambios del borrador.</p>}</form>}
   {document.actual_amount!=null&&<p>Intercambio registrado: {money(document.actual_amount)}</p>}
   {document.state!=="cancelled"&&document.id&&state.canWrite&&<div className="form-actions"><AppButton className="danger" disabled={state.busy} onClick={()=>setCancelling(true)}>Anular liquidación</AppButton></div>}
   {cancelling&&<form onSubmit={e=>{e.preventDefault();void state.run(async()=>{if(!(await confirmAction("¿Anular esta liquidación? Sus cobros y envíos volverán a quedar pendientes. El historial y el importe intercambiado se conservarán; cualquier devolución de dinero debe realizarse manualmente.")))return;await keyedRequest(company,"courier_operations",{id:document.id,reason},"settlement_cancel");const d=await courierRead(company,"settlement",{id:document.id});setDocument(d.document);setItems(d.items);setCancelling(false);setDirty(false);await load();});}}><label>Motivo de anulación<input required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="form-actions"><AppButton disabled={state.busy}>Confirmar anulación</AppButton><AppButton type="button" className="secondary" onClick={()=>setCancelling(false)}>Cancelar</AppButton></div></form>}
   {document.cancel_reason&&<p>Motivo de anulación: {document.cancel_reason}</p>}
  </section></div>}
 </section>;
}
export default function Couriers({company,onDirty,onSaved,canManage}:{company:string;onDirty:(d:boolean)=>void;onSaved:()=>Promise<void>;canManage:boolean}){
 const [tab,setTab]=useState("couriers"),[tariffs,setTariffs]=useState<Row|null>(null),[partnerDirty,setPartnerDirty]=useState(false);
 const partnerChanged=useCallback((d:boolean)=>{setPartnerDirty(d);onDirty(d);},[onDirty]);
 const navigate=async(next:string)=>{if(next===tab)return;if((partnerDirty||document.querySelector('[data-navigation-dirty="true"]'))&&!(await confirmAction("Hay cambios sin guardar. ¿Descartarlos?")))return;setTab(next);};
 return <><nav className="courier-tabs" aria-label="Mensajerías y liquidaciones"><AppButton className="secondary" iconKey="module.couriers" onClick={()=>navigate("couriers")}>Mensajerías</AppButton><AppButton className="secondary" iconKey="action.calculate" onClick={()=>navigate("settlements")}>Liquidaciones de mensajería</AppButton></nav>
 {tab==="couriers"?<BusinessPartners company={company} partnerType="courier" onDirty={partnerChanged} onSaved={onSaved} onTariffs={setTariffs}/>:<Settlements company={company}/>}
 {tariffs&&<Tariffs company={company} courier={tariffs} canManage={canManage} onClose={()=>setTariffs(null)}/>}
 </>;
}
