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
