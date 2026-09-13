import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {evidenceDigest,jsonValue} from '../evaluation/runner.js';
import {fail,key} from '../releases/store.js';
const ref=v=>{if(!v||Object.keys(v).some(k=>!['applicationId','subjectId'].includes(k)))throw fail('Explicit principal reference required');return {applicationId:key(v.applicationId),subjectId:key(v.subjectId)};};
const same=(a,b)=>evidenceDigest(a)===evidenceDigest(b);
export class PostgresDelegationStore {
 constructor({pool,namespace}){this.pool=pool;this.namespace=key(namespace);}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async create(id,terms){id=key(id);terms=jsonValue(terms);const digest=evidenceDigest(terms);
  await this.pool.query('INSERT INTO iaic_delegation_grants(namespace,id,digest,terms) VALUES($1,$2,$3,$4) ON CONFLICT(namespace,id) DO NOTHING',[this.namespace,id,digest,terms]);
  const row=await this.get(id);if(row.digest!==digest)throw fail('Delegation ID is bound to other terms',409);return row;
 }
 async get(id){const row=(await this.pool.query('SELECT id,digest,terms,revoked FROM iaic_delegation_grants WHERE namespace=$1 AND id=$2',[this.namespace,key(id)])).rows[0];if(!row)throw fail('Delegation unavailable',404);if(evidenceDigest(row.terms)!==row.digest)throw fail('Delegation integrity mismatch',409);return row;}
 async taskPage({after=null,limit=20}={}){if(after!==null)key(after);if(!Number.isInteger(limit)||limit<1||limit>100)throw fail('Task grant page must be 1..100');return (await this.pool.query("SELECT id FROM iaic_delegation_grants WHERE namespace=$1 AND terms ? 'task' AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT $3",[this.namespace,after,limit])).rows.map(r=>r.id);}
 async revoke(id){await this.pool.query('UPDATE iaic_delegation_grants SET revoked=true WHERE namespace=$1 AND id=$2',[this.namespace,key(id)]);return this.get(id);}
 async admit(id,{callId,capability,inputDigest,effectKey:boundEffectKey=null}){
  const c=await this.pool.connect();try{await c.query('BEGIN');const row=(await c.query('SELECT * FROM iaic_delegation_grants WHERE namespace=$1 AND id=$2 FOR UPDATE',[this.namespace,key(id)])).rows[0];
   if(!row||row.revoked||Date.parse(row.terms.deadlineAt)<=Date.now())throw fail('Delegation revoked or expired',403);
   if(evidenceDigest(row.terms)!==row.digest||!row.terms.tools.includes(capability))throw fail('Delegation terms unavailable',403);
   const prior=(await c.query('SELECT * FROM iaic_delegation_calls WHERE namespace=$1 AND grant_id=$2 AND call_id=$3',[this.namespace,id,key(callId)])).rows[0];
   if(prior)throw fail('Delegated attempt already admitted; inspect its original effect rather than replay',409);
   const used=(await c.query('SELECT count(*)::int AS n FROM iaic_delegation_calls WHERE namespace=$1 AND grant_id=$2',[this.namespace,id])).rows[0].n;
   if(used>=row.terms.maxCalls)throw fail('Delegation call budget exhausted',409);
   const effectKey=boundEffectKey===null?'delegated:'+randomUUID():key(boundEffectKey);
   await c.query('INSERT INTO iaic_delegation_calls(namespace,grant_id,call_id,capability,input_digest,effect_key) VALUES($1,$2,$3,$4,$5,$6)',[this.namespace,id,callId,capability,inputDigest,effectKey]);await c.query('COMMIT');return {effectKey};
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 }
 async settled(id,callId,outcome){if(!['returned','unknown'].includes(outcome))throw fail('Invalid delegated attempt outcome');await this.pool.query("UPDATE iaic_delegation_calls SET outcome=$4 WHERE namespace=$1 AND grant_id=$2 AND call_id=$3 AND outcome='admitted'",[this.namespace,key(id),key(callId),outcome]);}
 async calls(id){return (await this.pool.query('SELECT call_id,effect_key,capability,input_digest,outcome,created_at FROM iaic_delegation_calls WHERE namespace=$1 AND grant_id=$2 ORDER BY created_at,call_id',[this.namespace,key(id)])).rows;}
}

// Authorization/attribution composition only: the existing dispatcher executes.
export class DelegatedCapabilities {
 constructor({store,dispatcher,resolvePrincipal,restoreActor,authorizeGrant,allowInput}){
  for(const port of [resolvePrincipal,restoreActor,authorizeGrant,allowInput])if(typeof port!=='function')throw fail('Delegation identity, grant and input policy ports required');
  Object.assign(this,{store,dispatcher,resolvePrincipal,restoreActor,authorizeGrant,allowInput});
 }
 async principal(actor){return ref(await this.resolvePrincipal(actor));}
 async issue(actor,{id,delegate,payer,tools,constraints,deadlineAt,maxCalls,task=null,artifacts=[]}){
  const issuer=await this.principal(actor);delegate=ref(delegate);payer=ref(payer);
  if(!Array.isArray(tools)||!tools.length||tools.length>100||new Set(tools).size!==tools.length||tools.some(t=>typeof t!=='string'||!t)||!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>10000||typeof deadlineAt!=='string'||!Number.isFinite(Date.parse(deadlineAt))||Date.parse(deadlineAt)<=Date.now()||!constraints||typeof constraints!=='object'||Array.isArray(constraints))throw fail('Bounded delegation terms required');
  if(!Array.isArray(artifacts)||artifacts.length>100)throw fail('Bounded input Artifact references required');
  const terms=jsonValue({issuer,delegate,payer,tools:[...tools].sort(),constraints,deadlineAt:new Date(deadlineAt).toISOString(),maxCalls,...(task?{task}: {}),...(artifacts.length?{artifacts}: {})});
  if(await this.authorizeGrant(actor,{action:'issue',terms})!==true)throw fail('Delegation issue denied',403);
  return this.store.create(id,terms);
 }
 async access(actor,id,action){const row=await this.store.get(id),who=await this.principal(actor);if(!same(who,row.terms.issuer)&&!same(who,row.terms.delegate))throw fail('Delegation access denied',403);if(await this.authorizeGrant(actor,{action,terms:row.terms})!==true)throw fail('Delegation access denied',403);return row;}
 async read(actor,id){const row=await this.access(actor,id,'read');return {...row,calls:await this.store.calls(id)};}
 async revoke(actor,id){const row=await this.access(actor,id,'revoke');if(!same(await this.principal(actor),row.terms.issuer))throw fail('Only issuer may revoke this grant',403);return this.store.revoke(id);}
 async invoke(actor,{grantId,callId,capability,input},{signal}={}){
  input=jsonValue(input);
  const row=await this.access(actor,grantId,'execute'),terms=row.terms;
  if(!same(await this.principal(actor),terms.delegate)||row.revoked||Date.parse(terms.deadlineAt)<=Date.now()||!terms.tools.includes(capability))throw fail('Delegation does not allow this execution',403);
  const issuerActor=await this.restoreActor(terms.issuer);
  if(!same(await this.principal(issuerActor),terms.issuer)||await this.authorizeGrant(issuerActor,{action:'continue',terms})!==true)throw fail('Issuer authority no longer available',403);
  const definition=this.dispatcher.capabilities.get(capability);
  if(!definition||definition.implementation.kind!=='function'||this.dispatcher.validateActor(issuerActor,definition)!==true||this.dispatcher.validateActor(actor,definition)!==true||!definition.validateInput(input)||await definition.authorize(issuerActor,input)!==true||await definition.authorize(actor,input)!==true||await this.allowInput({issuerActor,delegateActor:actor,terms,capability,input})!==true)throw fail('Delegation exceeds current principal or domain authority',403);
  signal?.throwIfAborted();
  const {effectKey}=await this.store.admit(grantId,{callId,capability,inputDigest:evidenceDigest(input)});
  // The payer is evidence, not an instruction to change the billing account.
  const context={actor,signal,callId:effectKey};
  try{const result=await this.dispatcher.invoke(capability,input,context);await this.store.settled(grantId,callId,'returned');return {grantId,callId,payer:terms.payer,result};}
  catch(error){await this.store.settled(grantId,callId,'unknown').catch(()=>{});throw error;}
 }
}
