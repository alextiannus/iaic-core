import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createServer} from 'node:http';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),cli=fileURLToPath(new URL('../developer/cli.js',import.meta.url));
test('CLI uses the shared HTTP request envelope and preserves request keys and credentials',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-cli-')),input=path.join(directory,'input.json');await fs.writeFile(input,JSON.stringify({value:42}));let seen;
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;seen={authorization:req.headers.authorization,path:req.url,body:JSON.parse(body)};res.setHeader('content-type','application/json');res.end(JSON.stringify({resultKind:'capability-result',result:seen.body.input}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const {stdout}=await exec(process.execPath,[cli,'call','fixture.write','--url',`http://127.0.0.1:${server.address().port}/capabilities`,'--input',input,'--request-key','stable'],{env:{...process.env,IAIC_BEARER_TOKEN:'fixture'},timeout:10000});assert.deepEqual(JSON.parse(stdout).result,{value:42});assert.deepEqual(seen,{authorization:'Bearer fixture',path:'/capabilities/fixture.write',body:{input:{value:42},requestKey:'stable'}});
 await assert.rejects(exec(process.execPath,[cli,'call','fixture.write','--unknown','value']),e=>e.code===1);
 }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});}
});
