import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {Pool} from 'pg';
import {TaskStore} from '@immedi/iaic-core/tasks/store.js';
import {Operations} from '@immedi/iaic-core/operations/service.js';
import {createOperationsDashboard} from '@immedi/iaic-core/operations/dashboard.js';
/** Local fixture only. Basic credentials below are not a production login system. */
export async function openFixture(){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw Error('Isolated SUBMISSION_TEST_DATABASE_URL required');
 const schema='dashboard_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 const tasks=new TaskStore({pool});await tasks.initialize();const owner={scopeId:'platform-fixture',subjectId:'platform-service'};
 const task=await tasks.create({actor:owner,capability:'platform.review',input:{goal:'Review fixture'},idempotencyKey:'review',version:'fixture',model:'task-bound-fixture-model'});
 const ref=(source,id)=>({source,id,revision:'1'}),packet=(items,source,complete=true)=>({items,complete,observedAt:new Date().toISOString(),validUntil:new Date(Date.now()+60000).toISOString(),reference:ref(source,'snapshot')});
 const agents=[{id:'maintainer',name:'内置维护 Agent',role:'platform',location:'internal',lifecycle:'active',workspaceId:owner.scopeId,principalId:owner.subjectId,reference:ref('Host fixture','maintainer')},{id:'external-peer',name:'外部协作 Agent（fixture）',role:'platform',location:'external',lifecycle:'active',workspaceId:owner.scopeId,principalId:'peer-fixture',reference:ref('Host fixture','external-peer')}];
 let permitted=true;const password=randomBytes(18).toString('base64url');
 const operations=new Operations({namespace:schema,cursorKey:randomBytes(32),resolveScope:a=>JSON.stringify([a.subjectId,owner.scopeId,'v1']),authorize:a=>permitted&&a.subjectId==='operator',listAgents:async({limit,after})=>{const offset=Number(after??0);return {items:agents.slice(offset,offset+limit),next:offset+limit<agents.length?String(offset+limit):null,complete:true};},readAgent:async({id})=>agents.find(a=>a.id===id),sources:{
 tasks:async({agent})=>packet(agent.id==='maintainer'?(await tasks.list(owner)).map(t=>({id:t.id,status:t.status,waitingReason:t.waiting_reason??null,resultState:'pending',reference:ref('TaskStore',t.id)})):[],'TaskStore'),
 signals:async()=>packet([],'No real runtime probe',false),
 models:async({agent})=>packet(agent.id==='maintainer'?[{taskId:task.id,configuredProfileRef:'fixture-model-profile',boundModel:(await tasks.get(owner,task.id)).model,requestedModel:null,actualModel:null,provider:null,basis:'observed',reference:ref('TaskStore',task.id)}]:[],'TaskStore'),
 interactions:async()=>packet([{id:'review-request',type:'review',from:'maintainer',to:'external-peer',taskId:task.id,stage:'requested',basis:'reported',reference:ref('Host fixture','review-request')}],'Host fixture')
 }});
 const handler=createOperationsDashboard({operations,resolveObserver:async request=>{const auth=request.headers.authorization;if(typeof auth!=='string'||!auth.startsWith('Basic '))return null;const [username,key]=Buffer.from(auth.slice(6),'base64').toString().split(':');if(key!==password||!['operator','user','organization-admin'].includes(username))return null;return {actor:{subjectId:username},binding:username+':fixture-session'};},authorizeOperator:({actor})=>permitted&&actor.subjectId==='operator'});
 const server=createServer((req,res)=>{res.setHeader('WWW-Authenticate','Basic realm="Local IAiC fixture only"');handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}}).catch(()=>{res.destroy();});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}/admin/agents`,password,taskId:task.id,revoke:()=>{permitted=false;},task:()=>tasks.get(owner,task.id),close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
}
