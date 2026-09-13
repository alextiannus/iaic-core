import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
async function fixture(fn){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
 const schema='batch_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
 try{
  await pool.query('CREATE TABLE effects(id text PRIMARY KEY,value integer)');let unknown=false,denySecond=false,failFirst=false,requests=0;
  const actor={scopeId:'batch',subjectId:'owner'};
  const tool=defineCapability({name:'record.write',description:'Write one effect',input:{type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false},output:{type:'object'},effect:'write',retry:'never-replay',authorize:(_a,i)=>!(denySecond&&i.value===2),revalidate:async(_i,r)=>r,implementation:{kind:'function',execute:async(i,c)=>{if(failFirst&&i.value===1)throw new Error('Rejected operation');await pool.query('INSERT INTO effects VALUES($1,$2)',[c.callId,i.value]);if(unknown&&i.value===1)throw Object.assign(new Error('Committed response lost'),{outcomeUnknown:true});return {done:true};}}});
  const job=defineCapability({name:'worker.run',description:'Write two records',input:{type:'object'},output:{type:'object'},effect:'write',retry:'never-replay',authorize:()=>true,implementation:{kind:'agent',instructions:'Use configured tools',tools:[tool.name],verify:async()=>Number((await pool.query('SELECT count(*) FROM effects')).rows[0].count)===2}});
  const dispatcher=new CapabilityDispatcher({capabilities:[tool,job]}),model={name:'batch-fixture',next:async()=>{requests++;return requests===1?{type:'batch',actions:[1,2].map(value=>({type:'call',name:tool.name,input:{value}}))}:{type:'finish',result:{done:true}};}};
  const build=async(maxCalls=2)=>{await runtime?.stop();runtime=new AgentRuntime({store:new TaskStore({pool}),dispatcher,model,context:new ContextAssembler({skillRoot:'/tmp'}),version:'batch-v1',maxBatchCalls:2,maxCalls,maxTurns:2});dispatcher.tasks=runtime;await runtime.initialize();return runtime;};
  await build();const task=await dispatcher.invoke(job.name,{goal:'Write one and two',allowedTools:[tool.name]},{actor,callId:'one'});
  await fn({pool,actor,task,build,get runtime(){return runtime;},requests:()=>requests,unknown:()=>{unknown=true;},deny:()=>{denySecond=true;},failFirst:()=>{failFirst=true;}});
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Bounded batch executes two original calls sequentially and spends one inference for its plan',async()=>fixture(async f=>{
 const done=await f.runtime.tick();assert.equal(done.status,'succeeded');assert.equal(f.requests(),2);
 const h=await f.runtime.store.history(f.actor,f.task.id);assert.equal(h.calls.length,2);assert.equal(new Set(h.calls.map(c=>c.action_ref)).size,2);assert.ok(h.calls.every(c=>c.action_ref));assert.equal(h.events.filter(e=>e.kind==='action_batch').length,1);
}));
test('Unknown first effect pauses later calls and reconstruction resumes after original-call reconciliation',async()=>fixture(async f=>{
 f.unknown();assert.equal((await f.runtime.tick()).waiting_reason,'external_result');assert.equal((await f.pool.query('SELECT * FROM effects')).rowCount,1);
 const history=await f.runtime.store.history(f.actor,f.task.id),original=history.calls[0];assert.equal(original.status,'unknown');
 const rebuilt=await f.build();await assert.rejects(rebuilt.transition(f.actor,f.task.id,{action:'resume'}));
 await rebuilt.store.resolveCall(f.actor,f.task.id,original.id,{done:true});await rebuilt.transition(f.actor,f.task.id,{action:'resume'});
 assert.equal((await rebuilt.tick()).status,'succeeded');assert.equal(f.requests(),2);const effects=(await f.pool.query('SELECT * FROM effects ORDER BY value')).rows;assert.equal(effects.length,2);assert.equal(effects[0].id,original.id);
}));
test('Each batch step checks current permission before dispatch',async()=>fixture(async f=>{
 f.deny();const done=await f.runtime.tick();assert.equal(done.status,'waiting');assert.equal((await f.pool.query('SELECT * FROM effects')).rowCount,1);
 const h=await f.runtime.store.history(f.actor,f.task.id);assert.equal(h.calls[1].status,'failed');assert.equal(h.events.filter(e=>e.kind==='action_batch_closed'&&e.data.reason==='step_failed').length,1);
}));
test('A failed step abandons the remainder without pretending the parent outcome passed',async()=>fixture(async f=>{
 f.failFirst();assert.equal((await f.runtime.tick()).status,'waiting');assert.equal((await f.pool.query('SELECT * FROM effects')).rowCount,0);assert.equal((await f.runtime.store.history(f.actor,f.task.id)).calls.length,1);
}));
test('A batch exceeding remaining call budget is rejected before any effect',async()=>fixture(async f=>{
 await f.build(1);assert.equal((await f.runtime.tick()).status,'waiting');assert.equal((await f.pool.query('SELECT * FROM effects')).rowCount,0);
}));
test('Interrupted preparation keeps its original receipt and abandons remaining planned steps',async()=>fixture(async f=>{
 const prepare=f.runtime.executor.prepare.bind(f.runtime.executor);
 f.runtime.executor.prepare=async(...args)=>{await prepare(...args);throw new Error('Interrupted after durable preparation');};
 assert.equal((await f.runtime.tick()).status,'waiting');
 const before=await f.runtime.store.history(f.actor,f.task.id);assert.equal(before.calls[0].status,'prepared');
 const runtime=await f.build();await runtime.transition(f.actor,f.task.id,{action:'resume'});await runtime.tick();
 const after=await runtime.store.history(f.actor,f.task.id);assert.equal(after.calls.length,1);assert.equal(after.calls[0].id,before.calls[0].id);assert.equal(after.calls[0].status,'failed');assert.equal((await f.pool.query('SELECT * FROM effects')).rowCount,0);
}));
test('Cancellation prevents the unexecuted remainder of an unknown batch',async()=>fixture(async f=>{
 f.unknown();await f.runtime.tick();await f.runtime.transition(f.actor,f.task.id,{action:'cancel'});await f.build();assert.equal(await f.runtime.tick(),null);assert.equal((await f.pool.query('SELECT * FROM effects')).rowCount,1);assert.equal(f.requests(),1);
}));
test('Legacy executor is rejected before model work and releases its acquired session',async()=>{
 let closed=0;const store={initialize:async()=>{},acquireExecutor:async()=>({close:async()=>{closed++;}})};
 const options={store,model:{name:'fixture'},context:new ContextAssembler({skillRoot:'/tmp'}),version:'fixture'};
 const runtime=new AgentRuntime({...options,maxBatchCalls:2});await assert.rejects(runtime.initialize(),{statusCode:503});assert.equal(closed,1);assert.equal(runtime.executor,null);
 const legacy=new AgentRuntime(options);assert.equal((await legacy.initialize()).ready,true);await legacy.stop();assert.equal(closed,2);
 assert.throws(()=>new AgentRuntime({...options,maxBatchCalls:2,context:{assemble:async()=>[]}}),/history revalidation/);
});
test('Adapter dropping batch receipt metadata cannot dispatch an external effect',async()=>fixture(async f=>{
 const prepare=f.runtime.executor.prepareBatchAction.bind(f.runtime.executor);
 f.runtime.executor.prepareBatchAction=async(...args)=>{const row=await prepare(...args);return {...row,action_ref:null};};
 const done=await f.runtime.tick();assert.equal(done.status,'waiting');assert.match(done.error,/not durably preserved/);assert.equal((await f.pool.query('SELECT * FROM effects')).rowCount,0);
 const h=await f.runtime.store.history(f.actor,f.task.id);assert.equal(h.calls.length,1);assert.equal(h.calls[0].status,'prepared');
}));
