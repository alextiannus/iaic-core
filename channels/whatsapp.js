import {createHmac} from 'node:crypto';
import {channelMessage} from './assistant.js';
import {boundRoute,deliveryPort,equalSecret,fail,key,postJson,rawBytes} from './provider-utils.js';

export function whatsappMessages(payload,{installationId,businessAccountId,phoneNumberId}={}){
 [installationId,businessAccountId,phoneNumberId].forEach(key);
 if(payload?.object!=='whatsapp_business_account')return [];
 if(!Array.isArray(payload.entry))throw fail('WhatsApp entries required');
 const messages=[];
 for(const entry of payload.entry){
  if(entry.id!==businessAccountId)throw fail('WhatsApp business account differs',403);
  for(const change of entry.changes??[]){
   if(change.field!=='messages')continue;
   const value=change.value;
   if(value?.metadata?.phone_number_id!==phoneNumberId||value.messaging_product!=='whatsapp')throw fail('WhatsApp phone installation differs',403);
   for(const m of value.messages??[]){
    if(m.type!=='text')continue;
    if(m.group_id||value.group_id||m.recipient_type==='group')throw fail('WhatsApp group messages require a separate group adapter');
    // Phone-addressed direct chats only. Do not infer group/member or username identity.
    if(!/^\d+$/.test(m.from??''))throw fail('WhatsApp sender phone ID required');
    messages.push(channelMessage({provider:'whatsapp',installationId,eventId:m.id,conversationId:m.from,senderId:m.from,kind:'direct',text:m.text?.body}));
   }
  }
 }
 return messages;
}
export function readWhatsAppWebhook(rawBody,{appSecret,signature,...binding}={}){
 const bytes=rawBytes(rawBody);key(appSecret);
 const expected='sha256='+createHmac('sha256',appSecret).update(bytes).digest('hex');
 if(!equalSecret(expected,signature))throw fail('WhatsApp webhook authentication failed',403);
 return whatsappMessages(JSON.parse(bytes.toString('utf8')),binding);
}
export function whatsappWebhookChallenge(query,{verifyToken}={}){
 if(query?.['hub.mode']!=='subscribe'||!equalSecret(key(verifyToken),query['hub.verify_token'])||typeof query['hub.challenge']!=='string')throw fail('WhatsApp webhook challenge rejected',403);
 return query['hub.challenge'];
}
export function createWhatsAppNotificationDelivery({route,phoneNumberId,apiVersion,resolveAccessToken,authorize,canSendText,fetchImpl}={}){
 route=boundRoute(route,'whatsapp',{direct:true});
 if(!/^\d+$/.test(phoneNumberId??'')||!/^v\d+\.\d+$/.test(apiVersion??'')||!/^\d+$/.test(route.senderId)||typeof resolveAccessToken!=='function'||typeof canSendText!=='function'||typeof authorize!=='function')throw fail('WhatsApp phone/version/token resolver/current text-window policy required');
 return deliveryPort({route,maxChars:4096,authorize:async current=>await authorize(current)===true&&await canSendText(current)===true,send:async({message,signal,idempotencyKey})=>{
  const token=key(await resolveAccessToken(route.installationId));
  const body={messaging_product:'whatsapp',recipient_type:'individual',to:route.senderId,type:'text',text:{body:message.text,preview_url:false}};
  const result=await postJson(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,body,{fetchImpl,signal,headers:{authorization:`Bearer ${token}`}});
  if(result?.messaging_product!=='whatsapp'||typeof result.messages?.[0]?.id!=='string'||!result.messages[0].id||!result.contacts?.some(c=>c.wa_id===route.senderId))return {status:'unknown',idempotencyKey,reason:'whatsapp-receipt-unverified'};
  return {status:'delivered',idempotencyKey,reference:result.messages[0].id};
 }});
}
