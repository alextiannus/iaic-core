import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {TaskStore,AgentRuntime,ContextAssembler,CapabilityDispatcher,defineCapability,createTaskControlCapabilities} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('Task get exposes the current input question under history permissions and clears it after cancellation',{skip:!url},async()=>{
 const schema='input_view_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:url});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime;
 try{let sourceAllowed=true,turn=0;const actor={scopeId:'fixture',subjectId:'owner'},authorize=a=>a.subjectId===actor.subjectId;
 const source=defineCapability({name:'source.read',description:'Read fixture source',input:{type:'object'},output:{type:'object'},effect:'read',authorize:a=>authorize(a)&&sourceAllowed,revalidate:()=>({value:'source'}),implementation:{kind:'function',execute:()=>({value:'source'})}});
 const agent=defineCapability({name:'work.run',description:'Ask a source-dependent question',input:{type:'object'},output:{type:'object'},effect:'read',authorize,implementation:{kind:'agent',instructions:'Read and ask.',tools:[source.name],verify:()=>true}});
 const ports={get:(...args)=>runtime.get(...args),state:(...args)=>runtime.state(...args),transition:(...args)=>runtime.transition(...args)};
 const dispatcher=new CapabilityDispatcher({capabilities:[source,agent,...createTaskControlCapabilities({runtime:ports,authorize})]});runtime=new AgentRuntime({store:new TaskStore({pool}),dispatcher,context:new ContextAssembler({skillRoot:'/tmp'}),version:'fixture',model:{name:'fixture',next:()=>++turn===1?{type:'call',name:source.name,input:{}}:{type:'wait',question:turn===2?'Use this source?':'Which part of this source?'}}});dispatcher.tasks=runtime;await runtime.initialize();
 const task=await dispatcher.invoke(agent.name,{},{actor,callId:'question'});assert.equal((await dispatcher.invoke('tasks.get',{id:task.id},{actor})).inputRequest,null);await runtime.tick();
 const first=(await dispatcher.invoke('tasks.get',{id:task.id},{actor})).inputRequest;assert.equal(first.question,'Use this source?');assert.match(first.reference,/^\d+$/);
 await dispatcher.invoke('tasks.provide_input',{id:task.id,input:'Please clarify'},{actor,callId:'answer'});assert.equal((await runtime.get(actor,task.id)).inputRequest,null);await runtime.tick();
 const second=(await runtime.get(actor,task.id)).inputRequest;assert.equal(second.question,'Which part of this source?');assert.notEqual(second.reference,first.reference);
 sourceAllowed=false;await assert.rejects(dispatcher.invoke('tasks.get',{id:task.id},{actor}),{statusCode:403});assert.equal((await dispatcher.invoke('tasks.state',{id:task.id},{actor})).status,'waiting');
 await dispatcher.invoke('tasks.cancel',{id:task.id},{actor,callId:'cancel'});sourceAllowed=true;assert.equal((await runtime.get(actor,task.id)).inputRequest,null);
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
