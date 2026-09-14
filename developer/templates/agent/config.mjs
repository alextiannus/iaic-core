import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const job=JSON.parse(await fs.readFile(new URL('./job.json',import.meta.url),'utf8'));
export const skillRoot=fileURLToPath(new URL('./skills',import.meta.url));
const sourceHash=createHash('sha256');
const manifest=JSON.parse(await fs.readFile(new URL('./package.json',import.meta.url),'utf8'));
const archive=/^file:(vendor\/core-[a-f0-9]{64}\.tgz)$/.exec(manifest.dependencies?.['@immedi/iaic-core'])?.[1];
if(!archive)throw new Error('Agent starter requires its content-addressed vendor Core dependency');
for(const name of ['app.mjs','config.mjs','server.mjs','http.mjs','job.json','package.json',archive,...job.configuration.skills.map(p=>'skills/'+p)]){sourceHash.update(name);sourceHash.update(await fs.readFile(new URL(name,import.meta.url)));}
export const sourceRevision=sourceHash.digest('hex');
export function optionsFromEnvironment(env=process.env){
 if(!env.IAIC_MODEL||!env.APP_SUBJECT||!env.APP_ORGANIZATION)throw new Error('Set IAIC_MODEL, APP_SUBJECT and APP_ORGANIZATION');
 return {job,skillRoot,version:sourceRevision,profiles:[{id:'system',provider:env.IAIC_PROVIDER||'openai',model:env.IAIC_MODEL,baseUrl:env.IAIC_MODEL_BASE_URL||'',credentialRef:'system-key'}],resolveSecret:()=>env.AI_API_KEY,
 // These rates are platform-issued allowance units, not currency or raw LLM tokens.
 tokenPolicies:{system:{maximum:100000,price:{revision:'starter-units-v1',input:1,cachedInput:1,output:1}}},
 authorize:actor=>actor.subjectId===env.APP_SUBJECT&&actor.scopeId===env.APP_ORGANIZATION,
 // Minimal artifact/trace validation only. Add independent domain outcome checks here.
 verifyOutcome:async(input,result,{history})=>result.artifacts.length>0&&history.calls.some(c=>c.status==='succeeded'&&c.capability==='my_write_workspace')};
}
