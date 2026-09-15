import {channelMessage} from './assistant.js';
import {boundRoute,deliveryPort,fail,key,postJson} from './provider-utils.js';

export function wecomMessage(message,{installationId,corpId,agentId}={}){
 [installationId,corpId].forEach(key);
 if(!Number.isSafeInteger(agentId)||agentId<1)throw fail('WeCom internal application ID required');
 if(message?.ToUserName!==corpId||String(message.AgentID)!==String(agentId))throw fail('WeCom corporation/application differs',403);
 if(message.MsgType!=='text')return null;
 if(message.ChatId||message.ChatID)throw fail('WeCom internal app adapter does not support group events');
 const sender=key(message.FromUserName);
 if(sender.includes('|')||sender==='@all')throw fail('Concrete WeCom employee required');
 return channelMessage({provider:'wecom',installationId,eventId:key(message.MsgId),conversationId:sender,senderId:sender,kind:'direct',text:message.Content});
}
export function createWecomNotificationDelivery({route,agentId,resolveAccessToken,authorize,fetchImpl}={}){
 route=boundRoute(route,'wecom',{direct:true});
 if(!Number.isSafeInteger(agentId)||agentId<1||typeof resolveAccessToken!=='function'||route.senderId.includes('|')||route.senderId==='@all')throw fail('WeCom application/token resolver/concrete employee required');
 return deliveryPort({route,authorize,maxChars:16000,maxBytes:2048,send:async({message,signal,idempotencyKey})=>{
  const token=key(await resolveAccessToken(route.installationId));
  const result=await postJson(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`,{touser:route.senderId,agentid:agentId,msgtype:'text',text:{content:message.text},safe:0},{fetchImpl,signal});
  if(result?.errcode!==0||result.invaliduser||result.unlicenseduser||typeof result.msgid!=='string'||!result.msgid)return {status:'unknown',idempotencyKey,reason:'wecom-receipt-unverified'};
  return {status:'delivered',idempotencyKey,reference:result.msgid};
 }});
}
