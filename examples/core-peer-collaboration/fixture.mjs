import {PostgresPeerStore,PeerCollaboration,PeerInformationRequests,PeerHumanTasks,PeerFormalActions,PeerDeliveryRecovery,createPeerCapabilities,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
export const actors=Object.fromEntries(['alpha','beta','gamma','controller','human'].map(subjectId=>[subjectId,{subjectId,scopeId:'peer-fixture'}]));
export const who=actor=>({tenantId:'tenant-'+actor.subjectId,principalId:actor.subjectId,agentId:'agent-'+actor.subjectId,roleBindingId:'role-'+actor.subjectId,mandateRef:'mandate-'+actor.subjectId});
export const expiry='2035-01-01T00:00:00.000Z';
export async function openFixture(pool,state={}){
 state.now??=Date.parse('2030-01-01T00:00:00Z');state.enabled??=true;state.revoked??=new Set();state.received??=new Map();state.deliveryMode??='delivered';state.domainLoss??=false;
 const store=new PostgresPeerStore({pool,namespace:'peer-fixture'});await store.initialize();await pool.query('CREATE TABLE IF NOT EXISTS peer_fixture_facts(effect_key text PRIMARY KEY,owner text NOT NULL,value integer NOT NULL)');
 const peer=new PeerCollaboration({store,resolveIdentity:actor=>{if(!actors[actor.subjectId])throw Error('Unknown actor');return who(actor);},restoreActor:identity=>actors[identity.principalId],isEnabled:()=>state.enabled,clock:()=>state.now,
  authorize:async(actor,{action})=>{
   if(['endpoint.register','endpoint.status','channel.create','channel.transition','channel.subject','grant.issue','grant.revoke','channel.inspect','human.admin'].includes(action))return actor.subjectId==='controller';
   if(['channel.use','grant.use','message.deliver','formal.submit'].includes(action)&&state.revoked.has(actor.subjectId))return false;
   return Boolean(actors[actor.subjectId]);
  },
  verifyEndpoint:async(_actor,input)=>({identity:who(actors[input.endpointRef]),endpointRef:input.endpointRef,protocol:input.protocol,verificationRef:'verified-'+input.endpointRef,validUntil:expiry}),
  validateContent:async({type,content})=>type==='information.answer'?typeof content?.quantity==='number':content===null||typeof content==='object',
  readEvidence:async()=>({content:'evidence',producerRef:'fixture-authority',issuedAt:'2029-01-01T00:00:00Z',subjectRef:'subject-1',subjectVersion:'v1',version:'1',validUntil:expiry,revoked:false}),
  resolveDelivery:async()=>({send:async({idempotencyKey,envelope})=>{if(state.deliveryMode==='not_sent')return {status:'not_sent'};state.received.set(idempotencyKey,envelope.id);if(state.deliveryMode==='unknown')throw Error('Response lost');return {status:'delivered',milestone:'delivered',receiptRef:idempotencyKey};},query:async({idempotencyKey})=>state.received.has(idempotencyKey)?{status:'delivered',milestone:'delivered',receiptRef:idempotencyKey}:{status:'unknown'}})
 });
 const domain=new CapabilityDispatcher({capabilities:[defineCapability({name:'sample.set',description:'Write a deterministic sample fact',effect:'write',retry:'idempotent',authorize:actor=>['alpha','beta'].includes(actor.subjectId)&&!state.revoked.has(actor.subjectId),input:{type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false},output:{type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false},revalidate:async(_input,_result,{callId})=>{const r=(await pool.query('SELECT value FROM peer_fixture_facts WHERE effect_key=$1',[callId])).rows[0];if(!r)throw Error('Fact unavailable');return r;},verify:(_input,result)=>Number.isInteger(result.value),implementation:{kind:'function',execute:async(input,{actor,callId})=>{await pool.query('INSERT INTO peer_fixture_facts(effect_key,owner,value) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[callId,actor.subjectId,input.value]);if(state.domainLoss)throw Error('Committed result lost');return input;}}})]});
 const requests=new PeerInformationRequests({peer}),humans=new PeerHumanTasks({peer}),formal=new PeerFormalActions({peer,dispatcher:domain,query:async({effectKey})=>{const r=(await pool.query('SELECT value FROM peer_fixture_facts WHERE effect_key=$1',[effectKey])).rows[0];return r?{status:'confirmed',result:r}:{status:'unknown'};}});
 const recovery=new PeerDeliveryRecovery({peer,humans,resolveEscalation:async({job})=>({actor:actors.controller,input:{requestKey:'delivery-'+job.messageId,reason:'Resolve original delivery before retrying',allowedActions:['query','contact-owner'],dueAt:expiry}})});
 const dispatcher=new CapabilityDispatcher({capabilities:createPeerCapabilities({peer,requests,humans,formal})});
 const call=(actor,operation,input,key='fixture-request')=>dispatcher.invoke('peer.'+operation,input,{actor,callId:key});
 return {peer,requests,humans,formal,recovery,dispatcher,call,state,store};
}
export async function seed(f){
 for(const name of ['alpha','beta','gamma'])await f.call(actors.controller,'endpoint.register',{id:name,endpointRef:name,protocol:'internal'});
 await f.call(actors.controller,'channel.create',{id:'channel',subjectRef:'subject-1',subjectVersion:'v1',endpointIds:['alpha','beta'],expiresAt:expiry,retainBody:true,humanOwner:{tenantId:'tenant-human',principalId:'human'},maxAttempts:2,maxMessages:30,allowedCapabilities:['sample.set']});
 for(const name of ['alpha','beta'])await f.call(actors.controller,'grant.issue',{id:'grant-'+name,channelId:'channel',endpointId:name,sendTypes:['note','information.request','information.response','formal.submit'],receiveTypes:['note','information.request','information.response'],expiresAt:expiry});
 const c=await f.call(actors.alpha,'channel.get',{id:'channel'});await f.call(actors.controller,'channel.transition',{id:'channel',state:'active',expectedRevision:c.revision});
}
export const message=(overrides={})=>({channelId:'channel',grantId:'grant-alpha',requestKey:'message-1',recipientEndpointIds:['beta'],subjectVersion:'v1',type:'note',schemaVersion:'note.v1',expectedSequence:0,content:{text:'I accept; pay and complete.'},...overrides});
