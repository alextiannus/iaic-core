import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../examples/core-access-profiles/fixture.mjs';
import {AccessProfileReconciler} from '../context/access-profiles.js';
const request={profile:{id:'fixture.reader',version:'v2'},contextIds:['a','b']};
async function withFixture(run){const f=await fixture();try{await run(f);}finally{await f.close();}}

test('profile preview separates permissions/mandates, preserves extras and requires digest approval',()=>withFixture(async f=>{
 const s=f.service(),plan=await s.preview(f.operator,request);
 assert.deepEqual(plan.entries[0].changes.permissions,{add:['fixture.write'],retain:['fixture.extra','fixture.read'],remove:[]});
 assert.deepEqual(plan.entries[0].changes.mandates,{add:['mandate.replacement'],retain:[],remove:['mandate.original']});
 assert.equal((await f.ports.readContext({contextId:'a'})).revision,'1');
 await assert.rejects(s.apply(f.operator,{plan,approvalId:'unapproved'}),{code:'ACCESS_PROFILE_APPROVAL_REQUIRED'});
 const approvalId=await f.approve(plan),tampered=structuredClone(plan);tampered.entries[0].after.effective.permissions.push('escalated');
 await assert.rejects(s.apply(f.operator,{plan:tampered,approvalId}),{code:'ACCESS_PROFILE_PLAN_CHANGED'});
 const result=await s.apply(f.operator,{plan,approvalId});assert.equal(result.complete,true);
 assert.equal((await f.pool.query('SELECT * FROM audit')).rowCount,2);
 assert.equal((await f.pool.query('SELECT * FROM revisions')).rowCount,4);
 assert.equal((await s.apply(f.operator,{plan,approvalId})).complete,true);
 assert.equal((await f.pool.query('SELECT * FROM revisions')).rowCount,4);
 const unchanged=await s.preview(f.operator,request);
 assert.equal((await s.apply(f.operator,{plan:unchanged,approvalId:await f.approve(unchanged)})).results[0].status,'unchanged');
}));

test('lost acknowledgement and partial batch survive service recreation with original keys',()=>withFixture(async f=>{
 const plan=await f.service().preview(f.operator,request),approvalId=await f.approve(plan);
 f.controls.loseAck.add('a');f.controls.failBefore.add('b');
 const first=await f.service().apply(f.operator,{plan,approvalId});
 assert.deepEqual(first.results.map(r=>r.status),['applied','unknown']);assert.equal(first.complete,false);
 f.controls.failBefore.clear();
 const second=await f.service().apply(f.operator,{plan,approvalId});
 assert.equal(second.complete,true);assert.deepEqual(second.results.map(r=>r.operationKey),first.results.map(r=>r.operationKey));
 assert.equal((await f.pool.query('SELECT * FROM audit')).rowCount,2);
}));

test('concurrent revision and current eligibility changes invalidate old approval',()=>withFixture(async f=>{
 const s=f.service(),plan=await s.preview(f.operator,request),approvalId=await f.approve(plan);
 await f.pool.query("UPDATE contexts SET data=jsonb_set(data,'{revision}','\"2\"') WHERE id='a'");
 await f.pool.query("UPDATE contexts SET data=jsonb_set(data,'{eligible}','false') WHERE id='b'");
 const result=await s.apply(f.operator,{plan,approvalId});
 assert.deepEqual(result.results.map(r=>r.code),['ACCESS_PROFILE_CONFLICT','ACCESS_PROFILE_INELIGIBLE']);
 assert.equal((await f.pool.query('SELECT * FROM audit')).rowCount,0);
}));

test('Host CAS prevents policy race; compensating rollback cannot restore revoked permission',()=>withFixture(async f=>{
 const s=f.service(),plan=await s.preview(f.operator,request),approvalId=await f.approve(plan);
 f.controls.beforeAppend=async ({contextId})=>{if(contextId==='a')await f.pool.query("UPDATE contexts SET data=jsonb_set(data,'{policyRevision}','\"2\"') WHERE id='a'");};
 assert.deepEqual((await s.apply(f.operator,{plan,approvalId})).results.map(r=>r.status),['unknown','applied']);
 f.controls.beforeAppend=null;
 await f.pool.query("UPDATE contexts SET data=jsonb_set(jsonb_set(data,'{denied,permissions}','[\"fixture.read\"]'),'{policyRevision}','\"2\"') WHERE id='b'");
 const rollback=await s.preview(f.operator,{profile:{id:'fixture.reader',version:'v1'},contextIds:['b']});
 assert.deepEqual(rollback.entries[0].after.effective.permissions,['fixture.extra']);
 assert.equal((await s.apply(f.operator,{plan:rollback,approvalId:await f.approve(rollback)})).complete,true);
 const current=await f.ports.readContext({contextId:'b'});assert.equal(current.revision,'3');
 assert.deepEqual(current.effective.permissions,['fixture.extra']);
 assert.equal((await f.pool.query("SELECT * FROM revisions WHERE id='b'")).rowCount,3);
}));

test('invalid inputs and cross-scope operators fail before read, revoked operator cannot recover receipts',()=>withFixture(async f=>{
 const s=f.service();
 await assert.rejects(s.preview({id:'other'},request),{code:'ACCESS_PROFILE_DENIED'});
 await assert.rejects(s.preview(f.operator,{...request,contextIds:['a',,'b']}),{code:'ACCESS_PROFILE_INVALID'});
 await assert.rejects(s.preview(f.operator,{...request,contextIds:['a','a']}),{code:'ACCESS_PROFILE_INVALID'});
 await assert.rejects(s.preview(f.operator,{...request,profile:{id:'other',version:'v2'}}),{code:'ACCESS_PROFILE_TARGET_MISMATCH'});
 const plan=await s.preview(f.operator,request),approvalId=await f.approve(plan);await s.apply(f.operator,{plan,approvalId});
 f.controls.authorized=false;
 await assert.rejects(s.apply(f.operator,{plan,approvalId}),{code:'ACCESS_PROFILE_APPROVAL_REQUIRED'});
}));

test('concurrent retries append one revision; receipt mismatch and mutated target are rejected',()=>withFixture(async f=>{
 const s=f.service(),plan=await s.preview(f.operator,request),approvalId=await f.approve(plan);
 const results=await Promise.all([s.apply(f.operator,{plan,approvalId}),s.apply(f.operator,{plan,approvalId})]);
 assert.equal(results.length,2);assert.equal((await s.apply(f.operator,{plan,approvalId})).complete,true);assert.equal((await f.pool.query('SELECT * FROM audit')).rowCount,2);
 const wrong=new AccessProfileReconciler({...f.ports,readReceipt:async r=>({...await f.ports.readReceipt(r),planDigest:'different'})});
 assert.ok((await wrong.apply(f.operator,{plan,approvalId})).results.every(r=>r.code==='ACCESS_PROFILE_RECEIPT_MISMATCH'));
 const fresh=await s.preview(f.operator,{...request,profile:{id:'fixture.reader',version:'v1'}}),approval=await f.approve(fresh);
 f.profiles.v1.permissions.push('unexpected');
 assert.ok((await s.apply(f.operator,{plan:fresh,approvalId:approval})).results.every(r=>r.code==='ACCESS_PROFILE_TARGET_MISMATCH'));
}));

test('explicit application revoke wins over target grant and recovery lookup failures remain unknown',()=>withFixture(async f=>{
 await f.pool.query("UPDATE contexts SET data=jsonb_set(data,'{overrides,revoke,permissions}','[\"fixture.write\"]') WHERE id='a'");
 const s=f.service(),plan=await s.preview(f.operator,request),approvalId=await f.approve(plan);
 assert.deepEqual(plan.entries[0].after.effective.permissions,['fixture.extra','fixture.read']);
 const unavailable=new AccessProfileReconciler({...f.ports,readReceipt:async()=>{throw Error('private connection failure');}});
 const result=await unavailable.apply(f.operator,{plan,approvalId});
 assert.ok(result.results.every(r=>r.status==='unknown'));assert.ok(!JSON.stringify(result).includes('private'));
 assert.equal((await f.pool.query('SELECT * FROM audit')).rowCount,0);
 assert.equal((await s.apply(f.operator,{plan,approvalId})).complete,true);
}));
