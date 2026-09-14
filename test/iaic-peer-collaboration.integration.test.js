import {spawn} from 'node:child_process';import {createServer} from 'node:http';import {fileURLToPath} from 'node:url';
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {Pool} from 'pg';
import {openFixture,seed,actors,message,expiry} from '../examples/core-peer-collaboration/fixture.mjs';
async function fixture(fn){const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;assert.ok(connectionString);const schema='peer_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});try{const f=await openFixture(pool);await seed(f);await fn(f,pool);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
test('peer identities, independent grants, sequence and ordinary messages do not write domain facts',()=>fixture(async(f,pool)=>{
 await assert.rejects(f.call(actors.gamma,'message.send',message()),{code:'PEER_IDENTITY'});
 await assert.rejects(f.call(actors.alpha,'message.send',message({senderPrincipalId:'beta'})),{statusCode:400});
 const replies=await Promise.all([f.call(actors.alpha,'message.send',message()),f.call(actors.alpha,'message.send',message())]);assert.equal(replies[0].id,replies[1].id);
 assert.equal(replies[0].deliveries[0].state,'queued');assert.equal((await pool.query('SELECT * FROM peer_fixture_facts')).rowCount,0);
 await assert.rejects(f.call(actors.alpha,'message.send',message({content:{text:'changed'}})),{code:'PEER_CONFLICT'});
 await assert.rejects(f.call(actors.alpha,'message.send',message({requestKey:'stale'})),{code:'PEER_VERSION'});
 await assert.rejects(f.call(actors.gamma,'message.get',{id:replies[0].id}),{code:'PEER_PARTICIPANT'});
 await assert.rejects(f.call(actors.gamma,'channel.audit',{id:'channel'}),{code:'PEER_DENIED'});
 const inbox=await f.call(actors.beta,'message.inbox',{channelId:'channel'});assert.equal(inbox.items[0].id,replies[0].id);
 await f.peer.tick();assert.equal((await f.call(actors.alpha,'message.get',{id:replies[0].id})).receipt.deliveries[0].state,'delivered');
 const ack=await f.call(actors.beta,'message.ack',{id:replies[0].id,recipientEndpointId:'beta'});assert.equal(ack.deliveries[0].state,'application_acknowledged');
 await assert.rejects(f.call(actors.alpha,'message.ack',{id:replies[0].id,recipientEndpointId:'beta'}),{code:'PEER_IDENTITY'});
 await f.call(actors.controller,'grant.revoke',{id:'grant-alpha'});await assert.rejects(f.call(actors.alpha,'message.send',message({requestKey:'revoked',expectedSequence:1})),{code:'PEER_GRANT'});
 assert.equal((await f.call(actors.alpha,'message.get',{id:replies[0].id})).id,replies[0].id);
}));
test('unknown delivery queries the original effect; retry exhaustion creates a human task; restart keeps receipts',()=>fixture(async(f,pool)=>{
 f.state.deliveryMode='unknown';const m=await f.call(actors.alpha,'message.send',message());await f.peer.tick();
 assert.equal((await f.call(actors.alpha,'message.get',{id:m.id})).receipt.deliveries[0].state,'unknown');
 await assert.rejects(f.call(actors.alpha,'delivery.retry',{id:m.id,recipientEndpointId:'beta'}),{statusCode:409});
 const again=await openFixture(pool,f.state);assert.equal((await again.call(actors.alpha,'delivery.reconcile',{id:m.id,recipientEndpointId:'beta'})).deliveries[0].state,'delivered');assert.equal(f.state.received.size,1);
 f.state.deliveryMode='not_sent';const n=await f.call(actors.alpha,'message.send',message({requestKey:'failure',expectedSequence:1}));await f.peer.tick();await f.call(actors.alpha,'delivery.retry',{id:n.id,recipientEndpointId:'beta'});const recovered=await f.recovery.tick();assert.equal(recovered.escalations.length,1);const human=recovered.escalations[0];
 assert.equal((await f.recovery.tick()).escalations.length,0);
 await assert.rejects(f.call(actors.beta,'human.resolve',{id:human.id,action:'query',evidence:[],requestKey:'human-answer'}),{code:'PEER_DENIED'});
 await f.call(actors.human,'human.claim',{id:human.id});assert.equal((await f.call(actors.human,'human.resolve',{id:human.id,action:'query',evidence:[],requestKey:'human-answer'})).state,'resolved');
 assert.equal((await pool.query('SELECT * FROM peer_fixture_facts')).rowCount,0);
}));
test('structured information request validates recipient and minimal fields; formal action alone changes facts',()=>fixture(async(f,pool)=>{
 const request=await f.call(actors.alpha,'information.create',{channelId:'channel',grantId:'grant-alpha',requestKey:'question',targetEndpointId:'beta',subjectVersion:'v1',expectedSequence:0,fields:['quantity'],reason:'Need a quantity',acceptedSchema:'quantity.v1',dueAt:expiry});
 await assert.rejects(f.call(actors.alpha,'information.respond',{id:request.id,grantId:'grant-alpha',requestKey:'answer',expectedSequence:1,status:'answered',values:{quantity:2}}),{code:'PEER_IDENTITY'});
 const answer={id:request.id,grantId:'grant-beta',requestKey:'answer',expectedSequence:1,status:'answered',values:{quantity:2}};
 await assert.rejects(f.call(actors.beta,'information.respond',{...answer,values:{quantity:2,privatePolicy:'secret'}}),{code:'PEER_DISCLOSURE'});
 const response=await f.call(actors.beta,'information.respond',answer);assert.equal(response.status,'answered');assert.equal((await f.call(actors.beta,'information.respond',answer)).responseId,response.responseId);
 assert.equal((await pool.query('SELECT * FROM peer_fixture_facts')).rowCount,0);
 const formal={channelId:'channel',grantId:'grant-alpha',requestKey:'formal',subjectVersion:'v1',messageIds:[request.id,response.responseId],capability:'sample.set',input:{value:2}};f.state.domainLoss=true;
 const first=await f.call(actors.alpha,'formal.submit',formal);assert.equal(first.state,'unknown');assert.equal((await f.call(actors.alpha,'formal.submit',formal)).id,first.id);assert.equal((await pool.query('SELECT * FROM peer_fixture_facts')).rowCount,1);
 assert.equal((await f.call(actors.alpha,'formal.lookup',{channelId:'channel',requestKey:'formal'})).receipt.id,first.id);
 const result=await f.call(actors.alpha,'formal.reconcile',{id:first.id});assert.equal(result.state,'confirmed');assert.equal(result.result.value,2);
 await assert.rejects(f.call(actors.beta,'formal.result',{id:first.id}),{code:'PEER_FORMAL_DENIED'});
}));
test('queued delivery rechecks revocation; closure and feature-off keep history without new effects',()=>fixture(async(f)=>{
 const m=await f.call(actors.alpha,'message.send',message());f.state.revoked.add('alpha');await f.peer.tick();assert.equal(f.state.received.size,0);f.state.revoked.clear();
 const c=await f.call(actors.alpha,'channel.get',{id:'channel'});await f.call(actors.controller,'channel.transition',{id:c.id,state:'closing',expectedRevision:c.revision});
 await assert.rejects(f.call(actors.alpha,'message.send',message({requestKey:'after-close',expectedSequence:1})),{code:'PEER_CHANNEL_CLOSED'});
 assert.equal((await f.call(actors.alpha,'message.get',{id:m.id})).id,m.id);f.state.enabled=false;
 assert.equal((await f.call(actors.alpha,'channel.get',{id:'channel'})).state,'closing');
 await assert.rejects(f.call(actors.controller,'channel.create',{id:'new-channel',subjectRef:'subject-1',subjectVersion:'v1',endpointIds:['alpha','beta'],expiresAt:expiry,retainBody:false,humanOwner:c.humanOwner,maxAttempts:2,maxMessages:30,allowedCapabilities:[]}),{code:'PEER_DISABLED'});
 assert.equal((await f.call(actors.alpha,'message.lookup',{channelId:'channel',requestKey:'message-1'})).receipt.id,m.id);
}));
test('evidence is checked by current recipient policy and hash; reference-only channel rejects inline bodies',()=>fixture(async(f)=>{
 const good={uri:'artifact-1',version:'1',hash:createHash('sha256').update('evidence').digest('hex')};await f.call(actors.alpha,'message.send',message({references:[good]}));
 await assert.rejects(f.call(actors.alpha,'message.send',message({requestKey:'bad-hash',expectedSequence:1,references:[{...good,hash:'0'.repeat(64)}]})),{code:'PEER_EVIDENCE'});
 await f.call(actors.controller,'channel.create',{id:'refs',subjectRef:'subject-1',subjectVersion:'v1',endpointIds:['alpha','beta'],expiresAt:expiry,retainBody:false,humanOwner:{tenantId:'tenant-human',principalId:'human'},maxAttempts:2,maxMessages:30,allowedCapabilities:[]});
 for(const name of ['alpha','beta'])await f.call(actors.controller,'grant.issue',{id:'refs-'+name,channelId:'refs',endpointId:name,sendTypes:['note'],receiveTypes:['note'],expiresAt:expiry});
 const c=await f.call(actors.alpha,'channel.get',{id:'refs'});await f.call(actors.controller,'channel.transition',{id:'refs',state:'active',expectedRevision:c.revision});
 await assert.rejects(f.call(actors.alpha,'message.send',message({channelId:'refs',grantId:'refs-alpha'})),{code:'PEER_RETENTION'});
 const refOnly=await f.call(actors.alpha,'message.send',message({channelId:'refs',grantId:'refs-alpha',content:null,references:[good]}));assert.equal((await f.call(actors.beta,'message.get',{id:refOnly.id})).content,null);
 f.peer.readEvidence=async()=>null;await assert.rejects(f.call(actors.beta,'message.inbox',{channelId:'channel'}),{code:'PEER_EVIDENCE'});
}));

test('endpoint suspension, stale subject versions, expiry and rate limits reject new admissions',()=>fixture(async(f)=>{
 f.peer.messagesPerMinute=1;await f.call(actors.alpha,'message.send',message());
 await assert.rejects(f.call(actors.alpha,'message.send',message({requestKey:'rate',expectedSequence:1})),{code:'PEER_RATE'});
 f.state.now+=60000;const c=await f.call(actors.alpha,'channel.get',{id:'channel'});await f.call(actors.controller,'channel.subject',{id:c.id,subjectVersion:'v2',expectedRevision:c.revision});
 await assert.rejects(f.call(actors.alpha,'message.send',message({requestKey:'old-version',expectedSequence:1})),{code:'PEER_VERSION'});
 await f.call(actors.controller,'endpoint.status',{id:'beta',status:'suspended'});
 await assert.rejects(f.call(actors.alpha,'message.send',message({requestKey:'suspended',expectedSequence:1,subjectVersion:'v2'})),{code:'PEER_ENDPOINT'});
 await f.call(actors.controller,'endpoint.status',{id:'beta',status:'revoked'});await assert.rejects(f.call(actors.controller,'endpoint.status',{id:'beta',status:'active'}),{code:'PEER_ENDPOINT'});
 f.state.now=Date.parse(expiry)+1;assert.equal((await f.call(actors.alpha,'channel.get',{id:'channel'})).state,'expired');
 await assert.rejects(f.call(actors.alpha,'message.send',message({requestKey:'expired',expectedSequence:1,subjectVersion:'v2'})),{code:'PEER_CHANNEL_CLOSED'});
}));
test('killed delivery worker preserves committed remote effect and recovers via original query',()=>fixture(async(f,pool)=>{
 const m=await f.call(actors.alpha,'message.send',message());let entered;const delivered=new Promise(resolve=>entered=resolve);let child;let childError='';
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);f.state.received.set(data.idempotencyKey,data.envelope.id);entered();/* Deliberately lose the response after remote acceptance. */});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 try{
  const fixtureUrl=new URL('../examples/core-peer-collaboration/fixture.mjs',import.meta.url).href;
  const code=`import {Pool} from 'pg';import {openFixture} from ${JSON.stringify(fixtureUrl)};const pool=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL,options:process.env.PEER_TEST_SCHEMA});const f=await openFixture(pool);f.peer.resolveDelivery=async()=>({send:async request=>{const response=await fetch(process.env.PEER_TEST_ENDPOINT,{method:'POST',body:JSON.stringify(request)});return response.json();}});await f.peer.tick();await pool.end();`;
  child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,PEER_TEST_SCHEMA:pool.options.options,PEER_TEST_ENDPOINT:url},stdio:['ignore','ignore','pipe']});child.stderr.on('data',b=>childError+=b);
  let timer;try{await Promise.race([delivered,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Delivery did not reach remote endpoint: '+childError)),8000);})]);}finally{clearTimeout(timer);}
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));child.kill('SIGKILL');assert.equal((await exited).signal,'SIGKILL');
  // Advance the test lease after an actual process kill, without waiting a minute.
  await pool.query("UPDATE iaic_notifications SET lease_until=now()-interval '1 second' WHERE state='sending'");
  const restarted=await openFixture(pool,f.state);await restarted.peer.tick();assert.equal((await restarted.call(actors.alpha,'message.get',{id:m.id})).receipt.deliveries[0].state,'unknown');
  assert.equal((await restarted.call(actors.alpha,'delivery.reconcile',{id:m.id,recipientEndpointId:'beta'})).deliveries[0].state,'delivered');assert.equal(f.state.received.size,1);
 }finally{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}));

test('receipt reconciliation survives withdrawn evidence and a query-only retired transport',()=>fixture(async(f)=>{
 const reference={uri:'artifact-1',version:'1',hash:createHash('sha256').update('evidence').digest('hex')};
 f.state.deliveryMode='unknown';const m=await f.call(actors.alpha,'message.send',message({references:[reference]}));await f.peer.tick();
 f.peer.readEvidence=async()=>null;
 await assert.rejects(f.call(actors.alpha,'message.get',{id:m.id}),{code:'PEER_EVIDENCE'});
 const original=f.peer.resolveDelivery;f.peer.resolveDelivery=async data=>({query:(await original(data)).query});
 const c=await f.call(actors.alpha,'channel.get',{id:'channel'});await f.call(actors.controller,'channel.transition',{id:c.id,state:'closing',expectedRevision:c.revision});
 await assert.rejects(f.call(actors.gamma,'delivery.reconcile',{id:m.id,recipientEndpointId:'beta'}),{code:'PEER_PARTICIPANT'});
 const receipt=await f.call(actors.alpha,'delivery.reconcile',{id:m.id,recipientEndpointId:'beta'});
 assert.equal(receipt.deliveries[0].state,'delivered');assert.equal(f.state.received.size,1);assert.equal(Object.hasOwn(receipt,'content'),false);
}));

test('expired human creation replay returns the original task without reopening it',()=>fixture(async(f,pool)=>{
 const input={channelId:'channel',requestKey:'human-expiring',reason:'Query original result',allowedActions:['query'],dueAt:new Date(f.state.now+1000).toISOString()};
 const task=await f.call(actors.controller,'human.create',input);f.state.now+=1001;
 const replay=await f.call(actors.controller,'human.create',input);assert.equal(replay.id,task.id);assert.equal(replay.state,'expired');
 assert.equal((await pool.query("SELECT * FROM iaic_peer_records WHERE kind='human'")).rowCount,1);
 await assert.rejects(f.call(actors.controller,'human.create',{...input,reason:'Different meaning'}),{code:'PEER_CONFLICT'});
 await assert.rejects(f.call(actors.controller,'human.create',{...input,requestKey:'new-expired'}),{code:'PEER_EXPIRY'});
}));

test('non-exhausted failures cannot starve later unknown deliveries from human escalation',()=>fixture(async(f)=>{
 await f.store.transaction(async tx=>{const c=await tx.get('channel','channel');c.maxMessages=100;await tx.put('channel',c.id,c);});
 f.state.deliveryMode='not_sent';
 for(let n=0;n<50;n++){await f.call(actors.alpha,'message.send',message({requestKey:'failed-'+n,expectedSequence:n}));await f.peer.tick();}
 f.state.deliveryMode='unknown';const unknown=await f.call(actors.alpha,'message.send',message({requestKey:'unknown-after-failures',expectedSequence:50}));
 const result=await f.recovery.tick();assert.equal(result.escalations.length,1);assert.equal(result.escalations[0].messageId,unknown.id);
}));
