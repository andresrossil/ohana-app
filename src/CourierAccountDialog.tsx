import { useEffect, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import SearchSelect from "./SearchSelect";
import ResponsiveTable from "./ResponsiveTable";
import MoneyInput from "./MoneyInput";
import { confirmAction } from "./ConfirmDialog";
import { courierRead } from "./delivery-model";
import { keyedRequest, money, today, useOperation, type Row } from "./operations";
import { courierBalanceClass, courierBalanceText } from "./courier-account";
export default function CourierAccountDialog({company,courier,onClose,onSaved}:{company:string;courier:Row;onClose:()=>void;onSaved:()=>Promise<void>}){
 const state=useOperation(company,"sales"),[data,setData]=useState<Row>({balance:0,movements:[]}),[editing,setEditing]=useState(false),[voiding,setVoiding]=useState<string|null>(null),[reason,setReason]=useState("");
 const [form,setForm]=useState({amount:"",direction:"received",method:"cash",date:today(),notes:""});
 const load=async()=>setData(await courierRead(company,"account",{courier:courier.id}));
 useEffect(()=>{void state.run(load);},[company,courier.id]);
 const close=async()=>{if(state.busy)return;if((editing||voiding)&&!(await confirmAction("Hay datos pendientes. ¿Salir sin guardar?")))return;onClose();};
 const record=()=>state.run(async()=>{
  const current=await courierRead(company,"account",{courier:courier.id});setData(current);
  const next=Number(current.balance)+(form.direction==="received"?-1:1)*Number(form.amount);
  if(!(await confirmAction(`${form.direction==="received"?"Recibido del mensajero":"Pagado al mensajero"}: ${money(form.amount)}.\nSaldo después: ${courierBalanceText(next,courier.name)}.\nConfirma solo el dinero realmente intercambiado.`)))return;
  await keyedRequest(company,"courier_operations",{...form,courier:courier.id,expected_balance:current.balance},"money_add");setEditing(false);setForm({amount:"",direction:"received",method:"cash",date:today(),notes:""});await load();await onSaved();
 });
 return <div className="overlay"><section className="modal courier-dialog" role="dialog" aria-modal="true" aria-label="Cuenta de mensajería" data-navigation-dirty={editing||!!voiding}>
  <header className="hierarchy-toolbar"><h2>Cuenta de {courier.name}</h2><AppButton className="secondary" disabled={state.busy} onClick={close}>Cerrar</AppButton></header>
  {state.error&&<p className="error"><AppIcon name="status.error"/>{state.error}</p>}
  <p className={`settlement-balance ${courierBalanceClass(Number(data.balance))}`}>{courierBalanceText(Number(data.balance),courier.name)}</p>
  {state.canWrite&&!editing&&<div className="form-actions"><AppButton disabled={state.busy} onClick={()=>setEditing(true)}>Registrar intercambio de dinero</AppButton></div>}
  {editing&&<form onSubmit={e=>{e.preventDefault();void record();}}><fieldset className="settings-grid" disabled={state.busy}>
   <label>Importe<MoneyInput currency="GTQ" required min="0.01" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label>
   <label>Dirección<SearchSelect value={form.direction} onChange={e=>setForm({...form,direction:e.target.value})}><option value="received">Recibido de mensajero</option><option value="paid">Pagado a mensajero</option></SearchSelect></label>
   <label>Método<SearchSelect value={form.method} onChange={e=>setForm({...form,method:e.target.value})}><option value="cash">Efectivo</option><option value="transfer">Transferencia bancaria</option></SearchSelect></label>
   <label>Fecha<input type="date" required max={today()} value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label>
   <label className="form-wide">Observaciones · opcional<input maxLength={2000} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
   <div className="form-actions form-wide"><AppButton>Guardar movimiento</AppButton><AppButton type="button" className="secondary" onClick={()=>setEditing(false)}>Cancelar</AppButton></div>
  </fieldset></form>}
  <h3>Historial de la cuenta</h3><div className="table-wrap"><ResponsiveTable><thead><tr><th>Fecha</th><th>Concepto</th><th>Importe</th><th>Método</th><th>Saldo acumulado</th><th>Acciones</th></tr></thead><tbody>{data.movements.map((m:Row)=><tr key={m.id}>
   <td>{m.occurred_on}</td><td>{m.kind==="settlement"?"Resultado de liquidación":m.kind==="reversal"?"Reversión":Number(m.signed_amount)<0?"Recibido de mensajero":"Pagado a mensajero"}{m.reversed&&<small>Anulado mediante reversión</small>}<small>{m.notes}</small></td>
   <td data-sort-value={m.signed_amount}>{money(Math.abs(Number(m.signed_amount)))}<small>{Number(m.signed_amount)>0?"A favor de Ohana":Number(m.signed_amount)<0?"A favor del mensajero":"Equilibrado"}</small></td>
   <td>{m.method==="cash"?"Efectivo":m.method==="transfer"?"Transferencia":"No registrado"}</td><td data-sort-value={m.running_balance}>{courierBalanceText(Number(m.running_balance),courier.name)}</td>
   <td>{state.canWrite&&m.kind==="exchange"&&!m.settlement_id&&!m.reversed&&<AppButton className="danger" disabled={state.busy} onClick={()=>{setVoiding(m.id);setReason("");}}>Revertir movimiento</AppButton>}</td>
  </tr>)}</tbody></ResponsiveTable></div>
  {voiding&&<form onSubmit={e=>{e.preventDefault();void state.run(async()=>{if(!(await confirmAction("¿Revertir este movimiento? Se conservará su historial. No se realiza una devolución bancaria automáticamente.")))return;await keyedRequest(company,"courier_operations",{id:voiding,reason},"money_void");setVoiding(null);await load();await onSaved();});}}><label>Motivo<input required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="form-actions"><AppButton disabled={state.busy}>Confirmar reversión</AppButton><AppButton type="button" className="secondary" onClick={()=>setVoiding(null)}>Cancelar</AppButton></div></form>}
 </section></div>;
}
