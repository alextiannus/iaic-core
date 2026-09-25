import fs from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const text=v=>typeof v==='string'&&v.trim()&&v.length<=500;
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const sequence=v=>Number.isInteger(v)&&v>=0&&v<2147483647;
function identity(scope){const values=[scope?.applicationId,scope?.assistantId,scope?.subjectId];if(!values.every(text))throw fail('Trusted session scope required',401);return values;}
const header=row=>({id:row.id,title:row.title,sequence:row.sequence,state:row.state,createdAt:row.created_at});
export class SessionStore{
 constructor({pool}){this.pool=pool;}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async transaction(run){const c=await this.pool.connect();try{await c.query('BEGIN');const result=await run(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async owned(c,scope,id,{lock=false}={}){
  if(!uuid(id))throw fail('Invalid session ID');const row=(await c.query('SELECT * FROM iaic_sessions WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND id=$4'+(lock?' FOR UPDATE':''),[...identity(scope),id])).rows[0];if(!row)throw fail('Session not found',404);return row;
 }
 async create(scope,{requestKey,title=''}){
  if(!text(requestKey)||typeof title!=='string'||title.length>200)throw fail('Session title and request key required');const account=identity(scope);
  return this.transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['session',...account,requestKey])]);
   const prior=(await c.query('SELECT * FROM iaic_sessions WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND request_key=$4',[...account,requestKey])).rows[0];
   if(prior){if(prior.title!==title)throw fail('Session key belongs to different input',409);return header(prior);}
   return header((await c.query('INSERT INTO iaic_sessions(id,application_id,assistant_id,subject_id,request_key,title) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[randomUUID(),...account,requestKey,title])).rows[0]);
  });
 }
 async list(scope,{after='',limit=20}={}){
  if((after!==''&&!uuid(after))||!Number.isInteger(limit)||limit<1||limit>50)throw fail('Invalid session page');
  const rows=(await this.pool.query('SELECT * FROM iaic_sessions WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT $5',[...identity(scope),after||null,limit+1])).rows;
  const items=rows.slice(0,limit).map(header);return {items,nextCursor:rows.length>limit?items.at(-1).id:null};
 }
 async append(scope,{sessionId,requestKey,expectedSequence,kind,data}){
  if(!text(requestKey)||!['user_message','task_ref','session_state','resource_ref'].includes(kind)||!data||typeof data!=='object'||Array.isArray(data))throw fail('Invalid session event');
  if(kind==='user_message'&&(!sequence(expectedSequence)||typeof data.text!=='string'||!data.text.trim()||data.text.length>8000||Object.keys(data).length!==1))throw fail('Message and expected sequence required');
  if(kind==='task_ref'&&(expectedSequence!==null||!uuid(data.taskId)||Object.keys(data).length!==1))throw fail('Invalid task reference');
  if(kind==='session_state'&&(!sequence(expectedSequence)||!['open','closed'].includes(data.state)||Object.keys(data).length!==1))throw fail('State and expected sequence required');
  if(kind==='resource_ref'&&(expectedSequence!==null||!text(data.type)||!text(data.id)||Object.keys(data).length!==2))throw fail('Invalid resource reference');
  return this.transaction(async c=>{
   const row=await this.owned(c,scope,sessionId,{lock:true});
   const prior=(await c.query('SELECT * FROM iaic_session_events WHERE session_id=$1 AND request_key=$2',[sessionId,requestKey])).rows[0];
   if(prior){if(prior.kind!==kind||prior.expected_sequence!==expectedSequence||!isDeepStrictEqual(prior.data,data))throw fail('Session event key belongs to different input',409);return prior;}
   if(kind==='user_message'&&row.state==='closed')throw fail('Session is closed to new messages',409);
   if(kind==='session_state'&&row.state===data.state)throw fail('Session already has this state',409);
   if(expectedSequence!==null&&row.sequence!==expectedSequence)throw fail('Session changed; read its current sequence',409);
   if(row.sequence>=2147483646)throw fail('Session sequence limit reached',409);
   const next=row.sequence+1;await c.query('UPDATE iaic_sessions SET sequence=$2,state=$3 WHERE id=$1',[sessionId,next,kind==='session_state'?data.state:row.state]);
   return (await c.query('INSERT INTO iaic_session_events(session_id,sequence,request_key,expected_sequence,kind,data) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[sessionId,next,requestKey,expectedSequence,kind,data])).rows[0];
  });
 }
 async findEvent(scope,sessionId,requestKey){
  await this.owned(this.pool,scope,sessionId);if(!text(requestKey))throw fail('Event request key required');
  return (await this.pool.query('SELECT * FROM iaic_session_events WHERE session_id=$1 AND request_key=$2',[sessionId,requestKey])).rows[0]??null;
 }
 async read(scope,id,{after=0,throughSequence=null,limit=50}={}){
  if(!sequence(after)||(throughSequence!==null&&!sequence(throughSequence))||!Number.isInteger(limit)||limit<1||limit>50)throw fail('Invalid session range');
  const row=await this.owned(this.pool,scope,id);const through=throughSequence??row.sequence;
  if(through>row.sequence||after>through)throw fail('Session snapshot does not exist',409);
  const rows=(await this.pool.query('SELECT sequence,kind,data,created_at FROM iaic_session_events WHERE session_id=$1 AND sequence>$2 AND sequence<=$3 ORDER BY sequence LIMIT $4',[id,after,through,limit+1])).rows;
  const events=rows.slice(0,limit);return {session:header(row),throughSequence:through,events,nextCursor:rows.length>limit?events.at(-1).sequence:null};
 }
}
