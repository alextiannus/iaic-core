import assert from 'node:assert/strict';
import {createServer, type IncomingMessage} from 'node:http';
import type {AddressInfo} from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {Server} from '@modelcontextprotocol/sdk/server/index.js';
import type {AuthInfo} from '@modelcontextprotocol/sdk/server/auth/types.js';
import {createCapabilityMcpServer,connectCapabilityMcpHttpTransport,type McpAccessContext} from '@immedi/iaic-core/mcp/server.js';
import {CapabilityDispatcher,defineCapability,type Actor} from '@immedi/iaic-core/capabilities/index.js';

type HostActor=Actor & {revision:number};
let revision=1,revoked=false,domainAllowed=true,effects=0,resolutions=0;
const seen=new Map<string,object>();
const read=defineCapability<Record<string,never>,{subject:string;revision:number},HostActor>({name:'fixture.read',description:'Read fixture identity',input:{type:'object',additionalProperties:false},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'function',execute:(_input,{actor})=>({subject:actor.subjectId,revision:actor.revision})}});
const write=defineCapability<Record<string,never>,object,HostActor>({name:'fixture.write',description:'Fixture write',input:{type:'object',additionalProperties:false},output:{type:'object'},effect:'write',retry:'idempotent',authorize:actor=>domainAllowed&&actor.subjectId==='member',implementation:{kind:'function',execute:(_input,{callId})=>{assert.ok(callId);let result=seen.get(callId);if(!result){effects++;result={written:true};seen.set(callId,result);}return result;}}});
const dispatcher=new CapabilityDispatcher<Record<string,{input:Record<string,never>;output:object}>,HostActor>({capabilities:[read,write]});
// Fixture token verifier is Host-owned. No real credentials or OAuth server.
let resource:URL;
const credentials:Record<string,{subject:string;expiresAt:number;audience:string}>={
 valid:{subject:'member',expiresAt:Date.now()/1000+600,audience:'current'},
 expired:{subject:'member',expiresAt:0,audience:'current'},
 wrong:{subject:'member',expiresAt:Date.now()/1000+600,audience:'other'},
};
function verify(req:IncomingMessage):AuthInfo|undefined {
 const token=req.headers.authorization?.replace(/^Bearer /,'');if(!token)return;
 const record=credentials[token];
 if(!record||revoked||record.expiresAt<=Date.now()/1000||record.audience!=='current')return;
 return {token,clientId:'fixture-client',scopes:['fixture'],expiresAt:record.expiresAt,resource,extra:{subject:record.subject}};
}
const servers:Server[]=[];
const http=createServer(async(req,res)=>{
 try{
  const auth=verify(req);
  if(req.url==='/mcp'&&!auth){res.writeHead(401,{'WWW-Authenticate':`Bearer resource_metadata="${resource.origin}/.well-known/oauth-protected-resource"`});res.end();return;}
  if(req.url==='/.well-known/oauth-protected-resource'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({resource:resource.href,authorization_servers:['https://authorization.fixture.invalid']}));return;}
  if(req.url!=='/mcp'&&req.url!=='/mcp/public'){res.writeHead(404);res.end();return;}
  const transport=new StreamableHTTPServerTransport({enableJsonResponse:true});
  const server:Server=createCapabilityMcpServer({dispatcher,serverInfo:{name:'installed-fixture',version:'1'},resolveAccess:(extra:McpAccessContext)=>{
   resolutions++;
   // AuthInfo is a transport assertion, not permanent permission. Recheck current state.
   if(extra.authInfo){assert.equal(extra.authInfo.resource?.href,resource.href);assert.equal(extra.authInfo.extra?.subject,'member');if(revoked)return null;}
   const member=!!extra.authInfo;
   return {actor:{subjectId:member?'member':'anonymous',revision},capabilities:member?['fixture.read','fixture.write']:['fixture.read']};
  }});
  servers.push(server);res.on('close',()=>{void server.close();});
  await connectCapabilityMcpHttpTransport(server,transport);
  const request:IncomingMessage & {auth?:AuthInfo}=req;
  if(auth)request.auth=auth;
  await transport.handleRequest(request,res);
 }catch{if(!res.headersSent)res.writeHead(500);res.end();}
});
await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));
resource=new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`);
const clients:Client[]=[];
async function client(path:string,token?:string){
 const c=new Client({name:'fixture',version:'1'});clients.push(c);
 // @ts-expect-error SDK 1.30.0 client transport has the same upstream exact-optional defect.
 await c.connect(new StreamableHTTPClientTransport(new URL(path,resource),token?{requestInit:{headers:{Authorization:`Bearer ${token}`}}}:{}));
 return c;
}
try{
 for(const token of [undefined,'wrong','expired']){const r=await fetch(resource,{method:'POST',headers:token?{Authorization:`Bearer ${token}`}:{}});assert.equal(r.status,401);assert.match(r.headers.get('www-authenticate')??'',/resource_metadata/);}
 assert.equal((await (await fetch(new URL('/.well-known/oauth-protected-resource',resource))).json()).resource,resource.href);
 const anonymous=await client('/mcp/public');assert.deepEqual((await anonymous.listTools()).tools.map(t=>t.name),['fixture.read']);
 assert.deepEqual((await anonymous.callTool({name:'fixture.read',arguments:{input:{}}})).structuredContent,{subject:'anonymous',revision:1});
 await assert.rejects(anonymous.callTool({name:'fixture.write',arguments:{input:{},requestKey:'anonymous'}}));
 const member=await client('/mcp','valid');assert.equal((await member.listTools()).tools.length,2);
 assert.equal((await member.callTool({name:'fixture.write',arguments:{input:{}}})).isError,true);assert.equal(effects,0);
 assert.equal((await member.callTool({name:'fixture.write',arguments:{input:{},requestKey:'forged',actor:{subjectId:'other'}}})).isError,true);
 assert.equal((await member.callTool({name:'fixture.write',arguments:{input:{actor:{subjectId:'other'}},requestKey:'forged-input'}})).isError,true);assert.equal(effects,0);
 for(let i=0;i<2;i++)assert.equal((await member.callTool({name:'fixture.write',arguments:{input:{},requestKey:'stable'}})).isError,undefined);
 assert.equal(effects,1);revision=2;
 assert.deepEqual((await member.callTool({name:'fixture.read',arguments:{input:{}}})).structuredContent,{subject:'member',revision:2});
 domainAllowed=false;assert.equal((await member.callTool({name:'fixture.write',arguments:{input:{},requestKey:'denied'}})).isError,true);assert.equal(effects,1);
 revoked=true;await assert.rejects(member.callTool({name:'fixture.write',arguments:{input:{},requestKey:'cached'}}));assert.equal(effects,1);assert.ok(resolutions>=10);
 if(false){
  // @ts-expect-error Actor requires subjectId.
  createCapabilityMcpServer({dispatcher,resolveAccess:()=>({actor:{revision:1},capabilities:[]})});
  // @ts-expect-error Capability names must be strings.
  createCapabilityMcpServer({dispatcher,resolveAccess:()=>({actor:{subjectId:'x',revision:1},capabilities:[1]})});
  // @ts-expect-error Server identity requires version.
  createCapabilityMcpServer({dispatcher,resolveAccess:()=>null,serverInfo:{name:'x'}});
 }
 console.log(JSON.stringify({mcpInstalledHttp:true,authInfoBridge:true,anonymousAndRequiredEndpoints:true,currentActorRevision:true,revocation:true,forgedIdentityRejected:true,stableWriteKey:true,fixtureEffects:effects}));
}finally{await Promise.all(clients.map(c=>c.close()));await Promise.all(servers.map(s=>s.close()));http.closeAllConnections();await new Promise<void>((resolve,reject)=>http.close(e=>e?reject(e):resolve()));}
