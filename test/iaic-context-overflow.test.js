import test from 'node:test';
import assert from 'node:assert/strict';
import {ContextAssembler} from '@immedi/iaic-core/context/index.js';
function fixture(){
 let permitted=true,refreshes=0;
 const history={calls:[{id:'old',capability:'read',input:{id:'source'},status:'succeeded',result:{body:'stale'}},{id:'latest',capability:'read',input:{id:'current'},status:'succeeded',result:{body:'latest'}}],events:[{seq:1,kind:'call_settled',data:{callId:'old'}},{seq:2,kind:'input',data:{text:'Use the revised goal'}},{seq:3,kind:'call_settled',data:{callId:'latest'}}]};
 const dispatcher={capabilities:new Map([['read',{authorize:async()=>permitted,revalidate:async(input)=>{refreshes++;return {body:input.id==='source'?'x'.repeat(5000):'latest'};}}]])};
 return {request:{history,dispatcher,actor:{},task:{input:{goal:'Complete original goal'}},capability:{implementation:{instructions:'Fixture',skills:[]}}},deny:()=>{permitted=false;},refreshes:()=>refreshes};
}
test('bounded context retains original goal, clarification, operation status and latest result without changing history',async()=>{
 const f=fixture(),before=structuredClone(f.request.history),assembler=new ContextAssembler({maxBytes:2000,overflow:'omit-old-results'});
 const messages=await assembler.assemble(f.request),data=JSON.parse(messages[1].content);
 assert.ok(Buffer.byteLength(messages[1].content)<=2000);assert.equal(data.calls[0].resultOmitted,true);assert.equal(data.calls[0].status,'succeeded');assert.equal(data.calls[1].result.body,'latest');
 assert.deepEqual(data.goal,f.request.task.input);assert.deepEqual(data.events.map(e=>({seq:e.seq,kind:e.kind})),f.request.history.events.map(e=>({seq:e.seq,kind:e.kind})));assert.equal(data.events[1].data.text,'Use the revised goal');assert.deepEqual(data.contextProjection.omittedResultCallIds,['old']);assert.deepEqual(f.request.history,before);assert.equal(f.refreshes(),2);
 const full=await assembler.revalidateHistory(f.request);assert.equal(full.calls[0].result.body.length,5000);
 f.deny();await assert.rejects(assembler.assemble(f.request),{statusCode:403});
});
test('legacy overflow stays explicit and required context is never silently dropped',async()=>{
 const f=fixture();await assert.rejects(new ContextAssembler({maxBytes:2000}).assemble(f.request),{limitReached:true});
 f.request.task.input.goal='g'.repeat(5000);await assert.rejects(new ContextAssembler({maxBytes:2000,overflow:'omit-old-results'}).assemble(f.request),{limitReached:true});
 assert.throws(()=>new ContextAssembler({overflow:'summarize'}));
});
test('small contexts are unchanged and latest settled observation is protected even with different call order',async()=>{
 const f=fixture(),normal=await new ContextAssembler({maxBytes:10000}).assemble(f.request),compact=await new ContextAssembler({maxBytes:10000,overflow:'omit-old-results'}).assemble(f.request);assert.deepEqual(compact,normal);
 f.request.history.calls.reverse();const data=JSON.parse((await new ContextAssembler({maxBytes:2000,overflow:'omit-old-results'}).assemble(f.request))[1].content);assert.equal(data.calls[0].id,'latest');assert.equal(data.calls[0].result.body,'latest');assert.equal(data.calls[1].resultOmitted,true);
});
