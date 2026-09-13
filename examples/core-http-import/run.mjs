import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {CapabilityDispatcher, importHttpCapabilities} from '@immedi/iaic-core';
import {createCapabilityMcpServer} from '@immedi/iaic-core/mcp/server.js';
const schema = {type:'object',properties:{name:{type:'string'}},required:['name'],additionalProperties:false};
let remoteCalls = 0;
const capabilities = importHttpCapabilities({baseUrl:'https://fixture.example/api/',resolveHeaders:({actor})=>({authorization:'Bearer fixture-'+actor.subjectId}),
  fetch:async(url,options)=>{assert.equal(options.headers.get('authorization'),'Bearer fixture-owner');assert.equal(url.pathname,'/api/record');remoteCalls++;return Response.json({record:{name:url.searchParams.get('name')}});},
  bindings:[{name:'external.record',description:'Read a record from an existing JSON API',input:schema,output:schema,effect:'read',authorize:actor=>actor.subjectId==='owner',request:value=>({path:'record',query:value}),project:body=>body.record}]
});
const dispatcher = new CapabilityDispatcher({capabilities}), actor = {subjectId:'owner'};
const server = createCapabilityMcpServer({dispatcher,resolveAccess:()=>({actor,capabilities:['external.record']})});
const client = new Client({name:'external-agent',version:'1'}), [ct,st] = InMemoryTransport.createLinkedPair();
await server.connect(st);await client.connect(ct);
try {
  const result = await client.callTool({name:'external.record',arguments:{input:{name:'Example record'}}});
  assert.equal(result.structuredContent.name,'Example record');assert.equal(remoteCalls,1);
  console.log(JSON.stringify({example:'core-http-import',status:'passed',externalMcpToHttp:true,sharedCapability:true,realExternalApiUsed:false}));
} finally {await client.close();await server.close();}
