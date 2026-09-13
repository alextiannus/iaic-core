import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SkillCatalog} from '@immedi/iaic-core/skills/catalog.js';
test('Skill discovery returns metadata; registered resources load on demand and track revisions',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-skills-'));
 try{
  await fs.mkdir(path.join(root,'review'));await fs.writeFile(path.join(root,'review/SKILL.md'),'# Review\n\nUse for reviewing documents.\n\nDetailed instructions.');await fs.writeFile(path.join(root,'review/example.md'),'Example');
  const catalog=new SkillCatalog({root,entries:['review/SKILL.md']});const [entry]=await catalog.list();assert.equal(entry.description,'Use for reviewing documents.');assert.equal(entry.text,undefined);
  assert.match((await catalog.read(entry.id)).text,/Detailed instructions/);assert.equal((await catalog.read(entry.id,{resource:'example.md'})).text,'Example');
  await fs.writeFile(path.join(root,'review/SKILL.md'),'# Revised');assert.notEqual((await catalog.list())[0].version,entry.version);
  await assert.rejects(catalog.read('other/SKILL.md'),{statusCode:404});await fs.writeFile(path.join(root,'private.txt'),'private');
  await assert.rejects(catalog.read(entry.id,{resource:'../private.txt'}),/outside/);
  await fs.symlink(path.join(root,'private.txt'),path.join(root,'review/link'));await assert.rejects(catalog.read(entry.id,{resource:'link'}),/outside/);
  await assert.rejects(new SkillCatalog({root,entries:['review/SKILL.md'],maxBytes:2}).list(),/limit/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('standard Skill metadata supports folded YAML, optional fields and explicit revision reads', async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-skills-'));
 try {
  await fs.mkdir(path.join(root,'review'));
  const document='---\nname: review\ndescription: >-\n  Review documents when\n  evidence needs checking.\nlicense: MIT\ncompatibility: Node 20\nallowed-tools: unrestricted-tool\nmetadata:\n  version: "1.0"\n---\n# Instructions\n\nSecret body, loaded only on demand.';
  await fs.writeFile(path.join(root,'review/SKILL.md'),document);
  await fs.writeFile(path.join(root,'review/reference.md'),'Source reference');
  const catalog=new SkillCatalog({root,entries:['review/SKILL.md']});
  const [entry]=await catalog.list();
  assert.equal(entry.name,'review');assert.equal(entry.description,'Review documents when evidence needs checking.');assert.equal(entry.format,'agent-skills');
  assert.deepEqual(entry.metadata,{version:'1.0'});assert.equal(entry['allowed-tools'],'unrestricted-tool');assert.equal(JSON.stringify(entry).includes('Secret body'),false);
  const loaded=await catalog.read(entry.id,{expectedVersion:entry.version});assert.equal(loaded.text,document);assert.equal(loaded.skillVersion,entry.version);
  const reference=await catalog.read(entry.id,{resource:'reference.md',expectedVersion:entry.version});assert.equal(reference.text,'Source reference');assert.equal(reference.skillVersion,entry.version);assert.notEqual(reference.version,entry.version);
  await fs.writeFile(path.join(root,'review/SKILL.md'),document+'\nChanged');
  await assert.rejects(catalog.read(entry.id,{resource:'reference.md',expectedVersion:entry.version}),{statusCode:409});
 } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('invalid frontmatter is rejected instead of silently becoming description text', async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-skills-'));
 try {
  await fs.mkdir(path.join(root,'review'));
  const catalog=new SkillCatalog({root,entries:['review/SKILL.md']});
  for(const frontmatter of [
   'name: review\ndescription: first\ndescription: second',
   'name: other\ndescription: text',
   'name: review\ndescription: 42',
   'name: review\ndescription: text\nmetadata:\n  version: 1',
   'name: review\ndescription: !unknown text',
   'name: review\ndescription: &description text\nlicense: *description',
   '- review',
  ]){
   await fs.writeFile(path.join(root,'review/SKILL.md'),'---\n'+frontmatter+'\n---\nBody');
   await assert.rejects(catalog.list(),/Invalid Skill metadata/);
   await assert.rejects(catalog.read('review/SKILL.md'),/Invalid Skill metadata/);
  }
  await fs.writeFile(path.join(root,'review/SKILL.md'),'---\nname: review');
  await assert.rejects(catalog.list(),/closing delimiter/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});


test('referenced Skill resources can be pinned independently of an unchanged entry', async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-skills-'));
 try{
  await fs.mkdir(path.join(root,'review'));
  await fs.writeFile(path.join(root,'review/SKILL.md'),'# Review\n\nRead reference.md when reviewing.');
  await fs.writeFile(path.join(root,'review/reference.md'),'Original method');
  const catalog=new SkillCatalog({root,entries:['review/SKILL.md']});
  const [entry]=await catalog.list();
  const original=await catalog.read(entry.id,{resource:'reference.md',expectedVersion:entry.version});
  const pinned={resource:'reference.md',expectedVersion:entry.version,expectedResourceVersion:original.version};
  assert.deepEqual(await catalog.read(entry.id,pinned),original);
  await fs.writeFile(path.join(root,'review/reference.md'),'Corrected method');
  assert.equal((await catalog.list())[0].version,entry.version);
  await assert.rejects(catalog.read(entry.id,pinned),{statusCode:409});
  const current=await catalog.read(entry.id,{resource:'reference.md',expectedVersion:entry.version});
  assert.equal(current.text,'Corrected method');assert.notEqual(current.version,original.version);
  assert.deepEqual(await catalog.read(entry.id,{...pinned,expectedResourceVersion:current.version}),current);
  assert.equal((await catalog.read(entry.id,{expectedResourceVersion:entry.version})).version,entry.version);
  await assert.rejects(catalog.read(entry.id,{expectedResourceVersion:current.version}),{statusCode:409});
  await fs.writeFile(path.join(root,'review/SKILL.md'),'# Changed entry');
  await assert.rejects(catalog.read(entry.id,{...pinned,expectedResourceVersion:current.version}),{statusCode:409});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
