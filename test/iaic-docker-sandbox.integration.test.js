import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DockerSandbox} from '@immedi/iaic-core';
const image='node@sha256:8094c002d08262dba12645a3b4a15cd6cd627d30bc782f53229a2ec13ee22a00';
async function fixture(script,run){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-sandbox-test-'));try{await fs.writeFile(path.join(directory,'main.mjs'),script,{mode:0o600});await run(directory);}finally{await fs.rm(directory,{recursive:true,force:true});}}
const sandbox=options=>new DockerSandbox({image,command:['node','/work/main.mjs'],...options});
test('Docker executes as non-root with readonly inputs, no host environment and isolated network',async()=>fixture(`import fs from 'node:fs';import os from 'node:os';let readonly=false;try{fs.writeFileSync('/work/changed','no');}catch{readonly=true;}console.log(JSON.stringify({value:JSON.parse(fs.readFileSync(0,'utf8')).value*2,uid:process.getuid(),readonly,interfaces:Object.keys(os.networkInterfaces()),hostSecret:process.env.IAIC_SANDBOX_FIXTURE_SECRET??null}));`,async directory=>{
 process.env.IAIC_SANDBOX_FIXTURE_SECRET='fixture-not-a-real-secret';
 try{const result=await sandbox().execute({directory,stdin:JSON.stringify({value:21})});assert.equal(result.status,'succeeded',result.stderr);assert.equal(result.cleanupConfirmed,true);const output=JSON.parse(result.stdout);assert.equal(output.value,42);assert.notEqual(output.uid,0);assert.equal(output.readonly,true);assert.deepEqual(output.interfaces,['lo']);assert.equal(output.hostSecret,null);await assert.rejects(fs.access(path.join(directory,'changed')));}
 finally{delete process.env.IAIC_SANDBOX_FIXTURE_SECRET;}
}));
test('Sandbox timeout and output limits stop execution and confirm container cleanup',async()=>{
 await fixture(`console.log('started');setInterval(()=>{},1000);`,async directory=>{const result=await sandbox({timeoutMs:3000}).execute({directory});assert.equal(result.status,'timed_out');assert.equal(result.cleanupConfirmed,true);assert.match(result.stdout,/started/);});
 await fixture(`process.stdout.write('x'.repeat(200000));`,async directory=>{const result=await sandbox({maxOutputBytes:256}).execute({directory});assert.equal(result.status,'output_limit');assert.equal(result.cleanupConfirmed,true);assert.ok(Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr)<=256);});
});
test('Sandbox cancellation and nonzero exit remain distinct from successful execution',async()=>{
 await fixture(`process.exit(7);`,async directory=>{const result=await sandbox().execute({directory});assert.equal(result.status,'failed');assert.equal(result.exitCode,7);assert.equal(result.cleanupConfirmed,true);});
 await fixture(`console.log('running');setInterval(()=>{},1000);`,async directory=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),1500);try{const result=await sandbox().execute({directory,signal:controller.signal});assert.equal(result.status,'cancelled');assert.match(result.stdout,/running/);assert.equal(result.cleanupConfirmed,true);}finally{clearTimeout(timer);}});
 await fixture(`setInterval(()=>{},1000);`,async directory=>{const controller=new AbortController();controller.abort();const result=await sandbox().execute({directory,signal:controller.signal});assert.equal(result.status,'cancelled');assert.equal(result.cleanupConfirmed,true);});
});
