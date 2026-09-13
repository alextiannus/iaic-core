import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DockerDeployment} from '@immedi/iaic-core';
const exec=promisify(execFile),namespace='deployment-example-'+randomUUID(),requestKey='revision-one';
const image='node@sha256:8094c002d08262dba12645a3b4a15cd6cd627d30bc782f53229a2ec13ee22a00';
const command=['node','--input-type=module','-e',`import {createServer} from 'node:http';import {randomUUID} from 'node:crypto';const instance=randomUUID();createServer((req,res)=>{if(req.url==='/health'){res.end('ready');return;}if(req.headers.authorization!=='Bearer '+process.env.APP_TOKEN){res.writeHead(403);res.end();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({instance,revision:process.env.APP_REVISION}));}).listen(3000,'0.0.0.0');`];
const environment=()=>({APP_TOKEN:'fixture-private-only',APP_REVISION:'one'}),config={namespace,image,command,containerPort:3000,environment};
const adapter=new DockerDeployment(config),directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-deploy-'));
const moduleFile=path.join(directory,'deployment.mjs'),cli=fileURLToPath(import.meta.resolve('@immedi/iaic-core/developer/cli.js'));
await fs.writeFile(moduleFile,`import {DockerDeployment} from ${JSON.stringify(import.meta.resolve('@immedi/iaic-core'))};export async function open(){return {adapter:new DockerDeployment(${JSON.stringify({...config,environment:undefined}).replace(/}$/,',environment:()=>({APP_TOKEN:process.env.DEPLOY_TEST_TOKEN,APP_REVISION:"one"})}')})};}`);
const invoke=async command=>JSON.parse((await exec(process.execPath,[cli,command,'--config',moduleFile,'--request-key',requestKey],{env:{...process.env,DEPLOY_TEST_TOKEN:'fixture-private-only'},timeout:60000})).stdout);
try{
 assert.equal((await adapter.inspect(requestKey)).status,'absent');
 const deployed=await invoke('deploy');assert.ok(deployed.containerId);assert.ok(!JSON.stringify(deployed).includes('fixture-private-only'));
 let ready;const deadline=Date.now()+10000;
 do{ready=await adapter.inspect(requestKey);if(ready.status==='ready')break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
 assert.equal(ready.status,'ready');assert.equal((await fetch(ready.endpoint)).status,403);
 const read=async()=>{const r=await fetch(ready.endpoint,{headers:{authorization:'Bearer fixture-private-only'}});assert.equal(r.status,200);return r.json();};
 const first=await read();assert.equal(first.revision,'one');
 const rebuilt=new DockerDeployment(config);assert.equal((await rebuilt.deploy(requestKey)).containerId,ready.containerId);assert.deepEqual(await read(),first);
 assert.equal((await invoke('deployment-status')).containerId,ready.containerId);
 await assert.rejects(new DockerDeployment({...config,environment:()=>({...environment(),APP_REVISION:'two'})}).deploy(requestKey),/environment changed/);
 await assert.rejects(new DockerDeployment({...config,healthPath:'/other'}).inspect(requestKey),/another configuration/);
 // Lost acknowledgement after Docker has started: inspect, never start a second process.
 const secondKey='lost-response',second=new DockerDeployment(config),run=second.run.bind(second);let lost=false;
 second.run=async(args,opts)=>{const r=await run(args,opts);if(args[0]==='start'&&!lost){lost=true;return {ok:false};}return r;};
 try{await assert.rejects(second.deploy(secondKey),{outcomeUnknown:true,requestKey:secondKey});const recovered=await rebuilt.inspect(secondKey);assert.ok(recovered.containerId);assert.equal((await rebuilt.deploy(secondKey)).containerId,recovered.containerId);}finally{await exec('docker',['rm','-f',second.name(secondKey)]).catch(()=>{});}
 assert.equal((await invoke('deployment-stop')).status,'stopped');assert.equal((await rebuilt.deploy(requestKey)).status,'stopped');
 console.log(JSON.stringify({example:'core-deployment',status:'passed',realDocker:true,cliProcessSeparation:true,stableContainer:true,unknownStartReconciled:true,secretValuesNotInReceipts:true}));
}finally{await exec('docker',['rm','-f',adapter.name(requestKey)]).catch(()=>{});await fs.rm(directory,{recursive:true,force:true});}
