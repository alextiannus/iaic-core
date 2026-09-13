import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {Pool} from 'pg';
import {DockerDeployment,PostgresDeploymentActivations,RecoverableDockerDeployment} from '@immedi/iaic-core';
const exec=promisify(execFile);
async function fixture(fn){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
 const schema='deployment_recovery_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString,options:`-c search_path=${schema}`}),namespace='fixture-'+randomUUID(),requestKey='one';
 const config={namespace,image:'node@sha256:8094c002d08262dba12645a3b4a15cd6cd627d30bc782f53229a2ec13ee22a00',command:['node','-e',"require('http').createServer((req,res)=>res.end('ready')).listen(3000,'0.0.0.0')"],containerPort:3000};
 const deployment=new DockerDeployment(config),activations=new PostgresDeploymentActivations({pool,namespace});await activations.initialize();
 const adapter=new RecoverableDockerDeployment({deployment,activations});
 async function interrupt(mode){
  const source=`import {Pool} from ${JSON.stringify(import.meta.resolve('pg'))};
import {DockerDeployment,PostgresDeploymentActivations,RecoverableDockerDeployment} from ${JSON.stringify(import.meta.resolve('@immedi/iaic-core'))};
const pool=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL,options:${JSON.stringify('-c search_path='+schema)}});
const deployment=new DockerDeployment(${JSON.stringify(config)}),activations=new PostgresDeploymentActivations({pool,namespace:${JSON.stringify(namespace)}});
await activations.initialize();
if(${JSON.stringify(mode)}==='prepare'){await deployment.prepare('one');process.send({checkpoint:'prepared'});await new Promise(()=>{});}
else {const original=deployment.run.bind(deployment);deployment.run=async(args,options)=>{if(args[0]==='start'){process.send({checkpoint:'admitted'});await new Promise(()=>{});}return original(args,options);};await new RecoverableDockerDeployment({deployment,activations}).deploy('one');}`;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','ignore','pipe','ipc']});let stderr='',timer;
  child.stderr.on('data',c=>{stderr+=c;});
  const exited=once(child,'exit');
  try{
   const message=await Promise.race([once(child,'message').then(([m])=>m),exited.then(()=>{throw new Error('Worker exited before checkpoint: '+stderr);}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Worker checkpoint timeout')),20000);})]);
   assert.equal(message.checkpoint,mode==='prepare'?'prepared':'admitted');child.kill('SIGKILL');const [code,signal]=await exited;assert.equal(code,null);assert.equal(signal,'SIGKILL');
  }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
 }
 try{await fn({pool,deployment,activations,adapter,requestKey,interrupt});}
 finally{await exec('docker',['rm','-f',deployment.name(requestKey)]).catch(()=>{});await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Prepared deployment survives actual process kill and concurrent recovery admits one original start',async()=>fixture(async f=>{
 await f.interrupt('prepare');const prepared=await f.adapter.inspect(f.requestKey);assert.equal(prepared.status,'prepared');assert.equal(prepared.activation,null);
 const results=await Promise.all([f.adapter.deploy(f.requestKey),f.adapter.deploy(f.requestKey)]);assert.ok(results.every(r=>r.containerId===prepared.containerId));
 let ready;for(let i=0;i<30;i++){ready=await f.adapter.inspect(f.requestKey);if(ready.status==='ready')break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(ready.status,'ready');assert.equal(ready.requiresReconciliation,false);assert.equal((await f.pool.query('SELECT * FROM iaic_deployment_activations')).rowCount,1);
 const startedAt=(await f.deployment.raw(f.requestKey)).State.StartedAt;
 assert.equal((await f.adapter.deploy(f.requestKey)).containerId,prepared.containerId);assert.equal((await f.deployment.raw(f.requestKey)).State.StartedAt,startedAt);
 assert.equal((await f.adapter.stop(f.requestKey)).status,'stopped');assert.equal((await f.adapter.deploy(f.requestKey)).status,'stopped');
}));
test('Process kill after durable start admission retains uncertainty and never sends another start',async()=>fixture(async f=>{
 await f.interrupt('admit');const original=await f.adapter.inspect(f.requestKey);assert.equal(original.status,'prepared');assert.equal(original.requiresReconciliation,true);
 let starts=0;const run=f.deployment.run.bind(f.deployment);f.deployment.run=(args,options)=>{if(args[0]==='start')starts++;return run(args,options);};
 const result=await f.adapter.deploy(f.requestKey);assert.equal(result.status,'prepared');assert.equal(result.requiresReconciliation,true);assert.equal(starts,0);
 assert.equal((await f.deployment.raw(f.requestKey)).State.Running,false);
 // Removing the original cannot turn this consumed request into another instance.
 await exec('docker',['rm',f.deployment.name(f.requestKey)]);
 const missing=await f.adapter.deploy(f.requestKey);assert.equal(missing.status,'absent');assert.equal(missing.requiresReconciliation,true);assert.equal(starts,0);
}));
test('Lost start acknowledgement is recovered from the same container without restarting it',async()=>fixture(async f=>{
 const run=f.deployment.run.bind(f.deployment);let starts=0;
 f.deployment.run=async(args,options)=>{const r=await run(args,options);if(args[0]==='start'){starts++;return {ok:false};}return r;};
 await assert.rejects(f.adapter.deploy(f.requestKey),{outcomeUnknown:true});
 const before=await f.deployment.raw(f.requestKey);assert.equal(before.State.Running,true);
 const result=await f.adapter.deploy(f.requestKey);assert.equal(result.containerId,before.Id);assert.equal(starts,1);assert.equal((await f.deployment.raw(f.requestKey)).State.StartedAt,before.State.StartedAt);
}));
