import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {TaskStore} from '@immedi/iaic-core/tasks/store.js';
import {Operations} from '@immedi/iaic-core/operations/service.js';
import {createOperationsCapabilities} from '@immedi/iaic-core/operations/capabilities.js';
import {CapabilityDispatcher} from '@immedi/iaic-core/capabilities/index.js';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;assert.ok(connectionString);
const schema='operations_example_'+randomUUID().replaceAll('-','');const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
try {
 const tasks=new TaskStore({pool});await tasks.initialize();const actor={scopeId:'platform-workspace',subjectId:'observer'},owner={scopeId:'platform-workspace',subjectId:'platform-service'};
 const task=await tasks.create({actor:owner,capability:'platform.review',input:{goal:'Review a fixture proposal'},idempotencyKey:'review-1',version:'operations-fixture',model:'platform-model-binding'});
 const ref=(source,id)=>({source,id,revision:'1'}),now=Date.now();
 const packet=(items,source)=>({items,complete:true,observedAt:new Date(now).toISOString(),validUntil:new Date(now+60000).toISOString(),reference:ref(source,'snapshot')});
 const agents=[{id:'maintainer',name:'Platform maintainer',role:'platform',location:'internal',lifecycle:'active',workspaceId:actor.scopeId,principalId:owner.subjectId,reference:ref('host-agent-directory','maintainer')},{id:'external-peer',name:'External platform peer',role:'platform',location:'external',lifecycle:'active',workspaceId:actor.scopeId,principalId:'external-platform-principal',reference:ref('host-agent-directory','external-peer')}];
 let authorized=true;
 const operations=new Operations({namespace:'example',cursorKey:randomBytes(32),resolveScope:a=>JSON.stringify([a.scopeId,a.subjectId,'visibility-v1']),authorize:a=>authorized&&a.scopeId===actor.scopeId&&a.subjectId===actor.subjectId,
  listAgents:async()=>({items:agents,next:null,complete:true}),readAgent:async({id})=>agents.find(a=>a.id===id),
  sources:{
   tasks:async({agent})=>packet(agent.id==='maintainer'?(await tasks.list(owner)).map(t=>({id:t.id,status:t.status,waitingReason:t.waiting_reason??null,resultState:'pending',reference:ref('TaskStore',t.id)})):[],'TaskStore'),
   signals:async({agent})=>({ ...packet(agent.id==='external-peer'?[{id:'peer-self-report',kind:'connector',state:'healthy',basis:'reported',observedAt:new Date(now-120000).toISOString(),validUntil:new Date(now-60000).toISOString(),reason:'fixture-last-report',reference:ref('external-host-fixture','report-1')}]:[],'Host signals'),complete:false}),
   models:async({agent})=>packet(agent.id==='maintainer'?[{taskId:task.id,configuredProfileRef:'host-model-profile',boundModel:(await tasks.get(owner,task.id)).model,requestedModel:null,actualModel:null,provider:null,basis:'observed',reference:ref('TaskStore',task.id)}]:[],'Task model binding'),
   interactions:async()=>packet([{id:'review-fixture',type:'review',from:'maintainer',to:'external-peer',taskId:task.id,stage:'requested',basis:'reported',reference:ref('host-fixture','review-request')}],'Host review fixture')
  }});
 const dispatcher=new CapabilityDispatcher({capabilities:createOperationsCapabilities({operations})});
 const view=await dispatcher.invoke('operations.overview',{}, {actor});assert.equal(view.count.agents,2);assert.equal(view.count.scope,'returned-page');assert.equal(view.count.healthUnknown,2);
 const detail=await dispatcher.invoke('operations.agent',{id:'maintainer'},{actor});assert.equal(detail.activity,'queued');assert.equal(detail.models[0].boundModel,'platform-model-binding');assert.equal(detail.models[0].actualModel,null);assert.equal(detail.interactions[0].basis,'reported');
 const external=await operations.agent(actor,'external-peer');assert.equal(external.signals[0].freshness,'stale');assert.equal(external.health.state,'unknown');
 authorized=false;await assert.rejects(dispatcher.invoke('operations.agent',{id:'maintainer'},{actor}),{statusCode:403});
 assert.equal((await tasks.get(owner,task.id)).status,'queued');
 console.log(JSON.stringify({example:'core-operations',actualTaskStore:true,sharedReadCapabilities:true,internalExternalDescriptors:true,modelBindingNotActualCall:true,reportedReviewNotVerified:true,missingAndStaleRemainUnknown:true,revocation:true,mutatedTask:false,realWorkerProbe:false,externalConnector:false,ui:false}));
} finally {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
