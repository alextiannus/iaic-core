import {defineCapability} from '../../capabilities/index.js';
import {schemas,hash} from './contracts.js';
export function createPeerCapabilities({peer,requests=null,humans=null,formal=null}){
 return Object.entries(schemas).filter(([op])=>!op.startsWith('information.')||requests).filter(([op])=>!op.startsWith('human.')||humans).filter(([op])=>!op.startsWith('formal.')||formal).map(([op,input])=>{
  const reading=['channel.get','channel.audit','message.get','message.lookup','message.inbox','information.get','human.get','formal.result','formal.lookup'].includes(op);
  const execute=(input,{actor})=>op.startsWith('formal.')?formal.run(actor,op,input):op.startsWith('information.')?requests.run(actor,op,input):op.startsWith('human.')?humans.run(actor,op,input):op.startsWith('delivery.')?peer.delivery(actor,op,input):peer.run(actor,op,input);
  return defineCapability({name:'peer.'+op,description:'Peer collaboration '+op+'. Messages are communication evidence, never domain outcomes. Subject, principal and current grants remain authoritative.',input,output:{type:'object'},effect:reading?'read':'write',...(!reading?{retry:['message.send','message.ack','channel.create','endpoint.register','grant.issue','grant.revoke','information.create','information.respond','human.create','human.resolve','formal.submit'].includes(op)?'idempotent':'never-replay'}:{}),authorize:async actor=>Boolean(await peer.who(actor)),projectHistoryInput:input=>reading?input:{inputHash:hash(input)},revalidate:async(input,result,context)=>{if(reading)return execute(input,context);await peer.permit(context.actor,'receipt.read',{operation:op,input});return {operation:op,id:result.id??null,originalReceipt:true};},implementation:{kind:'function',execute}});
 });
}
