import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {TaskStore} from '../tasks/store.js';import {AgentRuntime} from '../agent/runtime.js';import {defineCapability,CapabilityDispatcher} from '../capabilities/index.js';
import {ContextAssembler} from '../context/index.js';import {TokenLedger} from '../billing/token-ledger.js';import {meteredModel} from '../billing/metered-model.js';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
const gate=()=>{let enter,release;const reached=new Promise(r=>enter=r),done=new Promise(r=>release=r);return {reached,release,wait:async()=>{enter();await done;}};};
async function fixture(run){const admin=new Pool({connectionString:url}),schema='handoff_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`}),runtimes=[];try{await run({pool,admin,runtimes});}finally{for(const r of runtimes)await r.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
const actor={scopeId:'fixture',subjectId:'owner'},shape={type:'object'};
const agent=(tools=['records.write'])=>defineCapability({name:'agent.work',description:'Test',input:shape,output:shape,effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Fixture',tools,verify:async()=>true}});
test('rolling handoff drains all four boundaries without premature recovery or duplicate writes',{skip:!url},async t=>{
 for(const stage of ['before_model','provider_accepted','before_usage_settlement','tool_dispatched'])await t.test(stage,async()=>fixture(async({pool,runtimes})=>{
  const barrier=gate(),ledger=new TokenLedger({pool});await ledger.initialize();const scope={applicationId:'fixture',subjectId:'owner'};await ledger.grant(scope,{reference:'fixture',amount:1000,evidence:{kind:'fixture'}});
  let calls=0,writes=0,paused=false;
  const pause=async at=>{if(stage===at&&!paused){paused=true;await barrier.wait();}};
  const raw={name:'fixture',next:async()=>{calls++;await pause('provider_accepted');return {...(stage==='tool_dispatched'&&calls===1?{type:'call',name:'records.write',input:{}}:{type:'finish',result:{done:true}}),usage:{inputTokens:2,outputTokens:1}};}};
  const gatewayLedger={hasPendingTask:(...a)=>ledger.hasPendingTask(...a),reserve:(...a)=>ledger.reserve(...a),release:(...a)=>ledger.release(...a),markUnknown:(...a)=>ledger.markUnknown(...a),settle:async(...a)=>{await pause('before_usage_settlement');return ledger.settle(...a);}};
  const model=meteredModel({model:raw,ledger:gatewayLedger,scope,policy:{maximum:20,price:{revision:'v1',input:1,output:1,cachedInput:1}}});
  const write=defineCapability({name:'records.write',description:'Fixture',input:shape,output:shape,effect:'write',retry:'never-replay',authorize:()=>true,revalidate:async(_i,r)=>r,implementation:{kind:'function',execute:async()=>{writes++;await pause('tool_dispatched');return {receipt:'original'};}}});
  const open=async(handoff=false)=>{const store=new TaskStore({pool}),dispatcher=new CapabilityDispatcher({capabilities:[agent(),write]}),base=new ContextAssembler({skillRoot:'/tmp'});const context={assemble:async r=>{await pause('before_model');return base.assemble(r);},revalidateHistory:r=>base.revalidateHistory(r)};const runtime=new AgentRuntime({store,dispatcher,model,context,version:'v1'});dispatcher.tasks=runtime;runtimes.push(runtime);await runtime.initialize({requestHandoff:handoff});return runtime;};
  const first=await open(),task=await first.dispatcher.invoke('agent.work',{}, {actor,callId:'first'}),running=first.tick();await barrier.reached;
  const second=await open(true);assert.equal(second.ready,false);const state=await second.deploymentState();assert.equal(state.acceptingTicks,true);assert.equal(state.ownership.state,'draining');assert.equal(await second.tick(),null);assert.equal((await second.store.get(actor,task.id)).status,'running');
  const queued=await second.dispatcher.invoke('agent.work',{}, {actor,callId:'second'});
  barrier.release();assert.equal((await running).status,'succeeded');assert.equal(await first.tick(),null);assert.equal(first.ready,false);
  assert.equal((await second.store.get(actor,queued.id)).status,'queued');assert.equal((await second.tick()).id,queued.id);assert.equal((await second.store.get(actor,queued.id)).status,'succeeded');
  assert.equal((await first.store.history(actor,task.id)).events.some(e=>e.kind==='interrupted'),false);assert.equal(writes,stage==='tool_dispatched'?1:0);assert.equal((await ledger.balance(scope)).reserved,'0');assert.equal((await second.deploymentState()).generation,'2');
  assert.equal(await second.store.requestExecutorDrain({generation:'1'}),false);assert.equal(await first.tick(),null); // old instance never re-acquires
 }));
});
test('bounded host drain retains the lock until work exits; lost sessions alone authorize recovery',{skip:!url},async()=>fixture(async({pool,admin,runtimes})=>{
 const store=new TaskStore({pool}),dispatcher=new CapabilityDispatcher({capabilities:[agent([])]}),barrier=gate();
 const first=new AgentRuntime({store,dispatcher,model:{name:'fixture',next:async()=>{await barrier.wait();return {type:'finish',result:{done:true}};}},context:new ContextAssembler({skillRoot:'/tmp'}),version:'v1'});runtimes.push(first);dispatcher.tasks=first;await first.initialize();await dispatcher.invoke('agent.work',{}, {actor,callId:'one'});const running=first.tick();await barrier.reached;
 assert.deepEqual(await first.drain({timeoutMs:1}),{drained:false,requiresTermination:true});assert.equal(await store.acquireExecutor(),null);assert.equal(await first.tick(),null);barrier.release();await running;assert.deepEqual(await first.drain({timeoutMs:1}),{drained:true,requiresTermination:false});
 const old=await store.acquireExecutor();const task=await store.create({actor,capability:'agent.work',input:{},idempotencyKey:'crash',version:'v1',model:'fixture'});await old.claim('v1');const call=await old.prepare(task.id,{capability:'records.write',input:{},effect:'write'});await old.dispatch(task.id,call.id);
 const pid=(await old.connection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;await admin.query('SELECT pg_terminate_backend($1)',[pid]);await assert.rejects(old.prepare(task.id,{capability:'records.write',input:{},effect:'write'}));await old.close();
 const successor=await store.acquireExecutor();try{assert.equal((await store.get(actor,task.id)).waiting_reason,'interrupted');assert.equal((await store.history(actor,task.id)).calls[0].status,'unknown');await assert.rejects(store.transition(actor,task.id,{action:'resume',version:'v1'}),/uncertain/);}finally{await successor.close();}
}));

test('actual SIGTERM timeout requires process exit before recovery and preserves reserved usage',{skip:!url},async()=>fixture(async({pool})=>{
 const {fork}=await import('node:child_process');const {once}=await import('node:events');
 const schema=(await pool.query('SELECT current_schema() AS name')).rows[0].name;
 const child=fork(new URL('../test-support/executor-drain-worker.mjs',import.meta.url),[],{env:{...process.env,IAIC_TEST_SCHEMA:schema},stdio:['ignore','ignore','pipe','ipc']});
 let stderr='';child.stderr.on('data',b=>{stderr+=b;});
 const accepted=new Promise((resolve,reject)=>{child.on('message',m=>{if(m.kind==='accepted')resolve(m);});child.once('error',reject);child.once('exit',()=>reject(Error(stderr||'Exited before checkpoint')));});
 let drain;
 child.on('message',m=>{if(m.kind==='drain')drain=m;});
 try{
  const task=await accepted,store=new TaskStore({pool}),exited=once(child,'exit');assert.equal(await store.acquireExecutor(),null);child.kill('SIGTERM');assert.equal((await exited)[0],0);assert.deepEqual(drain,{kind:'drain',drained:false,requiresTermination:true});
  let next;for(let i=0;i<50&&!next;i++){next=await store.acquireExecutor();if(!next)await new Promise(r=>setTimeout(r,10));}assert.ok(next);
  try{assert.equal((await store.get(actor,task.taskId)).waiting_reason,'interrupted');const ledger=new TokenLedger({pool});const pending=await ledger.pending({applicationId:'fixture',subjectId:'owner'});assert.equal(pending.length,1);assert.equal(pending[0].state,'reserved');assert.equal((await store.history(actor,task.taskId)).calls.length,0);}finally{await next.close();}
 }finally{if(child.exitCode===null){child.kill('SIGKILL');await once(child,'exit');}}
}));

test('old Runtime cannot regain ownership after session loss during requested drain',{skip:!url},async()=>fixture(async({pool,admin,runtimes})=>{
 const open=async requestHandoff=>{const store=new TaskStore({pool}),dispatcher=new CapabilityDispatcher({capabilities:[agent([])]}),runtime=new AgentRuntime({store,dispatcher,version:'v1',model:{name:'fixture',next:async()=>({type:'finish',result:{}})},context:new ContextAssembler({skillRoot:'/tmp'})});dispatcher.tasks=runtime;runtimes.push(runtime);await runtime.initialize({requestHandoff});return runtime;};
 const old=await open(false),next=await open(true);const pid=(await old.executor.connection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 await admin.query('SELECT pg_terminate_backend($1)',[pid]);await assert.rejects(old.executor.claim('v1'));assert.equal(await old.tick(),null);assert.equal(old.retired,true);assert.equal(await next.tick(),null);assert.equal(next.ready,true);assert.equal((await next.deploymentState()).generation,'2');assert.equal(await old.tick(),null);
}));
