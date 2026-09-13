import fs from 'node:fs/promises';import path from 'node:path';import {scaffoldCapabilityApp} from './scaffold.js';
export async function scaffoldAgentApp(options){
 const result=await scaffoldCapabilityApp(options),target=result.directory;
 try{await fs.cp(new URL('./templates/agent/',import.meta.url),target,{recursive:true});const manifest=JSON.parse(await fs.readFile(path.join(target,'package.json'),'utf8'));manifest.name='iaic-agent-app';manifest.dependencies.pg='8.23.0';manifest.scripts={start:'node server.mjs',test:'node --test app.test.mjs',grant:'node grant.mjs'};await fs.writeFile(path.join(target,'package.json'),JSON.stringify(manifest,null,2)+'\n');return {directory:target,template:'agent',files:await fs.readdir(target)};}
 catch(error){error.createdDirectory=target;throw error;}
}
