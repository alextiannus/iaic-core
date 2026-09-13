import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {AgentIdentityStore,AgentRegistry,AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
const connectionString=process.env.DATABASE_URL||process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL URL required');
const admin=new Pool({connectionString}),schema='identities_example_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
try{
 const identities=new AgentIdentityStore({pool});await identities.initialize();const definitions=['user-assistant','business','platform'].map(role=>({id:role,role,purpose:'Perform '+role+' scoped work.',capabilities:[role+'.work']}));
 const registry=new AgentRegistry({store:identities,definitions,resolveScope:async actor=>({applicationId:actor.scopeId,subjectId:actor.subjectId}),authorizeStateChange:async()=>true});
 const capabilities=definitions.map(d=>defineCapability({name:d.capabilities[0],description:d.purpose,input:{type:'object',properties:{goal:{type:'string'}},required:['goal'],additionalProperties:false},output:{type:'object',properties:{role:{const:d.role}},required:['role'],additionalProperties:false},effect:'write',retry:'never-replay',authorize:async actor=>actor.subjectId===d.role,implementation:{kind:'agent',instructions:'Return the execution role.',tools:[],verify:async(_i,r)=>r.role===d.role}}));
 const dispatcher=new CapabilityDispatcher({capabilities}),store=new TaskStore({pool}),seen=[];
 const model={name:'identity-fixture',next:async({messages})=>{const {agent}=JSON.parse(messages[1].content);seen.push(agent);return {type:'finish',result:{role:agent.role}};}};
 const agentIdentity={bind:({actor,capability})=>registry.bind(actor,actor.subjectId,capability.name),check:({actor,task,binding})=>registry.check(actor,binding,task.capability)};
 runtime=new AgentRuntime({store,dispatcher,model,context:new ContextAssembler({skillRoot:process.cwd()}),version:'identity-example-v1',agentIdentity});dispatcher.tasks=runtime;await runtime.initialize();
 for(const d of definitions){const actor={scopeId:'identity-demo',subjectId:d.role};const task=await dispatcher.invoke(d.capabilities[0],{goal:'Describe execution role'},{actor,callId:d.role});assert.equal((await runtime.tick()).status,'succeeded');assert.deepEqual(await registry.check(actor,task.agent,task.capability),task.agent);assert.equal((await new AgentIdentityStore({pool}).get({applicationId:actor.scopeId,subjectId:actor.subjectId,definitionId:d.id})).id,task.agent.instanceId);}
 assert.equal(new Set(seen.map(x=>x.instanceId)).size,3);
 console.log(JSON.stringify({application:'core-identities',roles:seen.map(x=>x.role),sameRuntime:true,durableIdentity:true,erpUsed:false,modelMode:'deterministic'}));
}finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
