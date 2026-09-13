import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileObjectStore,ObjectStorage,createObjectCapabilities,CapabilityDispatcher,ReleaseResources} from '@immedi/iaic-core';
async function fixture(run){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-objects-'));try{await run(directory);}finally{await fs.rm(directory,{recursive:true,force:true});}}
test('Object bytes are immutable by reference, scoped and removable across store reconstruction',async()=>fixture(async directory=>{
 const store=new FileObjectStore({directory}),bytes=Buffer.from([0,255,42,13]);
 const ref=await store.put('owner',bytes);assert.deepEqual(await store.put('owner',bytes),ref);
 assert.deepEqual(await new FileObjectStore({directory}).get('owner',ref),bytes);
 await assert.rejects(store.get('other',ref),{statusCode:404});
 await fs.writeFile(store.location('owner',ref),Buffer.from([1,255,42,13]));
 await assert.rejects(store.get('owner',ref),{statusCode:409});
 await assert.rejects(store.put('owner',bytes),{statusCode:409});
 await store.remove('owner',ref);await assert.rejects(store.get('owner',ref),{statusCode:404});
}));
test('Object Capability transfer uses current authorization and canonical base64',async()=>fixture(async directory=>{
 let allowed=true;const storage=new ObjectStorage({store:new FileObjectStore({directory}),resolveScope:actor=>actor.subjectId,authorize:()=>allowed});
 const dispatcher=new CapabilityDispatcher({capabilities:createObjectCapabilities({storage,maxTransferBytes:10})}),actor={subjectId:'owner'};
 const ref=await dispatcher.invoke('objects.put',{base64:'AP8='},{actor,callId:'put'});
 assert.equal((await dispatcher.invoke('objects.get',ref,{actor})).base64,'AP8=');
 await assert.rejects(dispatcher.invoke('objects.put',{base64:'not base64'},{actor,callId:'invalid'}),{statusCode:400});
 allowed=false;await assert.rejects(dispatcher.invoke('objects.get',ref,{actor}),{statusCode:403});
}));
test('Release resources enforce content references, safe paths and current binding with cleanup',async()=>fixture(async parentDirectory=>{
 const store=new FileObjectStore({directory:path.join(parentDirectory,'objects')}),bytes=Buffer.from('pinned prompt'),ref=await store.put('owner',bytes);
 const manifest={resources:[{path:'prompts/main.txt',...ref,reference:ref}]};let enabled=true,reads=0;
 const releases={check:async()=>{if(!enabled)throw Object.assign(new Error('Stopped'),{statusCode:409});return manifest;}};
 const loader=new ReleaseResources({releases,readResource:async(_actor,reference)=>{reads++;return store.get('owner',reference);}});
 const binding={releaseId:'v1',manifestDigest:'fixture'},result=await loader.materialize({},binding,{parentDirectory});
 assert.equal(await fs.readFile(path.join(result.directory,'prompts/main.txt'),'utf8'),'pinned prompt');
 manifest.resources[0].path='../escape';await assert.rejects(loader.materialize({},binding,{parentDirectory}),/Invalid relative/);assert.equal(reads,1);
 manifest.resources[0].path='prompts/main.txt';manifest.resources[0].sha256='0'.repeat(64);
 const before=(await fs.readdir(parentDirectory)).sort();await assert.rejects(loader.materialize({},binding,{parentDirectory}),{statusCode:409});assert.deepEqual((await fs.readdir(parentDirectory)).sort(),before);
 manifest.resources[0].sha256=ref.sha256;
 const stoppedDuringRead=new ReleaseResources({releases,readResource:async()=>{enabled=false;return bytes;}});
 await assert.rejects(stoppedDuringRead.materialize({},binding,{parentDirectory}),{statusCode:409});assert.deepEqual((await fs.readdir(parentDirectory)).sort(),before);
}));
