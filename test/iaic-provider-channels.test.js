import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';
import {encrypt,getSignature} from '@wecom/crypto';
import {readTelegramWebhook,createTelegramNotificationDelivery,telegramMessage,readWhatsAppWebhook,whatsappMessages,whatsappWebhookChallenge,createWhatsAppNotificationDelivery,wecomMessage,createWecomNotificationDelivery} from '@immedi/iaic-core';
import {readWecomWebhook} from '@immedi/iaic-core/channels/wecom-webhook.js';
const route=(provider,sender,extra={})=>({provider,installationId:'installation',senderId:sender,conversationId:sender,kind:'direct',threadId:'',...extra});
const request={idempotencyKey:'outbox-original',message:{text:'Task complete'}};
const response=data=>new Response(JSON.stringify(data),{status:200});
const waBinding={installationId:'wa',businessAccountId:'100',phoneNumberId:'200'};
const waPayload={object:'whatsapp_business_account',entry:[{id:'100',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:'200'},messages:[{id:'wamid.one',from:'6599999999',type:'text',text:{body:'Start a task'}},{id:'wamid.two',from:'6588888888',type:'text',text:{body:'Another user'}}]}}]}]};
test('Telegram verified webhook supports own addressed commands and concrete group senders',()=>{
 const payload={update_id:12,message:{message_id:1,from:{id:7},chat:{id:-80,type:'supergroup'},message_thread_id:3,text:'/status@OurBot task'}};
 const options={secretToken:'fixture-secret',providedSecret:'fixture-secret',installationId:'bot',botUsername:'OurBot'};
 const m=readTelegramWebhook(Buffer.from(JSON.stringify(payload)),options);assert.equal(m.text,'/status task');assert.equal(m.kind,'group');assert.equal(m.threadId,'3');
 assert.throws(()=>readTelegramWebhook(Buffer.from('{}'),{...options,providedSecret:'forged'}),{statusCode:403});
 assert.equal(telegramMessage(payload,{...options,botUsername:'AnotherBot'}),null);
 assert.equal(telegramMessage({...payload,message:{...payload.message,sender_chat:{id:-80}}},options),null);
});
test('Telegram outbound uses exact chat/topic and never retries uncertain sends',async()=>{
 const calls=[];const delivery=createTelegramNotificationDelivery({route:route('telegram','7',{conversationId:'-80',kind:'group',threadId:'3'}),resolveBotToken:()=> '123:fixture',authorize:()=>true,fetchImpl:async(url,options)=>{calls.push({url,options});return response({ok:true,result:{message_id:6,chat:{id:-80},message_thread_id:3}});}});
 assert.equal((await delivery.send(request)).reference,'6');const body=JSON.parse(calls[0].options.body);assert.equal(body.chat_id,'-80');assert.equal(body.message_thread_id,3);assert.equal(body.parse_mode,undefined);assert.equal(body.idempotency_key,undefined);
 const uncertain=createTelegramNotificationDelivery({route:route('telegram','7'),resolveBotToken:()=> '123:fixture',authorize:()=>true,fetchImpl:async()=>{calls.push('lost');throw Error('lost');}});
 assert.equal((await uncertain.send(request)).status,'unknown');assert.equal(calls.length,2);
 await assert.rejects(delivery.send({...request,message:{text:'x'.repeat(4097)}}),{statusCode:400});
});
test('WhatsApp raw signature, challenge, batched users and WABA/phone boundaries',()=>{
 const raw=Buffer.from(JSON.stringify(waPayload)),appSecret='fixture-secret';const signature='sha256='+createHmac('sha256',appSecret).update(raw).digest('hex');
 const messages=readWhatsAppWebhook(raw,{...waBinding,appSecret,signature});assert.equal(messages.length,2);assert.notEqual(messages[0].senderId,messages[1].senderId);
 assert.throws(()=>readWhatsAppWebhook(Buffer.from('{}'),{...waBinding,appSecret,signature}),{statusCode:403});
 assert.throws(()=>whatsappMessages(waPayload,{...waBinding,phoneNumberId:'wrong'}),{statusCode:403});
 assert.throws(()=>whatsappMessages(waPayload,{...waBinding,businessAccountId:'wrong'}),{statusCode:403});
 assert.equal(whatsappWebhookChallenge({'hub.mode':'subscribe','hub.verify_token':'test','hub.challenge':'123'},{verifyToken:'test'}),'123');
 assert.throws(()=>whatsappWebhookChallenge({'hub.mode':'subscribe','hub.verify_token':'wrong'},{verifyToken:'test'}),{statusCode:403});
 const status=structuredClone(waPayload);delete status.entry[0].changes[0].value.messages;status.entry[0].changes[0].value.statuses=[{status:'read'}];assert.deepEqual(whatsappMessages(status,waBinding),[]);
});
test('WhatsApp text sends require current permission/window and bind accepted recipient',async()=>{
 let allowed=true,window=true,calls=0;const options={route:route('whatsapp','6599999999'),phoneNumberId:'200',apiVersion:'v25.0',resolveAccessToken:()=> 'fixture',authorize:()=>allowed,canSendText:()=>window,fetchImpl:async(url,input)=>{calls++;assert.equal(url,'https://graph.facebook.com/v25.0/200/messages');assert.equal(input.headers.authorization,'Bearer fixture');assert.equal(JSON.parse(input.body).to,'6599999999');return response({messaging_product:'whatsapp',contacts:[{wa_id:'6599999999'}],messages:[{id:'wamid.sent'}]});}};
 const delivery=createWhatsAppNotificationDelivery(options);assert.equal((await delivery.send(request)).status,'delivered');
 window=false;assert.equal((await delivery.send(request)).status,'not_sent');window=true;allowed=false;assert.equal((await delivery.send(request)).status,'not_sent');assert.equal(calls,1);
 allowed=true;const wrong=createWhatsAppNotificationDelivery({...options,fetchImpl:async()=>response({messaging_product:'whatsapp',contacts:[{wa_id:'other'}],messages:[{id:'wamid.wrong'}]})});assert.equal((await wrong.send(request)).status,'unknown');
});
const weBinding={installationId:'wecom-app',corpId:'wwcorp',agentId:1000002};
const xml='<xml><ToUserName><![CDATA[wwcorp]]></ToUserName><FromUserName>employee1</FromUserName><MsgType>text</MsgType><Content><![CDATA[Save & read]]></Content><MsgId>9223372036854775807</MsgId><AgentID>1000002</AgentID></xml>';
const cryptoConfig={...weBinding,token:'fixture-token',encodingAESKey:Buffer.alloc(32,1).toString('base64').slice(0,-1),now:1800000000000};
function encryptedInput(text,id='wwcorp',challenge=false){const cipher=encrypt(cryptoConfig.encodingAESKey,text,id),timestamp='1800000000',nonce='fixture';return {query:{timestamp,nonce,msg_signature:getSignature(cryptoConfig.token,timestamp,nonce,cipher),...(challenge?{echostr:cipher}:{})},rawBody:Buffer.from(`<xml><Encrypt><![CDATA[${cipher}]]></Encrypt></xml>`)};}
test('WeCom open-source crypto verifies encrypted challenge/messages without losing 64-bit IDs',()=>{
 const input=encryptedInput(xml),result=readWecomWebhook(input,cryptoConfig);assert.equal(result.messages[0].eventId,'9223372036854775807');assert.equal(result.messages[0].text,'Save & read');
 assert.equal(readWecomWebhook(encryptedInput(xml.replace('<![CDATA[Save & read]]>','Save &amp; read')),cryptoConfig).messages[0].text,'Save & read');
 assert.equal(readWecomWebhook(encryptedInput('echo','wwcorp',true),cryptoConfig).challenge,'echo');
 assert.throws(()=>readWecomWebhook({...input,query:{...input.query,msg_signature:'forged'}},cryptoConfig),{statusCode:403});
 assert.throws(()=>readWecomWebhook(input,{...cryptoConfig,now:cryptoConfig.now+700000}),{statusCode:403});
 assert.throws(()=>readWecomWebhook(encryptedInput(xml,'other'),cryptoConfig),{statusCode:403});
 assert.throws(()=>readWecomWebhook(encryptedInput(xml.replace('1000002','1000003')),cryptoConfig),{statusCode:403});
 assert.throws(()=>readWecomWebhook(encryptedInput('<!DOCTYPE xml [<!ENTITY a "bad">]>'+xml),cryptoConfig),{statusCode:400});
 assert.throws(()=>wecomMessage({ToUserName:'wwcorp',AgentID:'1000002',MsgType:'text',FromUserName:'@all',Content:'x',MsgId:'1'},weBinding),{statusCode:400});
});
test('WeCom outbound binds employee/app, rejects partial receipts and enforces byte limit',async()=>{
 let calls=0,allowed=true;const options={route:route('wecom','employee1'),agentId:1000002,resolveAccessToken:()=> 'fixture-token',authorize:()=>allowed,fetchImpl:async(url,input)=>{calls++;assert.equal(new URL(url).hostname,'qyapi.weixin.qq.com');const body=JSON.parse(input.body);assert.equal(body.touser,'employee1');assert.equal(body.agentid,1000002);assert.equal(body.toparty,undefined);return response({errcode:0,msgid:'wecom-receipt'});}};
 const delivery=createWecomNotificationDelivery(options);assert.equal((await delivery.send(request)).reference,'wecom-receipt');allowed=false;assert.equal((await delivery.send(request)).status,'not_sent');assert.equal(calls,1);
 await assert.rejects(delivery.send({...request,message:{text:'字'.repeat(683)}}),{statusCode:400});
 allowed=true;assert.equal((await createWecomNotificationDelivery({...options,fetchImpl:async()=>response({errcode:0,msgid:'partial',invaliduser:'employee1'})}).send(request)).status,'unknown');
});
