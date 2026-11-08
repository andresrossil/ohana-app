import { useEffect, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import ResponsiveTable from "./ResponsiveTable";
import { confirmAction } from "./ConfirmDialog";
import { courierRead } from "./delivery-model";
import { keyedRequest, money, useOperation, type Row } from "./operations";
import { courierBalanceClass, courierBalanceText } from "./courier-account";
export default function CourierAccountDialog({company,courier,onClose,onSaved}:{company:string;courier:Row;onClose:()=>void;onSaved:()=>Promise<void>}){
 const state=useOperation(company,"sales"),[data,setData]=useState<Row>({balance:0,movements:[]}),[voiding,setVoiding]=useState<string|null>(null),[reason,setReason]=useState("");
 const load=async()=>setData(await courierRead(company,"account",{courier:courier.id}));
 useEffect(()=>{void state.run(load);},[company,courier.id]);
 const close=async()=>{if(state.busy)return;if(voiding&&!(await confirmAction("Hay datos pendientes. ¿Salir sin guardar?")))return;onClose();};

 return <div className="overlay"><section className="modal courier-dialog" role="dialog" aria-modal="true" aria-label="Cuenta de mensajería" data-navigation-dirty={!!voiding}>
  <header className="hierarchy-toolbar"><h2>Cuenta de {courier.name}</h2><AppButton className="secondary" disabled={state.busy} onClick={close}>Cerrar</AppButton></header>
  {state.error&&<p className="error"><AppIcon name="status.error"/>{state.error}</p>}
  <p className={`settlement-balance ${courierBalanceClass(Number(data.balance))}`}>{courierBalanceText(Number(data.balance),courier.name)}</p>
  <p>Registra los pagos desde el detalle de cada liquidación.</p>
  <h3>Historial de la cuenta</h3><div className="table-wrap"><ResponsiveTable><thead><tr><th>Fecha</th><th>Concepto</th><th>Importe</th><th>Método</th><th>Saldo acumulado</th><th>Acciones</th></tr></thead><tbody>{data.movements.map((m:Row)=><tr key={m.id}>
   <td>{m.occurred_on}</td><td>{m.kind==="settlement"?"Resultado de liquidación":m.kind==="reversal"?"Reversión":Number(m.signed_amount)<0?"Recibido de mensajero":"Pagado a mensajero"}{m.reversed&&<small>Anulado mediante reversión</small>}<small>{m.notes}</small></td>
   <td data-sort-value={m.signed_amount}>{money(Math.abs(Number(m.signed_amount)))}<small>{Number(m.signed_amount)>0?"A favor de Ohana":Number(m.signed_amount)<0?"A favor del mensajero":"Equilibrado"}</small></td>
   <td>{m.method==="cash"?"Efectivo":m.method==="transfer"?"Transferencia":"No registrado"}</td><td data-sort-value={m.running_balance}>{courierBalanceText(Number(m.running_balance),courier.name)}</td>
   <td>{state.canWrite&&m.kind==="exchange"&&!m.settlement_id&&!m.reversed&&<AppButton className="danger" disabled={state.busy} onClick={()=>{setVoiding(m.id);setReason("");}}>Revertir movimiento</AppButton>}</td>
  </tr>)}</tbody></ResponsiveTable></div>
  {voiding&&<form onSubmit={e=>{e.preventDefault();void state.run(async()=>{if(!(await confirmAction("¿Revertir este movimiento? Se conservará su historial. No se realiza una devolución bancaria automáticamente.")))return;await keyedRequest(company,"courier_operations",{id:voiding,reason},"money_void");setVoiding(null);await load();await onSaved();});}}><label>Motivo<input required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="form-actions"><AppButton disabled={state.busy}>Confirmar reversión</AppButton><AppButton type="button" className="secondary" onClick={()=>setVoiding(null)}>Cancelar</AppButton></div></form>}
 </section></div>;
}
