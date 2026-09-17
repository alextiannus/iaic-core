import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),npm=process.env.npm_execpath;if(!npm)throw Error('Use npm run verify:types-package');
const run=(args,cwd)=>{const r=spawnSync(process.execPath,args,{cwd,env:process.env,encoding:'utf8',timeout:180000});if(r.status!==0)throw Error(r.stderr||r.stdout||String(r.error));return r.stdout;};
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-types-'));
try{
 const packed=JSON.parse(run([npm,'pack','--json','--pack-destination',temp],root))[0];
 const consumer=path.join(temp,'consumer');await fs.mkdir(consumer);await fs.writeFile(path.join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
 run([npm,'install','--ignore-scripts','--no-audit','--no-fund',path.join(temp,packed.filename),'typescript@5.9.3','@larksuiteoapi/node-sdk@1.74.0','pg@8.23.0','@types/pg@8.15.5','@modelcontextprotocol/sdk@1.30.0'],consumer);
 const installed=await fs.realpath(path.join(consumer,'node_modules/@immedi/iaic-core'));if(!installed.startsWith((await fs.realpath(consumer))+path.sep))throw Error('Source link instead of installed package');
 await fs.copyFile(path.join(root,'examples/core-types-consumer/consumer.mts'),path.join(consumer,'consumer.mts'));
 await fs.copyFile(path.join(root,'examples/core-types-consumer/starter.mts'),path.join(consumer,'starter.mts'));
 await fs.copyFile(path.join(root,'examples/core-types-consumer/http-results.mts'),path.join(consumer,'http-results.mts'));
 await fs.copyFile(path.join(root,'examples/core-types-consumer/mcp-server.mts'),path.join(consumer,'mcp-server.mts'));
 // Declarations must also resolve after the CLI copies the starter outside Core.
 for(const name of ['app.mjs','app.d.mts'])await fs.copyFile(path.join(installed,'developer/templates/agent',name),path.join(consumer,name));
 await fs.writeFile(path.join(consumer,'copied.mts'),"import {openApplication} from './app.mjs'; import type {ApplicationOptions} from './app.mjs'; export const open = (options:ApplicationOptions) => openApplication(options);\n");
 run([path.join(consumer,'node_modules/typescript/bin/tsc'),'--strict','--noEmitOnError','--target','es2022','--lib','es2022,dom','--module','nodenext','--moduleResolution','nodenext','--outDir','built','consumer.mts','starter.mts','copied.mts','http-results.mts'],consumer);
 // Check every declaration; tolerate only the two independently reproduced SDK
 // 1.30.0 TS2420 defects, never errors in Core or in the application consumer.
 const exact=[path.join(consumer,'node_modules/typescript/bin/tsc'),'--strict','--exactOptionalPropertyTypes','--target','es2022','--module','nodenext','--moduleResolution','nodenext'];
 const checked=spawnSync(process.execPath,[...exact,'--noEmit','mcp-server.mts'],{cwd:consumer,encoding:'utf8',timeout:180000});
 const diagnostics=(checked.stdout??'').split('\n').filter(line=>line.includes(': error TS'));
 const upstream=['client','server'].map(side=>`node_modules/@modelcontextprotocol/sdk/dist/esm/${side}/streamableHttp.d.ts`);
 if(checked.status!==2||diagnostics.length!==2||!upstream.every(file=>diagnostics.some(line=>line.startsWith(file+'(')&&line.includes('error TS2420:'))))throw Error(checked.stdout||checked.stderr||String(checked.error));
 console.log(JSON.stringify({upstreamSdkExactOptionalDefects:diagnostics,coreAndConsumerDiagnostics:0}));
 // Emission excludes library checking only after the complete diagnostic gate.
 run([...exact,'--skipLibCheck','--noEmitOnError','--outDir','built','mcp-server.mts'],consumer);
 process.stdout.write(run(['built/consumer.mjs'],consumer));
 process.stdout.write(run(['built/starter.mjs'],consumer));
 process.stdout.write(run(['built/http-results.mjs'],consumer));
 process.stdout.write(run(['built/mcp-server.mjs'],consumer));
 console.log(JSON.stringify({strictTypes:true,mcpExactOptionalLibraryCheck:"two-known-upstream-diagnostics",independentTarball:true,ambientShim:false,emittedProgramExecuted:true}));
}finally{await fs.rm(temp,{recursive:true,force:true});}
