import fs from 'node:fs/promises';
import path from 'node:path';
export async function scaffoldCapabilityApp({directory,corePackage}){
 const target=path.resolve(directory),archive=path.resolve(corePackage);
 if(!(await fs.stat(archive)).isFile())throw new Error('Core package archive required');
 await fs.mkdir(target); // Existing directories are never overwritten.
 try{
  await fs.mkdir(path.join(target,'vendor'));await fs.copyFile(archive,path.join(target,'vendor/core.tgz'));
  await fs.writeFile(path.join(target,'package.json'),JSON.stringify({name:'iaic-capability-app',version:'0.1.0',private:true,type:'module',scripts:{start:'node app.mjs',test:'node --test app.test.mjs'},dependencies:{'@immedi/iaic-core':'file:vendor/core.tgz'}},null,2)+'\n');
  await fs.writeFile(path.join(target,'app.mjs'),`import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {CapabilityDispatcher,defineCapability,createCapabilityHttpHandler} from '@immedi/iaic-core';
export const dispatcher=new CapabilityDispatcher({capabilities:[defineCapability({name:'greeting.read',description:'Return a greeting',input:{type:'string'},output:{type:'string'},effect:'read',authorize:actor=>actor.subjectId==='local-developer',implementation:{kind:'function',execute:name=>'Hello '+name}})]});
export function createHandler(token){if(!token)throw new Error('Set APP_TOKEN');return createCapabilityHttpHandler({dispatcher,resolveAccess:request=>request.headers.get('authorization')==='Bearer '+token?{actor:{subjectId:'local-developer'},capabilities:['greeting.read']}:null});}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const handler=createHandler(process.env.APP_TOKEN);
 const server=createServer(async(req,res)=>{try{let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>1048576){res.writeHead(413).end();return;}parts.push(chunk);}const method=req.method||'GET';const response=await handler(new Request('http://localhost'+req.url,{method,headers:req.headers,signal:AbortSignal.timeout(30000),...(!['GET','HEAD'].includes(method)?{body:Buffer.concat(parts)}:{})}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500).end();}});
 server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('Capability server listening locally'));
}
`);
  await fs.writeFile(path.join(target,'app.test.mjs'),`import test from 'node:test';import assert from 'node:assert/strict';import {createHandler} from './app.mjs';
test('Shared capability returns a greeting and denies anonymous callers',async()=>{const handler=createHandler('fixture');const request=token=>new Request('http://localhost/capabilities/greeting.read',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({input:'developer'})});assert.equal((await (await handler(request('fixture'))).json()).result,'Hello developer');assert.equal((await handler(request('wrong'))).status,403);});
`);
  await fs.writeFile(path.join(target,'.gitignore'),'node_modules/\n.env\n');
  await fs.writeFile(path.join(target,'README.md'),'# Core capability starter\n\nRun `npm install --ignore-scripts`, `npm test`, then set APP_TOKEN and run `npm start`. The included archive pins the Core source candidate. This local-only server demonstrates a shared Capability, not a complete AI Native Application. Replace the local identity mapping with your application authentication; add existing Core Agent/Task/Session/Memory/Skill/model modules as required. No UI or business domain is imposed.\n');
  return {directory:target,files:['package.json','app.mjs','app.test.mjs','README.md','.gitignore','vendor/core.tgz']};
 }catch(error){error.createdDirectory=target;throw error;}
}
