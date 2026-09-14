import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createServer} from 'node:http';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),cli=fileURLToPath(new URL('../developer/cli.js',import.meta.url));
test('CLI uses the shared HTTP request envelope and preserves request keys and credentials',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-cli-')),input=path.join(directory,'input.json');await fs.writeFile(input,JSON.stringify({value:42}));let seen;
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;seen={authorization:req.headers.authorization,path:req.url,body:JSON.parse(body)};res.setHeader('content-type','application/json');res.end(JSON.stringify({resultKind:'capability-result',result:seen.body.input}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const {stdout}=await exec(process.execPath,[cli,'call','fixture.write','--url',`http://127.0.0.1:${server.address().port}/capabilities`,'--input',input,'--request-key','stable'],{env:{...process.env,IAIC_BEARER_TOKEN:'fixture'},timeout:10000});assert.deepEqual(JSON.parse(stdout).result,{value:42});assert.deepEqual(seen,{authorization:'Bearer fixture',path:'/capabilities/fixture.write',body:{input:{value:42},requestKey:'stable'}});
 await assert.rejects(exec(process.execPath,[cli,'call','fixture.write','--unknown','value']),e=>e.code===1);
 }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});}
});

test('Evaluation CLI records failed outcomes with the existing runner and closes the host resource',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-eval-cli-'));
 const core=new URL('../index.js',import.meta.url).href;
 try{
  const config=path.join(directory,'evaluation.mjs');
  await fs.writeFile(config,`import fs from 'node:fs/promises';import {FileEvaluationStore} from ${JSON.stringify(core)};
export async function open(){return {store:new FileEvaluationStore({directory:new URL('./evidence',import.meta.url).pathname}),settings:{dataset:[{id:'case',category:'fixture',input:{value:2},expected:4}],revision:'candidate',graderRevision:'grader-1',environmentRevision:'fixture-1'},execute:async({input})=>({result:input.value}),grade:({testCase,observation})=>({passed:observation.result===testCase.expected,score:0,checks:[{name:'outcome',passed:false}]}),onRecord:async({runId,record})=>fs.appendFile(new URL('./records.jsonl',import.meta.url),JSON.stringify({runId,record})+'\\n'),close:()=>fs.writeFile(new URL('./closed',import.meta.url),'closed')};}`);
  const {stdout}=await exec(process.execPath,[cli,'evaluate','--config',config],{timeout:10000});const result=JSON.parse(stdout);
  assert.equal(result.status,'recorded');assert.deepEqual(result.records,{planned:1,recorded:1,failed:1});assert.equal(result.evaluationId,result.evidence.id);
  const stored=JSON.parse(await fs.readFile(result.evidence.path,'utf8'));assert.equal(stored.run.id,result.evaluationId);assert.equal(stored.run.records[0].passed,false);assert.equal(stored.run.records[0].observation.result,2);
  assert.equal(await fs.readFile(path.join(directory,'closed'),'utf8'),'closed');assert.equal(JSON.parse(await fs.readFile(path.join(directory,'records.jsonl'),'utf8')).runId,result.evaluationId);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('Evaluation CLI preserves the original evaluation ID on evidence write failure without rerunning',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-eval-failure-'));
 try{
  const config=path.join(directory,'evaluation.mjs');
  await fs.writeFile(config,`import fs from 'node:fs/promises';export async function open(){return {store:{put:async()=>{throw Object.assign(new Error('fixture evidence sink unavailable'),{outcomeUnknown:true});}},settings:{dataset:[{id:'case',category:'fixture',input:{}}],revision:'candidate',graderRevision:'grader',environmentRevision:'fixture'},execute:async()=>{await fs.appendFile(new URL('./calls',import.meta.url),'call\\n');return {};},grade:()=>({passed:true,score:1,checks:[]}),onRecord:({runId})=>fs.writeFile(new URL('./run-id',import.meta.url),runId),close:()=>fs.writeFile(new URL('./closed',import.meta.url),'closed')};}`);
  let failure;
  await assert.rejects(exec(process.execPath,[cli,'evaluate','--config',config],{timeout:10000}),error=>{assert.equal(error.code,1);failure=JSON.parse(error.stderr);assert.match(failure.error,/evidence sink/);assert.equal(failure.outcomeUnknown,true);assert.match(failure.recovery,/no automatic evaluation retry/);return true;});
  // Inspect one process invocation only; never rerun evaluation to recover evidence.
  const runId=await fs.readFile(path.join(directory,'run-id'),'utf8');assert.match(runId,/^[a-f0-9-]{36}$/);assert.equal(failure.evaluationId,runId);
  assert.equal(await fs.readFile(path.join(directory,'calls'),'utf8'),'call\n');assert.equal(await fs.readFile(path.join(directory,'closed'),'utf8'),'closed');
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
