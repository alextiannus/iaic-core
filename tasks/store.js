import {checkedHostBinding} from '../context/host.js';
import {executorState,requestExecutorDrain,takeOwnership,assertOwnership} from './ownership.js';
import fs from 'node:fs/promises';
import {pageOptions,pagePosition} from './paging.js';
import {transitionBinding,checkedTransition} from './transition-requests.js';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const conflict = message => Object.assign(new Error(message), {statusCode:409});
const notFound = () => Object.assign(new Error('Task not found'), {statusCode:404});

export class TaskStore {
  constructor({pool,actorCodec={encode:actor=>[actor?.scopeId,actor?.subjectId],decode:([scopeId,subjectId])=>({scopeId,subjectId})}}) {this.pool=pool;this.actorCodec=actorCodec;}
  identity(actor){const pair=this.actorCodec.encode(actor);if(!Array.isArray(pair)||pair.length!==2||pair.some(v=>typeof v!=='string'||!v.trim()||v.length>500))throw conflict('Trusted task actor identity required');return pair;}
  actor(task){return this.actorCodec.decode([task.employee_id,task.erp_user]);}
  async initialize() {
    await this.pool.query(await fs.readFile(new URL('./migrations/005_iaic_tasks.sql',import.meta.url),'utf8'));
    await this.pool.query(await fs.readFile(new URL('./migrations/008_iaic_token_waiting.sql',import.meta.url),'utf8'));
    await this.pool.query(await fs.readFile(new URL('./migrations/010_iaic_agent_identity.sql',import.meta.url),'utf8'));
    await this.pool.query(await fs.readFile(new URL('./migrations/011_iaic_handoff.sql',import.meta.url),'utf8'));
    await this.pool.query(await fs.readFile(new URL('./migrations/012_iaic_delegation.sql',import.meta.url),'utf8'));
    await this.pool.query(await fs.readFile(new URL('./migrations/013_iaic_task_authority.sql',import.meta.url),'utf8'));
    await this.pool.query(await fs.readFile(new URL('./migrations/014_iaic_action_batches.sql',import.meta.url),'utf8'));
    await this.pool.query(await fs.readFile(new URL('./migrations/015_iaic_transition_receipts.sql',import.meta.url),'utf8'));
    await this.pool.query(await fs.readFile(new URL('./migrations/016_iaic_task_pages.sql',import.meta.url),'utf8'));
    await this.pool.query(await fs.readFile(new URL('./migrations/017_iaic_executor_ownership.sql',import.meta.url),'utf8'));
    await this.pool.query(await fs.readFile(new URL('./migrations/018_iaic_host_context.sql',import.meta.url),'utf8'));
  }
  async create({actor,capability,input,idempotencyKey,version,model,agent=null,handoff=null,authority=null,trustedContext=null}) {
    if(!idempotencyKey||!version||!model)throw conflict('Task identity, key, code/Skill version and model are required');
    if(trustedContext!==null){trustedContext=checkedHostBinding(trustedContext);if(trustedContext.owner.scopeId!==actor.scopeId||trustedContext.owner.subjectId!==actor.subjectId)throw conflict('Host context owner mismatch');}
    const name=typeof capability==='string'?capability:capability.name;
    const connection=await this.pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([...this.identity(actor),name,idempotencyKey])]);
      const prior=await connection.query(`SELECT *,input=$5::jsonb AS same_input FROM iaic_tasks
        WHERE employee_id=$1 AND erp_user=$2 AND capability=$3 AND request_key=$4`,[...this.identity(actor),name,idempotencyKey,JSON.stringify(input)]);
      if(prior.rowCount){
        const row=prior.rows[0];if(!row.same_input||!isDeepStrictEqual(row.authority??null,authority)||!isDeepStrictEqual(row.trusted_context??null,trustedContext))throw conflict('Task request key belongs to different input or authority');
        delete row.same_input;await connection.query('COMMIT');return row;
      }
      const row=(await connection.query(`INSERT INTO iaic_tasks(id,employee_id,erp_user,capability,input,request_key,version,model,agent,handoff,authority,trusted_context,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'queued') RETURNING *`,[randomUUID(),...this.identity(actor),name,JSON.stringify(input),idempotencyKey,version,model,agent,handoff,authority,trustedContext])).rows[0];
      await event(connection,row.id,'created',{version,model,...(agent?{agent}:{}),...(handoff?{handoff}:{}),...(authority?{authority}:{}),...(trustedContext?{trustedContext}: {})});await connection.query('COMMIT');return row;
    }catch(error){await connection.query('ROLLBACK').catch(()=>{});throw error;}finally{connection.release();}
  }
  async findRequest(actor,capability,requestKey) {
    if(typeof capability!=='string'||!capability||typeof requestKey!=='string'||!requestKey||requestKey.length>500)throw conflict('Valid task lookup key required');
    return (await this.pool.query('SELECT * FROM iaic_tasks WHERE employee_id=$1 AND erp_user=$2 AND capability=$3 AND request_key=$4',[...this.identity(actor),capability,requestKey])).rows[0]||null;
  }
  async page(actor,{before=null,...input}={}) {
    const {limit,capability,status}=pageOptions(input),position=pagePosition(before);
    const rows=(await this.pool.query(`SELECT id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt" FROM iaic_tasks
      WHERE employee_id=$1 AND erp_user=$2 AND ($3::text IS NULL OR capability=$3) AND ($4::text IS NULL OR status=$4)
      AND ($5::timestamptz IS NULL OR (created_at,id)<($5::timestamptz,$6::uuid)) ORDER BY created_at DESC,id DESC LIMIT $7`,[...this.identity(actor),capability,status,position?.createdAt??null,position?.id??null,limit+1])).rows;
    return {items:rows.slice(0,limit),hasMore:rows.length>limit};
  }
  async list(actor) {
    return (await this.pool.query('SELECT * FROM iaic_tasks WHERE employee_id=$1 AND erp_user=$2 ORDER BY created_at DESC LIMIT 50',[...this.identity(actor)])).rows;
  }
  async get(actor,id) {
    const row=(await this.pool.query('SELECT * FROM iaic_tasks WHERE id=$1 AND employee_id=$2 AND erp_user=$3',[id,...this.identity(actor)])).rows[0];
    if(!row)throw notFound();return row;
  }
  async controlState(actor,id) {
    const row=(await this.pool.query(`SELECT t.id,t.capability,t.input,t.version,t.model,t.agent,t.status,t.waiting_reason,t.handoff,t.authority,t.delegation,t.updated_at,e.seq::text AS "controlSeq",w.seq::text AS "waitingSeq"
      FROM iaic_tasks t LEFT JOIN LATERAL (SELECT seq FROM iaic_task_events WHERE task_id=t.id ORDER BY seq DESC LIMIT 1) e ON true
      LEFT JOIN LATERAL (SELECT seq FROM iaic_task_events WHERE task_id=t.id AND (kind='delegation_requested' OR (kind='outcome' AND data->>'status'='waiting' AND data->>'reason'='input')) ORDER BY seq DESC LIMIT 1) w ON true
      WHERE t.id=$1 AND t.employee_id=$2 AND t.erp_user=$3`,[id,...this.identity(actor)])).rows[0];
    if(!row)throw notFound();return row;
  }
  async operationReceipts(actor,id) {
    await this.get(actor,id);
    const rows=(await this.pool.query('SELECT id AS "effectKey",capability,effect,status FROM iaic_calls WHERE task_id=$1 ORDER BY created_at,id LIMIT 1001',[id])).rows;
    if(rows.length>1000)throw Object.assign(new Error('Task operation receipt bound exceeded'),{statusCode:413});
    return rows;
  }
  async history(actor,id) {
    await this.get(actor,id);
    const events=await this.pool.query('SELECT seq,kind,data,created_at FROM iaic_task_events WHERE task_id=$1 ORDER BY seq',[id]);
    const calls=await this.pool.query('SELECT * FROM iaic_calls WHERE task_id=$1 ORDER BY created_at,id',[id]);
    return {events:events.rows,calls:calls.rows};
  }
  async transitionReceipt(actor,id,requestKey) {
    if(typeof requestKey!=='string'||!requestKey||requestKey.length>500)throw conflict('Valid transition request key required');
    await this.get(actor,id);
    const row=(await this.pool.query('SELECT request_key AS "requestKey",request_digest AS "requestDigest",action,result AS task FROM iaic_task_transition_receipts WHERE task_id=$1 AND request_key=$2',[id,requestKey])).rows[0];
    return row??null;
  }
  async findTransition(actor,id,request) {
    return checkedTransition(await this.transitionReceipt(actor,id,request.requestKey),transitionBinding(request));
  }
  async transition(actor,id,{action,version,input,requestKey=null}) {
    const binding=requestKey===null?null:transitionBinding({action,version,input,requestKey});
    const connection=await this.pool.connect();
    try{
      await connection.query('BEGIN');
      const row=(await connection.query('SELECT * FROM iaic_tasks WHERE id=$1 AND employee_id=$2 AND erp_user=$3 FOR UPDATE',[id,...this.identity(actor)])).rows[0];
      if(!row)throw notFound();
      if(binding){
        const prior=(await connection.query('SELECT request_digest AS "requestDigest",result AS task FROM iaic_task_transition_receipts WHERE task_id=$1 AND request_key=$2',[id,requestKey])).rows[0];
        const original=checkedTransition(prior,binding);
        if(original){await connection.query('COMMIT');return original;}
      }
      if(action==='cancel'){
        if(['succeeded','failed'].includes(row.status))throw conflict('Terminal task cannot be cancelled');
        if(row.status!=='cancelled'){
          await connection.query("UPDATE iaic_tasks SET status='cancelled',waiting_reason=NULL,updated_at=now() WHERE id=$1",[id]);
          await event(connection,id,'cancelled',{});
        }
      }else{
        if(row.status!=='waiting')throw conflict('Only waiting tasks can resume');
        if(['model_output_limit','invalid_model_action'].includes(row.waiting_reason))throw Object.assign(conflict('Deterministic model failure requires a reviewed new Task; preserve original effect receipts'),{code:'MODEL_RESTART_REQUIRED'});
        if(row.delegation&&!row.delegation.received)throw conflict('Delegation must finish or the parent must be cancelled before resuming');
        if(row.version!==version)throw conflict('Code/Skill version mismatch; resume with original version or create a new task');
        if((await connection.query("SELECT id FROM iaic_calls WHERE task_id=$1 AND status IN ('running','unknown') LIMIT 1",[id])).rowCount)throw conflict('Resolve uncertain calls before resuming');
        if(action==='provide_input'){
          if(row.waiting_reason!=='input'||typeof input!=='string'||!input.trim())throw conflict('Task is not waiting for this input');
          await event(connection,id,'input',{text:input});
        }else if(action!=='resume'||row.waiting_reason==='input')throw conflict('Task requires input before resuming');
        await connection.query("UPDATE iaic_tasks SET status='queued',waiting_reason=NULL,executor_token=NULL,updated_at=now() WHERE id=$1",[id]);
        await event(connection,id,'resumed',{});
      }
      let snapshot=null;
      if(binding){
        const current=(await connection.query('SELECT id,capability,status,waiting_reason,version,updated_at FROM iaic_tasks WHERE id=$1',[id])).rows[0];
        snapshot=JSON.parse(JSON.stringify({...current,controlReceipt:binding}));
        await connection.query('INSERT INTO iaic_task_transition_receipts(task_id,request_key,request_digest,action,result) VALUES($1,$2,$3,$4,$5)',[id,requestKey,binding.requestDigest,action,snapshot]);
      }
      await connection.query('COMMIT');return snapshot??this.get(actor,id);
    }catch(error){await connection.query('ROLLBACK').catch(()=>{});throw error;}finally{connection.release();}
  }
  async switchModel(actor,id,{model,expectedModel,version}) {
    if(typeof model!=='string'||!model||typeof expectedModel!=='string'||!expectedModel)throw conflict('Current and target model identities required');
    const connection=await this.pool.connect();
    try{
      await connection.query('BEGIN');
      const task=(await connection.query('SELECT * FROM iaic_tasks WHERE id=$1 AND employee_id=$2 AND erp_user=$3 FOR UPDATE',[id,...this.identity(actor)])).rows[0];
      if(!task)throw notFound();
      if(task.status!=='waiting'||task.version!==version||task.model!==expectedModel)throw conflict('Task changed; reload before switching its model');
      if((await connection.query("SELECT 1 FROM iaic_calls WHERE task_id=$1 AND status IN ('running','unknown') LIMIT 1",[id])).rowCount)throw conflict('Resolve uncertain calls before switching models');
      if(model!==task.model){
        await connection.query('UPDATE iaic_tasks SET model=$2,updated_at=now() WHERE id=$1',[id,model]);
        await event(connection,id,'model_changed',{from:task.model,to:model});
      }
      await connection.query('COMMIT');return this.get(actor,id);
    }catch(error){await connection.query('ROLLBACK').catch(()=>{});throw error;}finally{connection.release();}
  }
  async resolveCall(actor,taskId,callId,result) {
    const connection=await this.pool.connect();
    try{
      await connection.query('BEGIN');
      const task=(await connection.query('SELECT * FROM iaic_tasks WHERE id=$1 AND employee_id=$2 AND erp_user=$3 FOR UPDATE',[taskId,...this.identity(actor)])).rows[0];
      if(!task)throw notFound();
      if(!['waiting','cancelled'].includes(task.status))throw conflict('Only interrupted or cancelled task calls may be reconciled');
      const changed=await connection.query("UPDATE iaic_calls SET status='succeeded',result=$3,error='',updated_at=now() WHERE id=$1 AND task_id=$2 AND status='unknown'",[callId,taskId,JSON.stringify(result)]);
      if(!changed.rowCount)throw conflict('Call state changed during reconciliation');
      await event(connection,taskId,'call_reconciled',{callId,status:'succeeded'});
      await connection.query('COMMIT');
    }catch(error){await connection.query('ROLLBACK').catch(()=>{});throw error;}finally{connection.release();}
  }
  // Public Runtime port: only explicit durable result waits, never user-input or uncertain calls.
  async pendingResultWait(version,after=null) {
    return (await this.pool.query(`SELECT t.*,e.seq AS wait_seq,e.data->>'callId' AS wait_call_id,
      c.capability AS wait_capability,c.input AS wait_input
      FROM iaic_tasks t
      JOIN LATERAL (SELECT seq,kind,data FROM iaic_task_events WHERE task_id=t.id ORDER BY seq DESC LIMIT 1) e ON e.kind='result_wait'
      JOIN iaic_calls c ON c.task_id=t.id AND c.id::text=e.data->>'callId' AND c.status='succeeded' AND c.effect='read'
      WHERE t.version=$1 AND t.status='waiting' AND t.waiting_reason='external_result'
      AND ($2::uuid IS NULL OR t.id>$2) ORDER BY t.id LIMIT 1`,[version,after])).rows[0]||null;
  }
  async wakeResultWait(actor,id,{version,waitSeq,callId}) {
    const connection=await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const row=(await connection.query('SELECT * FROM iaic_tasks WHERE id=$1 AND employee_id=$2 AND erp_user=$3 FOR UPDATE',[id,...this.identity(actor)])).rows[0];
      const latest=(await connection.query('SELECT seq,kind,data FROM iaic_task_events WHERE task_id=$1 ORDER BY seq DESC LIMIT 1',[id])).rows[0];
      if(!row||row.version!==version||row.status!=='waiting'||row.waiting_reason!=='external_result'||latest?.kind!=='result_wait'||String(latest.seq)!==String(waitSeq)||latest.data.callId!==callId){await connection.query('COMMIT');return false;}
      if((await connection.query("SELECT 1 FROM iaic_calls WHERE task_id=$1 AND status IN ('prepared','running','unknown') LIMIT 1",[id])).rowCount){await connection.query('COMMIT');return false;}
      await connection.query("UPDATE iaic_tasks SET status='queued',waiting_reason=NULL,executor_token=NULL,updated_at=now() WHERE id=$1",[id]);
      await event(connection,id,'result_ready',{callId});
      await event(connection,id,'resumed',{source:'result_wait',callId});
      await connection.query('COMMIT');return true;
    } catch(error){await connection.query('ROLLBACK').catch(()=>{});throw error;}finally{connection.release();}
  }
  async pendingDelegation(version,after=null){return (await this.pool.query("SELECT * FROM iaic_tasks WHERE version=$1 AND status='waiting' AND waiting_reason='external_result' AND delegation IS NOT NULL AND NOT (delegation ? 'received') AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 1",[version,after])).rows[0]||null;}
  async receiveDelegation(actor,id,{version,delegationId,receipt}){
    const connection=await this.pool.connect();
    try{await connection.query('BEGIN');const row=(await connection.query('SELECT * FROM iaic_tasks WHERE id=$1 AND employee_id=$2 AND erp_user=$3 FOR UPDATE',[id,...this.identity(actor)])).rows[0];
      if(!row||row.version!==version||row.status!=='waiting'||row.waiting_reason!=='external_result'||row.delegation?.id!==delegationId||row.delegation.received){await connection.query('COMMIT');return false;}
      if((await connection.query("SELECT 1 FROM iaic_calls WHERE task_id=$1 AND status IN ('prepared','running','unknown') LIMIT 1",[id])).rowCount)throw conflict('Uncertain calls prevent delegation continuation');
      await connection.query("UPDATE iaic_tasks SET status='queued',waiting_reason=NULL,executor_token=NULL,delegation=jsonb_set(delegation,'{received}','true'),updated_at=now() WHERE id=$1",[id]);
      await event(connection,id,'delegation_received',{...receipt,delegationId});await event(connection,id,'resumed',{source:'delegation'});await connection.query('COMMIT');return true;
    }catch(error){await connection.query('ROLLBACK').catch(()=>{});throw error;}finally{connection.release();}
  }
  executorState(){return executorState(this.pool);}
  requestExecutorDrain(request){return requestExecutorDrain(this.pool,request);}
  async acquireExecutor() {
    const connection=await this.pool.connect();
    try{
      const acquired=(await connection.query("SELECT pg_try_advisory_lock(hashtextextended(current_database() || ':' || current_schema() || ':iaic-executor',0)) AS acquired")).rows[0].acquired;
      if(!acquired){connection.release();return null;}
      const executor=new TaskExecutor(connection);
      executor.generation=await takeOwnership(connection,executor.token);
      await executor.recover();return executor;
    }catch(error){connection.release(true);throw error;}
  }
}

class TaskExecutor {
  constructor(connection){this.connection=connection;this.token=randomUUID();this.closed=false;this.failed=false;this.draining=false;this.queue=Promise.resolve();
    this.onError=()=>{this.failed=true;};connection.on('error',this.onError);}
  // A dedicated DB session owns the executor lock. Never reconnect this session;
  // connection loss prevents any new operation from passing admission.
  transaction(operation){
    const run=this.queue.then(async()=>{
      if(this.closed||this.failed)throw conflict('Executor session is unavailable');
      try{await this.connection.query('BEGIN');const ownership=await assertOwnership(this.connection,this);this.draining=ownership.state==='draining';const result=await operation(this.connection);await this.connection.query('COMMIT');return result;}
      catch(error){await this.connection.query('ROLLBACK').catch(()=>{this.failed=true;});if(error.code==='EXECUTOR_FENCED')this.failed=true;throw error;}
    });this.queue=run.catch(()=>{});return run;
  }
  recover(){return this.transaction(async c=>{
    await c.query("UPDATE iaic_calls SET status='unknown',error='Executor interrupted after dispatch',updated_at=now() WHERE status='running'");
    await c.query("UPDATE iaic_calls SET status='failed',error='Executor interrupted before dispatch; no operation was sent',updated_at=now() WHERE status='prepared'");
    const running=(await c.query("SELECT id FROM iaic_tasks WHERE status='running' FOR UPDATE")).rows;
    for(const row of running){
      await c.query("UPDATE iaic_calls SET status='unknown',error='Executor interrupted after dispatch',updated_at=now() WHERE task_id=$1 AND status='running'",[row.id]);
      await c.query("UPDATE iaic_tasks SET status='waiting',waiting_reason='interrupted',executor_token=NULL,updated_at=now() WHERE id=$1",[row.id]);
      await event(c,row.id,'interrupted',{});
    }
  });}
  claim(version){return this.transaction(async c=>{
    if(this.draining)return null;
    if((await c.query("SELECT id FROM iaic_tasks WHERE status='running' LIMIT 1")).rowCount)return null;
    if((await c.query("SELECT id FROM iaic_calls WHERE status='running' LIMIT 1")).rowCount)return null;
    const row=(await c.query("SELECT * FROM iaic_tasks WHERE status='queued' ORDER BY created_at,id FOR UPDATE LIMIT 1")).rows[0];
    if(!row)return null;
    if(row.version!==version){
      await c.query("UPDATE iaic_tasks SET status='waiting',waiting_reason='interrupted',error='Code/Skill version mismatch',updated_at=now() WHERE id=$1",[row.id]);
      await event(c,row.id,'version_mismatch',{expected:row.version,actual:version});return null;
    }
    return (await c.query("UPDATE iaic_tasks SET status='running',executor_token=$2,updated_at=now() WHERE id=$1 RETURNING *",[row.id,this.token])).rows[0];
  });}
  async active(c,id){const row=(await c.query('SELECT * FROM iaic_tasks WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!row||row.status!=='running'||row.executor_token!==this.token)throw conflict('Task is no longer active');return row;}
  prepareBatchAction(taskId,args){
    if(!args?.actionRef)throw conflict('Batch action reference required');
    return this.prepare(taskId,args);
  }
  prepare(taskId,{capability,input,effect,actionRef=null}){return this.transaction(async c=>{
    await this.active(c,taskId);
    if(actionRef!==null&&(typeof actionRef!=='string'||! /^[a-f0-9-]{36}:[0-7]$/.test(actionRef)))throw conflict('Invalid batch action reference');
    const row=(await c.query("INSERT INTO iaic_calls(id,task_id,capability,input,effect,status,action_ref) VALUES($1,$2,$3,$4,$5,'prepared',$6) RETURNING *",[randomUUID(),taskId,capability,JSON.stringify(input),effect,actionRef])).rows[0];
    await event(c,taskId,'call_prepared',{callId:row.id,capability});return row;
  });}
  dispatch(taskId,callId){return this.transaction(async c=>{
    await this.active(c,taskId);
    const row=(await c.query("UPDATE iaic_calls SET status='running',updated_at=now() WHERE id=$1 AND task_id=$2 AND status='prepared' RETURNING *",[callId,taskId])).rows[0];
    if(!row)throw conflict('Call is not prepared');await event(c,taskId,'call_started',{callId});return row;
  });}
  settle(taskId,callId,{result=null,error=null,unknown=false,wait=false}){return this.transaction(async c=>{
    // Cancellation prevents subsequent calls, but preserves results of an admitted call.
    const task=(await c.query('SELECT * FROM iaic_tasks WHERE id=$1 FOR UPDATE',[taskId])).rows[0];
    if(!task||task.executor_token!==this.token)throw conflict('Executor no longer owns this task');
    const status=error?(unknown?'unknown':'failed'):'succeeded';
    const row=(await c.query("UPDATE iaic_calls SET status=$3,result=$4,error=$5,updated_at=now() WHERE id=$1 AND task_id=$2 AND status='running' RETURNING *",[callId,taskId,status,JSON.stringify(result),error?String(error.message||error):''])).rows[0];
    if(!row)throw conflict('Call cannot be settled');await event(c,taskId,'call_settled',{callId,status});
    if(wait&&status==='succeeded'&&task.status==='running'){
      if(row.effect!=='read')throw conflict('Only read calls can register result waits');
      await c.query("UPDATE iaic_tasks SET status='waiting',waiting_reason='external_result',executor_token=NULL,updated_at=now() WHERE id=$1",[taskId]);
      await event(c,taskId,'result_wait',{callId});
    }
    return row;
  });}
  delegate(taskId,{request,deadlineAt}){return this.transaction(async c=>{
    const task=await this.active(c,taskId);
    if(task.delegation||task.handoff)throw conflict('Only one non-nested delegation is allowed');
    if((await c.query("SELECT 1 FROM iaic_calls WHERE task_id=$1 AND status IN ('prepared','running','unknown') LIMIT 1",[taskId])).rowCount)throw conflict('Uncertain calls prevent delegation');
    const intent={id:randomUUID(),request,deadlineAt};
    await c.query("UPDATE iaic_tasks SET status='waiting',waiting_reason='external_result',executor_token=NULL,delegation=$2,updated_at=now() WHERE id=$1",[taskId,intent]);
    await event(c,taskId,'delegation_requested',{delegationId:intent.id});return intent;
  });}
  finish(taskId,{status,result=null,reason=null,error=''}){return this.transaction(async c=>{
    await this.active(c,taskId);
    if(!['succeeded','failed','waiting'].includes(status))throw conflict('Invalid executor task outcome');
    if(status==='succeeded'&&(await c.query("SELECT id FROM iaic_calls WHERE task_id=$1 AND status IN ('prepared','running','unknown') LIMIT 1",[taskId])).rowCount)throw conflict('Unresolved calls prevent task completion');
    await c.query('UPDATE iaic_tasks SET status=$2,result=$3,waiting_reason=$4,error=$5,updated_at=now() WHERE id=$1',[taskId,status,JSON.stringify(result),reason,error]);
    await event(c,taskId,'outcome',{status,reason});
  });}
  append(taskId,kind,data){return this.transaction(async c=>{
    if(kind==='model_usage'){
      // Accounting for a previously admitted model request is not a new action.
      // Keep its usage even if the user cancelled while the response was in flight.
      const task=(await c.query('SELECT * FROM iaic_tasks WHERE id=$1 FOR UPDATE',[taskId])).rows[0];
      if(!task||task.executor_token!==this.token||!['running','cancelled'].includes(task.status))throw conflict('Executor no longer owns model accounting');
    }else await this.active(c,taskId);
    await event(c,taskId,kind,data);
  });}
  async close(){await this.queue;if(this.closed)return;this.closed=true;this.connection.off('error',this.onError);
    if(!this.failed)await this.connection.query("UPDATE iaic_executor_ownership SET state='released',owner_token=NULL,updated_at=now() WHERE singleton=true AND owner_token=$1 AND generation=$2",[this.token,this.generation]).catch(()=>{this.failed=true;});
    if(!this.failed)await this.connection.query("SELECT pg_advisory_unlock(hashtextextended(current_database() || ':' || current_schema() || ':iaic-executor',0))").catch(()=>{this.failed=true;});this.connection.release(this.failed);}
}
async function event(connection,taskId,kind,data){await connection.query('INSERT INTO iaic_task_events(task_id,kind,data) VALUES($1,$2,$3)',[taskId,kind,JSON.stringify(data)]);}
