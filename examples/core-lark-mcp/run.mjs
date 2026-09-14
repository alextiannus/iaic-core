import assert from 'node:assert/strict';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {LarkMcpTool} from '@larksuiteoapi/lark-mcp/dist/mcp-tool/mcp-tool.js';
import {CapabilityDispatcher} from '@immedi/iaic-core';
import {LARK_TOOL_CATALOG,importLarkCapabilities,selectLarkTools} from '@immedi/iaic-core/mcp/lark.js';

// Real official MCP definitions/handlers; SDK HTTP boundary replaced, no live credentials.
const calls=[];let allowed=true,lost=false;
const sdk={request:async input=>{calls.push(input);if(lost)throw Error('fixture response lost');return {code:0,data:{fixture:true}};}};
const official=new LarkMcpTool({client:sdk,tokenMode:'auto',toolsOptions:{allowTools:LARK_TOOL_CATALOG.map(row=>row.tool)}});
const server=new McpServer({name:'official-lark-fixture',version:'0.5.1'});
official.registerMcpServer(server,{toolNameCase:'snake'});
const client=new Client({name:'iaic-lark-consumer',version:'1'});
const [ct,st]=InMemoryTransport.createLinkedPair();await server.connect(st);await client.connect(ct);
try {
 const actor={subjectId:'fixture-user'},domains=[...new Set(LARK_TOOL_CATALOG.map(row=>row.domain))];
 const capabilities=await importLarkCapabilities({client,identity:'bot',domains,
  resolveClient:({actor:current,larkIdentity})=>current.subjectId===actor.subjectId&&larkIdentity==='bot'?client:null,
  authorize:(current,_input,{lark})=>allowed&&current.subjectId===actor.subjectId&&lark.identity==='bot'});
 assert.equal(capabilities.length,LARK_TOOL_CATALOG.length);
 const dispatcher=new CapabilityDispatcher({capabilities});
 const join='lark.im.v1.chatmembers.mejoin',input={path:{chat_id:'oc_fixture'}};
 await dispatcher.invoke(join,input,{actor,callId:'join-one'});
 assert.equal(calls[0].method,'PATCH');assert.equal(calls[0].path.chat_id,'oc_fixture');assert.equal(calls[0].useUAT,false);
 await assert.rejects(dispatcher.invoke(join,{...input,useUAT:true},{actor,callId:'identity-switch'}),{statusCode:400});
 await assert.rejects(dispatcher.invoke(join,input,{actor}),{statusCode:400});
 allowed=false;await assert.rejects(dispatcher.invoke(join,input,{actor,callId:'revoked'}),{statusCode:403});assert.equal(calls.length,1);allowed=true;
 await dispatcher.invoke('lark.im.v1.message.reply',{path:{message_id:'om_fixture'},data:{msg_type:'text',content:'{"text":"fixture reply"}'}},{actor,callId:'reply-one'});
 await dispatcher.invoke('lark.docx.v1.document.rawcontent',{path:{document_id:'doc_fixture'}},{actor});
 assert.equal(calls.length,3);
 lost=true;await assert.rejects(dispatcher.invoke(join,input,{actor,callId:'join-uncertain'}));assert.equal(calls.length,4);
 lost=false;official.updateUserAccessToken('synthetic-user-token');
 const userCapabilities=await importLarkCapabilities({client,identity:'user',domains:[],tools:['im.v1.chatMembers.meJoin'],authorize:()=>true,resolveClient:()=>client});
 await new CapabilityDispatcher({capabilities:userCapabilities}).invoke(join,input,{actor,callId:'user-join'});
 assert.equal(calls.at(-1).useUAT,true);
 assert.equal(capabilities.find(cap=>cap.name===join).retry,'never-replay');
 await assert.rejects(importLarkCapabilities({client:{listTools:async()=>({tools:[]})},identity:'bot',domains:['im'],authorize:()=>true,resolveClient:()=>client}),/unavailable/);
 assert.throws(()=>selectLarkTools({domains:['typo']}),/Unknown/);
 console.log(JSON.stringify({example:'core-lark-mcp',officialMcp:'0.5.1',importedTools:capabilities.length,domains,groupJoinMapping:true,replyAndDocumentMapping:true,fixedIdentity:true,revocation:true,unknownWriteNotRetried:true,liveProvider:false}));
} finally {await client.close();await server.close();}
