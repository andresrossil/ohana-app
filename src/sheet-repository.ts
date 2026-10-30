import {supabase as db} from './client';
import type {CatalogRow} from './sheet-model';
export type SheetSnapshot={sheet:CatalogRow[];history:CatalogRow[]};
export async function readSheet(company:string,includeRows=true):Promise<SheetSnapshot>{
 const history:CatalogRow[]=[],sheet:CatalogRow[]=[];
 for(let offset=0;;offset+=1000){const page=await db.from('price_history').select('*').eq('company_id',company).order('id').range(offset,offset+999);if(page.error)throw page.error;history.push(...page.data);if(page.data.length<1000)break}
 if(includeRows)for(let offset=0;;offset+=1000){const page=await db.from('material_sheet').select('*').eq('company_id',company).eq('active',true).order('material_name').order('id').range(offset,offset+999);if(page.error)throw page.error;sheet.push(...page.data);if(page.data.length<1000)break}
 return {sheet,history};
}
