import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createServer} from 'node:http';import {Pool} from 'pg';
import {createCapabilityHttpHandler,createCapabilityA2AHandler} from '@immedi/iaic-core';
import {createCapabilityMcpServer} from '@immedi/iaic-core/mcp/server.js';import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ClientFactory,JsonRpcTransportFactory} from '@a2a-js/sdk/client';import {AgentCard,Message,Role} from '@a2a-js/sdk';
import {openFixture,seed,actors,message} from './fixture.mjs';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;assert.ok(connectionString);const schema='peer_example_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let server,mcp,client;
try{
 const f=await openFixture(pool);await seed(f);const caps=[...f.dispatcher.capabilities.keys()];
 const access=request=>request.headers.get('authorization')==='Bearer peer-fixture'?{actor:actors.alpha,capabilities:caps}:null;
 const handler=createCapabilityHttpHandler({dispatcher:f.dispatcher,resolveAccess:access});
 server=createServer(async(req,res)=>{try{let body='';for await(const chunk of req)body+=chunk;const response=await handler(new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(body?{body}:{})}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());}catch{res.writeHead(500);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const input=message();const posted=await fetch(base+'/capabilities/peer.message.send',{method:'POST',headers:{authorization:'Bearer peer-fixture','content-type':'application/json'},body:JSON.stringify({input,requestKey:'surface-1'})});assert.equal(posted.status,200);const first=(await posted.json()).result;
 const denied=await fetch(base+'/capabilities/peer.message.send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input,requestKey:'surface-1'})});assert.equal(denied.status,403);
 mcp=createCapabilityMcpServer({dispatcher:f.dispatcher,resolveAccess:async()=>({actor:actors.alpha,capabilities:caps})});client=new Client({name:'peer-surface',version:'1'});const [ct,st]=InMemoryTransport.createLinkedPair();await mcp.connect(st);await client.connect(ct);
 const repeated=await client.callTool({name:'peer.message.send',arguments:{input,requestKey:'surface-1'}});assert.notEqual(repeated.isError,true);assert.equal(JSON.parse(repeated.content[0].text).id,first.id);
 const a2a=await createCapabilityA2AHandler({dispatcher:f.dispatcher,capability:'peer.message.send',resolveAccess:access,url:'https://peer.test/rpc'});
 const transport=(url,init={})=>a2a(new Request(url,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),authorization:'Bearer peer-fixture'}}));
 const card=AgentCard.fromJSON(await (await transport('https://peer.test/.well-known/agent-card.json')).json());const a2aClient=await new ClientFactory({transports:[new JsonRpcTransportFactory({fetchImpl:transport})]}).createFromAgentCard(card);
 const result=await a2aClient.sendMessage({message:Message.fromJSON({messageId:'surface-1',role:Role.ROLE_USER,parts:[{data:input,mediaType:'application/json'}]})});assert.equal(result.parts[0].content.value.id,first.id);
 const conflicting={...input,content:{text:'changed under the same key'}};
 const httpError=await fetch(base+'/capabilities/peer.message.send',{method:'POST',headers:{authorization:'Bearer peer-fixture','content-type':'application/json'},body:JSON.stringify({input:conflicting,requestKey:'surface-1'})});assert.equal((await httpError.json()).error.code,'PEER_CONFLICT');
 const mcpError=await client.callTool({name:'peer.message.send',arguments:{input:conflicting,requestKey:'surface-1'}});assert.equal(mcpError.isError,true);assert.equal(JSON.parse(mcpError.content[0].text).error.code,'PEER_CONFLICT');
 await assert.rejects(a2aClient.sendMessage({message:Message.fromJSON({messageId:'surface-1',role:Role.ROLE_USER,parts:[{data:conflicting,mediaType:'application/json'}]})}),error=>JSON.stringify(error).includes('PEER_CONFLICT'));

 assert.equal((await pool.query("SELECT * FROM iaic_peer_records WHERE kind='message'")).rowCount,1);assert.equal((await pool.query('SELECT * FROM peer_fixture_facts')).rowCount,0);
 const restarted=await openFixture(pool,f.state);assert.equal((await restarted.call(actors.alpha,'message.lookup',{channelId:'channel',requestKey:input.requestKey})).receipt.id,first.id);
 await restarted.peer.tick();await restarted.call(actors.beta,'message.ack',{id:first.id,recipientEndpointId:'beta'});
 const formal=await restarted.call(actors.alpha,'formal.submit',{channelId:'channel',grantId:'grant-alpha',requestKey:'formal',subjectVersion:'v1',messageIds:[first.id],capability:'sample.set',input:{value:7}});assert.equal(formal.result.value,7);assert.equal((await pool.query('SELECT * FROM peer_fixture_facts')).rowCount,1);
 console.log(JSON.stringify({example:'core-peer-collaboration',realHttpTransport:true,mcpMapping:true,officialA2aMapping:true,stableErrorCodes:true,oneLogicalMessage:true,independentPrincipals:true,ordinaryMessageDoesNotWriteFacts:true,explicitFormalAction:true,reconstructedReceipt:true,modelInvoked:false,real12EatIntegration:false}));
}finally{await client?.close();await mcp?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
