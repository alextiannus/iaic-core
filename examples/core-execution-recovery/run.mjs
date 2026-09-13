import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {PostgresExecutionJournal,RecoverableDockerSandbox} from '@immedi/iaic-core';
const exec=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;
if(!connectionString)throw new Error('Isolated PostgreSQL required');
const schema='execution_example_'+randomUUID().replaceAll('-',''),directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-execution-'));
const image='node@sha256:8094c002d08262dba12645a3b4a15cd6cd627d30bc782f53229a2ec13ee22a00';
const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`}),journal=new PostgresExecutionJournal({pool,namespace:'fixture'});
const sandbox=new RecoverableDockerSandbox({journal,image,command:['node','/work/main.mjs'],timeoutMs:30000});
const children=[];
async function interrupted(code,timeoutMs=30000){
 await fs.writeFile(path.join(directory,'main.mjs'),code);
 const child=spawn(process.execPath,[fileURLToPath(new URL('./worker.mjs',import.meta.url))],{detached:true,stdio:['ignore','ignore','pipe'],env:{...process.env,RECOVERY_SCHEMA:schema,RECOVERY_DIRECTORY:directory,RECOVERY_IMAGE:image,RECOVERY_TIMEOUT:String(timeoutMs)}});children.push(child);
 let error='';child.stderr.on('data',b=>{error+=b;});
 const deadline=Date.now()+15000;let receipt;
 while(Date.now()<deadline){
  if(child.exitCode!==null)throw new Error('Worker ended before interruption: '+error);
  const entries=await journal.pending();
  for(const e of entries){try{const {stdout}=await exec('docker',['inspect',e.id],{timeout:5000});if(JSON.parse(stdout)[0].State.Running){receipt=e;break;}}catch{}}
  if(receipt)break;await pause(100);
 }
 assert.ok(receipt,'Live container receipt must be visible before killing host');
 const exited=once(child,'exit');process.kill(-child.pid,'SIGKILL');await exited;
 return receipt;
}
try{
 await journal.initialize();
 await fs.writeFile(path.join(directory,'main.mjs'),"console.log('normal');");
 const normal=await sandbox.execute({directory});assert.equal(normal.status,'succeeded');assert.equal((await journal.get(normal.containerName)).result.stdout.trim(),'normal');
 // Kill the actual worker and Docker CLI while the container still runs.
 const first=await interrupted("setTimeout(()=>console.log('recovered-once'),3000);");
 const rebuilt=new RecoverableDockerSandbox({journal:new PostgresExecutionJournal({pool,namespace:'fixture'}),image,command:['node','/work/main.mjs']});
 let result;const deadline=Date.now()+15000;
 do{result=await rebuilt.reconcile(first.id);if(result.result)break;assert.equal(result.observation.status,'running');await pause(200);}while(Date.now()<deadline);
 assert.equal(result.result.status,'succeeded');assert.equal(result.result.stdout.trim(),'recovered-once');assert.equal(result.result.cleanupConfirmed,true);
 assert.deepEqual(await rebuilt.reconcile(first.id),result);
 const second=await interrupted("setTimeout(()=>console.log('should-not-finish'),25000);");
 const stopped=await rebuilt.reconcile(second.id,{stop:true});assert.equal(stopped.result.status,'cancelled');assert.equal(stopped.result.cleanupConfirmed,true);
 const expired=await interrupted("setTimeout(()=>console.log('too-late'),25000);",2000);
 await pause(2100);const timedOut=await rebuilt.reconcile(expired.id);assert.equal(timedOut.result.status,'timed_out');assert.equal(timedOut.result.cleanupConfirmed,true);
 const missing={containerName:'iaic-sandbox-'+randomUUID(),image,directory,startedAt:new Date().toISOString(),timeoutMs:30000};
 await journal.started(missing);const unknown=await rebuilt.reconcile(missing.containerName);assert.equal(unknown.result.status,'unknown');assert.equal(unknown.result.cleanupConfirmed,false);
 assert.equal((await journal.pending()).length,1);
 console.log(JSON.stringify({example:'core-execution-recovery',actualWorkerSigkill:true,originalContainerResultRecovered:true,cancelledSurvivor:true,expiredSurvivorStopped:true,missingContainerRemainsUnknown:true}));
}finally{
 for(const child of children)if(child.exitCode===null&&child.signalCode===null)try{process.kill(-child.pid,'SIGKILL');}catch{}
 try{for(const entry of await journal.pending())await exec('docker',['rm','-f',entry.id],{timeout:10000}).catch(()=>{});}catch{}
 await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(directory,{recursive:true,force:true});
}
