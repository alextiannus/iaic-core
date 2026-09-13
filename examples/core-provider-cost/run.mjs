import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {TokenLedger,PostgresModelCapacity,capacityModel,ProviderCostAccounting,meteredModel,TaskStore,AgentRuntime,ContextAssembler,CapabilityDispatcher,defineCapability,createTaskObservationSource} from '@immedi/iaic-core';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
const schema='cost_example_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
try{
 const actor={scopeId:'example',subjectId:'owner'},scope={applicationId:'example',subjectId:'owner'},ledger=new TokenLedger({pool});await ledger.initialize();await ledger.grant(scope,{reference:'fixture',amount:'1000',evidence:{fixture:true}});
 const costBasis={format:'iaic.provider-cost.v1',revision:'fixture-prices-v1',currency:'USD',minorUnitScale:2,bearer:'platform',accountReference:'fixture-provider',model:'fixture',inputPerMillionMinor:'300',cachedInputPerMillionMinor:'30',outputPerMillionMinor:'1200',missingCachedInput:'incomplete'};
 const capacity=new PostgresModelCapacity({pool,namespace:'fixture-provider-account',maxConcurrent:1});await capacity.initialize();
 const model=meteredModel({model:capacityModel({capacity,model:{name:'fixture',next:async()=>({type:'finish',result:{done:true},usage:{inputTokens:100,cachedInputTokens:20,outputTokens:50,reasoningOutputTokens:10}})}}),ledger,scope,policy:{maximum:'500',price:{revision:'allowance-v1',input:'2',cachedInput:'1',output:'3'},costBasis}});
 const cap=defineCapability({name:'cost.demo',description:'Run the deterministic cost fixture',input:{type:'object'},output:{type:'object'},effect:'read',authorize:a=>a.subjectId==='owner',implementation:{kind:'agent',instructions:'Return the fixture result',tools:[],verify:async(_i,r)=>r.done===true}});
 const tasks=new TaskStore({pool}),dispatcher=new CapabilityDispatcher({capabilities:[cap]});runtime=new AgentRuntime({store:tasks,dispatcher,model,context:new ContextAssembler({skillRoot:'/tmp'}),version:'cost-example-v1'});dispatcher.tasks=runtime;await runtime.initialize();
 const task=await runtime.create({actor,capability:cap,input:{goal:'Complete the deterministic cost fixture'},idempotencyKey:'cost'});assert.equal((await runtime.tick()).status,'succeeded');assert.equal((await capacity.pending()).items.length,0);
 const costs=new ProviderCostAccounting({ledger:new TokenLedger({pool})}),summary=await costs.task(scope,task.id);assert.equal(summary.complete,true);assert.equal(summary.totals[0].minorUnitsNumerator,'84600000000');
 const source=createTaskObservationSource({tasks,ledger,resolveContext:()=>({actor,taskId:task.id,billingScope:scope}),resolveRelease:()=>({releaseId:'fixture-release',manifestDigest:'a'.repeat(64)}),costForTask:async({context,task})=>{
  const current=await costs.task(context.billingScope,task.id);if(!current.complete||current.totals.length!==1)return null;
  const cost=current.totals[0];return {kind:current.kind,currency:cost.currency,minorUnits:cost.minorUnitsCeiling};
 }});
 const observed=await source('fixture-source',{sourceScope:'fixture'});assert.equal(observed.record.providerTokens,'150');assert.equal(observed.record.platformUnits,'330');assert.deepEqual(observed.record.cost,{kind:'usage_rate_estimate',currency:'USD',minorUnits:'1'});
 console.log(JSON.stringify({example:'core-provider-cost',status:'passed',providerTokens:'150',platformUnits:'330',estimatedMinorUnitsNumerator:'84600000000',costObserved:true,sharedModelCapacity:true,actualCurrencyCharge:false}));
}finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
