// Synthetic fixture, not a production build entry. No writes are made by this harness.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ImportMaterials from '../src/ImportMaterials';
import '../src/style.css';
const catalog={units:[{id:'u1',name:'Onza',symbol:'oz',dimension:'mass',base_factor:28.34952313,active:true}],suppliers:[],raw_materials:[],presentations:[]};
function Fixture(){const [open,setOpen]=useState(true);return <main style={{padding:24}}><h1>Prueba local · carga masiva</h1><button onClick={()=>setOpen(true)}>Copiar de Tabla</button>{open&&<ImportMaterials company="fixture" canWrite={true} catalog={catalog} onDirty={()=>{}} onSaved={async()=>{}} onCancel={()=>setOpen(false)} onComplete={()=>setOpen(false)} readSnapshot={async()=>({sheet:[{id:'saved-record',material_name:'REGISTRO EXISTENTE NO DEBE MOSTRARSE',supplier_name:'Proveedor existente',quantity:10,unit_symbol:'oz',amount:50,effective_on:'2026-07-03'}],history:[]})}/>}</main>}
createRoot(document.getElementById('root')!).render(<Fixture/>);
