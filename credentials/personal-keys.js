import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const names=v=>Array.isArray(v)&&v.length>0&&v.length<=256&&Array.from(v).every(n=>typeof n==='string'&&/^[a-z][a-z0-9_.-]{0,199}$/.test(n))&&new Set(v).size===v.length;
const digest=token=>createHash('sha256').update(token).digest('hex');
const publicRecord=r=>({id:r.id,accountId:r.accountId,organizationId:r.organizationId,label:r.label,capabilities:[...r.capabilities],createdAt:r.createdAt,expiresAt:r.expiresAt,revokedAt:r.revokedAt});
export class PersonalApiKeys {
 constructor({store,directory,authorizeManagement,resolveCapabilities,clock=()=>new Date()}) {
  if(!store||['insert','get','list','revoke'].some(k=>typeof store[k]!=='function')||!directory?.namespace||typeof directory.current!=='function'||typeof authorizeManagement!=='function'||typeof resolveCapabilities!=='function'||store.namespace!==directory.namespace)throw fail('Personal keys require matching directory/store and explicit Host policies');
  Object.assign(this,{store,directory,authorizeManagement,resolveCapabilities,clock});
 }
 now() { const date=new Date(this.clock()); if(!Number.isFinite(+date))throw fail('Invalid Host clock'); return date; }
 async manage(actor,action) {
  // Agent credentials may not mint/extend/revoke credentials, even if a Host policy is permissive.
  if(actor?.personalCredentialId)throw fail('Use an independently authenticated owner session',403);
  const current=await this.directory.current(actor);
  if(await this.authorizeManagement({actor,current,action})!==true)throw fail('Credential management denied',403);
  return current;
 }
 async issue(actor,input) { return this.create(actor,input,null); }
 async rotate(actor,id,input) { if(!uuid(id))throw fail('Invalid credential id'); return this.create(actor,input,id); }
 async create(actor,{label,capabilities,expiresAt,requestKey}={},replaceId) {
  if(typeof label!=='string'||!label.trim()||label.length>200||!names(capabilities)||typeof requestKey!=='string'||!requestKey.trim()||requestKey.length>200||typeof expiresAt!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(expiresAt)||!Number.isFinite(Date.parse(expiresAt)))throw fail('Label, explicit capabilities, expiry and stable request key required');
  capabilities=[...capabilities].sort(); expiresAt=new Date(expiresAt).toISOString();
  let current=await this.manage(actor,replaceId?'rotate':'issue');
  const allowed=await this.resolveCapabilities({actor,current});
  if(!Array.isArray(allowed)||capabilities.some(c=>!allowed.includes(c)))throw fail('Requested capabilities exceed current access',403);
  if(replaceId) {
   const old=await this.store.get(replaceId);
   if(!old||old.accountId!==actor.subjectId||old.organizationId!==(actor.organizationId??null))throw fail('Credential not found',404);
  }
  await this.manage(actor,replaceId?'rotate':'issue');
  const now=this.now(); if(Date.parse(expiresAt)<=+now)throw fail('Future expiry required');
  const id=randomUUID(),token=`iaic_pk_${id}.${randomBytes(32).toString('base64url')}`;
  const record={id,accountId:actor.subjectId,organizationId:actor.organizationId??null,label,capabilities,expiresAt,createdAt:now.toISOString(),revokedAt:null,requestKey,digest:digest(token)};
  await this.store.insert(record,replaceId);
  return {credential:publicRecord(record),token};
 }
 async list(actor,{after='',limit=50}={}) {
  if(typeof after!=='string'||(after&&!uuid(after))||!Number.isInteger(limit)||limit<1||limit>100)throw fail('Invalid page');
  await this.manage(actor,'list'); return (await this.store.list(actor.subjectId,{after,limit})).map(publicRecord);
 }
 async revoke(actor,id) {
  if(!uuid(id))throw fail('Invalid credential id'); await this.manage(actor,'revoke');
  const record=await this.store.revoke(actor.subjectId,id,this.now().toISOString());
  if(!record)throw fail('Credential not found',404); return publicRecord(record);
 }
 async access(record) {
  if(!record||record.revokedAt||Date.parse(record.expiresAt)<=+this.now())throw fail('Invalid or expired credential',401);
  const actor=Object.freeze({subjectId:record.accountId,organizationId:record.organizationId,
   scopeId:JSON.stringify([this.directory.namespace,record.organizationId,record.accountId]),personalCredentialId:record.id});
  const current=await this.directory.current(actor);
  const allowed=await this.resolveCapabilities({actor,current});
  if(!Array.isArray(allowed))throw fail('Current capability policy unavailable',403);
  // Policy callbacks may await external data. Recheck revocation/account state before returning.
  const fresh=await this.store.get(record.id);
  if(!fresh||fresh.revokedAt||Date.parse(fresh.expiresAt)<=+this.now())throw fail('Invalid or expired credential',401);
  await this.directory.current(actor);
  return {actor,capabilities:record.capabilities.filter(c=>allowed.includes(c))};
 }
 async authenticate(token) {
  if(typeof token!=='string'||!/^iaic_pk_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(token))throw fail('Invalid or expired credential',401);
  const id=token.slice(8,44); if(!uuid(id))throw fail('Invalid or expired credential',401);
  const record=await this.store.get(id);
  if(!record||!timingSafeEqual(Buffer.from(digest(token),'hex'),Buffer.from(record.digest,'hex')))throw fail('Invalid or expired credential',401);
  return this.access(record);
 }
 async check(actor,capability) {
  if(!uuid(actor?.personalCredentialId))throw fail('Personal credential actor required',401);
  const record=await this.store.get(actor.personalCredentialId);
  if(!record||record.accountId!==actor.subjectId||record.organizationId!==(actor.organizationId??null)||actor.scopeId!==JSON.stringify([this.directory.namespace,record.organizationId,record.accountId]))throw fail('Invalid credential actor',401);
  const access=await this.access(record); if(!access.capabilities.includes(capability))throw fail('Credential capability denied',403);
  return true;
 }
}
