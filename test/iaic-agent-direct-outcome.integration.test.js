import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,createAgentTaskCapabilities} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('Application can verify a direct Agent answer without forcing a tool call, while rejecting incorrect output',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='direct_outcome_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime;
 try{
 const actor={subjectId:'owner',scopeId:'fixture'};let checks=0;
 const capabilities=createAgentTaskCapabilities({memory:{},workspace:{},authorize:()=>true,verifyOutcome:async(input,result)=>{checks++;assert.equal(input.goal,'Compute 2 + 3 using the supplied numbers.');return result.summary===String(2+3)?true:{verified:false,feedback:'The arithmetic result is incorrect. Recalculate from the supplied numbers.'};}});
 const cap=capabilities.find(c=>c.name==='assistant.run'),dispatcher=new CapabilityDispatcher({capabilities});
 runtime=new AgentRuntime({store:new TaskStore({pool}),dispatcher,context:new ContextAssembler({}),version:'direct-v1',model:{name:'fixture',next:async({messages,tools})=>{assert.equal(tools.length,0);const data=JSON.parse(messages[1].content);return {type:'finish',result:{summary:data.events.some(e=>e.kind==='verification'&&!e.data.verified)?'5':'4',artifacts:[]}};}}});dispatcher.tasks=runtime;await runtime.initialize();
 const task=await runtime.create({actor,capability:cap,input:{goal:'Compute 2 + 3 using the supplied numbers.',allowedTools:[]},idempotencyKey:'direct-answer'});assert.equal((await runtime.tick()).status,'succeeded');assert.equal(checks,2);
 const history=await runtime.store.history(actor,task.id);assert.equal(history.calls.length,0);assert.deepEqual(history.events.filter(e=>e.kind==='verification').map(e=>e.data.verified),[false,true]);assert.equal((await runtime.get(actor,task.id)).result.summary,'5');
 const forged={path:'forged.md',revision:1,digest:'a'.repeat(64)};assert.equal(await cap.implementation.verify({},{summary:'5',artifacts:[forged]},{actor,history:{calls:[]}}),false);assert.equal(checks,2);
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
