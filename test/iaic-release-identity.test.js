import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {scaffoldCapabilityApp} from '../developer/scaffold.js';
import {CORE_RELEASE} from '@immedi/iaic-core';
import {CORE_RELEASE as subpath} from '@immedi/iaic-core/releases/identity.js';
test('runtime identity comes from package metadata and root/subpath agree',async()=>{
 const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.deepEqual(CORE_RELEASE,{name:pkg.name,version:pkg.version,tag:'v'+pkg.version});assert.equal(subpath,CORE_RELEASE);assert.ok(Object.isFrozen(CORE_RELEASE));
});
test('scaffolds give changed archive bytes different immutable dependency paths',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-vendor-'));
 try {
  const archive=path.join(directory,'download.tgz'),paths=[];
  for(const [index,content] of ['previous archive fixture','current archive fixture'].entries()){
   await fs.writeFile(archive,content);const target=path.join(directory,'app-'+index);
   const generated=await scaffoldCapabilityApp({directory:target,corePackage:archive});
   const pkg=JSON.parse(await fs.readFile(path.join(target,'package.json'),'utf8')),dependency=pkg.dependencies['@immedi/iaic-core'];paths.push(dependency);
   const expected='vendor/core-'+createHash('sha256').update(content).digest('hex')+'.tgz';
   assert.equal(dependency,'file:'+expected);assert.ok(generated.files.includes(expected));assert.equal(await fs.readFile(path.join(target,expected),'utf8'),content);
  }
  assert.notEqual(paths[0],paths[1]);
 } finally {await fs.rm(directory,{recursive:true,force:true});}
});
