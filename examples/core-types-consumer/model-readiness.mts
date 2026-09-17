import assert from 'node:assert/strict';
import {withModelReadiness,type ModelReadinessSnapshot} from '@immedi/iaic-core/agent/model-readiness.js';
const binding={modelIdentity:'fixture',endpoint:'https://fixture.invalid/v1',credentialRevision:'revision-1',certificateIdentity:'peer-1'};
const snapshot:ModelReadinessSnapshot={active:true,binding,declaredCapabilities:['text_input'],verification:{binding,capabilities:['text_input'],tlsVerified:true,verifiedAt:1,expiresAt:100}};
const model=withModelReadiness({binding,model:{name:'fixture',next:async(request:{signal?:AbortSignal;value:string})=>({value:request.value})},requirements:['text_input'],resolve:({modelIdentity,signal})=>{assert.equal(modelIdentity,'fixture');void signal;return snapshot;},now:()=>50});
assert.equal((await model.next({value:'typed'})).value,'typed');
assert.equal((await model.checkReady()).origin,'https://fixture.invalid');
if(false){
 // @ts-expect-error Request shape survives the wrapper.
 model.next({value:3});
 // @ts-expect-error Certificate binding is required.
 const invalid:ModelReadinessSnapshot={active:true,binding:{modelIdentity:'x',endpoint:'https://fixture.invalid',credentialRevision:'1'},declaredCapabilities:[],verification:null};void invalid;
 // @ts-expect-error Verified result has no vendor token or API key.
 (await model.checkReady()).apiKey;
}
console.log(JSON.stringify({modelReadinessTyped:true,requestResponsePreserved:true,negativeChecks:3}));
