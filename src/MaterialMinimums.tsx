import { useState } from "react";
import { supabase as db } from "./client";
import { AppButton, AppIcon } from "./AppIcon";
import ResponsiveTable from "./ResponsiveTable";
import SearchSelect from "./SearchSelect";
import { useOperation, type Row } from "./operations";

export default function MaterialMinimums({company,onSaved}:{company:string;onSaved:()=>Promise<void>}) {
 const state=useOperation(company,"catalog");
 const [plan,setPlan]=useState<Row|null>(null),[choices,setChoices]=useState<Record<string,string>>({}),[result,setResult]=useState<Row|null>(null);
 const num=(n:any)=>n==null?"—":Number(n).toLocaleString("es-GT",{maximumFractionDigits:8});
 const differences=(plan?.rows||[]).filter((r:Row)=>!r.error&&r.uses>0&&Number(r.current_minimum)>0&&Number(r.current_minimum)!==Number(r.suggested));
 async function call(action:string,data:Row={}) {
  const r=await db.rpc("material_minimum_stock",{p_company:company,p_action:action,p_data:data});
  if(r.error)throw r.error;return r.data;
 }
 return <>
  <AppButton className="secondary" disabled={state.busy||!state.canWrite} onClick={()=>state.run(async()=>{
   setResult(null);setChoices({});setPlan(await call("preview"));
  })}>Calcular mínimos</AppButton>
  {(plan||result||state.error)&&<div className="overlay"><section className="modal operations-dialog" role="dialog" aria-modal="true" aria-label="Calcular inventarios mínimos" aria-busy={state.busy}>
   <header className="hierarchy-toolbar"><h2>Inventarios mínimos</h2><AppButton className="secondary" disabled={state.busy} onClick={()=>{setPlan(null);setResult(null);state.setError("");}}>Cerrar</AppButton></header>
   {state.error&&<p className="error" role="alert"><AppIcon name="status.error"/>{state.error}</p>}
   {result?<><h3>Cálculo finalizado</h3><dl className="settings-grid">{[["Materiales procesados","processed"],["Mínimos nuevos asignados","assigned"],["Mínimos existentes actualizados","updated"],["Mínimos conservados","kept"],["Materiales sin fórmulas vigentes","unused"],["Materiales con errores","errors"]].map(([label,key])=><div key={key}><dt>{label}</dt><dd><strong>{result[key]}</strong></dd></div>)}</dl></>:plan&&<>
    <p>Se procesan todos los materiales de esta empresa, sin aplicar filtros del catálogo. Se calcula una preparación completa por producto, con su fórmula vigente, empaque e insumos.</p>
    <p>Los mínimos vacíos o en cero se asignarán al guardar. Los existentes se mantienen salvo que elijas Actualizar. Las existencias y el Kardex no cambian.</p>
    <p><strong>{plan.rows.length} materiales · {differences.length} mínimos diferentes por revisar</strong></p>
    {differences.length>0&&<><div className="form-actions"><AppButton className="secondary" disabled={state.busy} onClick={()=>setChoices(Object.fromEntries(differences.map((r:Row)=>[r.id,"update"])))}>Actualizar todos</AppButton><AppButton className="secondary" disabled={state.busy} onClick={()=>setChoices({})}>Mantener todos</AppButton></div>
     <div className="table-wrap"><ResponsiveTable><thead><tr><th>Material</th><th>Mínimo actual</th><th>Mínimo sugerido</th><th>Acción</th></tr></thead><tbody>{differences.map((r:Row)=><tr key={r.id}><td>{r.sku} · {r.name}</td><td data-sort-value={r.current_minimum}>{num(r.current_minimum)} {r.unit}</td><td data-sort-value={r.suggested}>{num(r.suggested)} {r.unit}</td><td><SearchSelect value={choices[r.id]||"keep"} disabled={state.busy} onChange={e=>setChoices({...choices,[r.id]:e.target.value})}><option value="update">Actualizar</option><option value="keep">Mantener</option></SearchSelect></td></tr>)}</tbody></ResponsiveTable></div>
    </>}
    {plan.rows.some((r:Row)=>r.error)&&<><h3>Materiales que conservarán su mínimo por errores</h3><div className="table-wrap"><ResponsiveTable><thead><tr><th>Material</th><th>Motivo</th></tr></thead><tbody>{plan.rows.filter((r:Row)=>r.error).map((r:Row)=><tr key={r.id}><td>{r.sku} · {r.name}</td><td>{r.error}</td></tr>)}</tbody></ResponsiveTable></div></>}
    <div className="form-actions"><AppButton disabled={state.busy} onClick={()=>state.run(async()=>{const r=await call("apply",{token:plan.token,choices});setResult(r);setPlan(null);await onSaved();})}>Guardar mínimos</AppButton><AppButton className="secondary" disabled={state.busy} onClick={()=>setPlan(null)}>Cancelar</AppButton></div>
   </>}
  </section></div>}
 </>;
}
