import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {SupportIssues} from '@immedi/iaic-core/support/service.js';
import {PostgresSupportStore} from '@immedi/iaic-core/support/store.js';
import {SupportConversations,PostgresSupportConversationStore,feedbackInstructions} from '@immedi/iaic-core/support/conversations.js';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;
const schema='conversation_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString});
await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new pg.Pool({connectionString,options:`-c search_path=${schema}`});
try {
 const store=new PostgresSupportStore({pool,namespace:'example'}),turns=new PostgresSupportConversationStore({pool,namespace:'example'});
 await store.initialize();await turns.initialize();
 const actor={scopeId:'example',subjectId:'user'},support=new SupportIssues({store,resolveIdentity:a=>a,authorize:()=>true});
 const messages={one:'保存失败',two:'I expected the document to be saved'};
 const options={support,store:turns,requiredFields:['expected'],resolveMessage:async(messageId,{identity})=>({confirmed:true,...identity,messageId,text:messages[messageId]})};
 const first=await new SupportConversations(options).start(actor,{messageId:'one'});
 assert.equal(first.state,'clarifying');
 const resumed=new SupportConversations(options);
 const next=await resumed.reply(actor,{id:first.issueId,requestKey:'turn-two',expectedRevision:1,messageId:'two',details:{expected:'Saved document'},classification:{type:'bug',confidence:.7,reason:'Unexpected save failure'}});
 assert.equal(next.state,'ready');assert.equal(next.issueId,first.issueId);assert.equal(next.original,'保存失败');
 assert.equal((await resumed.get(actor,{id:first.issueId})).history.length,1);
 assert.equal((await support.get(actor,{id:first.issueId})).state,'received');
 assert.ok(feedbackInstructions.includes('unknown'));
 console.log(JSON.stringify({example:'core-support-conversations',persistent:true,sameIssue:true,classification:'fixture-suggestion',liveModelAcceptance:false}));
} finally {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
