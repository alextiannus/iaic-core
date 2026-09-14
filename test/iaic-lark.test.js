import test from 'node:test';import assert from 'node:assert/strict';
import {larkMessage,createLarkNotificationDelivery} from '@immedi/iaic-core/channels/lark.js';
const options={installationId:'tenant-app',appId:'cli_fixture',tenantKey:'tenant',botOpenId:'ou_bot'};
const event={schema:'2.0',header:{event_type:'im.message.receive_v1',event_id:'event',app_id:options.appId,tenant_key:options.tenantKey},event:{sender:{sender_type:'user',sender_id:{open_id:'ou_user'}},message:{message_id:'om_message',chat_id:'oc_chat',chat_type:'p2p',message_type:'text',content:JSON.stringify({text:'Start my task'})}}};
test('Lark V2 and official SDK events normalize with strict tenant/application binding',()=>{
 const message=larkMessage(event,options);assert.equal(message.provider,'lark');assert.equal(message.senderId,'ou_user');assert.equal(message.kind,'direct');
 assert.deepEqual(larkMessage({...event.header,...event.event},options),message);
 assert.throws(()=>larkMessage(event,{...options,tenantKey:'other'}),{statusCode:403});assert.throws(()=>larkMessage(event,{...options,appId:'other'}),{statusCode:403});
 assert.equal(larkMessage({...event,event:{...event.event,sender:{sender_type:'app'}}},options),null);
 assert.equal(larkMessage({...event,event:{...event.event,message:{...event.event.message,message_type:'image'}}},options),null);
 const group=structuredClone(event);Object.assign(group.event.message,{chat_type:'group',root_id:'om_root',thread_id:'omt_topic',content:JSON.stringify({text:'@_user_1 /status task'}),mentions:[{key:'@_user_1',id:{open_id:'ou_bot'}}]});
 assert.equal(larkMessage(group,options).text,'/status task');assert.equal(larkMessage(group,options).threadId,'om_root');
 group.event.message.content='{invalid';assert.throws(()=>larkMessage(group,options));
});
test('Lark delivery maps text/create/thread reply, current revocation and unknown receipts',async()=>{
 const calls=[],route={provider:'lark',installationId:'tenant-app',conversationId:'oc_chat',senderId:'ou_user',threadId:''};let allowed=true,lost=false;
 const client={im:{message:{create:async input=>{calls.push(input);if(lost)throw Error('lost response');return {code:0,data:{chat_id:'oc_chat',message_id:'om_sent'}};},reply:async input=>{calls.push(input);return {code:0,data:{chat_id:'oc_chat',message_id:'om_reply'}};}}}};
 const request={idempotencyKey:'original-outbox-uuid',message:{text:'Task complete'}};
 const delivery=createLarkNotificationDelivery({client,route,authorize:()=>allowed});assert.equal((await delivery.send(request)).status,'delivered');assert.equal(calls[0].data.uuid,request.idempotencyKey);assert.equal(calls[0].params.receive_id_type,'chat_id');assert.equal(JSON.parse(calls[0].data.content).text,'Task complete');
 const reply=createLarkNotificationDelivery({client,route:{...route,threadId:'om_root'},authorize:()=>allowed});assert.equal((await reply.send(request)).reference,'om_reply');assert.equal(calls[1].path.message_id,'om_root');assert.equal(calls[1].data.reply_in_thread,true);
 allowed=false;assert.equal((await delivery.send(request)).status,'not_sent');assert.equal(calls.length,2);allowed=true;lost=true;assert.equal((await delivery.send(request)).status,'unknown');assert.equal(calls.length,3);
 client.im.message.create=async()=>({code:0,data:{chat_id:'another-chat',message_id:'om_wrong'}});assert.equal((await delivery.send(request)).status,'unknown');
});
