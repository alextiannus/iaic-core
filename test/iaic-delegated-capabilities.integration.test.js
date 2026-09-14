import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {PostgresDelegationStore,DelegatedCapabilities,CapabilityDispatcher,defineCapability,createDelegatedToolCapabilities} from '@immedi/iaic-core';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createCapabilityMcpServer} from '@immedi/iaic-core/mcp/server.js';
async function fixture(fn){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
 const schema='delegated_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 try{const store=new PostgresDelegationStore({pool,namespace:'fixture'});await store.initialize();await pool.query('CREATE TABLE effects(id text PRIMARY KEY,actor text)');
  const permitted=new Set(['issuer','delegate']);let loseResponse=false;
  const cap=defineCapability({name:'write',description:'Fixture effect',input:{type:'object',properties:{resource:{type:'string'}},required:['resource'],additionalProperties:false},output:{type:'object'},effect:'write',retry:'never-replay',authorize:a=>permitted.has(a.subjectId),implementation:{kind:'function',execute:async(i,c)=>{await pool.query('INSERT INTO effects VALUES($1,$2)',[c.callId,c.actor.subjectId]);if(loseResponse)throw new Error('Lost response');return {done:true};}}});
  const dispatcher=new CapabilityDispatcher({capabilities:[cap]}),principal=subjectId=>({applicationId:'app',subjectId});
  const options={store,dispatcher,resolvePrincipal:a=>principal(a.subjectId),restoreActor:r=>({subjectId:r.subjectId}),authorizeGrant:()=>true,allowInput:({terms,input})=>input.resource===terms.constraints.resource};
  const d=new DelegatedCapabilities(options),issuer={subjectId:'issuer'},delegate={subjectId:'delegate'};
  const terms={id:'grant',delegate:principal('delegate'),payer:principal('issuer'),tools:['write'],constraints:{resource:'allowed'},deadlineAt:new Date(Date.now()+60000).toISOString(),maxCalls:1};
  await d.issue(issuer,terms);await fn({d,options,store,pool,issuer,delegate,terms,permitted,lose:()=>{loseResponse=true;}});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Cross-principal capability calls preserve executor and atomically bound concurrent admissions',async()=>fixture(async({d,delegate,pool,issuer})=>{
 const outcomes=await Promise.allSettled(['a','b'].map(callId=>d.invoke(delegate,{grantId:'grant',callId,capability:'write',input:{resource:'allowed'}})));
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
 const rows=(await pool.query('SELECT * FROM effects')).rows;assert.equal(rows.length,1);assert.equal(rows[0].actor,'delegate');
 const entry=await d.read(issuer,'grant');assert.equal(entry.calls.length,1);assert.equal(entry.calls[0].outcome,'returned');assert.deepEqual(entry.terms.payer,{applicationId:'app',subjectId:'issuer'});
}));
test('Delegated calls recheck issuer and delegate authority, resource ceilings and revocation',async()=>fixture(async({d,delegate,issuer,permitted,pool})=>{
 const call={grantId:'grant',callId:'one',capability:'write',input:{resource:'allowed'}};
 await assert.rejects(d.invoke(delegate,{...call,input:{resource:'other'}}),{statusCode:403});
 permitted.delete('issuer');await assert.rejects(d.invoke(delegate,call),{statusCode:403});permitted.add('issuer');
 permitted.delete('delegate');await assert.rejects(d.invoke(delegate,call),{statusCode:403});permitted.add('delegate');
 await assert.rejects(d.read({subjectId:'other'},'grant'),{statusCode:403});await d.revoke(issuer,'grant');await assert.rejects(d.invoke(delegate,call),{statusCode:403});
 assert.equal((await pool.query('SELECT * FROM effects')).rowCount,0);
}));
test('Lost delegated effect response survives reconstruction and is never blindly replayed',async()=>fixture(async({d,delegate,issuer,options,pool,lose})=>{
 lose();const call={grantId:'grant',callId:'one',capability:'write',input:{resource:'allowed'}};
 await assert.rejects(d.invoke(delegate,call),/Lost response/);
 const restored=new DelegatedCapabilities({...options,store:new PostgresDelegationStore({pool,namespace:'fixture'})});
 await assert.rejects(restored.invoke(delegate,call),{statusCode:409});assert.equal((await pool.query('SELECT * FROM effects')).rowCount,1);
 assert.equal((await restored.read(issuer,'grant')).calls[0].outcome,'unknown');
}));
test('External direct invocation cannot bypass Task-bound grant Runtime checks',async()=>fixture(async({d,issuer,delegate,terms,pool})=>{
 await d.issue(issuer,{...terms,id:'task-bound',task:{capability:'agent.work'}});
 await assert.rejects(d.invoke(delegate,{grantId:'task-bound',callId:'direct',capability:'write',input:{resource:'allowed'}}),{statusCode:403});
 assert.equal((await d.read(issuer,'task-bound')).calls.length,0);
 assert.equal((await pool.query('SELECT * FROM effects')).rowCount,0);
}));
test('Either team participant can recover the other external tool caller original effect through MCP receipts',async()=>fixture(async({d,issuer,delegate,terms,pool,options,lose})=>{
 await d.issue(delegate,{...terms,id:'reverse',delegate:{applicationId:'app',subjectId:'issuer'},payer:{applicationId:'app',subjectId:'delegate'}});
 lose();
 const restored=new DelegatedCapabilities({...options,store:new PostgresDelegationStore({pool,namespace:'fixture'})});
 const capabilities=createDelegatedToolCapabilities({grants:restored}),dispatcher=new CapabilityDispatcher({capabilities});
 for(const [grantId,caller,covering] of [['grant',delegate,issuer],['reverse',issuer,delegate]]){
  const server=createCapabilityMcpServer({dispatcher,resolveAccess:async()=>({actor:caller,capabilities:capabilities.map(c=>c.name)})});
  const client=new Client({name:'external-platform-fixture',version:'1'});
  const [ct,st]=InMemoryTransport.createLinkedPair();await server.connect(st);await client.connect(ct);
  try{
   const input={grantId,callId:'original',capability:'write',input:{resource:'allowed'}};
   const failed=await client.callTool({name:'collaboration.tools.invoke',arguments:{input,requestKey:'external-attempt'}});
   assert.equal(failed.isError,true);
   const receipt=await dispatcher.invoke('collaboration.tools.read',{grantId},{actor:covering});
   assert.equal(receipt.calls.length,1);assert.equal(receipt.calls[0].outcome,'unknown');
   const operation=receipt.calls[0];assert.equal(operation.call_id,input.callId);
   // Independent domain query uses the original key, not a replay of the write.
   const effect=(await pool.query('SELECT * FROM effects WHERE id=$1',[operation.effect_key])).rows[0];
   assert.equal(effect.actor,caller.subjectId);
   const refreshed=await capabilities[0].revalidate(input,{result:'untrusted cached result'},{actor:covering});
   assert.equal(refreshed.receipt.effect_key,operation.effect_key);assert.equal(refreshed.unknown,true);assert.equal(refreshed.result,undefined);
   await assert.rejects(dispatcher.invoke('collaboration.tools.invoke',input,{actor:caller,callId:'repeat'}),{statusCode:409});
   await dispatcher.invoke('collaboration.tools.revoke',{grantId},{actor:covering,callId:'revoke-'+grantId});
   assert.equal((await dispatcher.invoke('collaboration.tools.read',{grantId},{actor:covering})).calls[0].effect_key,operation.effect_key);
   await assert.rejects(dispatcher.invoke('collaboration.tools.invoke',{...input,callId:'another'},{actor:caller,callId:'another-wrapper'}),{statusCode:403});
  }finally{await client.close();await server.close();}
 }
 assert.equal((await pool.query('SELECT * FROM effects')).rowCount,2);
 await assert.rejects(dispatcher.invoke('collaboration.tools.read',{grantId:'grant'},{actor:{subjectId:'outsider'}}),{statusCode:403});
}));
