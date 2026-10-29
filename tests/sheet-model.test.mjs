import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTSV,formatTSV,parseNumber,parseDate,blankRow,calculate,validateRow} from '../src/sheet-model.ts';
test('Excel TSV preserves empty cells, quoted tabs, multiline values and trailing blanks',()=>{
 const input='PRICESMART\t\tACEITE COCO\t54 OZ\t50\tOZ\t"nota\ncon\tcomilla ""ok"""\tQ120.00\tQ2.40\t-1\tQ110.00\t\t3/07/2026\r\n';
 const rows=parseTSV(input);assert.equal(rows.length,1);assert.equal(rows[0].length,13);assert.equal(rows[0][1],'');assert.equal(rows[0][6],'nota\ncon\tcomilla "ok"');assert.deepEqual(parseTSV(formatTSV(rows)),rows);
 assert.deepEqual(parseTSV('a\t\t'),[['a','','']]);assert.throws(()=>parseTSV('"unfinished'));
});
test('currency and dates do not infer invalid values',()=>{
 for(const text of ['Q 120.00','Q120.00','120.00'])assert.equal(parseNumber(text),120);
 assert.equal(parseNumber('Q2.40'),2.4);assert.equal(parseNumber('1,200.50'),1200.5);assert.equal(parseNumber('2,40'),2.4);assert.equal(parseNumber('NaN'),null);assert.equal(parseNumber('54 OZ'),null);assert.equal(parseNumber(''),null);
 assert.equal(parseDate('3/07/2026'),'2026-07-03');assert.equal(parseDate('31/02/2026'),null);assert.equal(parseDate('29/02/2024'),'2024-02-29');
});
const units=[{id:'g',name:'Gramo',symbol:'g',dimension:'mass',base_factor:1,active:true},{id:'kg',name:'Kilogramo',symbol:'kg',dimension:'mass',base_factor:1000,active:true},{id:'oz',name:'Onza',symbol:'oz',dimension:'mass',base_factor:28.34952313,active:true}];
const suppliers=[{id:'s1',name:'Proveedor A',active:true},{id:'s2',name:'Proveedor B',active:true}];
const materials=[{id:'m1',name:'Aceite coco',unit_id:'g',active:true}];
const presentations=[{id:'p1',raw_material_id:'m1',supplier_id:'s1',unit_id:'kg',quantity:1},{id:'p2',raw_material_id:'m1',supplier_id:'s2',unit_id:'g',quantity:500}];
test('capacity is never used as a numeric denominator; unknown history does not fabricate VS',()=>{
 const row=blankRow();row.cells=['PRICESMART','','ACEITE COCO','54 OZ','50','OZ','','Q120.00','Q2.40','-1','Q110.00','','3/07/2026'];row.importedPrevious='Q110.00';
 const r=calculate(row,units,[],[],[],[],true,'unknown');assert.equal(r.current,2.4);assert.equal(r.variation,null);assert.equal(r.previousDisplay,110);assert.equal(r.unknown,true);assert.deepEqual(validateRow(row,units,[],[]),[]);
});
test('previous quotations normalize different package sizes, quantities and suppliers',()=>{
 const row=blankRow();row.cells=['Proveedor B','','Aceite coco','','500','g','','60','','','','','2026-07-03'];row.materialId='m1';
 const history=[{id:'h1',presentation_id:'p1',amount:100,currency:'GTQ',effective_on:'2026-07-02',created_at:'2026-07-02T12:00:00Z'}];
 const r=calculate(row,units,presentations,materials,suppliers,history,false,'unknown');assert.equal(r.current,.12);assert.equal(r.previousUnit,.1);assert.ok(Math.abs(r.variation-.02)<1e-10);assert.equal(r.previousSupplier,'Proveedor A');
 row.currency='USD';assert.equal(calculate(row,units,presentations,materials,suppliers,history,false,'unknown').variation,null);
});
test('editing only a comment does not compare the current quotation against itself',()=>{
 const row=blankRow();row.id='p2';row.materialId='m1';row.priceId='h2';row.cells=['Proveedor B','','Aceite coco','','500','g','new comment','60','','','','','2026-07-03'];
 const history=[{id:'h1',presentation_id:'p1',amount:100,currency:'GTQ',effective_on:'2026-07-02',created_at:'2026-07-02T12:00:00Z'},{id:'h2',presentation_id:'p2',amount:60,currency:'GTQ',effective_on:'2026-07-03',created_at:'2026-07-03T12:00:00Z'}];
 assert.equal(calculate(row,units,presentations,materials,suppliers,history,false,'unknown').previousUnit,.1);
 row.cells[7]='70';assert.equal(calculate(row,units,presentations,materials,suppliers,history,false,'unknown').previousUnit,.12);
});
test('inherited Excel references do not cross currencies or apply to a backdated different package',()=>{
 const row=blankRow();row.id='p2';row.materialId='m1';row.priceId='h2';row.legacyAmount=50;row.legacyBasis='presentation';row.currency='USD';row.cells=['Proveedor B','','Aceite coco','','500','g','','60','','','','','2026-07-03'];
 const history=[{id:'h2',presentation_id:'p2',amount:60,currency:'GTQ',effective_on:'2026-07-03',created_at:'2026-07-03T12:00:00Z'}];
 assert.equal(calculate(row,units,presentations,materials,suppliers,history,false,'unknown').variation,null);
 row.currency='GTQ';row.cells[4]='1000';row.cells[12]='2026-07-01';assert.equal(calculate(row,units,presentations,materials,suppliers,history,false,'unknown').variation,null);
});
