import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresAccountStore} from '../accounts/store.js';
import {AccountDirectory} from '../accounts/service.js';
import {PostgresPersonalKeyStore} from '../credentials/personal-key-store.js';
import {PersonalApiKeys} from '../credentials/personal-keys.js';
async function fixture(run) {
 const schema='keys_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL});
 await admin.query(`CREATE SCHEMA ${schema}`); const pool=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try {
  const accounts=new PostgresAccountStore({pool,namespace:'app'});await accounts.initialize();
  for(const id of ['alice','bob'])await accounts.put('account',id,{expectedRevision:0});
  for(const id of ['a','b']) {await accounts.put('organization',id,{expectedRevision:0});await accounts.putMembership(id,'alice',{expectedRevision:0,roles:['writer']});}
  const directory=new AccountDirectory({store:accounts,namespace:'app',resolveIdentity:c=>c,authorize:()=>true});
  const store=new PostgresPersonalKeyStore({pool,namespace:'app'}); await store.initialize();
  let now=new Date('2026-09-25T00:00:00Z');
  const options={store,directory,authorizeManagement:()=>true,resolveCapabilities:({current})=>current.membership?.roles.includes('writer')?['notes.read','notes.write']:['notes.read'],clock:()=>now};
  const keys=new PersonalApiKeys(options),actor=await directory.actor({accountId:'alice',organizationId:'a'});
  const input={label:'External assistant',capabilities:['notes.read','notes.write'],expiresAt:'2026-09-26T00:00:00Z',requestKey:'first'};
  await run({pool,accounts,directory,store,options,keys,actor,input,setNow:v=>{now=new Date(v);}});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Personal keys bind owner and organization, narrow current permissions and survive reconstruction',()=>fixture(async({keys,actor,input,pool,options,accounts})=>{
 const issued=await keys.issue(actor,input);const access=await new PersonalApiKeys(options).authenticate(issued.token);
 assert.equal(access.actor.organizationId,'a');assert.equal(access.actor.subjectId,'alice');assert.deepEqual(access.capabilities,input.capabilities);
 assert.equal(await keys.check(access.actor,'notes.write'),true);
 const stored=(await pool.query('SELECT * FROM iaic_personal_keys')).rows[0];assert.notEqual(stored.digest,issued.token);assert.equal(JSON.stringify(await keys.list(actor)).includes(stored.digest),false);
 await assert.rejects(keys.authenticate(issued.token.slice(0,-1)+(issued.token.endsWith('x')?'y':'x')),{statusCode:401});
 await assert.rejects(keys.issue(access.actor,{...input,requestKey:'agent-mint'}),{statusCode:403});
 await assert.rejects(keys.issue(actor,input),{statusCode:409});
 await assert.rejects(keys.check({...access.actor,organizationId:'b'},'notes.read'),{statusCode:401});
 await accounts.putMembership('a','alice',{expectedRevision:1,roles:[]});
 assert.deepEqual((await keys.authenticate(issued.token)).capabilities,['notes.read']);
 await assert.rejects(keys.check(access.actor,'notes.write'),{statusCode:403});
 await accounts.putMembership('a','alice',{expectedRevision:2,state:'removed'});
 await assert.rejects(keys.authenticate(issued.token),{statusCode:403});
}));
test('Personal key rotation is atomic, secrets are one-time and revocation is durable',()=>fixture(async({keys,actor,input,directory,pool})=>{
 const first=await keys.issue(actor,input),bob=await directory.actor({accountId:'bob'});
 await assert.rejects(keys.revoke(bob,first.credential.id),{statusCode:404});
 await assert.rejects(keys.rotate(actor,first.credential.id,input),{statusCode:409});
 await keys.authenticate(first.token); // Failed insertion rolls back the old-key revocation.
 const results=await Promise.allSettled(['r1','r2'].map(requestKey=>keys.rotate(actor,first.credential.id,{...input,requestKey})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const next=results.find(r=>r.status==='fulfilled').value;
 await assert.rejects(keys.authenticate(first.token),{statusCode:401});
 const access=await keys.authenticate(next.token);await keys.revoke(actor,next.credential.id);await keys.revoke(actor,next.credential.id);
 await assert.rejects(keys.check(access.actor,'notes.read'),{statusCode:401});
 assert.equal(Number((await pool.query('SELECT count(*) FROM iaic_personal_keys')).rows[0].count),2);
}));
test('Expiry, suspension, policy escalation and asynchronous revoke fail closed',()=>fixture(async({keys,actor,input,options,accounts,setNow})=>{
 await assert.rejects(keys.issue(actor,{...input,capabilities:['admin.write']}),{statusCode:403});
 await assert.rejects(keys.issue(actor,{...input,capabilities:Array(1)}),{statusCode:400});
 const first=await keys.issue(actor,input);setNow(input.expiresAt);await assert.rejects(keys.authenticate(first.token),{statusCode:401});
 setNow('2026-09-25T00:00:00Z');
 const delayed=new PersonalApiKeys({...options,resolveCapabilities:async()=>{await keys.revoke(actor,first.credential.id);return input.capabilities;}});
 await assert.rejects(delayed.authenticate(first.token),{statusCode:401});
 const next=await keys.issue(actor,{...input,requestKey:'next'});
 await accounts.put('account','alice',{expectedRevision:1,state:'suspended'});
 await assert.rejects(keys.authenticate(next.token),{statusCode:403});
}));

test('HTTP discovery and invocation use the personal key identity and current limits',()=>fixture(async({keys,actor,input})=>{
 const {createCapabilityHttpHandler}=await import('../http/server.js');
 const {CapabilityDispatcher}=await import('../capabilities/index.js');
 const {defineCapability}=await import('../capabilities/index.js');
 const cap=defineCapability({name:'notes.read',effect:'read',description:'Read fixture',input:{type:'object',additionalProperties:false},output:{type:'object'},authorize:a=>keys.check(a,'notes.read'),implementation:{kind:'function',execute:async(_,ctx)=>({owner:ctx.actor.subjectId,organization:ctx.actor.organizationId})}});
 const handler=createCapabilityHttpHandler({dispatcher:new CapabilityDispatcher({capabilities:[cap]}),resolveAccess:request=>keys.authenticate((request.headers.get('authorization')??'').replace(/^Bearer /,''))});
 const issued=await keys.issue(actor,{...input,capabilities:['notes.read']});
 const call=()=>handler(new Request('https://fixture.test/capabilities/notes.read',{method:'POST',headers:{authorization:`Bearer ${issued.token}`,'content-type':'application/json'},body:JSON.stringify({input:{}})}));
 const response=await call();assert.equal(response.status,200);assert.deepEqual((await response.json()).result,{owner:'alice',organization:'a'});
 await keys.revoke(actor,issued.credential.id);assert.equal((await call()).status,401);
}));
