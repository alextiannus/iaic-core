import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createServer} from 'node:http';import {Pool} from 'pg';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ClientFactory,JsonRpcTransportFactory} from '@a2a-js/sdk/client';import {AgentCard,Message,Role} from '@a2a-js/sdk';
import {CapabilityDispatcher,defineCapability,createCapabilityHttpHandler,createCapabilityA2AHandler} from '@immedi/iaic-core';
import {createCapabilityMcpServer} from '@immedi/iaic-core/mcp/server.js';import {CapabilityHttpClient} from '@immedi/iaic-core/http/client.js';
const connectionString=process.env.DATABASE_URL||process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
const schema='parity_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
let server,mcp,client;
try{
 await pool.query('CREATE TABLE parity_effects(scope text NOT NULL,owner text NOT NULL,key text NOT NULL,id uuid NOT NULL,value text NOT NULL,PRIMARY KEY(scope,owner,key))');
 const actor={scopeId:'fixture-app',subjectId:'owner'},lost=new Set();let enabled=true;
 const input={type:'object',properties:{value:{type:'string',minLength:1,maxLength:100}},required:['value'],additionalProperties:false};
 const capability=defineCapability({name:'records.save',description:'Persist one fixture record per owner and stable key',input,output:{type:'object',properties:{id:{type:'string'},value:{type:'string'}},required:['id','value'],additionalProperties:false},effect:'write',retry:'idempotent',authorize:a=>enabled&&a.subjectId===actor.subjectId&&a.scopeId===actor.scopeId,implementation:{kind:'function',execute:async(value,{actor:current,callId})=>{
  await pool.query('INSERT INTO parity_effects(scope,owner,key,id,value) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[current.scopeId,current.subjectId,callId,randomUUID(),value.value]);
  const row=(await pool.query('SELECT id,value FROM parity_effects WHERE scope=$1 AND owner=$2 AND key=$3',[current.scopeId,current.subjectId,callId])).rows[0];
  if(row.value!==value.value)throw Object.assign(new Error('Immutable request input conflict'),{statusCode:409});
  if(lost.delete(callId))throw new Error('Fixture response failure after committed effect');return row;
 }}});
 const dispatcher=new CapabilityDispatcher({capabilities:[capability]});
 const access=request=>request.headers.get('authorization')==='Bearer fixture'?{actor,capabilities:[capability.name]}:null;
 const http=createCapabilityHttpHandler({dispatcher,resolveAccess:access});let a2a;
 server=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const request=new Request(base+req.url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});const response=await (req.url.startsWith('/capabilities')?http:a2a)(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 a2a=await createCapabilityA2AHandler({dispatcher,capability:capability.name,url:base+'/a2a/rpc',resolveAccess:access});
 const authFetch=(url,options={})=>fetch(url,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),authorization:'Bearer fixture'}});
 const httpClient=new CapabilityHttpClient({url:base+'/capabilities',headers:()=>({authorization:'Bearer fixture'})});
 mcp=createCapabilityMcpServer({dispatcher,resolveAccess:()=>({actor,capabilities:[capability.name]})});client=new Client({name:'parity-fixture',version:'1'});const [ct,st]=InMemoryTransport.createLinkedPair();await mcp.connect(st);await client.connect(ct);
 const card=AgentCard.fromJSON(await (await authFetch(base+'/.well-known/agent-card.json')).json());const remote=await new ClientFactory({transports:[new JsonRpcTransportFactory({fetchImpl:authFetch})]}).createFromAgentCard(card);
 const endpoints={
  esm:(value,key)=>dispatcher.toolsFor(actor)[capability.name].handler(value,{callId:key}),
  sdk:async(value,key)=>(await httpClient.invoke(capability.name,value,{requestKey:key})).result,
  http:async(value,key)=>{const response=await authFetch(base+'/capabilities/'+capability.name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:value,requestKey:key})}),body=await response.json();if(!response.ok)throw Object.assign(new Error(body.error.message),body.error);return body.result;},
  mcp:async(value,key)=>{const result=await client.callTool({name:capability.name,arguments:{input:value,requestKey:key}}),body=JSON.parse(result.content[0].text);if(result.isError)throw Object.assign(new Error(body.error.message),body.error);return body;},
  a2a:async(value,key)=>{try{const result=await remote.sendMessage({message:Message.fromJSON({messageId:key,role:Role.ROLE_USER,parts:[{data:value,mediaType:'application/json'}]})});return result.parts[0].content.value;}catch(error){const metadata=error.metadata||(Array.isArray(error.data)?error.data.find(item=>item?.['@type']==='type.googleapis.com/google.rpc.ErrorInfo'&&item.domain==='a2a-protocol.org')?.metadata:null);throw Object.assign(error,{statusCode:Number(metadata?.statusCode??error.httpStatus??0),outcomeUnknown:metadata?.outcomeUnknown==='true'});}}
 };
 const httpDescription=(await httpClient.list())[0],mcpDescription=(await client.listTools()).tools[0];assert.deepEqual(httpDescription.input,capability.input);assert.equal(httpDescription.effect,'write');assert.equal(httpDescription.retry,'idempotent');assert.equal(mcpDescription.annotations.readOnlyHint,false);assert.equal(mcpDescription.annotations.idempotentHint,true);assert.equal(card.skills[0].id,capability.name);
 const names=Object.keys(endpoints),shared={value:'same semantic result'};let original;
 for(const [name,invoke] of Object.entries(endpoints)){
  const result=await invoke(shared,'shared');original??=result;assert.deepEqual(result,original,name);
  await assert.rejects(invoke({value:'conflicting value'},'shared'),error=>error.statusCode===409,name+' input conflict');
  await assert.rejects(invoke({value:'valid',extra:true},'bad-'+name),error=>error.statusCode===400,name+' schema validation');
 }
 assert.equal(Number((await pool.query('SELECT count(*) FROM parity_effects')).rows[0].count),1);
 for(const [index,name] of names.entries()){
  const key='uncertain-'+name;lost.add(key);await assert.rejects(endpoints[name](shared,key),error=>error.outcomeUnknown===true,name+' preserves uncertainty');
  const recovered=await endpoints[names[(index+1)%names.length]](shared,key);assert.equal(recovered.value,shared.value);
 }
 assert.equal(Number((await pool.query('SELECT count(*) FROM parity_effects')).rows[0].count),names.length+1);
 enabled=false;for(const [name,invoke] of Object.entries(endpoints))await assert.rejects(invoke(shared,'denied-'+name),error=>error.statusCode===403,name+' current revocation');
 assert.equal(Number((await pool.query('SELECT count(*) FROM parity_effects')).rows[0].count),names.length+1);
 console.log(JSON.stringify({example:'core-protocol-parity',status:'passed',entrypoints:names,samePersistentReceipt:true,currentRevocation:true,sharedSchema:true,conflictAndUncertainty:true,crossEntryRecovery:true,httpAndA2aLoopback:true,mcpInMemoryProtocol:true,modelInvoked:false,uiTested:false}));
}finally{await client?.close();await mcp?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
