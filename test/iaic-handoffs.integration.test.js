import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {HandoffStore,TaskHandoffs,TaskStore,AgentRuntime,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL,actor={scopeId:'handoff-app',subjectId:'owner'},other={...actor,subjectId:'other'};
async function fixture(run){
 const admin=new Pool({connectionString:url}),schema='handoff_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime;
 try{
  const store=new TaskStore({pool}),records=new HandoffStore({pool});await records.initialize();let actions=[],modelCalls=0,domainCalls=0;
  const schemaObject={type:'object'};const read=defineCapability({name:'source.read',description:'Read source',input:schemaObject,output:schemaObject,effect:'read',authorize:async()=>true,revalidate:async(_i,r)=>r,implementation:{kind:'function',execute:async()=>{domainCalls++;return {source:'evidence'};}}});
  const write=defineCapability({name:'write.other',description:'Unrelated write',input:schemaObject,output:schemaObject,effect:'write',retry:'never-replay',authorize:async()=>true,implementation:{kind:'function',execute:async()=>{throw new Error('Must not execute');}}});
  const agent=(name,tools)=>defineCapability({name,description:name,input:schemaObject,output:schemaObject,effect:'write',retry:'never-replay',authorize:async()=>true,implementation:{kind:'agent',tools,allowCall:(_request,action)=>name!=='parent'||action.input.key!=='forbidden',instructions:'Use evidence and produce result',verify:async()=>true}});
  const parent=agent('parent',['source.read','write.other']),worker=agent('worker',['source.read']);const dispatcher=new CapabilityDispatcher({capabilities:[read,write,parent,worker]});
  const artifact={path:'source.md',revision:1,digest:'a'.repeat(64)};let artifactAvailable=true;
  const ports={store:records,resolveScope:async a=>({applicationId:a.scopeId,subjectId:a.subjectId}),restoreActor:async s=>({scopeId:s.applicationId,subjectId:s.subjectId}),authorize:async()=>true,attenuateInput:async({parent,input})=>({...input,...(parent.input.resourceScope?{resourceScope:parent.input.resourceScope}:{})}),readTask:(a,id)=>runtime.get(a,id,{history:true}),readTaskState:(a,id)=>runtime.state(a,id),admitTask:(a,name,input,key)=>dispatcher.invoke(name,input,{actor:a,callId:key}),findTask:(a,name,key)=>store.findRequest(a,name,key),cancelTask:(a,id)=>runtime.transition(a,id,{action:'cancel'}),capabilityFor:name=>dispatcher.capabilities.get(name),readArtifact:async(a,reference)=>{if(a.subjectId!==actor.subjectId||!artifactAvailable)throw Object.assign(new Error('Artifact unavailable'),{statusCode:404});assert.deepEqual(reference,artifact);return {reference:artifact,content:'source'};},logger:{warn(){}}};
  const handoffs=new TaskHandoffs(ports);const model={name:'handoff-fixture',next:async request=>{modelCalls++;const next=actions.shift();assert.ok(next,'Unexpected model invocation');return typeof next==='function'?next(request):next;}};
  runtime=new AgentRuntime({store,dispatcher,model,context:new ContextAssembler({skillRoot:'/private/tmp'}),version:'handoff-v1',handoffs});dispatcher.tasks=runtime;await runtime.initialize();
  const startParent=async()=>{actions.push({type:'wait',question:'PRIVATE_PARENT_TRANSCRIPT'});const task=await dispatcher.invoke('parent',{goal:'PRIVATE_PARENT_TRANSCRIPT',allowedTools:['source.read','write.other'],resourceScope:'source-only'},{actor,callId:randomUUID()});assert.equal((await runtime.tick()).waiting_reason,'input');return task;};
  const contract=task=>({requestKey:randomUUID(),parentTaskId:task.id,capability:'worker',goal:'Read the source',successCriteria:'Return an evidence-backed summary and source reference',tools:['source.read'],artifacts:[artifact],deadlineAt:'2099-01-01T00:00:00Z',maxModelCalls:2});
  await run({pool,store,records,handoffs,ports,runtime,dispatcher,startParent,contract,artifact,setActions:a=>actions.push(...a),counts:()=>({modelCalls,domainCalls}),hideArtifact:()=>artifactAvailable=false});
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Handoff uses one Runtime, isolated child context, scoped receipts and explicit parent continuation',{skip:!url},()=>fixture(async f=>{
 const parent=await f.startParent(),input=f.contract(parent);const receipt=await f.handoffs.create(actor,input);
 assert.equal(receipt.childStatus,'queued');assert.equal((await f.store.get(actor,receipt.childTaskId)).input.resourceScope,'source-only');assert.equal((await f.handoffs.create(actor,input)).childTaskId,receipt.childTaskId);assert.equal((await f.store.list(actor)).length,2);
 await assert.rejects(f.handoffs.create(actor,{...input,goal:'Changed'}),{statusCode:409});await assert.rejects(f.handoffs.read(other,receipt.id),{statusCode:404});
 await assert.rejects(f.runtime.transition(actor,parent.id,{action:'provide_input',input:'Continue'}),/waiting for its handoff/);
 f.setActions([request=>{assert.deepEqual(request.tools.map(t=>t.name),['source.read']);assert.doesNotMatch(JSON.stringify(request.messages),/PRIVATE_PARENT_TRANSCRIPT/);return {type:'call',name:'source.read',input:{}};},{type:'finish',result:{summary:'Read evidence',artifacts:[f.artifact]}}]);
 assert.equal((await f.runtime.tick()).status,'succeeded');const view=await f.handoffs.read(actor,receipt.id);assert.equal(view.modelAdmissionsUsed,2);assert.deepEqual(view.result,{summary:'Read evidence',artifacts:[f.artifact]});assert.equal('events' in view,false);
 const rebuilt=new TaskHandoffs({...f.ports,store:new HandoffStore({pool:f.pool})});assert.deepEqual(await rebuilt.read(actor,receipt.id),view);
 await new TaskHandoffs({...f.ports,clock:()=>Date.parse('2100-01-01T00:00:00Z')}).tick();assert.equal((await f.handoffs.read(actor,receipt.id)).state,'finished');
 await f.runtime.transition(actor,parent.id,{action:'provide_input',input:'Child evidence reviewed'});f.setActions([{type:'finish',result:{summary:'Parent complete',artifacts:[]}}]);assert.equal((await f.runtime.tick()).status,'succeeded');assert.equal((await f.handoffs.read(actor,receipt.id)).state,'finished');
 f.hideArtifact();await assert.rejects(f.handoffs.read(actor,receipt.id),/Artifact unavailable/);
}));
test('Handoff call budget is durable and cancellation propagates without another model call',{skip:!url},()=>fixture(async f=>{
 const parent=await f.startParent(),input={...f.contract(parent),maxModelCalls:1},receipt=await f.handoffs.create(actor,input);
 f.setActions([{type:'call',name:'source.read',input:{}}]);const child=await f.runtime.tick();assert.equal(child.status,'waiting');assert.match(child.error,/budget exhausted/);assert.equal((await f.handoffs.read(actor,receipt.id)).modelAdmissionsUsed,1);
 const before=f.counts();await f.runtime.transition(actor,parent.id,{action:'cancel'});assert.equal((await f.store.get(actor,receipt.childTaskId)).status,'cancelled');assert.deepEqual(f.counts(),before);assert.equal((await f.handoffs.create(actor,input)).state,'cancelled');
}));
test('Handoff rejects widened scopes and expired terms, recovers lost admission acknowledgement with the original Task',{skip:!url},()=>fixture(async f=>{
 const parent=await f.startParent(),input=f.contract(parent);
 await assert.rejects(new TaskHandoffs({...f.ports,attenuateInput:async({input})=>({...input,allowedTools:['write.other']})}).create(actor,input),{statusCode:403});
 await assert.rejects(f.handoffs.create(actor,{...input,tools:['write.other']}),{statusCode:403});await assert.rejects(f.handoffs.create(actor,{...input,deadlineAt:'2000-01-01T00:00:00Z'}),/elapsed/);assert.equal((await f.store.list(actor)).length,1);
 let lost=true;const adapter=new TaskHandoffs({...f.ports,admitTask:async(...args)=>{const task=await f.ports.admitTask(...args);if(lost){lost=false;throw new Error('Acknowledgement lost');}return task;}});
 await assert.rejects(adapter.create(actor,input),/Acknowledgement lost/);const receipt=await adapter.create(actor,input);assert.equal((await f.store.list(actor)).length,2);assert.ok(receipt.childTaskId);
 await assert.rejects(f.handoffs.create(actor,f.contract(await f.store.get(actor,receipt.childTaskId))),/unbound waiting parent/);
 const expired=new TaskHandoffs({...f.ports,clock:()=>Date.parse('2100-01-01T00:00:00Z')});await expired.tick();assert.equal((await f.store.get(actor,receipt.childTaskId)).status,'cancelled');assert.equal((await f.handoffs.read(actor,receipt.id)).state,'expired');
}));
test('Bound handoff Task cannot run without its resolver; reserve-once model attempts never silently replay',{skip:!url},()=>fixture(async f=>{
 const parent=await f.startParent(),receipt=await f.handoffs.create(actor,f.contract(parent)),child=await f.store.get(actor,receipt.childTaskId);assert.ok(child.handoff);
 const context={actor,task:child,turn:1};await f.handoffs.admitModel(context);await assert.rejects(f.handoffs.admitModel(context),/already admitted/);assert.equal((await f.handoffs.read(actor,receipt.id)).modelAdmissionsUsed,1);
 f.runtime.handoffs=null;assert.equal((await f.runtime.tick()).status,'waiting');assert.match((await f.store.get(actor,child.id)).error,/Handoff resolver is unavailable/);assert.equal(f.counts().domainCalls,0);
}));

test('Child tool scope cannot bypass the parent domain allowCall filter',{skip:!url},()=>fixture(async f=>{
 const parent=await f.startParent(),receipt=await f.handoffs.create(actor,f.contract(parent));f.setActions([{type:'call',name:'source.read',input:{key:'forbidden'}}]);
 const task=await f.runtime.tick();assert.equal(task.id,receipt.childTaskId);assert.equal(task.status,'waiting');assert.match(task.error,/parent domain restrictions/);assert.equal(f.counts().domainCalls,0);assert.equal((await f.store.history(actor,task.id)).calls.length,0);
}));
test('Parent cancellation during child inference preserves admitted usage and prevents the proposed tool',{skip:!url},()=>fixture(async f=>{
 const parent=await f.startParent(),receipt=await f.handoffs.create(actor,f.contract(parent));
 f.setActions([async()=>{await f.runtime.transition(actor,parent.id,{action:'cancel'});return {type:'call',name:'source.read',input:{},usage:{inputTokens:3,outputTokens:2}};}]);
 const child=await f.runtime.tick();assert.equal(child.id,receipt.childTaskId);assert.equal(child.status,'cancelled');assert.equal(f.counts().domainCalls,0);
 const history=await f.store.history(actor,child.id);assert.equal(history.events.find(e=>e.kind==='model_usage').data.usage.inputTokens,3);assert.equal(history.calls.length,0);
}));
