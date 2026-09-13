import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {CapabilityDispatcher,defineCapability,TaskStore,createCapabilityA2AHandler,createCapabilityHttpHandler} from '@immedi/iaic-core';
import {ClientFactory,JsonRpcTransportFactory} from '@a2a-js/sdk/client';
import {AgentCard,Message,Role,TaskState} from '@a2a-js/sdk';
const admin=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL});
const schema='a2a_example_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL,options:`-c search_path=${schema}`});
try{
 let store=new TaskStore({pool});await store.initialize();let allowed=true;
 const actor={subjectId:'fixture-user',scopeId:'fixture-org'};
 const authorize=a=>a.subjectId===actor.subjectId&&a.scopeId===actor.scopeId;
 const method=(name,effect,execute)=>defineCapability({name,description:name,input:{},output:{},effect,...(effect==='write'?{retry:'idempotent'}:{}),authorize,implementation:{kind:'function',execute}});
 const capabilities=[defineCapability({name:'work.run',description:'Persist bounded work',input:{type:'object',properties:{goal:{type:'string'}},required:['goal'],additionalProperties:false},output:{},effect:'write',retry:'idempotent',authorize,implementation:{kind:'agent',instructions:'Work on the goal',tools:[],verify:()=>true}}),
 method('work.get','read',({id},c)=>store.get(c.actor,id)),method('work.cancel','write',({id},c)=>store.transition(c.actor,id,{action:'cancel'})),method('work.list','read',async(p,c)=>{if(p.pageToken)throw Object.assign(new Error('Invalid page token'),{statusCode:400});const rows=await store.list(c.actor);return {tasks:rows,nextPageToken:'',totalSize:rows.length,pageSize:rows.length};}),method('echo.read','read',input=>input)];
 const dispatcher=new CapabilityDispatcher({capabilities,tasks:{create:request=>store.create({...request,version:'fixture1',model:'fixture1'})}});
 const project=row=>({id:row.id,contextId:row.id,status:{state:({queued:TaskState.TASK_STATE_SUBMITTED,cancelled:TaskState.TASK_STATE_CANCELED})[row.status]},history:[],artifacts:[],metadata:{iaicCapability:row.capability}});
 const make=capability=>createCapabilityA2AHandler({dispatcher,capability,url:'https://a2a.test/rpc',resolveAccess:req=>allowed&&req.headers.get('authorization')==='Bearer fixture'?{actor,capabilities:capabilities.map(c=>c.name)}:null,taskBindings:{get:'work.get',cancel:'work.cancel',list:'work.list',project}});
 let handler=await make('work.run');
 const transport=async(url,init)=>{const headers=new Headers(init?.headers);headers.set('authorization','Bearer fixture');return handler(new Request(url,{...init,headers}));};
 const card=AgentCard.fromJSON(await (await transport('https://a2a.test/.well-known/agent-card.json')).json());
 const client=await new ClientFactory({transports:[new JsonRpcTransportFactory({fetchImpl:transport})]}).createFromAgentCard(card);
 const message=Message.fromJSON({messageId:randomUUID(),role:Role.ROLE_USER,parts:[{data:{goal:'preserve my work'},mediaType:'application/json'}]});
 const request={message,configuration:{returnImmediately:true}};
 const response=await client.sendMessage(request);const id=response.id;assert.equal(response.status.state,TaskState.TASK_STATE_SUBMITTED);
 assert.equal((await client.sendMessage(request)).id,id);
 assert.equal((await dispatcher.invoke('work.run',{goal:'preserve my work'},{actor,callId:message.messageId})).id,id);
 const http=createCapabilityHttpHandler({dispatcher,resolveAccess:()=>({actor,capabilities:['work.run']})});
 const httpReply=await http(new Request('https://a2a.test/capabilities/work.run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:{goal:'preserve my work'},requestKey:message.messageId})}));assert.equal(httpReply.status,202);assert.equal((await httpReply.json()).result.id,id);
 // Rebuild service objects while keeping authoritative PostgreSQL state.
 store=new TaskStore({pool});handler=await make('work.run');
 assert.equal((await client.getTask({id})).id,id);
 assert.equal((await client.listTasks({})).tasks[0].id,id);
 assert.equal((await client.cancelTask({id})).status.state,TaskState.TASK_STATE_CANCELED);
 allowed=false;await assert.rejects(client.getTask({id}));allowed=true;
 const changed=Message.fromJSON({...message,parts:[{data:{goal:'different'}}]});await assert.rejects(client.sendMessage({message:changed,configuration:{returnImmediately:true}}));
 handler=await make('echo.read');const echo=await client.sendMessage({message:Message.fromJSON({...message,messageId:randomUUID(),parts:[{data:{hello:'world'}}]})});assert.deepEqual(echo.parts[0].content.value,{hello:'world'});
 console.log(JSON.stringify({example:'core-a2a',status:'passed',officialSdk:true,persistentTask:true,stableReceipt:true,cancellation:true,currentRevocation:true,sharedDispatcher:true,sameHttpSdkReceipt:true,modelInvoked:false}));
}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
