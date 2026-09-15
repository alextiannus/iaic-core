// Optional entry: install @wecom/crypto and fast-xml-parser in the WeCom host.
import {decrypt,getSignature} from '@wecom/crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {equalSecret,fail,key,rawBytes} from './provider-utils.js';
import {wecomMessage} from './wecom.js';
const parser=new XMLParser({parseTagValue:false,parseAttributeValue:false,trimValues:false,ignoreAttributes:true,processEntities:true});
function xml(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>1024*1024||/<!DOCTYPE|<!ENTITY/i.test(text)||XMLValidator.validate(text)!==true)throw fail('Invalid WeCom XML');
 const body=parser.parse(text).xml;
 if(!body||typeof body!=='object'||Array.isArray(body))throw fail('WeCom XML envelope required');
 return body;
}
export function readWecomWebhook({rawBody,query},{token,encodingAESKey,corpId,agentId,installationId,now=Date.now(),maxAgeSeconds=600}={}){
 [token,corpId,installationId].forEach(key);
 if(!/^[A-Za-z0-9+/]{43}$/.test(encodingAESKey??'')||!Number.isFinite(now)||!Number.isFinite(maxAgeSeconds)||maxAgeSeconds<=0)throw fail('WeCom encryption configuration required');
 const {timestamp,nonce,msg_signature:signature,echostr}=query??{};
 if(typeof timestamp!=='string'||!/^\d+$/.test(timestamp)||!Number.isFinite(Number(timestamp))||Math.abs(now/1000-Number(timestamp))>maxAgeSeconds)throw fail('WeCom callback timestamp rejected',403);
 key(nonce);
 const encrypted=echostr===undefined?xml(rawBytes(rawBody).toString('utf8')).Encrypt:echostr;
 if(typeof encrypted!=='string'||encrypted.length>1024*1024||!equalSecret(getSignature(token,timestamp,nonce,encrypted),signature))throw fail('WeCom callback authentication failed',403);
 let decoded;try{decoded=decrypt(encodingAESKey,encrypted);}catch{throw fail('WeCom callback decryption failed',403);}
 if(decoded.id!==corpId)throw fail('WeCom decrypted corporation differs',403);
 if(echostr!==undefined)return {challenge:decoded.message,messages:[]};
 const message=wecomMessage(xml(decoded.message),{installationId,corpId,agentId});
 return {messages:message?[message]:[]};
}
