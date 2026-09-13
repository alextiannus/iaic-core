import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileObjectStore,ObjectStorage,createObjectCapabilities,CapabilityDispatcher} from '@immedi/iaic-core';
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-objects-example-'));
try{
 const storage=new ObjectStorage({store:new FileObjectStore({directory}),resolveScope:a=>JSON.stringify(['example',a.subjectId]),authorize:a=>a.subjectId==='owner'});
 const dispatcher=new CapabilityDispatcher({capabilities:createObjectCapabilities({storage})}),actor={subjectId:'owner'},bytes=Buffer.from([0,255,13,10]);
 const ref=await dispatcher.invoke('objects.put',{base64:bytes.toString('base64')},{actor,callId:'binary-object'});
 assert.deepEqual(Buffer.from((await dispatcher.invoke('objects.get',ref,{actor})).base64,'base64'),bytes);
 await dispatcher.invoke('objects.remove',ref,{actor,callId:'delete-object'});
 await assert.rejects(dispatcher.invoke('objects.get',ref,{actor}),{statusCode:404});
 console.log(JSON.stringify({example:'core-objects',status:'passed',binaryRoundTrip:true,scopedReferences:true,deletedReferenceUnavailable:true}));
}finally{await fs.rm(directory,{recursive:true,force:true});}
