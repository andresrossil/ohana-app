import { useEffect, useState } from "react";
import BusinessPartners from "./BusinessPartners";
import { AppButton, AppIcon } from "./AppIcon";
import SearchSelect from "./SearchSelect";
import ResponsiveTable from "./ResponsiveTable";
import MoneyInput from "./MoneyInput";
import AutoTextarea from "./AutoTextarea";
import { confirmAction } from "./ConfirmDialog";
import { courierRead, tariffDestinations, tariffModes } from "./delivery-model";
import { keyedRequest, useOperation, type Row } from "./operations";
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
   <div className="table-wrap"><ResponsiveTable><thead><tr><th>Destino</th><th>Tarifa GTQ</th><th>Horario</th><th>Disponible</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.destination}><td>{mode==="general"?"Todas las entregas":mode==="zone"?`Zona ${r.destination}`:r.destination}</td><td data-sort-value={r.amount}><MoneyInput currency="GTQ" min="0" required={r.available} value={r.amount??""} onChange={e=>{setRows(old=>old.map((x,j)=>j===i?{...x,amount:e.target.value}:x));setDirty(true);}}/></td><td><AutoTextarea aria-label={`Horario ${r.destination}`} maxLength={500} placeholder="Ej. Lunes a viernes, 9:00 a 17:00" value={r.delivery_schedule||""} onChange={e=>{setRows(old=>old.map((x,j)=>j===i?{...x,delivery_schedule:e.target.value}:x));setDirty(true);}}/></td><td><input aria-label={`Disponible ${r.destination}`} type="checkbox" checked={r.available} onChange={e=>{setRows(old=>old.map((x,j)=>j===i?{...x,available:e.target.checked}:x));setDirty(true);}}/></td></tr>)}</tbody></ResponsiveTable></div>
   <div className="form-actions"><AppButton disabled={!dirty}>Guardar tarifas</AppButton></div>
  </fieldset></form>}
 </section></div>;
}

export default function Couriers({company,onDirty,onSaved,canManage}:{company:string;onDirty:(d:boolean)=>void;onSaved:()=>Promise<void>;canManage:boolean}){
 const [tariffs,setTariffs]=useState<Row|null>(null);
 return <>
 <BusinessPartners company={company} partnerType="courier" onDirty={onDirty} onSaved={onSaved} onTariffs={setTariffs}/>
 {tariffs&&<Tariffs company={company} courier={tariffs} canManage={canManage} onClose={()=>setTariffs(null)}/>}
 </>;
}
