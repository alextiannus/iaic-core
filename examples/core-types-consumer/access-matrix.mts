import assert from 'node:assert/strict';
import {checkAccessCatalogMatrix, type AccessCatalogEntrance} from '@immedi/iaic-core/developer/access-matrix.js';
type Context={subjectId:string; revision:number; entitled:boolean};
const entrance:AccessCatalogEntrance<Context>={name:'fixture',surface:'model',list:c=>c.entitled?['document.read']:[]};
const result=await checkAccessCatalogMatrix<Context>({cases:[{name:'current',context:{subjectId:'user',revision:2,entitled:false},expected:{model:[]}}],entrances:[entrance]});
assert.equal(result.passed,true);
const invalid:AccessCatalogEntrance<Context>={name:'invalid',surface:'model',
 // @ts-expect-error catalog adapters must return names, not access decisions
 list:()=>true};
void invalid;
console.log(JSON.stringify({typedAccessMatrix:true,currentFixture:true}));
