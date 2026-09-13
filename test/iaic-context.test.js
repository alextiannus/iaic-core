import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ContextAssembler} from '@immedi/iaic-core/context/index.js';
const actor={employeeId:'E1',erpUser:'u@example.test'};
test('historical source permissions are rechecked before model context or task history access',async()=>{
 const context=new ContextAssembler({skillRoot:'/private/tmp'});let allowed=true;
 const history={events:[],calls:[{id:'C1',capability:'read',input:{},status:'succeeded',result:{secret:'old'}}]};
 const dispatcher={capabilities:new Map([['read',{authorize:async()=>allowed,revalidate:async()=>({source:'currently permitted'})}]])};
 assert.deepEqual((await context.revalidateHistory({history,actor,dispatcher})).calls[0].result,{source:'currently permitted'});
 allowed=false;await assert.rejects(context.revalidateHistory({history,actor,dispatcher}),{statusCode:403});
});
test('context rejects escaping skill symlinks and enforces input byte budget',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-context-'));const other=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-outside-'));
 try{
  await fs.writeFile(path.join(other,'secret.md'),'Outside skill root');await fs.symlink(path.join(other,'secret.md'),path.join(root,'escape.md'));
  const context=new ContextAssembler({skillRoot:root,maxBytes:1000});
  const request={task:{input:{}},capability:{implementation:{instructions:'Work',skills:['escape.md']}},history:{events:[],calls:[]},actor,dispatcher:{}};
  await assert.rejects(context.assemble(request),/outside/);
  request.capability.implementation.skills=[];request.task.input={goal:'x'.repeat(2000)};
  await assert.rejects(context.assemble(request),{limitReached:true});
 }finally{await fs.rm(root,{recursive:true,force:true});await fs.rm(other,{recursive:true,force:true});}
});

test('continuation preserves input/result ordering without copying stale result bodies',async()=>{
 const context=new ContextAssembler({skillRoot:'/private/tmp'});
 const request={task:{input:{goal:'Read the draft',allowedTools:['read']}},capability:{implementation:{instructions:'Work',skills:[]}},actor,
  history:{calls:[{id:'C1',capability:'read',input:{path:'draft.md'},status:'succeeded',result:{content:'stale secret'}}],events:[
   {seq:'1',kind:'input',data:{text:'Read the current draft'}},
   {seq:'2',kind:'call_settled',data:{callId:'C1',status:'succeeded',result:{content:'stale secret'}}},
   {seq:'3',kind:'input',data:{text:'Now confirm its title'}},
   {seq:'4',kind:'model_response',data:{hidden:'must not be copied'}},
   {seq:'5',kind:'call_settled',data:{callId:'missing',status:'succeeded'}}]},
  dispatcher:{capabilities:new Map([['read',{authorize:async()=>true,revalidate:async()=>({content:'Current draft'})}]])}};
 const messages=await context.assemble(request),data=JSON.parse(messages[1].content);
 assert.deepEqual(data.goal.allowedTools,['read']);
 assert.deepEqual(data.events,[{seq:'1',kind:'input',data:{text:'Read the current draft'}},{seq:'2',kind:'call_settled',data:{callId:'C1',status:'succeeded'}},{seq:'3',kind:'input',data:{text:'Now confirm its title'}}]);
 assert.deepEqual(data.calls[0].result,{content:'Current draft'});
 assert.equal(messages[1].content.split('Current draft').length-1,1);
 assert.ok(!JSON.stringify(messages).includes('stale secret'));assert.ok(!JSON.stringify(messages).includes('must not be copied'));
 // A later read request must remain after the earlier completed read.
 request.history.events.reverse();
 const reversed=JSON.parse((await context.assemble(request))[1].content);
 assert.deepEqual(reversed.events.map(e=>e.seq),['3','2','1']);
});

test('Handoff context comes from the injected current port, remains source data and counts toward the context budget',async()=>{
 let available=true,seen;
 const context=new ContextAssembler({handoffProvider:async value=>{seen=value;return {items:[available?{id:'handoff',result:{summary:'Current child result'}}:{id:'handoff',availability:'unavailable'}],hasMore:false};}});
 const request={task:{id:'parent',input:{goal:'Continue work'}},actor,capability:{implementation:{instructions:'Work',skills:[]}},history:{calls:[],events:[]},dispatcher:{capabilities:new Map()}};
 const first=await context.assemble(request);assert.equal(seen.task,request.task);assert.equal(seen.actor,actor);assert.equal(JSON.parse(first[1].content).handoffs.items[0].result.summary,'Current child result');
 available=false;assert.doesNotMatch((await context.assemble(request))[1].content,/Current child result/);context.maxBytes=20;await assert.rejects(context.assemble(request),{limitReached:true});
});
