import Ajv from 'ajv';
import {createHash} from 'node:crypto';
export const fail=(code,message,statusCode=400)=>Object.assign(new Error(message),{code,publicCode:code,statusCode});
export const canonical=v=>JSON.stringify(sort(v));
function sort(v){if(Array.isArray(v))return v.map(sort);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])]));return v;}
export const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
export const id={type:'string',minLength:1,maxLength:200};
export const text={type:'string',minLength:1,maxLength:8000};
export const strings={type:'array',items:id,minItems:1,maxItems:50,uniqueItems:true};
export const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
export const json={type:'object',maxProperties:100};
export const principal=object({tenantId:id,principalId:id});
export const identity=object({tenantId:id,principalId:id,agentId:id,roleBindingId:id,mandateRef:id});
export const reference=object({uri:id,version:id,hash:{type:'string',pattern:'^[a-f0-9]{64}$'}});
export const references={type:'array',items:reference,maxItems:20};
export const schemas={
 'endpoint.register':object({id,endpointRef:id,protocol:{enum:['internal','http','mcp','a2a','other']}}),
 'endpoint.status':object({id,status:{enum:['active','suspended','revoked']}}),
 'channel.create':object({id,subjectRef:id,subjectVersion:id,endpointIds:{...strings,maxItems:10,minItems:2},expiresAt:id,retainBody:{type:'boolean'},humanOwner:principal,maxAttempts:{type:'integer',minimum:1,maximum:10},maxMessages:{type:'integer',minimum:1,maximum:10000},allowedCapabilities:{type:'array',items:id,maxItems:50,uniqueItems:true}}),
 'channel.transition':object({id,state:{enum:['active','suspended','closing','closed']},expectedRevision:{type:'integer',minimum:1}}),
 'channel.subject':object({id,subjectVersion:id,expectedRevision:{type:'integer',minimum:1}}),
 'channel.get':object({id}),
 'grant.issue':object({id,channelId:id,endpointId:id,sendTypes:strings,receiveTypes:strings,expiresAt:id}),
 'grant.revoke':object({id}),
 'message.send':object({channelId:id,grantId:id,requestKey:id,recipientEndpointIds:{...strings,maxItems:10},subjectVersion:id,type:id,schemaVersion:id,expectedSequence:{type:'integer',minimum:0},content:{anyOf:[json,{type:'null'}]},references,replyTo:id},['channelId','grantId','requestKey','recipientEndpointIds','subjectVersion','type','schemaVersion','expectedSequence']),
 'message.get':object({id}),
 'message.lookup':object({channelId:id,requestKey:id}),
 'message.inbox':object({channelId:id,after:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},['channelId']),
 'message.ack':object({id,recipientEndpointId:id}),
 'delivery.retry':object({id,recipientEndpointId:id}),
 'delivery.reconcile':object({id,recipientEndpointId:id}),
 'channel.audit':object({id,after:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},['id']),
 'information.create':object({channelId:id,grantId:id,requestKey:id,targetEndpointId:id,subjectVersion:id,expectedSequence:{type:'integer',minimum:0},fields:strings,reason:text,acceptedSchema:id,dueAt:id}),
 'information.respond':object({id,grantId:id,requestKey:id,expectedSequence:{type:'integer',minimum:0},status:{enum:['answered','refused','unavailable']},values:json,reason:text},['id','grantId','requestKey','expectedSequence','status']),
 'information.get':object({id}),
 'human.create':object({channelId:id,requestKey:id,reason:text,allowedActions:strings,dueAt:id,messageId:id},['channelId','requestKey','reason','allowedActions','dueAt']),
 'human.get':object({id}),
 'human.resolve':object({id,action:id,evidence:references,requestKey:id}),
 'human.claim':object({id}),
 'human.cancel':object({id}),
 'formal.submit':object({channelId:id,grantId:id,requestKey:id,subjectVersion:id,messageIds:strings,capability:id,input:json}),
 'formal.result':object({id}),
 'formal.lookup':object({channelId:id,requestKey:id}),
 'formal.reconcile':object({id})
};
const ajv=new Ajv({strict:true,allErrors:true});const validators=new Map(Object.entries(schemas).map(([k,s])=>[k,ajv.compile(s)]));const identityValidator=ajv.compile(identity);
export function validate(operation,input){const v=validators.get(operation);if(!v?.(input))throw fail('PEER_INPUT','Invalid peer operation input',400);if(Buffer.byteLength(canonical(input))>65536)throw fail('PEER_SIZE','Peer input exceeds 64 KiB',413);return structuredClone(input);}
export function checkedIdentity(input){if(!identityValidator(input))throw fail('PEER_IDENTITY','Current authenticated principal binding required',403);return structuredClone(input);}
export const same=(a,b)=>canonical(a)===canonical(b);
export const future=(value,now)=>{const n=Date.parse(value);if(!Number.isFinite(n)||n<=now)throw fail('PEER_EXPIRY','A future expiry is required');return new Date(n).toISOString();};
export const active=(channel,now)=>channel.state==='active'&&Date.parse(channel.expiresAt)>now;
export const viewChannel=(c,now)=>({...c,state:!['closed','expired'].includes(c.state)&&Date.parse(c.expiresAt)<=now?'expired':c.state});
