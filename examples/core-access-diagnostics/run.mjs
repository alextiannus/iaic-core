import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {defineCapability,CapabilityDispatcher} from '@immedi/iaic-core/capabilities/index.js';
import {createCapabilityHttpHandler} from '@immedi/iaic-core/http/server.js';
import {createCapabilityMcpServer} from '@immedi/iaic-core/mcp/server.js';
const schema={type:'string'};
const actor={subjectId:'reader',scopeId:'fixture',revision:1};
function fixture(){
 let executions=0,reads=0,access={actor,capabilities:['fixture.read','fixture.host','fixture.fail']};
 const define=(name,extra={})=>defineCapability({name,description:name,input:schema,output:schema,effect:'read',authorize:a=>a.revision===1,implementation:{kind:'function',execute:i=>{executions++;return i;}},...extra});
 const dispatcher=new CapabilityDispatcher({capabilities:[define('fixture.read'),define('fixture.host',{visibility:'host'}),define('fixture.fail',{implementation:{kind:'function',execute:i=>{throw Object.assign(new Error('private credential'),{statusCode:500,code:'SECRET_CREDENTIAL_VALUE',...(i==='public'?{publicCode:'SAFE_FAILURE'}:{})});}}})]});
 return {dispatcher,resolveAccess:()=>{reads++;return access;},set:v=>access=v,get reads(){return reads;},get executions(){return executions;}};
}
test('HTTP distinguishes current projection, Domain and surface denial without disclosing hidden catalog',async()=>{
 const f=fixture(),handler=createCapabilityHttpHandler(f);
 const call=async name=>(await handler(new Request('https://fixture.test/capabilities/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:'value'})}))).json();
 assert.equal((await (await handler(new Request('https://fixture.test/capabilities'))).json()).capabilities.length,2);
 f.set({actor:{...actor,revision:2},capabilities:['fixture.read']});
 assert.equal((await call('fixture.read')).error.code,'CAPABILITY_ACCESS_DENIED');
 f.set({actor,capabilities:[]});
 const hidden=await call('fixture.read'),unknown=await call('unknown.read');assert.deepEqual(hidden,unknown);assert.equal(hidden.error.code,'CAPABILITY_NOT_AVAILABLE');assert.equal(hidden.error.statusCode,404);
 f.set({actor,capabilities:['fixture.host']});assert.equal((await call('fixture.host')).error.code,'CAPABILITY_SURFACE_DENIED');
 assert.equal(f.executions,0);assert.equal(f.reads,5);
});
test('MCP preserves protocol envelopes and rereads Actor after discovery; private codes do not override public codes',async()=>{
 const f=fixture(),server=createCapabilityMcpServer(f),client=new Client({name:'fixture',version:'1'});
 const [ct,st]=InMemoryTransport.createLinkedPair();
 try{
 await server.connect(st);await client.connect(ct);await client.listTools();
 const call=(name,input='value')=>client.callTool({name,arguments:{input}});
 f.set({actor:{...actor,revision:2},capabilities:['fixture.read']});
 const denied=await call('fixture.read');assert.equal(denied.isError,true);assert.equal(JSON.parse(denied.content[0].text).error.code,'CAPABILITY_ACCESS_DENIED');
 f.set({actor,capabilities:[]});
 for(const name of ['fixture.read','unknown.read'])await assert.rejects(call(name),error=>error.code===-32602&&error.data.code==='CAPABILITY_NOT_AVAILABLE'&&error.data.statusCode===404);
 f.set({actor,capabilities:['fixture.host','fixture.fail']});
 assert.equal(JSON.parse((await call('fixture.host')).content[0].text).error.code,'CAPABILITY_SURFACE_DENIED');
 const failure=await call('fixture.fail','public');assert.equal(JSON.parse(failure.content[0].text).error.code,'SAFE_FAILURE');assert.equal(JSON.stringify(failure).includes('SECRET_CREDENTIAL_VALUE'),false);assert.equal(JSON.stringify(failure).includes('private credential'),false);
 const privateFailure=await call('fixture.fail');assert.equal(JSON.parse(privateFailure.content[0].text).error.code,undefined);assert.equal(JSON.stringify(privateFailure).includes('SECRET_CREDENTIAL_VALUE'),false);
 assert.equal(f.executions,0);assert.equal(f.reads,7);
 }finally{await client.close();await server.close();}
});
test('Dispatcher distinguishes trusted Task scope and invalid identity before effects',async()=>{
 const f=fixture();
 await assert.rejects(f.dispatcher.invoke('fixture.read','x',{actor,allowedCapabilities:[]}),{code:'CAPABILITY_SCOPE_DENIED',statusCode:403});
 await assert.rejects(f.dispatcher.invoke('fixture.read','x',{actor:null}),{code:'ACTOR_REQUIRED',statusCode:401});
 assert.equal(f.executions,0);
});
