// Application-owned PostgreSQL adapter for fictional permissions, not a Core
// schema or a production authorization policy. One isolated schema per fixture.
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {AccessProfileReconciler} from '@immedi/iaic-core/context/access-profiles.js';
const empty=()=>({permissions:[],mandates:[]});
export async function fixture(){
 const admin=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL});
 const schema='access_profile_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 await pool.query('CREATE TABLE contexts(id text PRIMARY KEY, data jsonb NOT NULL); CREATE TABLE revisions(id text, revision text, data jsonb NOT NULL, PRIMARY KEY(id,revision)); CREATE TABLE audit(operation_key text PRIMARY KEY, receipt jsonb NOT NULL, evidence jsonb NOT NULL); CREATE TABLE approvals(id text PRIMARY KEY, digest text NOT NULL);');
 const profiles={v1:{id:'fixture.reader',version:'v1',permissions:['fixture.read'],mandates:['mandate.original']},v2:{id:'fixture.reader',version:'v2',permissions:['fixture.read','fixture.write'],mandates:['mandate.replacement']}};
 for(const id of ['a','b']){
  const data={contextId:id,revision:'1',policyRevision:'1',identity:{scopeId:'fixture',principalId:'principal-'+id,role:'reader',market:'fixture-market'},profile:profiles.v1,overrides:{grant:{permissions:['fixture.extra'],mandates:[]},revoke:empty()},effective:{permissions:['fixture.extra','fixture.read'],mandates:['mandate.original']},denied:empty(),eligible:true};
  await pool.query('INSERT INTO contexts VALUES($1,$2)',[id,data]);await pool.query('INSERT INTO revisions VALUES($1,$2,$3)',[id,'1',data]);
 }
 const operator={id:'operator'};
 const controls={authorized:true,loseAck:new Set(),failBefore:new Set(),beforeAppend:null};
 const ports={
  authorize:({actor,contextId})=>controls.authorized&&actor.id===operator.id&&['a','b'].includes(contextId),
  resolveProfile:({profile})=>structuredClone(profiles[profile.version]),
  readContext:async({contextId})=>(await pool.query('SELECT data FROM contexts WHERE id=$1',[contextId])).rows[0]?.data,
  approve:async({actor,approvalId,digest})=>controls.authorized&&actor.id===operator.id&&(await pool.query('SELECT 1 FROM approvals WHERE id=$1 AND digest=$2',[approvalId,digest])).rowCount===1,
  readReceipt:async({operationKey})=>(await pool.query('SELECT receipt FROM audit WHERE operation_key=$1',[operationKey])).rows[0]?.receipt??null,
  appendRevision:async request=>{
   await controls.beforeAppend?.(request);
   const db=await pool.connect();let receipt;
   try{
    await db.query('BEGIN');
    const current=(await db.query('SELECT data FROM contexts WHERE id=$1 FOR UPDATE',[request.contextId])).rows[0]?.data;
    // In a real Host, lock/revalidate current operator membership, policy,
    // profile definition and approval in the same transaction as this CAS.
    if(!controls.authorized||request.actor.id!==operator.id||!(await db.query('SELECT 1 FROM approvals WHERE id=$1 AND digest=$2',[request.approvalId,request.planDigest])).rowCount)throw Error('fixture authority changed');
    const prior=(await db.query('SELECT receipt FROM audit WHERE operation_key=$1',[request.operationKey])).rows[0]?.receipt;
    if(prior){await db.query('COMMIT');return prior;}
    if(!isDeepStrictEqual(current,request.expected)||!isDeepStrictEqual(profiles[request.next.profile.version],request.next.profile))throw Error('fixture CAS conflict');
    if(controls.failBefore.has(request.contextId))throw Error('fixture interrupted before commit');
    const revision=String(Number(current.revision)+1),next={...current,...request.next,revision};
    receipt={contextId:request.contextId,operationKey:request.operationKey,planDigest:request.planDigest,previousRevision:current.revision,revision};
    await db.query('INSERT INTO revisions VALUES($1,$2,$3)',[request.contextId,revision,next]);
    await db.query('UPDATE contexts SET data=$2 WHERE id=$1',[request.contextId,next]);
    await db.query('INSERT INTO audit VALUES($1,$2,$3)',[request.operationKey,receipt,{approvalId:request.approvalId,before:current,after:next}]);
    await db.query('COMMIT');
   }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
   if(controls.loseAck.delete(request.contextId))throw Error('fixture lost committed acknowledgement');
   return receipt;
  }
 };
 return {pool,operator,controls,profiles,ports,service:()=>new AccessProfileReconciler(ports),
  approve:async plan=>{const id='approval-'+randomUUID();await pool.query('INSERT INTO approvals VALUES($1,$2)',[id,plan.digest]);return id;},
  close:async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
 };
}
