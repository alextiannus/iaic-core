import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Operations} from '@immedi/iaic-core/operations/service.js';
import {createOperationsCapabilities} from '@immedi/iaic-core/operations/capabilities.js';
const now=Date.parse('2026-09-25T15:00:00Z');
const ref=id=>({source:'fixture',id,revision:'1'});
const envelope=(items,complete=true)=>({items,complete,observedAt:new Date(now-1000).toISOString(),validUntil:new Date(now+1000).toISOString(),reference:ref('snapshot')});
const agent=(id='a')=>({id,name:id,role:'platform',location:'internal',lifecycle:'active',workspaceId:'workspace',principalId:'principal',reference:ref(id)});
const signal=()=>({id:'worker',kind:'executor',state:'healthy',basis:'observed',observedAt:new Date(now-1000).toISOString(),validUntil:new Date(now+1000).toISOString(),reason:'reachable',reference:ref('worker')});
const task=()=>({id:'task',status:'waiting',waitingReason:'input',resultState:'pending',reference:ref('task')});
function fixture() {
 const state={scope:'viewer/tenant/workspace/market/rev1',permitted:true,signal:signal(),tasks:[task()]};
 const options={namespace:'app',cursorKey:randomBytes(32),clock:()=>now,timeoutMs:20,resolveScope:a=>state.scope+'/'+a.id,authorize:()=>state.permitted,
  listAgents:async({after})=>({items:[agent(after?'b':'a')],next:after?null:'second',complete:true}),readAgent:async({id})=>agent(id),
  sources:{tasks:async()=>envelope(state.tasks),signals:async()=>envelope(state.signal?[state.signal]:[]),models:async()=>envelope([]),interactions:async()=>envelope([])}};
 return {state,options,operations:new Operations(options),actor:{id:'viewer'}};
}
test('Waiting activity, lifecycle and runtime health are independent; no signals or self reports do not prove health',async()=>{
 const {state,operations,actor}=fixture();let result=await operations.agent(actor,'a');assert.equal(result.activity,'waiting');assert.equal(result.health.state,'healthy');assert.equal(result.taskCounts.waiting,1);
 state.tasks=[];result=await operations.agent(actor,'a');assert.equal(result.activity,'idle');
 state.signal.basis='reported';assert.equal((await operations.agent(actor,'a')).health.state,'unknown');
 state.signal=null;assert.equal((await operations.agent(actor,'a')).health.state,'unknown');
});
test('Stale/future evidence cannot become current health and incomplete coverage is explicit',async()=>{
 const {state,options,actor}=fixture();state.signal.validUntil=new Date(now-1).toISOString();let operations=new Operations(options);let result=await operations.agent(actor,'a');assert.equal(result.health.state,'unknown');assert.equal(result.signals[0].freshness,'stale');
 state.signal=signal();state.signal.observedAt=new Date(now+1).toISOString();assert.equal((await operations.agent(actor,'a')).health.state,'unknown');
 state.signal=signal();options.sources.signals=async()=>({...envelope([state.signal]),validUntil:new Date(now-1).toISOString()});operations=new Operations(options);assert.equal((await operations.agent(actor,'a')).health.state,'unknown');
 options.sources.signals=async()=>envelope([signal()],false);assert.equal((await new Operations(options).agent(actor,'a')).health.complete,false);
});
test('Partial/timeout sources remain explicit, closed contracts reject private fields, and read denial fails closed',async()=>{
 const {options,actor}=fixture();options.sources.tasks=async()=>new Promise(()=>{});options.sources.models=async()=>({...envelope([]),apiKey:'must-never-escape'});
 let operations=new Operations(options),result=await operations.agent(actor,'a');assert.equal(result.activity,'unknown');assert.equal(result.sources.tasks.state,'timeout');assert.equal(result.sources.models.state,'invalid-source');assert.ok(!JSON.stringify(result).includes('must-never-escape'));
 options.sources.interactions=async()=>{throw Object.assign(Error('private error'),{statusCode:403});};await assert.rejects(new Operations(options).agent(actor,'a'),{statusCode:403});
});
test('Current authorization and observer scope bind cursors, source reads, counts and cached capability revalidation',async()=>{
 const {options,operations,actor,state}=fixture();const first=await operations.agents(actor);assert.equal((await operations.agents(actor,{cursor:first.nextCursor})).items[0].id,'b');
 await assert.rejects(operations.agents({id:'other'},{cursor:first.nextCursor}),{statusCode:400});state.scope+='-changed';await assert.rejects(operations.agents(actor,{cursor:first.nextCursor}),{statusCode:400});
 state.permitted=false;await assert.rejects(operations.overview(actor),{statusCode:403});
 const capability=createOperationsCapabilities({operations}).find(c=>c.name==='operations.agents');await assert.rejects(capability.revalidate({},first,{actor}),{statusCode:403});state.permitted=true;
 options.sources.tasks=async()=>{state.permitted=false;return envelope([task()]);};await assert.rejects(new Operations(options).agent(actor,'a'),{statusCode:403});
});
test('One failed Agent detail does not hide other visible rows; overview counts only returned authorized page',async()=>{
 const {options,actor}=fixture();options.listAgents=async()=>({items:[agent('a'),agent('b'),agent('hidden')],next:null,complete:true});options.authorize=(_a,q)=>q.id!=='hidden';options.readAgent=async({id})=>{if(id==='a')throw Error('Unavailable');return agent(id);};
 const result=await new Operations(options).overview(actor);assert.deepEqual(result.items.map(x=>x.agent.id),['b']);assert.equal(result.complete,false);assert.deepEqual(result.count,{scope:'returned-page',agents:1,healthUnknown:0});assert.ok(!JSON.stringify(result).includes('hidden'));
});
test('Model requested/bound/actual are retained separately; unknown operation results do not imply a dead worker',async()=>{
 const {state,options,actor}=fixture();state.tasks=[{...task(),resultState:'unknown',waitingReason:'external_result'}];
 options.sources.models=async()=>envelope([{taskId:'task',configuredProfileRef:'default-a',boundModel:'model-b',requestedModel:'model-b',actualModel:null,provider:null,basis:'observed',reference:ref('model-binding')}]);
 const result=await new Operations(options).agent(actor,'a');assert.equal(result.models[0].actualModel,null);assert.equal(result.models[0].boundModel,'model-b');assert.equal(result.taskCounts.unknownResults,1);assert.equal(result.health.state,'healthy');
});
