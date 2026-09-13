import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {LocalSimulation,createScriptedModel,TaskStore,AgentRuntime,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;
if(!connectionString)throw new Error('Isolated PostgreSQL required');
const schema='simulation_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
try{
 const actor={scopeId:'local',subjectId:'developer'},world=new LocalSimulation({initialState:{count:0},resolveScope:a=>JSON.stringify([a.scopeId,a.subjectId])});
 const authorize=a=>a.scopeId===actor.scopeId&&a.subjectId===actor.subjectId;
 const add=world.capability({definition:{name:'counter.add',description:'Simulated counter write',input:{type:'object',properties:{amount:{type:'integer'}},required:['amount'],additionalProperties:false},output:{type:'integer'},effect:'write',retry:'idempotent',authorize},reduce:({state,input})=>({state:{count:state.count+input.amount},result:state.count+input.amount}),loseResponse:true});
 const read=world.capability({definition:{name:'counter.read',description:'Read simulated counter',input:{type:'object',additionalProperties:false},output:{type:'integer'},effect:'read',authorize},reduce:({state})=>({state,result:state.count})});
 const agent=defineCapability({name:'counter.work',description:'Verify simulation composition',input:{type:'object'},output:{type:'object'},effect:'read',authorize,implementation:{kind:'agent',instructions:'Add three and verify current counter',tools:[add.name,read.name],verify:async(_input,result,{history})=>result.count===3&&world.snapshot(JSON.stringify([actor.scopeId,actor.subjectId])).count===3&&history.calls.some(c=>c.capability===read.name&&c.result===3)}});
 const steps=[{response:{type:'call',name:add.name,input:{amount:3}}},{response:{type:'call',name:read.name,input:{}}},{response:{type:'finish',result:{count:3}}}];
 const store=new TaskStore({pool}),dispatcher=new CapabilityDispatcher({capabilities:[add,read,agent]});
 const build=()=>{const rt=new AgentRuntime({store,dispatcher,model:createScriptedModel({steps}),context:new ContextAssembler({skillRoot:'/tmp'}),version:'simulation-v1'});dispatcher.tasks=rt;return rt;};
 runtime=build();await runtime.initialize();const task=await runtime.create({actor,capability:agent,input:{goal:'Add and verify three',allowedTools:[add.name,read.name]},idempotencyKey:'simulation'});
 assert.equal((await runtime.tick()).status,'waiting');const history=await store.history(actor,task.id);assert.equal(history.calls.length,1);assert.equal(history.calls[0].status,'unknown');
 await runtime.stop();runtime=build();await runtime.initialize();
 const receipt=await add.reconcile({amount:3},{actor,callId:history.calls[0].id});assert.equal(receipt.confirmed,true);await store.resolveCall(actor,task.id,history.calls[0].id,receipt.result);
 await runtime.transition(actor,task.id,{action:'resume'});const done=await runtime.tick();assert.equal(done.status,'succeeded',done.error);
 const final=await store.history(actor,task.id);assert.equal(final.calls.filter(c=>c.capability===add.name).length,1);assert.equal(final.events.filter(e=>e.kind==='model_requested').length,3);
 assert.equal(await dispatcher.invoke(add.name,{amount:3},{actor,callId:history.calls[0].id}),3);
 console.log(JSON.stringify({example:'core-simulation',status:'passed',simulatedCount:3,originalWriteCalls:1,modelTurns:3,runtimeReconstructed:true,worldPreservedInMemory:true,actualModel:false,productionAccessed:false}));
}finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
