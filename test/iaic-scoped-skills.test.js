import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SkillCatalog} from '@immedi/iaic-core/skills/catalog.js';
import {skillOperations} from '@immedi/iaic-core/skills/operations.js';
import {createAgentTaskCapabilities} from '@immedi/iaic-core/assistants/tasks.js';
import {CapabilityDispatcher} from '@immedi/iaic-core/capabilities/index.js';
import {ContextAssembler} from '@immedi/iaic-core/context/index.js';

test('one registered catalog supports current per-actor discovery, reads and revoked historical loading',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'scoped-skills-'));
 const selection=new Map([['alice',['personal/SKILL.md']],['bob',['business/SKILL.md']]]);
 const actor=subjectId=>({scopeId:'demo',subjectId});
 try{
  for(const name of ['personal','business']){await fs.mkdir(path.join(root,name));await fs.writeFile(path.join(root,name,'SKILL.md'),`# ${name}\n\nUse for ${name} tasks.\n\nPrivate ${name} instructions.`);await fs.writeFile(path.join(root,name,'reference.md'),`${name} reference`);}
  const catalog=new SkillCatalog({root,entries:['personal/SKILL.md','business/SKILL.md'],selectEntries:({actor})=>selection.get(actor.subjectId)||[]});
  const capabilities=createAgentTaskCapabilities({memory:{},workspace:{},skillCatalog:catalog,authorize:async()=>true,verifyOutcome:async()=>true});
  const dispatcher=new CapabilityDispatcher({capabilities});
  const list=await dispatcher.invoke('assistant.skills.list',{},{actor:actor('alice')});
  assert.deepEqual(list.map(s=>s.id),['personal/SKILL.md']);assert.equal(list[0].text,undefined);
  const input={id:list[0].id,expectedVersion:list[0].version};
  const result=await dispatcher.invoke('assistant.skills.read',input,{actor:actor('alice')});assert.match(result.text,/Private personal/);
  await assert.rejects(dispatcher.invoke('assistant.skills.read',input,{actor:actor('bob')}),{statusCode:404});
  const ops=skillOperations(catalog);assert.equal((await ops.read.execute({...input,resource:'reference.md'},{actor:actor('alice')})).text,'personal reference');
  const context=new ContextAssembler({skillCatalog:catalog});
  const capability={implementation:{skillMode:'progressive',skills:['personal/SKILL.md','business/SKILL.md'],instructions:'Test'}};
  const messages=await context.assemble({task:{input:{}},capability,history:{calls:[],events:[]},actor:actor('bob'),dispatcher});
  assert.deepEqual(JSON.parse(messages[1].content).skills.map(s=>s.id),['business/SKILL.md']);
  await assert.rejects(context.assemble({task:{input:{}},capability:{implementation:{skills:['personal/SKILL.md'],instructions:'Test'}},history:{calls:[],events:[]},actor:actor('bob'),dispatcher}),{statusCode:404});
  selection.set('alice',[]);
  const history={events:[],calls:[{id:'read',capability:'assistant.skills.read',input,status:'succeeded',result}]};
  await assert.rejects(context.revalidateHistory({history,actor:actor('alice'),dispatcher}),{statusCode:404});
  assert.deepEqual(await dispatcher.invoke('assistant.skills.list',{},{actor:actor('alice')}),[]);
  selection.set('alice',['outside/SKILL.md']);await assert.rejects(catalog.list({actor:actor('alice')}),/registered entries/);
  selection.set('alice',['personal/SKILL.md','personal/SKILL.md']);await assert.rejects(catalog.list({actor:actor('alice')}),/unique registered/);
  assert.throws(()=>new SkillCatalog({root,entries:[],selectEntries:true}),/must be a function/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
