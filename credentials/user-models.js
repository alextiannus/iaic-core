import {invocationConfig} from '../agent/invocation.js';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID,createHash} from 'node:crypto';
import {createModelProvider} from '../agent/model-provider.js';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
function scopeKey(scope){
 const values=[scope?.applicationId,scope?.subjectId];
 if(values.some(v=>typeof v!=='string'||!v.trim()||v.length>500))throw fail('Trusted model owner required',401);return values;
}
const providerFetch=(url,options)=>fetch(url,{...options,redirect:'error'});
export class UserModels {
 #key;#endpoints;#factory;
 constructor({pool,encryptionKey,endpoints,factory=createModelProvider}){
  this.pool=pool;this.#key=Buffer.from(encryptionKey||'','base64');
  if(this.#key.length!==32)throw new Error('BYOK encryption requires a dedicated 32-byte key');
  if(!Array.isArray(endpoints)||!endpoints.length)throw new Error('Approved BYOK endpoints required');
  this.#endpoints=new Map();this.#factory=factory;
  for(const e of endpoints){
   if(!e.id||this.#endpoints.has(e.id)||!['openai','chat-completions'].includes(e.provider))throw new Error('Invalid BYOK endpoint');
   const url=new URL(e.baseUrl||'https://api.openai.com');
   if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||(e.provider==='openai'&&e.baseUrl))throw new Error('Approved endpoint must be plain HTTPS');
   const endpoint={id:e.id,label:e.label||e.id,provider:e.provider,baseUrl:e.baseUrl||'',...invocationConfig(e.invocation)};
   endpoint.revision=createHash('sha256').update(JSON.stringify(endpoint)).digest('hex');
   this.#endpoints.set(e.id,Object.freeze(endpoint));
  }
 }
 endpoints(){return [...this.#endpoints.values()].map(({revision,...endpoint})=>endpoint);}
 async initialize(){await this.pool.query(`CREATE TABLE IF NOT EXISTS iaic_user_models (
  application_id text NOT NULL,subject_id text NOT NULL,id text NOT NULL,
  label text NOT NULL,model text NOT NULL,endpoint_id text NOT NULL,endpoint_revision text NOT NULL,
  secret jsonb,validation jsonb NOT NULL,revoked boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(application_id,subject_id,id))`);}
 encrypt(key,aad){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.#key,iv);cipher.setAAD(Buffer.from(aad));
  const ciphertext=Buffer.concat([cipher.update(key,'utf8'),cipher.final()]);
  return {iv:iv.toString('base64'),ciphertext:ciphertext.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
 }
 decrypt(secret,aad){
  try{const cipher=createDecipheriv('aes-256-gcm',this.#key,Buffer.from(secret.iv,'base64'));cipher.setAAD(Buffer.from(aad));cipher.setAuthTag(Buffer.from(secret.tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(secret.ciphertext,'base64')),cipher.final()]).toString('utf8');}
  catch{throw fail('Own-model credential is unavailable',503);}
 }
 metadata(row){
  const endpoint=this.#endpoints.get(row.endpoint_id);
  return {id:row.id,label:row.label,model:row.model,provider:endpoint?.provider||'unavailable',credentialMode:'BYOK',
   modelIdentity:row.id+':'+row.endpoint_revision,available:!row.revoked&&endpoint?.revision===row.endpoint_revision};
 }
 async list(scope){return (await this.pool.query('SELECT id,label,model,endpoint_id,endpoint_revision,revoked FROM iaic_user_models WHERE application_id=$1 AND subject_id=$2 AND NOT revoked ORDER BY created_at',scopeKey(scope))).rows.map(row=>this.metadata(row));}
 async save(scope,{label,model,endpointId,apiKey}){
  const owner=scopeKey(scope),endpoint=this.#endpoints.get(endpointId);
  if(!endpoint||typeof model!=='string'||!model.trim()||model.length>200||typeof label!=='string'||!label.trim()||label.length>100||typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>8000)throw fail('Model label, approved endpoint, model and API key required');
  // The user explicitly requests one small validation call when saving. Never
  // send business context, echo provider errors or store the submitted key raw.
  let validation;try{
   const provider=this.#factory({...endpoint,apiKey,model,maxOutputTokens:128,fetchImpl:providerFetch});
   validation=await provider.next({messages:[{role:'user',content:'Connection validation only. Finish with {"ok":true}.'}],tools:[],outputSchema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok']},signal:AbortSignal.timeout(30000)});
  }catch(error){if(Number.isSafeInteger(error.usage?.inputTokens)&&error.usage.inputTokens>=0)validation=error;else throw fail('Model validation failed; check model, endpoint and API key',422);}
  const id='byok-'+randomUUID(),secret=this.encrypt(apiKey,JSON.stringify([...owner,id,endpoint.revision,model]));
  const row=(await this.pool.query('INSERT INTO iaic_user_models(application_id,subject_id,id,label,model,endpoint_id,endpoint_revision,secret,validation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[...owner,id,label,model,endpoint.id,endpoint.revision,secret,{usage:validation.usage??null,usageEvidence:validation.usageEvidence??null}])).rows[0];
  return this.metadata(row);
 }
 async row(scope,id){
  const row=(await this.pool.query('SELECT * FROM iaic_user_models WHERE application_id=$1 AND subject_id=$2 AND id=$3', [...scopeKey(scope),id])).rows[0];
  if(!row||row.revoked||!row.secret||!this.metadata(row).available)throw fail('Own model is unavailable or revoked',409);return row;
 }
 async resolve(scope,id,{expectedIdentity}={}){
  const row=await this.row(scope,id),metadata=this.metadata(row);
  if(expectedIdentity&&expectedIdentity!==metadata.modelIdentity)throw fail('Own model configuration changed',409);
  return Object.freeze({name:metadata.modelIdentity,model:metadata.model,profileId:id,credentialMode:'BYOK',next:async request=>{
   // Re-read immediately before every new call, including calls in one task.
   let provider;try{const current=await this.row(scope,id),endpoint=this.#endpoints.get(current.endpoint_id);
   const key=this.decrypt(current.secret,JSON.stringify([...scopeKey(scope),id,current.endpoint_revision,current.model]));
   provider=this.#factory({...endpoint,apiKey:key,model:current.model,fetchImpl:providerFetch});}catch(error){throw Object.assign(error,{providerNotCalled:true});}
   return provider.next(request);
  }});
 }
 async revoke(scope,id){
  const result=await this.pool.query('UPDATE iaic_user_models SET revoked=true,secret=NULL WHERE application_id=$1 AND subject_id=$2 AND id=$3 RETURNING id',[...scopeKey(scope),id]);
  if(!result.rowCount)throw fail('Own model not found',404);return {id,revoked:true};
 }
}
