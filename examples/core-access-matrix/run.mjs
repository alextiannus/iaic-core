import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {checkAccessCatalogMatrix} from '@immedi/iaic-core/developer/access-matrix.js';
import {CapabilityDispatcher,defineCapability} from '@immedi/iaic-core/capabilities/index.js';
import {createCapabilityHttpHandler} from '@immedi/iaic-core/http/server.js';
import {createCapabilityMcpServer} from '@immedi/iaic-core/mcp/server.js';
test('Actor catalog matrix detects legacy omissions and excess grants across real HTTP/MCP adapters without executing capabilities',async()=>{
 let context,reads=0,effects=0,authorizationChecks=0;
 const capabilities=['document.read','file.transfer'].map((name,i)=>defineCapability({name,description:name,visibility:i?'host':'both',input:{type:'string'},output:{type:'string'},effect:i?'write':'read',...(i?{retry:'idempotent'}:{}),authorize:()=>{authorizationChecks++;return true;},implementation:{kind:'function',execute:i=>{effects++;return i;}}}));
 const dispatcher=new CapabilityDispatcher({capabilities});
 const project=()=>{reads++;return {actor:context.actor,capabilities:context.entitled?capabilities.map(c=>c.name):[]};};
 const http=surface=>{const handler=createCapabilityHttpHandler({dispatcher,resolveAccess:project,surface});return async c=>{context=c;return (await (await handler(new Request('https://fixture.test/capabilities'))).json()).capabilities.map(c=>c.name);};};
 const server=createCapabilityMcpServer({dispatcher,resolveAccess:project});
 const client=new Client({name:'matrix-fixture',version:'1'});const [ct,st]=InMemoryTransport.createLinkedPair();
 try{
 await server.connect(st);await client.connect(ct);
 const cases=[{name:'entitled',context:{actor:{subjectId:'user',revision:1},entitled:true},expected:{model:['document.read'],host:['document.read','file.transfer']}},{name:'revoked',context:{actor:{subjectId:'user',revision:2},entitled:false},expected:{model:[],host:[]}}];
 const entrances=[{name:'http',surface:'model',list:http('model')},{name:'mcp',surface:'model',list:async c=>{context=c;return (await client.listTools()).tools.map(t=>t.name);}},{name:'native',surface:'host',list:http('host')}];
 const correct=await checkAccessCatalogMatrix({cases,entrances});assert.equal(correct.passed,true);assert.equal(correct.checks.length,6);assert.equal(reads,6);
 const broken=await checkAccessCatalogMatrix({cases,entrances:[{name:'legacy',surface:'model',list:c=>c.entitled?[]:['document.read']}]});
 assert.equal(broken.passed,false);assert.deepEqual(broken.checks[0].missing,['document.read']);assert.deepEqual(broken.checks[1].unexpected,['document.read']);
 assert.equal(effects,0);assert.equal(authorizationChecks,0);assert.equal(JSON.stringify(correct).includes('subjectId'),false);
 }finally{await client.close();await server.close();}
});
test('Matrix validates expectations before reads and keeps catalog failures private',async()=>{
 let reads=0;const entrance={name:'http',surface:'model',list:()=>{reads++;return [];}};
 await assert.rejects(checkAccessCatalogMatrix({cases:[{name:'good',context:null,expected:{model:[]}},{name:'bad',context:null,expected:{}}],entrances:[entrance]}),TypeError);assert.equal(reads,0);
 const result=await checkAccessCatalogMatrix({cases:[{name:'fixture',context:'secret-token',expected:{model:[]}}],entrances:[{...entrance,name:'throws',list:()=>{throw new Error('secret-token');}},{...entrance,name:'malformed',list:()=>['a','a']},entrance]});
 assert.equal(result.passed,false);assert.deepEqual(result.checks.map(c=>c.error),['CATALOG_UNAVAILABLE','INVALID_CATALOG',undefined]);assert.equal(reads,1);assert.equal(JSON.stringify(result).includes('secret-token'),false);
});

test('Sparse catalogs never pass an empty expected catalog and sparse configuration fails before reads',async()=>{
 let reads=0;
 const fixture={name:'empty',context:null,expected:{model:[]}};
 const entrance={name:'reader',surface:'model',list:()=>{reads++;return [];}};
 const result=await checkAccessCatalogMatrix({cases:[fixture],entrances:[{...entrance,list:()=>Array(1)}]});
 assert.equal(result.passed,false);assert.equal(result.checks[0].error,'INVALID_CATALOG');
 for(const options of [
  {cases:[fixture,,],entrances:[entrance]},
  {cases:[fixture],entrances:[entrance,,]},
  {cases:[fixture,{...fixture,name:'sparse',expected:{model:Array(1)}}],entrances:[entrance]}
 ])await assert.rejects(checkAccessCatalogMatrix(options),TypeError);
 assert.equal(reads,0);
});
