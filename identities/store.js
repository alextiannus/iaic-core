import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const identity=scope=>{
 const values=[scope?.applicationId,scope?.definitionId,scope?.subjectId];
 if(values.some(v=>typeof v!=='string'||!v.trim()||v.length>500))throw fail('Trusted Agent scope required',401);
 return values;
};
const visible=row=>row?{id:row.id,state:row.state,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at}:null;
export class AgentIdentityStore {
 constructor({pool}){this.pool=pool;}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 // Trusted Host inventory: authorization/filtering belongs to the caller, never an Agent tool.
 async page({definitionId,after=null,limit=50}){
  if(typeof definitionId!=='string'||!definitionId||definitionId.length>500||!Number.isInteger(limit)||limit<1||limit>100||after!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(after))throw fail('Invalid identity inventory page');
  const rows=(await this.pool.query('SELECT id,application_id AS "applicationId",definition_id AS "definitionId",subject_id AS "subjectId",state,revision FROM iaic_agent_identities WHERE definition_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',[definitionId,after,limit+1])).rows;
  return {items:rows.slice(0,limit),next:rows.length>limit?rows[limit-1].id:null};
 }
 async find({id,definitionId}){
  if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||typeof definitionId!=='string'||!definitionId||definitionId.length>500)throw fail('Invalid identity lookup');
  return (await this.pool.query('SELECT id,application_id AS "applicationId",definition_id AS "definitionId",subject_id AS "subjectId",state,revision FROM iaic_agent_identities WHERE id=$1 AND definition_id=$2',[id,definitionId])).rows[0]??null;
 }
 async get(scope){return visible((await this.pool.query('SELECT * FROM iaic_agent_identities WHERE application_id=$1 AND definition_id=$2 AND subject_id=$3',identity(scope))).rows[0]);}
 async ensure(scope){
  const values=identity(scope);
  await this.pool.query(`WITH created AS (INSERT INTO iaic_agent_identities(id,application_id,definition_id,subject_id) VALUES($1,$2,$3,$4) ON CONFLICT(application_id,definition_id,subject_id) DO NOTHING RETURNING id,revision,state)
   INSERT INTO iaic_agent_identity_events(agent_id,revision,state) SELECT id,revision,state FROM created`,[randomUUID(),...values]);
  return this.get(scope);
 }
 async history(scope,{after=0,limit=50}={}){
  if(!Number.isInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>50)throw fail('Invalid Agent lifecycle history page');
  const instance=await this.get(scope);if(!instance)return [];
  return (await this.pool.query('SELECT revision,state,created_at FROM iaic_agent_identity_events WHERE agent_id=$1 AND revision>$2 ORDER BY revision LIMIT $3',[instance.id,after,limit])).rows;
 }
 async setState(scope,{state,expectedRevision}){
  if(!['active','paused'].includes(state)||!Number.isInteger(expectedRevision)||expectedRevision<1||expectedRevision>=2147483647)throw fail('Agent state and expected revision required');
  const row=(await this.pool.query(`WITH changed AS (UPDATE iaic_agent_identities SET state=$4,revision=revision+1,updated_at=now()
   WHERE application_id=$1 AND definition_id=$2 AND subject_id=$3 AND revision=$5 RETURNING *),
   recorded AS (INSERT INTO iaic_agent_identity_events(agent_id,revision,state) SELECT id,revision,state FROM changed)
   SELECT * FROM changed`,[...identity(scope),state,expectedRevision])).rows[0];
  if(!row)throw fail('Agent identity is missing or its revision changed',409);
  return visible(row);
 }
}
