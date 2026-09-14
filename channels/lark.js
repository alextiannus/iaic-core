import {channelMessage} from './assistant.js';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const key=value=>{if(typeof value!=='string'||!value.trim()||value.length>500)throw fail('Lark binding identifier required');return value;};

/** Accept verified V2 events or the official Node SDK's flattened event callback. */
export function larkMessage(payload,{installationId,appId,tenantKey,botOpenId}={}) {
  [installationId,appId,tenantKey].forEach(key);
  const header=payload?.header??payload,event=payload?.header?payload.event:payload;
  if(header?.event_type!=='im.message.receive_v1')return null;
  if(header.app_id!==appId||header.tenant_key!==tenantKey)throw fail('Lark application or tenant differs',403);
  const m=event?.message,sender=event?.sender;
  if(sender?.sender_type!=='user'||m?.message_type!=='text')return null;
  if(!['p2p','group'].includes(m.chat_type))throw fail('Unsupported Lark conversation kind');
  if(typeof m.content!=='string'||m.content.length>100000)throw fail('Bounded Lark text content required');
  let content;try{content=JSON.parse(m.content);}catch{throw fail('Invalid Lark text content');}
  if(typeof content?.text!=='string')throw fail('Lark text field required');
  let text=content.text;
  // Strip only the configured bot's own verified mention token, not arbitrary mentions.
  if(botOpenId)for(const mention of m.mentions??[]){if(mention.id?.open_id===botOpenId&&typeof mention.key==='string'&&mention.key)text=text.replaceAll(mention.key,'');}
  if(!text.trim())return null;
  return channelMessage({provider:'lark',installationId,eventId:key(header.event_id),conversationId:key(m.chat_id),senderId:key(sender.sender_id?.open_id),text:text.trim(),
    kind:m.chat_type==='p2p'?'direct':'group',...(m.root_id?{threadId:key(m.root_id)}:{})});
}

/** Bind the official SDK client to one currently authorized notification route. */
export function createLarkNotificationDelivery({client,route,authorize}) {
  if(route?.provider!=='lark'||typeof authorize!=='function'||typeof client?.im?.message?.create!=='function')throw fail('Lark SDK client, bound route and current authorization required');
  route=Object.freeze({...route});[route.installationId,route.conversationId,route.senderId].forEach(key);
  if(route.threadId){key(route.threadId);if(typeof client.im.message.reply!=='function')throw fail('Lark thread route requires message.reply');}
  return {allowed:true,send:async({idempotencyKey,message,signal})=>{
    if(typeof idempotencyKey!=='string'||!/^[a-zA-Z0-9_-]{1,50}$/.test(idempotencyKey))throw fail('Lark send requires a bounded original outbox UUID');
    if(typeof message?.text!=='string'||!message.text.trim()||message.text.length>16000)throw fail('Bounded Lark outbound text required');
    if(signal?.aborted||await authorize(route)!==true||signal?.aborted)return {status:'not_sent',idempotencyKey,reference:'local-preflight-denied'};
    const data={msg_type:'text',content:JSON.stringify({text:message.text}),uuid:idempotencyKey};
    // One SDK invocation; unknown delivery is never retried here, even after UUID expiry.
    let result;
    try{result=route.threadId?await client.im.message.reply({path:{message_id:route.threadId},data:{...data,reply_in_thread:true}}):await client.im.message.create({params:{receive_id_type:'chat_id'},data:{...data,receive_id:route.conversationId}});}
    catch{return {status:'unknown',idempotencyKey,reason:'lark-response-unavailable'};}
    if(result?.code!==0||typeof result.data?.message_id!=='string'||!result.data.message_id||result.data.chat_id!==route.conversationId)return {status:'unknown',idempotencyKey,reason:'lark-receipt-unverified'};
    return {status:'delivered',idempotencyKey,reference:result.data.message_id};
  }};
}
