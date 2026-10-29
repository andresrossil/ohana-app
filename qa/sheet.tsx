// Local browser fixture only. This is not a Vite build entry and contains no user data.
import {createRoot} from 'react-dom/client';
import MaterialSheet from '../src/MaterialSheet';
import '../src/style.css';
const catalog={units:[{id:'u1',name:'Onza',symbol:'oz',dimension:'mass',base_factor:28.34952313,active:true}],suppliers:[],raw_materials:[],presentations:[]};
createRoot(document.getElementById('root')!).render(<main style={{padding:24}}><h1>Prueba local · sin datos reales</h1><MaterialSheet company="fixture" canWrite={true} catalog={catalog} onSaved={async()=>{}} onDirty={()=>{}} readSnapshot={async()=>({sheet:[],history:[]})}/></main>);
