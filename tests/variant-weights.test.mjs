import test from "node:test";
import assert from "node:assert/strict";
import {weightMatches,weightRangeError} from "../src/variant-weights.ts";
const variants=[
 {id:"JT-1",weight_min:80,weight_max:90,attributes:{aroma:"menta"},active:true},
 {id:"JT-2",weight_min:90,weight_max:100,attributes:{aroma:"menta"},active:true},
 {id:"JT-3",weight_min:100,weight_max:110,attributes:{aroma:"menta"},active:true},
];
test("lower inclusive, upper exclusive at the requested boundaries",()=>{
 for(const [weight,id] of [[89.99,"JT-1"],[90,"JT-2"],[99.99,"JT-2"],[100,"JT-3"]])
  assert.deepEqual(weightMatches(variants,{aroma:" MENTA "},weight).map(v=>v.id),[id]);
 assert.deepEqual(weightMatches(variants,{aroma:"menta"},110),[]);
 assert.deepEqual(weightMatches(variants,{aroma:"otro"},90),[]);
 assert.deepEqual(weightMatches(variants,{aroma:"menta"},""),[]);
});
test("adjacent ranges pass, overlaps and empty ranges fail",()=>{
 assert.equal(weightRangeError(variants,{id:"new",weight_min:110,weight_max:120,attributes:{aroma:"menta"}}),"");
 assert.ok(weightRangeError(variants,{id:"new",weight_min:89,weight_max:91,attributes:{aroma:"menta"}}));
 assert.ok(weightRangeError(variants,{id:"new",weight_min:120,weight_max:120,attributes:{aroma:"menta"}}));
 assert.equal(weightRangeError(variants,{id:"new",weight_min:89,weight_max:91,attributes:{aroma:"otro"}}),"");
});
test("ambiguity remains visible and archived variants are excluded",()=>{
 assert.equal(weightMatches([...variants,{...variants[1],id:"duplicate"}],{aroma:"menta"},90).length,2);
 assert.equal(weightMatches(variants.map(v=>({...v,active:false})),{aroma:"menta"},90).length,0);
});

import {centralVariant} from '../src/central-variant.ts';
test('central reference follows range order and chooses the lower median',()=>{
 for(const [count,position] of [[1,1],[2,1],[3,2],[4,2],[5,3],[10,5],[12,6]]){
  const variants=Array.from({length:count},(_,i)=>({id:String(i+1),product_id:'p',sku:'P'+(count-i),commercial_code:'JT-'+(count-i),weight_min:80+i*10,weight_max:90+i*10})).reverse();
  const before=JSON.stringify(variants);
  assert.equal(centralVariant(variants,'p').id,String(position));
  assert.equal(JSON.stringify(variants),before);
 }
 const tied=[{id:'a',product_id:'p',weight_min:80,weight_max:100},{id:'b',product_id:'p',weight_min:80,weight_max:90},{id:'c',product_id:'p',weight_min:80,weight_max:95}];
 assert.equal(centralVariant(tied,'p').id,'c');
 assert.equal(centralVariant([{id:'only',product_id:'p'}],'p').id,'only');
 assert.equal(centralVariant(tied,'other'),undefined);
});
test('central reference recomputes on additions, removals and range changes',()=>{
 const list=[1,2,3,4].map(i=>({id:String(i),product_id:'p',weight_min:i*10,weight_max:i*10+5}));
 assert.equal(centralVariant(list,'p').id,'2');
 assert.equal(centralVariant([...list,{id:'5',product_id:'p',weight_min:50,weight_max:55}],'p').id,'3');
 assert.equal(centralVariant(list.filter(v=>v.id!=='1'),'p').id,'3');
 assert.equal(centralVariant(list.map(v=>v.id==='4'?{...v,weight_min:0,weight_max:5}:v),'p').id,'1');
});
