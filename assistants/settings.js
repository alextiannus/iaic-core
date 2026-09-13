export class AssistantSettings{
 constructor({pool}){this.pool=pool;}
 async initialize(){await this.pool.query(`CREATE TABLE IF NOT EXISTS iaic_assistant_settings(application_id text NOT NULL,assistant_id text NOT NULL,subject_id text NOT NULL,model_profile text NOT NULL,revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(application_id,assistant_id,subject_id))`);}
 scope(value){const result=[value?.applicationId,value?.assistantId,value?.subjectId];if(result.some(x=>typeof x!=='string'||!x.trim()||x.length>500))throw new Error('Trusted Assistant scope required');return result;}
 async get(scope){return (await this.pool.query('SELECT model_profile,revision,updated_at FROM iaic_assistant_settings WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3',this.scope(scope))).rows[0]||null;}
 async select(scope,profileId,expectedRevision=0){
  if(typeof profileId!=='string'||!profileId||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Object.assign(new Error('Invalid model selection'),{statusCode:400});
  const args=[...this.scope(scope),profileId];
  const result=expectedRevision===0?await this.pool.query(`INSERT INTO iaic_assistant_settings(application_id,assistant_id,subject_id,model_profile) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING model_profile,revision`,args):await this.pool.query(`UPDATE iaic_assistant_settings SET model_profile=$4,revision=revision+1,updated_at=now() WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND revision=$5 RETURNING model_profile,revision`,[...args,expectedRevision]);
  if(!result.rowCount)throw Object.assign(new Error('Assistant settings changed; reload before saving'),{statusCode:409});return result.rows[0];
 }
}
