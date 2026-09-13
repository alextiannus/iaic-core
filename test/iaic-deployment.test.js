import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
// Isolated CLI-like process: an unresolved provider promise has no event-loop handle.
// Readiness must return a bounded non-ready receipt, not exit with unresolved TLA (13).
test('Deployment probe completes in a separate process even when its transport never settles',async()=>{
 const source=`import {DockerDeployment} from ${JSON.stringify(import.meta.resolve('@immedi/iaic-core'))};
 globalThis.fetch=()=>new Promise(()=>{});
 const d=new DockerDeployment({namespace:'fixture',image:'sha256:'+'a'.repeat(64),command:['node','app.mjs'],containerPort:3000});
 d.raw=async()=>({Id:'fixture',State:{Running:true},NetworkSettings:{Ports:{'3000/tcp':[{HostIp:'127.0.0.1',HostPort:'4000'}]}}});
 console.log(JSON.stringify(await d.inspect('fixture')));`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',source],{timeout:5000});
 const receipt=JSON.parse(stdout);assert.equal(receipt.status,'starting');assert.equal(receipt.ready,false);assert.equal(receipt.containerId,'fixture');
});
