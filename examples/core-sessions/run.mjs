import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {SessionStore,AssistantSessions} from '@immedi/iaic-core';
const connectionString=process.env.DATABASE_URL||process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL URL required');
const admin=new Pool({connectionString}),schema='session_example_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
const scope={applicationId:'session-demo',assistantId:'helper',subjectId:'reader'};
try{
 const store=new SessionStore({pool});await store.initialize();const sessions=new AssistantSessions({store,resolveScope:async actor=>({...scope,subjectId:actor.subjectId})}),actor={subjectId:'reader'};
 const session=await sessions.create(actor,{requestKey:'demo'}),message={sessionId:session.id,text:'Use the project name Aurora.',requestKey:'message',expectedSequence:0};await sessions.appendMessage(actor,message);await sessions.appendMessage(actor,message);
 const restored=new AssistantSessions({store:new SessionStore({pool}),resolveScope:async()=>scope});const snapshot=await restored.context(actor,{id:session.id,throughSequence:1});assert.equal(snapshot.events.length,1);assert.equal(snapshot.events[0].data.text,message.text);
 await sessions.appendMessage(actor,{...message,text:'Later message',requestKey:'later',expectedSequence:1});assert.equal((await restored.context(actor,{id:session.id,throughSequence:1})).events.length,1);
 const close={sessionId:session.id,state:'closed',requestKey:'close',expectedSequence:2};await sessions.setState(actor,close);await restored.setState(actor,close);
 await assert.rejects(sessions.appendMessage(actor,{...message,requestKey:'closed-message',expectedSequence:3}),{statusCode:409});
 assert.equal((await restored.read(actor,{sessionId:session.id})).session.state,'closed');await restored.setState(actor,{...close,state:'open',requestKey:'reopen',expectedSequence:3});
 await assert.rejects(sessions.read({subjectId:'other'},{sessionId:session.id}),{statusCode:404});
 console.log(JSON.stringify({application:'core-sessions',durableTimeline:true,closeAndReopen:true,idempotentAppend:true,pinnedContext:true,scopedAccess:true,erpUsed:false}));
}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
