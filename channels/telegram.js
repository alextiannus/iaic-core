import {telegramMessage} from './normalizers.js';
import {boundRoute,deliveryPort,equalSecret,fail,key,postJson,rawBytes} from './provider-utils.js';

export function readTelegramWebhook(rawBody,{secretToken,providedSecret,installationId,botUsername}={}){
 if(!equalSecret(key(secretToken),providedSecret))throw fail('Telegram webhook authentication failed',403);
 return telegramMessage(JSON.parse(rawBytes(rawBody).toString('utf8')),{installationId,botUsername});
}

export function createTelegramNotificationDelivery({route,resolveBotToken,authorize,fetchImpl}={}){
 route=boundRoute(route,'telegram');
 if(typeof resolveBotToken!=='function'||!/^(-?[1-9]\d*)$/.test(route.conversationId)||route.threadId&&(!/^[1-9]\d*$/.test(route.threadId)||!Number.isSafeInteger(Number(route.threadId))))throw fail('Telegram token resolver and numeric chat/topic required');
 return deliveryPort({route,authorize,maxChars:4096,send:async({message,signal,idempotencyKey})=>{
  const token=await resolveBotToken(route.installationId);if(typeof token!=='string'||!/^\d+:[A-Za-z0-9_-]+$/.test(token))throw fail('Telegram credential unavailable');
  const body={chat_id:route.conversationId,text:message.text,...(route.threadId?{message_thread_id:Number(route.threadId)}:{})};
  const result=await postJson(`https://api.telegram.org/bot${token}/sendMessage`,body,{fetchImpl,signal});
  if(result?.ok!==true||!Number.isSafeInteger(result.result?.message_id)||String(result.result?.chat?.id)!==route.conversationId||route.threadId&&String(result.result?.message_thread_id)!==route.threadId)return {status:'unknown',idempotencyKey,reason:'telegram-receipt-unverified'};
  return {status:'delivered',idempotencyKey,reference:String(result.result.message_id)};
 }});
}
