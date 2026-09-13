import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import os from 'node:os';
import {Pool} from 'pg';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ClientFactory,JsonRpcTransportFactory} from '@a2a-js/sdk/client';
import {AgentCard,Message,Role,TaskState} from '@a2a-js/sdk';
import {AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,defineCapability,createTaskControlCapabilities,createCapabilityHttpHandler,createCapabilityA2AHandler} from '@immedi/iaic-core';
import {createCapabilityMcpServer} from '@immedi/iaic-core/mcp/server.js';
import {CapabilityHttpClient} from '@immedi/iaic-core/http/client.js';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
const schema='agent_surfaces_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime,server,mcp,client;
try{
 const actor={scopeId:'fixture-app',subjectId:'owner'},store=new TaskStore({pool});let enabled=true,sourceAllowed=true,modelCalls=0;
 const authorize=a=>enabled&&a.subjectId===actor.subjectId&&a.scopeId===actor.scopeId;
 const source=defineCapability({name:'source.read',description:'Read the current fixture value',input:{type:'object'},output:{type:'object'},effect:'read',authorize:a=>authorize(a)&&sourceAllowed,revalidate:()=>({value:42}),implementation:{kind:'function',execute:()=>({value:42})}});
 const agent=defineCapability({name:'work.run',description:'Continue a persistent goal after user clarification',input:{type:'object',properties:{goal:{type:'string'}},required:['goal'],additionalProperties:false},output:{type:'object'},effect:'write',retry:'never-replay',authorize,implementation:{kind:'agent',instructions:'Use the clarification and source to complete the goal.',tools:['source.read'],verify:(_input,result,{history})=>result.value===42&&history.calls.some(call=>call.capability==='source.read'&&call.status==='succeeded'&&call.result.value===42)}});
 const controls=createTaskControlCapabilities({runtime:{get:(...args)=>runtime.get(...args),state:(...args)=>runtime.state(...args),transition:(...args)=>runtime.transition(...args)},authorize});
 const list=defineCapability({name:'tasks.list',description:'List the current owner latest fixture Tasks; no paging or filtering',input:{type:'object',properties:{},additionalProperties:false},output:{type:'object'},effect:'read',authorize,implementation:{kind:'function',execute:async(_input,{actor})=>({tasks:await Promise.all((await store.list(actor)).map(row=>runtime.state(actor,row.id))),nextPageToken:''})}});
 const dispatcher=new CapabilityDispatcher({capabilities:[source,agent,...controls,list]});
 const model={name:'surfaces-fixture',next:async({billingContext,messages})=>{
  modelCalls++;const task=await store.get(actor,billingContext.taskId),turn=billingContext.turn;
  if(task.input.goal==='cancel after source read')return turn===1?{type:'call',name:'source.read',input:{}}:{type:'wait',question:'Continue?'};
  if(turn===1)return {type:'wait',question:'Confirm the requested value.'};
  if(turn===2){assert.ok(messages.some(message=>message.content.includes('confirmed value')));return {type:'call',name:'source.read',input:{}};}
  return {type:'finish',result:{value:42}};
 }};
 const rebuild=async()=>{await runtime?.stop();runtime=new AgentRuntime({store:new TaskStore({pool}),dispatcher,model,context:new ContextAssembler({skillRoot:os.tmpdir()}),version:'surfaces-v1'});dispatcher.tasks=runtime;await runtime.initialize();};await rebuild();
 const names=[agent.name,...controls.map(cap=>cap.name),list.name],access=request=>request.headers.get('authorization')==='Bearer fixture'?{actor,capabilities:names}:null;
 const http=createCapabilityHttpHandler({dispatcher,resolveAccess:access});let a2a;
 server=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const request=new Request(base+req.url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})}),response=await (req.url.startsWith('/capabilities')?http:a2a)(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const project=row=>({id:row.id,contextId:row.id,status:{state:({queued:TaskState.TASK_STATE_SUBMITTED,running:TaskState.TASK_STATE_WORKING,succeeded:TaskState.TASK_STATE_COMPLETED,cancelled:TaskState.TASK_STATE_CANCELED,failed:TaskState.TASK_STATE_FAILED,waiting:(row.waitingReason??row.waiting_reason)==='input'?TaskState.TASK_STATE_INPUT_REQUIRED:TaskState.TASK_STATE_WORKING})[row.status]},history:[],artifacts:row.result?[{artifactId:row.id,parts:[{data:row.result,mediaType:'application/json'}]}]:[],metadata:{iaicCapability:row.capability}});
 a2a=await createCapabilityA2AHandler({dispatcher,capability:agent.name,url:base+'/a2a/rpc',resolveAccess:access,taskBindings:{get:'tasks.get',state:'tasks.state',cancel:'tasks.cancel',list:'tasks.list',project}});
 const authFetch=(url,options={})=>fetch(url,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),authorization:'Bearer fixture'}});
 const sdk=new CapabilityHttpClient({url:base+'/capabilities',headers:()=>({authorization:'Bearer fixture'})});
 mcp=createCapabilityMcpServer({dispatcher,resolveAccess:()=>({actor,capabilities:names})});client=new Client({name:'agent-surfaces-fixture',version:'1'});const [ct,st]=InMemoryTransport.createLinkedPair();await mcp.connect(st);await client.connect(ct);
 const card=AgentCard.fromJSON(await (await authFetch(base+'/.well-known/agent-card.json')).json()),remote=await new ClientFactory({transports:[new JsonRpcTransportFactory({fetchImpl:authFetch})]}).createFromAgentCard(card);
 const invoke={esm:(name,input,key)=>dispatcher.invoke(name,input,{actor,callId:key}),sdk:async(name,input,key)=>(await sdk.invoke(name,input,{requestKey:key})).result,http:async(name,input,key)=>{const response=await authFetch(base+'/capabilities/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input,requestKey:key})}),body=await response.json();if(!response.ok)throw Object.assign(new Error(body.error.message),body.error);return body.result;},mcp:async(name,input,key)=>{const response=await client.callTool({name,arguments:{input,requestKey:key}}),body=JSON.parse(response.content[0].text);if(response.isError)throw Object.assign(new Error(body.error.message),body.error);return body;}};
 const input={goal:'retrieve the confirmed value'},key='same-original-task';let original;
 for(const call of Object.values(invoke)){const task=await call(agent.name,input,key);original??=task.id;assert.equal(task.id,original);}
 const a2aTask=await remote.sendMessage({message:Message.fromJSON({messageId:key,role:Role.ROLE_USER,parts:[{data:input,mediaType:'application/json'}]}),configuration:{returnImmediately:true}});assert.equal(a2aTask.id,original);assert.equal((await store.list(actor)).length,1);
 assert.equal((await runtime.tick()).status,'waiting');assert.equal((await remote.getTask({id:original})).status.state,TaskState.TASK_STATE_INPUT_REQUIRED);
 await invoke.mcp('tasks.provide_input',{id:original,input:'confirmed value'},'clarification');await rebuild();assert.equal((await runtime.tick()).status,'succeeded');
 for(const call of Object.values(invoke))assert.deepEqual((await call('tasks.get',{id:original})).result,{value:42});
 const completed=await remote.getTask({id:original});assert.equal(completed.status.state,TaskState.TASK_STATE_COMPLETED);assert.deepEqual(completed.artifacts[0].parts[0].content.value,{value:42});
 assert.equal((await store.history(actor,original)).events.filter(event=>event.kind==='input').length,1);
 const pending=await invoke.sdk(agent.name,{goal:'cancel after source read'},'cancel-task');assert.equal((await runtime.tick()).status,'waiting');sourceAllowed=false;
 await assert.rejects(remote.getTask({id:pending.id}));assert.equal((await remote.cancelTask({id:pending.id})).status.state,TaskState.TASK_STATE_CANCELED);
 assert.equal((await invoke.mcp('tasks.state',{id:pending.id})).status,'cancelled');assert.equal(modelCalls,5);
 sourceAllowed=true;enabled=false;for(const call of Object.values(invoke))await assert.rejects(call('tasks.get',{id:original}));await assert.rejects(remote.getTask({id:original}));
 console.log(JSON.stringify({example:'core-agent-surfaces',status:'passed',entrypoints:[...Object.keys(invoke),'a2a'],oneOriginalTask:true,clarificationThroughMcp:true,reconstructedRuntime:true,verifiedSharedResult:true,cancelAfterSourceRevocation:true,currentAccessRevocation:true,modelCalls,actualModel:false,uiTested:false,processKill:false}));
}finally{await runtime?.stop();await client?.close();await mcp?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
