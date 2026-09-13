import test from 'node:test';import assert from 'node:assert/strict';
import {ExecutionPolicy,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
test('Execution policy decisions and recording must succeed without widening base permission or mutating input',async()=>{
 let executions=0,permission=true,decision={allowed:true,revision:'r1',reason:'enabled'},recorded=[];
 const capability=defineCapability({name:'record.write',description:'Fixture',input:{type:'object'},output:{type:'object'},effect:'write',retry:'never-replay',authorize:()=>permission,revalidate:(_i,r)=>r,implementation:{kind:'function',execute:()=>{executions++;return {};}}});
 const policy=new ExecutionPolicy({decide:request=>{assert.ok(Object.isFrozen(request.input));return decision;},record:async record=>{recorded.push(record);return {id:'record-'+recorded.length};}});
 const dispatcher=new CapabilityDispatcher({capabilities:[capability],executionPolicy:policy}),context={actor:{subjectId:'owner'},callId:'original'},input={secret:'payload never auto-audited'};
 await dispatcher.invoke(capability.name,input,context);assert.equal(executions,1);assert.equal(recorded[0].input,undefined);assert.equal(input.secret,'payload never auto-audited');
 decision={allowed:false,revision:'r2',reason:'flag disabled',risk:'host-classification'};await assert.rejects(dispatcher.invoke(capability.name,input,context),e=>e.code==='EXECUTION_POLICY_DENIED'&&e.policyDecision.recordId==='record-2');assert.equal(executions,1);
 permission=false;decision={allowed:true,revision:'r3',reason:'enabled'};await assert.rejects(dispatcher.invoke(capability.name,input,context),{statusCode:403});assert.equal(recorded.length,2);permission=true;
 for(const invalid of [true,{allowed:'yes',revision:'r',reason:'x'},{allowed:true,revision:'',reason:'x'},{allowed:true,revision:'r',reason:'x',grant:['all']}]){decision=invalid;await assert.rejects(dispatcher.invoke(capability.name,input,context),{code:'EXECUTION_POLICY_INVALID'});}
 decision={allowed:true,revision:'r3',reason:'enabled'};policy.record=async()=>null;await assert.rejects(dispatcher.invoke(capability.name,input,context),{code:'EXECUTION_POLICY_UNRECORDED'});assert.equal(executions,1);
 dispatcher.executionPolicy={check:async()=>true};await assert.rejects(dispatcher.invoke(capability.name,input,context),{statusCode:503});assert.equal(executions,1);
 let admissions=0;const agent=defineCapability({name:'agent.fixture',description:'Fixture',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Fixture',tools:[],verify:()=>true}});
 const custom=new CapabilityDispatcher({capabilities:[agent],tasks:{create:()=>{admissions++;return {}; }},executionPolicy:{check:async()=>{throw Object.assign(new Error('Disabled'),{statusCode:403});}}});
 await assert.rejects(custom.invoke(agent.name,{}, {actor:{subjectId:'owner',scopeId:'scope'},callId:'task'}),{statusCode:403});assert.equal(admissions,0);
});
