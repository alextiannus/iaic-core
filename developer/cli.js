#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {CapabilityHttpClient} from '../http/client.js';
import {scaffoldCapabilityApp} from './scaffold.js';
import {scaffoldAgentApp} from './agent-scaffold.js';
import {migratePostgres} from './migrations.js';
import {EvaluationRunner} from '../evaluation/runner.js';
const help=`iaic list --url URL
iaic call CAPABILITY --url URL --input FILE [--request-key KEY]
iaic init DIRECTORY --core-package ARCHIVE [--template capability|agent]
iaic evaluate --config MODULE
iaic migrate --config MODULE
iaic deploy|deployment-status|deployment-stop --config MODULE --request-key KEY
Credentials: IAIC_BEARER_TOKEN environment variable. Output: JSON. No automatic write retries.
Evaluation MODULE exports open(): {execute,grade,settings,store,onRecord?,close?}; trusted local code.
Migration MODULE exports open(): {pool,namespace,migrations,close?}; it is trusted local code.`;
export async function runCli(args,{env=process.env}={}){
 if(!args.length||['help','--help'].includes(args[0]))return {help};
 const [command,...rest]=args,options={},positionals=[];
 for(let i=0;i<rest.length;i++){const arg=rest[i];if(arg.startsWith('--')){if(Object.hasOwn(options,arg)||i+1>=rest.length||rest[i+1].startsWith('--'))throw new Error('Invalid or duplicate option '+arg);options[arg]=rest[++i];}else positionals.push(arg);}
 const allowed={list:['--url'],call:['--url','--input','--request-key'],init:['--core-package','--template'],migrate:['--config'],evaluate:['--config'],deploy:['--config','--request-key'],'deployment-status':['--config','--request-key'],'deployment-stop':['--config','--request-key']}[command];
 if(!allowed||Object.keys(options).some(k=>!allowed.includes(k))||positionals.length!==(['call','init'].includes(command)?1:0))throw new Error('Invalid command arguments; use iaic help');
 if(command==='init'){if(!options['--core-package'])throw new Error('--core-package is required');const template=options['--template']||'capability';if(!['capability','agent'].includes(template))throw new Error('Unknown template');return (template==='agent'?scaffoldAgentApp:scaffoldCapabilityApp)({directory:positionals[0],corePackage:options['--core-package']});}
 if(command==='evaluate'){
  if(!options['--config'])throw new Error('--config is required');
  const module=await import(pathToFileURL(path.resolve(options['--config'])).href);
  if(typeof module.open!=='function')throw new Error('Evaluation config must export open()');
  const config=await module.open();let evaluation;
  try{
   if(typeof config?.store?.put!=='function')throw new Error('Evaluation config requires an evidence store');
   const runner=new EvaluationRunner({execute:config.execute,grade:config.grade,onRecord:config.onRecord});
   evaluation=await runner.run(config.settings);
   const evidence=await config.store.put(evaluation);
   return {status:'recorded',evaluationId:evaluation.id,evidence,records:{planned:evaluation.expectedRecords,recorded:evaluation.records.length,failed:evaluation.records.filter(record=>record.status!=='graded'||!record.passed).length}};
  }catch(error){if(evaluation)error.evaluationId=evaluation.id;throw error;}
  finally{try{await config?.close?.();}catch(error){if(evaluation)error.evaluationId=evaluation.id;throw error;}}
 }
 if(command==='migrate'){
  if(!options['--config'])throw new Error('--config is required');const module=await import(pathToFileURL(path.resolve(options['--config'])).href);if(typeof module.open!=='function')throw new Error('Migration config must export open()');
  const config=await module.open();try{return await migratePostgres(config);}finally{if(config.close)await config.close();else await config.pool.end();}
 }
 if(['deploy','deployment-status','deployment-stop'].includes(command)){
  if(!options['--config']||!options['--request-key'])throw new Error('--config and --request-key are required');
  const module=await import(pathToFileURL(path.resolve(options['--config'])).href);if(typeof module.open!=='function')throw new Error('Deployment config must export open()');
  const config=await module.open();try{const method={deploy:'deploy','deployment-status':'inspect','deployment-stop':'stop'}[command];if(typeof config.adapter?.[method]!=='function')throw new Error('Deployment adapter method required');return await config.adapter[method](options['--request-key']);}finally{await config.close?.();}
 }
 if(!options['--url'])throw new Error('--url is required');const client=new CapabilityHttpClient({url:options['--url'],headers:()=>env.IAIC_BEARER_TOKEN?{authorization:'Bearer '+env.IAIC_BEARER_TOKEN}:{}}),signal=AbortSignal.timeout(30000);
 if(command==='list')return {capabilities:await client.list({signal})};
 if(!options['--input'])throw new Error('--input JSON file is required');const input=JSON.parse(await fs.readFile(options['--input'],'utf8'));
 return client.invoke(positionals[0],input,{signal,requestKey:options['--request-key']});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(await fs.realpath(process.argv[1])).href){
 try{process.stdout.write(JSON.stringify(await runCli(process.argv.slice(2)))+'\n');}
 catch(error){process.stderr.write(JSON.stringify({error:error.message,...(error.statusCode?{statusCode:error.statusCode}:{}),...(error.outcomeUnknown?{outcomeUnknown:true,requestKey:error.requestKey,recovery:'Query or reconcile before retrying with the same request key'}:{}),...(error.evaluationId?{evaluationId:error.evaluationId,recovery:'Inspect retained evaluation evidence before another run; no automatic evaluation retry or resume is supplied'}:{})})+'\n');process.exitCode=1;}
}
