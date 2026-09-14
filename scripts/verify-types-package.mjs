import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),npm=process.env.npm_execpath;if(!npm)throw Error('Use npm run verify:types-package');
const run=(args,cwd)=>{const r=spawnSync(process.execPath,args,{cwd,env:process.env,encoding:'utf8',timeout:180000});if(r.status!==0)throw Error(r.stderr||r.stdout||String(r.error));return r.stdout;};
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-types-'));
try{
 const packed=JSON.parse(run([npm,'pack','--json','--pack-destination',temp],root))[0];
 const consumer=path.join(temp,'consumer');await fs.mkdir(consumer);await fs.writeFile(path.join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
 run([npm,'install','--ignore-scripts','--no-audit','--no-fund',path.join(temp,packed.filename),'typescript@5.9.3'],consumer);
 const installed=await fs.realpath(path.join(consumer,'node_modules/@immedi/iaic-core'));if(!installed.startsWith((await fs.realpath(consumer))+path.sep))throw Error('Source link instead of installed package');
 await fs.copyFile(path.join(root,'examples/core-types-consumer/consumer.mts'),path.join(consumer,'consumer.mts'));
 run([path.join(consumer,'node_modules/typescript/bin/tsc'),'--strict','--noEmitOnError','--target','es2022','--lib','es2022,dom','--module','nodenext','--moduleResolution','nodenext','--outDir','built','consumer.mts'],consumer);
 process.stdout.write(run(['built/consumer.mjs'],consumer));
 console.log(JSON.stringify({strictTypes:true,independentTarball:true,ambientShim:false,emittedProgramExecuted:true}));
}finally{await fs.rm(temp,{recursive:true,force:true});}
