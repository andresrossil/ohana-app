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
 const [all,setAll]=useState<Row[]>([]),[mode,setMode]=useState("zone"),[rows,setRows]=useState<Row[]>([]),[dirty,setDirty]=useState(false),[ready,setReady]=useState(false);
 const [newZone, setNewZone] = useState("");
 const [defaults,setDefaults]=useState<Row>({}),[generalEnabled,setGeneralEnabled]=useState(false),[generalAmount,setGeneralAmount]=useState("");
 function choose(value:string,source:Row[],settings:Row=defaults){value=value==="department"?"department":"zone";setMode(value);setGeneralEnabled(!!settings[value]?.enabled);setGeneralAmount(settings[value]?.amount==null?"":String(settings[value].amount));const destinations = [...new Set([...tariffDestinations(value), ...source.filter(t => t.mode === value).map(t => String(t.destination))])];setRows(destinations.map(destination=>source.find(t=>t.mode===value&&t.destination===destination)||{destination,amount:"",available:false}));}
 useEffect(()=>{void state.run(async()=>{const d=await courierRead(company,"tariffs",{courier:courier.id});setAll(d.rows);setDefaults(d.courier.courier_tariff_defaults||{});choose(d.courier.courier_tariff_mode,d.rows,d.courier.courier_tariff_defaults||{});setReady(true);});},[company,courier.id]);
 const close=async()=>{if(state.busy)return;if(dirty&&!(await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?")))return;onClose();};
 return <div className="overlay"><section className="modal courier-dialog" role="dialog" aria-modal="true" aria-label="Tarifas de mensajería" data-navigation-dirty={dirty}>
  <header className="hierarchy-toolbar"><h2>Tarifas · {courier.name}</h2><AppButton className="secondary" disabled={state.busy} onClick={close}>Cerrar</AppButton></header>
  {state.error&&<p className="error" role="alert"><AppIcon name="status.error"/>{state.error}</p>}{state.notice&&<p role="status">{state.notice}</p>}
  <p>Selecciona zonas o departamentos. La tarifa general aplica el mismo importe a todos los destinos del modo seleccionado; los horarios y la disponibilidad se configuran por separado.</p>
  {ready&&<form data-dirty-managed aria-busy={state.busy} onSubmit={e=>{e.preventDefault();void state.run(async()=>{await keyedRequest(company,"courier_operations",{courier:courier.id,mode,rows,general_enabled:generalEnabled,general_amount:generalAmount},"tariffs_save");const d=await courierRead(company,"tariffs",{courier:courier.id});setAll(d.rows);setDefaults(d.courier.courier_tariff_defaults||{});choose(mode,d.rows,d.courier.courier_tariff_defaults||{});setDirty(false);state.setNotice("Tarifas guardadas. Los pedidos anteriores conservan sus importes.");});}}><fieldset disabled={!canManage||state.busy}>
   <label>Modalidad activa<SearchSelect value={mode} onChange={async e=>{const v=e.target.value;if(!(await confirmAction(dirty?"¿Cambiar de modalidad? Se conservarán las tarifas guardadas; se descartarán las ediciones sin guardar de esta tabla.":"¿Cambiar la modalidad activa? Las tarifas anteriores se conservarán y los pedidos existentes no cambiarán.")))return;choose(v,all);setDirty(true);}}>{Object.entries(tariffModes).map(([key,label])=><option value={key} key={key}>{label}</option>)}</SearchSelect></label>
   <div className="settings-grid delivery-summary"><label><input type="checkbox" checked={generalEnabled} onChange={e=>{setGeneralEnabled(e.target.checked);if(e.target.checked)setRows(old=>old.map(r=>({...r,amount:generalAmount})));setDirty(true);}}/> Tarifa general</label><label>Importe general GTQ<MoneyInput currency="GTQ" min="0" required={generalEnabled} value={generalAmount} onChange={e=>{const amount=e.target.value;setGeneralAmount(amount);if(generalEnabled)setRows(old=>old.map(r=>({...r,amount})));setDirty(true);}}/></label><small className="form-wide">Al desmarcar, los importes quedan disponibles para edición individual. Los horarios no cambian.</small></div>
   {mode === "zone" && <div className="form-actions">
     <label>Número de zona<input type="number" min="1" max="32767" step="1" value={newZone} onChange={e=>setNewZone(e.target.value)} /></label>
     <AppButton type="button" className="secondary" onClick={()=>{
       const zone = Number(newZone);
       if (!Number.isInteger(zone) || zone < 1 || zone > 32767) { state.setError("Indica un número de zona válido."); return; }
       if (rows.some(row=>row.destination===String(zone))) { state.setError("Esa zona ya está en el tarifario."); return; }
       if (rows.length >= 200) { state.setError("El tarifario admite hasta 200 zonas."); return; }
       setRows(old=>[...old,{destination:String(zone),amount:generalEnabled?generalAmount:"",available:false,delivery_schedule:""}]);
       setNewZone("");setDirty(true);state.setError("");
     }}>Agregar zona</AppButton>
   </div>}
   <div className="table-wrap"><ResponsiveTable><thead><tr><th>Destino</th><th>Tarifa GTQ</th><th>Horario</th><th>Disponible</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.destination}><td>{mode==="general"?"Todas las entregas":mode==="zone"?`Zona ${r.destination}`:r.destination}</td><td data-sort-value={r.amount}><MoneyInput currency="GTQ" min="0" readOnly={generalEnabled} required={r.available} value={r.amount??""} onChange={e=>{setRows(old=>old.map((x,j)=>j===i?{...x,amount:e.target.value}:x));setDirty(true);}}/></td><td><AutoTextarea aria-label={`Horario ${r.destination}`} maxLength={500} placeholder="Ej. Lunes a viernes, 9:00 a 17:00" value={r.delivery_schedule||""} onChange={e=>{setRows(old=>old.map((x,j)=>j===i?{...x,delivery_schedule:e.target.value}:x));setDirty(true);}}/></td><td><input aria-label={`Disponible ${r.destination}`} type="checkbox" checked={r.available} onChange={e=>{setRows(old=>old.map((x,j)=>j===i?{...x,available:e.target.checked}:x));setDirty(true);}}/></td></tr>)}</tbody></ResponsiveTable></div>
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
