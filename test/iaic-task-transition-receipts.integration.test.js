import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Pool} from 'pg';
import {AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,defineCapability,createTaskControlCapabilities} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL,actor={scopeId:'fixture-app',subjectId:'owner'};
async function fixture(run){
 const schema='transitions_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:url});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime;let allowed=true;
 const cap=defineCapability({name:'work.run',description:'Transition fixture',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>allowed,implementation:{kind:'agent',instructions:'Fixture',tools:[],verify:()=>true}}),dispatcher=new CapabilityDispatcher({capabilities:[cap]});
 const rebuild=async()=>{await runtime?.stop();runtime=new AgentRuntime({store:new TaskStore({pool}),dispatcher,model:{name:'fixture',next:()=>{throw new Error('No model expected');}},context:new ContextAssembler({skillRoot:'/tmp'}),version:'v1'});dispatcher.tasks=runtime;await runtime.initialize();return runtime;};
 try{await rebuild();const task=await runtime.create({actor,capability:cap,input:{goal:'Wait for clarification'},idempotencyKey:'task'});await runtime.executor.claim('v1');await runtime.executor.finish(task.id,{status:'waiting',reason:'input'});await run({schema,pool,task,runtime,rebuild,deny:()=>{allowed=false;}});}finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Clarification receipt survives worker SIGKILL and cannot answer a later wait twice',{skip:!url},async()=>fixture(async({schema,task,runtime,rebuild})=>{
 await runtime.stop();const child=spawn(process.execPath,[new URL('../test-support/task-transition-worker.mjs',import.meta.url).pathname],{env:{...process.env,IAIC_TRANSITION_WORKER:JSON.stringify({schema,id:task.id,actor})},stdio:['ignore','pipe','pipe','ipc']});let stderr='';child.stderr.on('data',data=>{stderr+=data;});
 try{const signal=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error('Worker exited before barrier: '+stderr);}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Worker barrier timeout')),15000);timer.unref();})]);assert.equal(signal[0].committed,true);const closed=once(child,'close');child.kill('SIGKILL');assert.equal((await closed)[1],'SIGKILL');}finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'close');}}
 runtime=await rebuild();const original=await runtime.transitionReceipt(actor,task.id,'original-request');assert.equal(original.status,'confirmed');assert.equal(original.task.status,'queued');
 await runtime.executor.claim('v1');await runtime.executor.finish(task.id,{status:'waiting',reason:'input'});
 const replay=await runtime.transition(actor,task.id,{action:'provide_input',input:'original clarification',requestKey:'original-request'});assert.deepEqual(replay,original.task);assert.equal((await runtime.state(actor,task.id)).status,'waiting');
 assert.equal((await runtime.store.history(actor,task.id)).events.filter(event=>event.kind==='input').length,1);
 await assert.rejects(runtime.transition(actor,task.id,{action:'provide_input',input:'different clarification',requestKey:'original-request'}),{statusCode:409});
 await runtime.transition(actor,task.id,{action:'provide_input',input:'new clarification',requestKey:'new-request'});assert.equal((await runtime.store.history(actor,task.id)).events.filter(event=>event.kind==='input').length,2);
}));
test('Concurrent transition keys bind original results and current receipt reads enforce Task access',{skip:!url},async()=>fixture(async({task,runtime,deny})=>{
 const controls=new CapabilityDispatcher({capabilities:createTaskControlCapabilities({runtime,authorize:()=>true,receipts:true})}),request={id:task.id,input:'same'};
 const [a,b]=await Promise.all([controls.invoke('tasks.provide_input',request,{actor,callId:'same-key'}),controls.invoke('tasks.provide_input',request,{actor,callId:'same-key'})]);assert.deepEqual(a,b);assert.equal((await runtime.store.history(actor,task.id)).events.filter(event=>event.kind==='input').length,1);
 assert.equal((await controls.invoke('tasks.control_result',{id:task.id,requestKey:'same-key'},{actor})).status,'confirmed');
 assert.equal((await controls.invoke('tasks.control_result',{id:task.id,requestKey:'missing-key'},{actor})).status,'unknown');
 await assert.rejects(runtime.transitionReceipt({...actor,subjectId:'other'},task.id,'same-key'),{statusCode:404});
 await assert.rejects(runtime.transition(actor,task.id,{action:'resume',requestKey:'same-key'}),{statusCode:409});
 deny();await assert.rejects(runtime.transitionReceipt(actor,task.id,'same-key'),{statusCode:403});await assert.rejects(runtime.transition(actor,task.id,{action:'provide_input',input:'same',requestKey:'same-key'}),{statusCode:403});
}));
test('Transition and receipt insert roll back together; legacy transitions remain available',{skip:!url},async()=>fixture(async({task,pool,runtime})=>{
 await pool.query("CREATE FUNCTION reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture receipt failure'; END $$");await pool.query('CREATE TRIGGER reject_receipt BEFORE INSERT ON iaic_task_transition_receipts FOR EACH ROW EXECUTE FUNCTION reject_receipt()');
 await assert.rejects(runtime.transition(actor,task.id,{action:'provide_input',input:'rollback me',requestKey:'failed'}),/fixture receipt failure/);
 assert.equal((await runtime.state(actor,task.id)).status,'waiting');assert.equal((await runtime.store.history(actor,task.id)).events.filter(event=>event.kind==='input').length,0);assert.equal((await runtime.transitionReceipt(actor,task.id,'failed')).status,'unknown');
 await pool.query('DROP TRIGGER reject_receipt ON iaic_task_transition_receipts');
 await runtime.transition(actor,task.id,{action:'provide_input',input:'legacy call'});assert.equal((await runtime.state(actor,task.id)).status,'queued');
 await runtime.executor.claim('v1');await runtime.executor.finish(task.id,{status:'waiting',reason:'limit'});const resumed=await runtime.transition(actor,task.id,{action:'resume',requestKey:'resume-key'});assert.equal(resumed.status,'queued');assert.equal((await runtime.transitionReceipt(actor,task.id,'resume-key')).status,'confirmed');
}));
