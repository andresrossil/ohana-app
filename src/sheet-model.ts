export const columns=['PROVEEDOR','OTRO NOMBRE','MP','CAPACIDAD','PRESENTACION','UNIDAD MEDIDA','COMENTARIO','PRECIO PRESENTACION','PRECIO UN','VS','PRECIO ANTERIOR','PROVEEDOR ANTERIOR','FECHA CONSULTA'];
export const manualColumns=[0,1,2,3,4,5,6,7,12];
export type SheetRow={key:string;cells:string[];id?:string;materialId?:string;priceId?:string;currency:string;dirty:boolean;mode:'add'|'update';duplicateChoice?:boolean;legacyAmount?:number|null;legacySupplier?:string|null;legacyBasis?:string;importedPrevious?:string;importedSupplier?:string};
export type CatalogRow={id:string;[key:string]:any};
export const normalize=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();
export function localDate(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
export function parseNumber(value:string):number|null{
 let s=value.trim().replace(/^(?:Q|GTQ|USD|\$)\s*/i,'').replace(/\s/g,'');
 if(!s)return null;
 if(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s))s=s.replace(/,/g,'');
 else if(/^-?\d+,\d{1,8}$/.test(s))s=s.replace(',','.');
 if(!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s))return null;
 const n=Number(s);return Number.isFinite(n)?n:null;
}
export function parseDate(value:string):string|null{
 const s=value.trim();let parts=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);let y,m,d;
 if(parts)[,y,m,d]=parts;else{parts=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!parts)return null;[,d,m,y]=parts}
 const n=new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));
 if(n.getUTCFullYear()!==Number(y)||n.getUTCMonth()+1!==Number(m)||n.getUTCDate()!==Number(d))return null;
 return `${y}-${m!.padStart(2,'0')}-${d!.padStart(2,'0')}`;
}
// Excel TSV uses doubled quotes, quoted tabs and quoted multiline cells.
export function parseTSV(text:string):string[][]{
 const result:string[][]=[];let row:string[]=[],cell='',quoted=false;
 const s=text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
 for(let i=0;i<s.length;i++){
  const c=s[i];if(c==='"'&&(quoted||cell==='')){if(quoted&&s[i+1]==='"'){cell+='"';i++}else quoted=!quoted}
  else if(!quoted&&(c==='\t'||c==='\n')){row.push(cell);cell='';if(c==='\n'){result.push(row);row=[]}}
  else cell+=c;
 }
 if(quoted)throw Error('El texto contiene una celda entre comillas sin cerrar.');
 row.push(cell);result.push(row);
 if(s.endsWith('\n'))result.pop();
 return result;
}
export function formatTSV(rows:string[][]){return rows.map(r=>r.map(c=>/[\t\n"]/.test(c)?`"${c.replace(/"/g,'""')}"`:c).join('\t')).join('\r\n')}
export function blankRow():SheetRow{return{key:crypto.randomUUID(),cells:Array.from({length:13},(_,i)=>i===12?localDate():''),currency:'GTQ',dirty:true,mode:'add'}}
export function findUnit(symbol:string,units:CatalogRow[]){const matches=units.filter(u=>u.active&&(normalize(u.symbol)===normalize(symbol)||normalize(u.name)===normalize(symbol)));return matches.length===1?matches[0]:undefined}
export function validateRow(row:SheetRow,units:CatalogRow[],suppliers:CatalogRow[],materials:CatalogRow[]){
 const c=row.cells,errors:string[]=[];const quantity=parseNumber(c[4]),price=parseNumber(c[7]);
 if(!c[0].trim())errors.push('PROVEEDOR obligatorio');if(!c[2].trim())errors.push('MP obligatoria');
 for(const i of [0,1,2])if(c[i].trim().length>160)errors.push(`${columns[i]}: máximo 160 caracteres`);
 if(quantity===null||quantity<=0||quantity>999999999999)errors.push('PRESENTACION debe ser mayor que 0');
 if(price===null||price<0||price>99999999999999)errors.push('PRECIO PRESENTACION inválido');
 if(quantity!==null&&Number(quantity.toFixed(8))!==quantity)errors.push('PRESENTACION: máximo 8 decimales');
 if(price!==null&&Number(price.toFixed(4))!==price)errors.push('PRECIO PRESENTACION: máximo 4 decimales');
 if(!parseDate(c[12]))errors.push('FECHA CONSULTA: usa día/mes/año o año-mes-día');
 const unit=findUnit(c[5],units);if(!unit)errors.push('UNIDAD MEDIDA desconocida o ambigua; configúrala en Unidades');
 const supplier=suppliers.filter(s=>normalize(s.name)===normalize(c[0]));if(supplier.length>1)errors.push('Proveedor ambiguo');else if(supplier[0]&&!supplier[0].active)errors.push('Proveedor archivado');
 const material=row.materialId?materials.find(m=>m.id===row.materialId):materials.find(m=>normalize(m.name)===normalize(c[2]));
 if(material&&!material.active)errors.push('Materia prima archivada');
 const base=units.find(u=>u.id===material?.unit_id);if(base&&unit&&base.dimension!==unit.dimension)errors.push('La unidad no es compatible con la materia prima');
 if(row.importedPrevious?.trim()&&(parseNumber(row.importedPrevious)===null||(parseNumber(row.importedPrevious) as number)<0))errors.push('PRECIO ANTERIOR inválido');
 return errors;
}
export function calculate(row:SheetRow,units:CatalogRow[],presentations:CatalogRow[],materials:CatalogRow[],suppliers:CatalogRow[],history:CatalogRow[],legacyImport:boolean,basis:string){
 const qty=parseNumber(row.cells[4]),price=parseNumber(row.cells[7]),unit=findUnit(row.cells[5],units),date=parseDate(row.cells[12]);
 const current=qty&&price!==null?price/qty:null;
 const materialId=row.materialId||materials.find(m=>normalize(m.name)===normalize(row.cells[2]))?.id;
 const own=history.find(h=>h.id===row.priceId),ownPresentation=presentations.find(p=>p.id===row.id);
 const currentSupplier=suppliers.find(s=>normalize(s.name)===normalize(row.cells[0]));
 const quoteChanged=!own||Number(own.amount)!==price||own.effective_on!==date||Number(ownPresentation?.quantity)!==qty||ownPresentation?.unit_id!==unit?.id||ownPresentation?.supplier_id!==currentSupplier?.id;
 const candidates=history.filter(h=>h.id!==row.priceId||quoteChanged).flatMap(h=>{
  const p=presentations.find(p=>p.id===h.presentation_id),u=units.find(u=>u.id===p?.unit_id);
  if(!p||!u||!unit||p.raw_material_id!==materialId||u.dimension!==unit.dimension||h.currency!==row.currency||!date||h.effective_on>date)return [];
  // An unchanged saved quotation compares only with earlier chronological records.
  if(!quoteChanged&&own&&[h.effective_on,h.created_at,h.id].join('|')>=[own.effective_on,own.created_at,own.id].join('|'))return [];
  return [{...h,effective_on:String(h.effective_on),created_at:String(h.created_at),normalized:Number(h.amount)/Number(p.quantity)*(Number(unit.base_factor)/Number(u.base_factor)),supplier:suppliers.find(s=>s.id===p.supplier_id)?.name||'—'}];
 }).sort((a,b)=>[b.effective_on,b.created_at,b.id].join('|').localeCompare([a.effective_on,a.created_at,a.id].join('|')));
 const previous=candidates[0];let previousUnit:number|null=previous?.normalized??null;
 const legacyAmount=legacyImport&&row.importedPrevious!==undefined?parseNumber(row.importedPrevious):row.legacyAmount??null;
 const legacyBasis=legacyImport&&row.importedPrevious!==undefined?basis:row.legacyBasis;
 if(previousUnit===null&&legacyAmount!==null){if(legacyBasis==='unit')previousUnit=legacyAmount;else if(legacyBasis==='presentation'&&qty)previousUnit=legacyAmount/qty}
 return {current,previousUnit,variation:current!==null&&previousUnit!==null?current-previousUnit:null,previousDisplay:previousUnit??legacyAmount,previousSupplier:previous?.supplier||(legacyImport?row.importedSupplier:row.legacySupplier)||'—',previousDate:previous?.effective_on||null,unknown:!previous&&legacyAmount!==null&&previousUnit===null};
}
