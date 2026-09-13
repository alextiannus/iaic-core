#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {CapabilityHttpClient} from '../http/client.js';
import {scaffoldCapabilityApp} from './scaffold.js';
import {scaffoldAgentApp} from './agent-scaffold.js';
import {migratePostgres} from './migrations.js';
const help=`iaic list --url URL
iaic call CAPABILITY --url URL --input FILE [--request-key KEY]
iaic init DIRECTORY --core-package ARCHIVE [--template capability|agent]
iaic migrate --config MODULE
Credentials: IAIC_BEARER_TOKEN environment variable. Output: JSON. No automatic write retries.
Migration MODULE exports open(): {pool,namespace,migrations,close?}; it is trusted local code.`;
export async function runCli(args,{env=process.env}={}){
 if(!args.length||['help','--help'].includes(args[0]))return {help};
 const [command,...rest]=args,options={},positionals=[];
 for(let i=0;i<rest.length;i++){const arg=rest[i];if(arg.startsWith('--')){if(Object.hasOwn(options,arg)||i+1>=rest.length||rest[i+1].startsWith('--'))throw new Error('Invalid or duplicate option '+arg);options[arg]=rest[++i];}else positionals.push(arg);}
 const allowed={list:['--url'],call:['--url','--input','--request-key'],init:['--core-package','--template'],migrate:['--config']}[command];
 if(!allowed||Object.keys(options).some(k=>!allowed.includes(k))||positionals.length!==(['call','init'].includes(command)?1:0))throw new Error('Invalid command arguments; use iaic help');
 if(command==='init'){if(!options['--core-package'])throw new Error('--core-package is required');const template=options['--template']||'capability';if(!['capability','agent'].includes(template))throw new Error('Unknown template');return (template==='agent'?scaffoldAgentApp:scaffoldCapabilityApp)({directory:positionals[0],corePackage:options['--core-package']});}
 if(command==='migrate'){
  if(!options['--config'])throw new Error('--config is required');const module=await import(pathToFileURL(path.resolve(options['--config'])).href);if(typeof module.open!=='function')throw new Error('Migration config must export open()');
  const config=await module.open();try{return await migratePostgres(config);}finally{if(config.close)await config.close();else await config.pool.end();}
 }
 if(!options['--url'])throw new Error('--url is required');const client=new CapabilityHttpClient({url:options['--url'],headers:()=>env.IAIC_BEARER_TOKEN?{authorization:'Bearer '+env.IAIC_BEARER_TOKEN}:{}}),signal=AbortSignal.timeout(30000);
 if(command==='list')return {capabilities:await client.list({signal})};
 if(!options['--input'])throw new Error('--input JSON file is required');const input=JSON.parse(await fs.readFile(options['--input'],'utf8'));
 return client.invoke(positionals[0],input,{signal,requestKey:options['--request-key']});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(await fs.realpath(process.argv[1])).href){
 try{process.stdout.write(JSON.stringify(await runCli(process.argv.slice(2)))+'\n');}
 catch(error){process.stderr.write(JSON.stringify({error:error.message,...(error.statusCode?{statusCode:error.statusCode}:{}),...(error.outcomeUnknown?{outcomeUnknown:true,requestKey:error.requestKey,recovery:'Query or reconcile before retrying with the same request key'}:{})})+'\n');process.exitCode=1;}
}
