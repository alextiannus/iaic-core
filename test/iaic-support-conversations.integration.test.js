import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresSupportStore} from '../support/store.js';
import {SupportIssues} from '../support/service.js';
import {SupportConversations,PostgresSupportConversationStore} from '../support/conversations.js';
import {createSupportConversationCapabilities} from '../support/capabilities.js';
import {CapabilityDispatcher} from '../capabilities/index.js';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
async function fixture(fn){
 const schema='c_'+randomUUID().replaceAll('-',''),namespace=randomUUID();
 const admin=new pg.Pool({connectionString:url});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`});
 const store=new PostgresSupportStore({pool,namespace});await store.initialize();
 const conversations=new PostgresSupportConversationStore({pool,namespace});await conversations.initialize();
 const actor={scopeId:'tenant',subjectId:'user'},messages=new Map();let revoked=false,override={},hook=()=>{};
 const support=new SupportIssues({store,resolveIdentity:a=>a,authorize:(actor,{action})=>!revoked&&(action!=='manage'||actor.engineer===true)});
 const options={support,store:conversations,requiredFields:['expected'],resolveMessage:async(messageId,{identity})=>{hook();return {confirmed:true,messageId,...identity,text:messages.get(messageId),...override};}};
 const service=new SupportConversations(options);
 try{await fn({actor,messages,service,support,options,conversations,store,control:{revoke:v=>revoked=v,override:v=>override=v,hook:v=>hook=v}});}
 finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('multilingual originals, clarification, correction and restart preserve one Issue and immutable turn history',{skip:!url},()=>fixture(async f=>{
 for(const [i,original] of ['保存时出错了','Please add an export button','Saya perlu bantuan'].entries()){
  const messageId=`initial-${i}`;f.messages.set(messageId,original);
  const [one,two]=await Promise.all([f.service.start(f.actor,{messageId}),f.service.start(f.actor,{messageId})]);
  assert.equal(one.issueId,two.issueId);assert.equal(one.original,original);assert.equal(one.classification.type,'unknown');assert.equal(one.state,'clarifying');
  assert.deepEqual(one.missingFields,['expected']);
  const resumed=new SupportConversations({...f.options,store:new PostgresSupportConversationStore({pool:f.conversations.pool,namespace:f.conversations.namespace})});
  f.messages.set(`reply-${i}`,'I expected a saved result');
  const input={id:one.issueId,requestKey:'reply',expectedRevision:1,messageId:`reply-${i}`,details:{expected:'Saved result'},classification:{type:'bug',confidence:.7,reason:'User reports unexpected failure'}};
  const done=await resumed.reply(f.actor,input);assert.equal(done.state,'ready');assert.equal(done.original,original);
  assert.deepEqual(await resumed.reply(f.actor,input),done);
  await resumed.reply(f.actor,{id:one.issueId,requestKey:'correct',expectedRevision:2,classification:{type:'issue',confidence:.8,reason:'Clarification indicates a usage question'}});
  const current=await resumed.get(f.actor,{id:one.issueId});assert.equal(current.history.length,2);assert.equal(current.initial.classification.type,'unknown');assert.equal(current.history[0].change.original,'I expected a saved result');assert.equal(current.classification.type,'issue');
  const reviewed=await resumed.review({...f.actor,subjectId:'engineer',engineer:true},{id:one.issueId});assert.equal(reviewed.classification.type,'issue');
  await assert.rejects(resumed.review(f.actor,{id:one.issueId}),{code:'SUPPORT_ACCESS_DENIED'});
  assert.equal((await f.support.get(f.actor,{id:one.issueId})).state,'received');
 }
 assert.equal((await f.support.list(f.actor)).length,3);
}));
test('lost initialization acknowledgement retries same Issue; concurrent corrections conflict and retry keys bind content',{skip:!url},()=>fixture(async f=>{
 f.messages.set('a','Original');const start=f.conversations.start.bind(f.conversations);let fail=true;
 f.conversations.start=async(...args)=>{const r=await start(...args);if(fail){fail=false;throw new Error('lost acknowledgement');}return r;};
 await assert.rejects(f.service.start(f.actor,{messageId:'a'}),/lost acknowledgement/);
 const one=await f.service.start(f.actor,{messageId:'a'});assert.equal((await f.support.list(f.actor)).length,1);
 const input={id:one.issueId,requestKey:'classify',expectedRevision:1,classification:{type:'improvement',confidence:.8,reason:'Requested enhancement'}};
 const results=await Promise.allSettled([f.service.reply(f.actor,input),f.service.reply(f.actor,{...input,requestKey:'other'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'SUPPORT_REVISION_CONFLICT');
 const win=results[0].status==='fulfilled'?input:{...input,requestKey:'other'};
 await assert.rejects(f.service.reply(f.actor,{...win,classification:{...win.classification,type:'bug'}}),{code:'SUPPORT_REQUEST_CONFLICT'});
 await assert.rejects(f.service.reply(f.actor,{...win,requestKey:'x',classification:{type:'bug',confidence:NaN,reason:'bad'}}),{code:'SUPPORT_INVALID_CLASSIFICATION'});
}));
test('message spoofing, machine impersonation, cross-user reads, revocation and unsupported fields are rejected',{skip:!url},()=>fixture(async f=>{
 f.messages.set('a','Original');f.control.override({subjectId:'other'});
 await assert.rejects(f.service.start(f.actor,{messageId:'a'}),{code:'SUPPORT_MESSAGE_UNVERIFIED'});f.control.override({});
 await assert.rejects(f.service.start({...f.actor,sourceKind:'business_ai_detected'},{messageId:'a'}),{code:'SUPPORT_OBSERVATION_REQUIRED'});
 const one=await f.service.start(f.actor,{messageId:'a'});
 await assert.rejects(f.service.get({...f.actor,subjectId:'other'},{id:one.issueId}),{code:'SUPPORT_NOT_FOUND'});
 await assert.rejects(f.service.get({...f.actor,scopeId:'other'},{id:one.issueId}),{code:'SUPPORT_NOT_FOUND'});
 await assert.rejects(f.service.reply(f.actor,{id:one.issueId,requestKey:'r',expectedRevision:1,messageId:'a',details:{password:'bad'}}),{code:'SUPPORT_INVALID_DETAILS'});
 f.control.hook(()=>f.control.revoke(true));
 await assert.rejects(f.service.reply(f.actor,{id:one.issueId,requestKey:'r',expectedRevision:1,messageId:'a'}),{code:'SUPPORT_ACCESS_DENIED'});
 f.control.hook(()=>{});f.control.revoke(false);
 const get=f.conversations.get.bind(f.conversations);f.conversations.get=async(...args)=>{const r=await get(...args);f.control.revoke(true);return r;};
 await assert.rejects(f.service.get(f.actor,{id:one.issueId}),{code:'SUPPORT_ACCESS_DENIED'});
}));
test('capability schemas expose minimal conversation tools without business permissions',{skip:!url},()=>fixture(async f=>{
 const capabilities=createSupportConversationCapabilities({conversations:f.service});
 assert.equal(capabilities.length,4);
 // Constructing the dispatcher compiles all public JSON schemas.
 new CapabilityDispatcher({capabilities});
 assert.ok(capabilities.some(c=>c.name==='support.feedback.start'));
}));
