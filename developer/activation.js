import fs from 'node:fs/promises';
import {fail,key} from '../releases/store.js';
// Trusted host persistence port; no credentials, domain data or model output.
export class PostgresDeploymentActivations {
 constructor({pool,namespace}){this.pool=pool;this.namespace=key(namespace);}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./activation.sql',import.meta.url),'utf8'));}
 async read(requestName){return (await this.pool.query('SELECT configuration,container_id AS "containerId",admitted_at AS "admittedAt" FROM iaic_deployment_activations WHERE namespace=$1 AND request_name=$2',[this.namespace,key(requestName)])).rows[0]??null;}
 async claim({requestName,configuration,containerId}){
  key(requestName);key(configuration);key(containerId);
  const row=(await this.pool.query('INSERT INTO iaic_deployment_activations(namespace,request_name,configuration,container_id) VALUES($1,$2,$3,$4) ON CONFLICT(namespace,request_name) DO NOTHING RETURNING container_id',[this.namespace,requestName,configuration,containerId])).rows[0];
  if(row)return true;
  const original=await this.read(requestName);
  if(!original||original.configuration!==configuration||original.containerId!==containerId)throw fail('Activation request is bound to another container or configuration',409);
  return false;
 }
}

// Composes the local Docker adapter; never dispatches a second start for a receipt.
export class RecoverableDockerDeployment {
 constructor({deployment,activations}){
  if(!deployment||!activations||typeof deployment.prepare!=='function'||typeof activations.claim!=='function'||typeof activations.read!=='function')throw fail('Docker preparation and durable activation ports required');
  Object.assign(this,{deployment,activations});
 }
 async inspect(requestKey){
  const receipt=await this.deployment.inspect(requestKey),activation=await this.activations.read(this.deployment.name(requestKey));
  if(activation&&(activation.configuration!==this.deployment.digest||(receipt.containerId&&activation.containerId!==receipt.containerId)))throw fail('Deployment activation binding changed',409);
  return {...receipt,activation,requiresReconciliation:Boolean(activation&&['prepared','absent','unknown'].includes(receipt.status))};
 }
 async deploy(requestKey,options={}){
  // A consumed activation prevents recreating a missing original container.
  const original=await this.inspect(requestKey);
  if(original.activation&&original.status==='absent')return original;
  await this.deployment.prepare(requestKey,options);
  return this.activate(requestKey,options);
 }
 async activate(requestKey,{signal}={}){
  const receipt=await this.inspect(requestKey);
  if(receipt.status!=='prepared')return receipt;
  signal?.throwIfAborted();
  const admitted=await this.activations.claim({requestName:this.deployment.name(requestKey),configuration:this.deployment.digest,containerId:receipt.containerId});
  if(!admitted)return this.inspect(requestKey);
  // Recheck the immutable Docker binding after admission. A crash after admission
  // remains uncertain, even if a later inspection still says prepared.
  const current=await this.deployment.raw(requestKey);
  if(!current||current.Id!==receipt.containerId)throw this.deployment.unknown(requestKey);
  if(current.State?.Status!=='created')return this.inspect(requestKey);
  let started;try{started=await this.deployment.run(['start',current.Id],{signal});}catch{throw this.deployment.unknown(requestKey);}
  if(!started.ok)throw this.deployment.unknown(requestKey);
  return this.inspect(requestKey);
 }
 async stop(requestKey){await this.deployment.stop(requestKey);return this.inspect(requestKey);}
}
