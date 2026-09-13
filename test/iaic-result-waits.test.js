import test from 'node:test';import assert from 'node:assert/strict';
import {ResultWaits} from '@immedi/iaic-core/agent/result-waits.js';import {defineCapability} from '@immedi/iaic-core/capabilities/index.js';
const base={name:'test.wait',description:'Wait',input:{type:'object'},output:{type:'object'},effect:'read',authorize:async()=>true,implementation:{kind:'function',execute:async()=>({})},revalidate:async()=>({}),waitReady:()=>true};
test('Result waiting accepts only deterministic reads with fresh history projection',()=>{
 assert.ok(defineCapability(base));assert.throws(()=>defineCapability({...base,effect:'write',retry:'idempotent'}),/read function/);assert.throws(()=>defineCapability({...base,revalidate:undefined}),/history revalidation/);
});
test('A timed-out read cannot wake later; polling never invokes writes or the model',async()=>{
 let complete,wakes=0,reads=0;const task={id:'task',wait_capability:'read',wait_input:{},wait_seq:'1',wait_call_id:'call'};
 const waits=new ResultWaits({version:'v1',intervalMs:0,timeoutMs:10,authorizeTask:async()=>{},store:{pendingResultWait:async()=>task,actor:()=>({}),wakeResultWait:async()=>{wakes++;}},dispatcher:{capabilities:new Map([['read',{effect:'read',waitReady:()=>true}]]),invoke:async()=>{reads++;return new Promise(resolve=>{complete=resolve;});}}});
 assert.equal(await waits.tick(),null);complete({});await new Promise(resolve=>setImmediate(resolve));assert.equal(wakes,0);assert.equal(reads,1);
 waits.dispatcher.capabilities.set('read',{effect:'write',waitReady:()=>true});assert.equal(await waits.tick(),null);assert.equal(reads,1);
});
