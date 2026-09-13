import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=path.dirname(fileURLToPath(import.meta.resolve('@immedi/iaic-core'))),temp=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-developer-'));
const npm=process.env.npm_execpath;if(!npm)throw new Error('Run this example through npm test or package verification');
const run=(args,cwd)=>{const r=spawnSync(process.execPath,args,{cwd,env:process.env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stderr||r.stdout||String(r.error));return r.stdout;};
try{
 const packed=JSON.parse(run([npm,'pack','--json','--pack-destination',temp],root))[0],archive=path.join(temp,packed.filename),target=path.join(temp,'app');
 const cli=path.join(root,'developer/cli.js');run([cli,'init',target,'--core-package',archive],root);
 run([npm,'install','--ignore-scripts','--no-audit','--no-fund'],target);
 // Invoke the installed npm bin symlink as well as the generated application.
 assert.match(run([path.join(target,'node_modules/.bin/iaic'),'help'],target),/iaic migrate/);
 run([npm,'test'],target);
 const duplicate=spawnSync(process.execPath,[cli,'init',target,'--core-package',archive],{encoding:'utf8'});assert.equal(duplicate.status,1);assert.ok(await fs.stat(path.join(target,'app.mjs')));
 const agentTarget=path.join(temp,'agent-app');run([cli,'init',agentTarget,'--core-package',archive,'--template','agent'],root);run([npm,'install','--ignore-scripts','--no-audit','--no-fund'],agentTarget);run([npm,'test'],agentTarget);
 console.log(JSON.stringify({example:'core-developer',status:'passed',generatedAppInstalled:true,installedBin:true,sharedCapabilityTest:true,existingDirectoryPreserved:true,persistentAgentTemplate:true,separateWorkerProcess:true,allowancePauseAndResume:true}));
}finally{await fs.rm(temp,{recursive:true,force:true});}
