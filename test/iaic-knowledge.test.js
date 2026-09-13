import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {KnowledgeCatalog,FileKnowledgeStore,createKnowledgeCapabilities,CapabilityDispatcher,ContextAssembler} from '@immedi/iaic-core';
async function fixture(run){const root=await fs.mkdtemp(path.join(os.tmpdir(),'knowledge-test-'));try{await run(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
const entry=(id,file=id+'.md')=>({id,file,title:id,description:'Reference material',source:{kind:'fixture',reference:'source:'+id}});
test('knowledge searches authorized content, paginates metadata and does not disclose denied records',()=>fixture(async root=>{
 for(const id of ['a','b','secret'])await fs.writeFile(path.join(root,id+'.md'),'Literal needle '+id);
 let reads=[];const store=new FileKnowledgeStore({root,entries:['secret','b','a'].map(id=>entry(id))});const read=store.read.bind(store);store.read=async id=>{reads.push(id);return read(id);};
 const catalog=new KnowledgeCatalog({store,authorize:async(actor,record)=>actor==='reader'&&record.id!=='secret'});
 const first=await catalog.search('reader',{query:'NEEDLE',limit:1});assert.deepEqual(first.items.map(e=>e.id),['a']);assert.equal(first.nextCursor,'a');assert.equal(first.items[0].text,undefined);assert.equal(first.items[0].file,undefined);
 const second=await catalog.search('reader',{after:first.nextCursor,limit:1});assert.deepEqual(second.items.map(e=>e.id),['b']);assert.equal(second.nextCursor,null);assert.ok(!reads.includes('secret'));
 assert.deepEqual((await catalog.search('outsider')).items,[]);await assert.rejects(catalog.read('reader',{id:'secret'}),{statusCode:404});await assert.rejects(catalog.read('reader',{id:'absent'}),{statusCode:404});
 assert.equal((await catalog.read('reader',{id:'a',expectedVersion:first.items[0].reference.version})).text,'Literal needle a');
}));
test('knowledge revisions cover content and provenance; revoked, expired and deleted sources are not reinjected',()=>fixture(async root=>{
 await fs.writeFile(path.join(root,'a.md'),'Old reference');let permitted=true,now=0;
 const store=new FileKnowledgeStore({root,entries:[{...entry('a'),expiresAt:'2030-01-01T00:00:00Z'}]});const catalog=new KnowledgeCatalog({store,authorize:async()=>permitted,now:()=>now});
 const first=await catalog.read({}, {id:'a'});await fs.writeFile(path.join(root,'a.md'),'Corrected reference');
 await assert.rejects(catalog.read({}, {id:'a',expectedVersion:first.reference.version}),{statusCode:409});assert.equal((await catalog.revalidate({},first.reference)).unavailable,true);
 const second=await catalog.read({}, {id:'a'});assert.notEqual(first.reference.version,second.reference.version);store.entries[0].source.reference='corrected-source';const third=await catalog.read({}, {id:'a'});assert.notEqual(second.reference.version,third.reference.version);
 permitted=false;assert.equal((await catalog.revalidate({},third.reference)).unavailable,true);permitted=true;now=Date.parse('2030-01-01');assert.deepEqual((await catalog.search({})).items,[]);now=0;
 await fs.rm(path.join(root,'a.md'));assert.equal((await catalog.revalidate({},third.reference)).unavailable,true);assert.deepEqual((await catalog.search({})).items,[]);
}));
test('knowledge adapter rejects path escape, oversized content, invalid encoding and duplicate IDs',()=>fixture(async root=>{
 const outside=root+'-outside.md';await fs.writeFile(outside,'secret');
 try{
  await fs.symlink(outside,path.join(root,'escape.md'));
  await assert.rejects(new FileKnowledgeStore({root,entries:[entry('a','escape.md')]}).read('a'),/outside/);
  await assert.rejects(new FileKnowledgeStore({root,entries:[entry('a','../outside.md')]}).read('a'),/Invalid/);
  await fs.writeFile(path.join(root,'a.md'),'12345');await assert.rejects(new FileKnowledgeStore({root,entries:[entry('a')],maxBytes:4}).read('a'),/limit/);
  await fs.writeFile(path.join(root,'a.md'),Buffer.from([255]));await assert.rejects(new FileKnowledgeStore({root,entries:[entry('a')]}).read('a'),TypeError);
  assert.throws(()=>new FileKnowledgeStore({root,entries:[entry('a'),entry('a')]}),/Duplicate/);
 }finally{await fs.rm(outside,{force:true});}
}));
test('knowledge capability history rechecks record access and removes stale bodies from model context',()=>fixture(async root=>{
 await fs.writeFile(path.join(root,'a.md'),'private-reference-body');let allowed=true;
 const knowledge=new KnowledgeCatalog({store:new FileKnowledgeStore({root,entries:[entry('a')]}),authorize:async()=>allowed});
 const dispatcher=new CapabilityDispatcher({capabilities:createKnowledgeCapabilities({knowledge,authorize:async()=>true})});
 const actor={scopeId:'test',subjectId:'reader'},input={id:'a'};
 const result=await dispatcher.invoke('my_read_knowledge',input,{actor,callId:'read'});
 const context=new ContextAssembler({skillRoot:root});
 const request={task:{input:{goal:'Use reference'}},capability:{implementation:{instructions:'Work',skills:[]}},actor,dispatcher,history:{events:[],calls:[{id:'read',capability:'my_read_knowledge',input,status:'succeeded',result}]}};
 assert.match(JSON.stringify(await context.assemble(request)),/private-reference-body/);allowed=false;
 const messages=JSON.stringify(await context.assemble(request));assert.ok(!messages.includes('private-reference-body'));assert.match(messages,/unavailable/);
}));
