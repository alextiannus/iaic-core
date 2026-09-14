import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import {Pool} from 'pg';
import {openUserAssistant} from './application.mjs';
const env=process.env;
for(const key of ['DATABASE_URL','APP_TOKEN','APP_SUBJECT','APP_ORGANIZATION','IAIC_MODEL','AI_API_KEY','DECLARATION_SCHEMA_PATH'])if(!env[key])throw Error('Missing '+key);
const actor={scopeId:env.APP_ORGANIZATION,subjectId:env.APP_SUBJECT};
const authorize=a=>a.scopeId===actor.scopeId&&a.subjectId===actor.subjectId;
const pool=new Pool({connectionString:env.DATABASE_URL});
const app=await openUserAssistant({pool,authorize,
 // This local demo's operator explicitly enables the user's declaration mandate.
 authorizeSubmission:a=>authorize(a)&&env.ALLOW_DECLARATION_SUBMIT==='true',
 payloadSchema:JSON.parse(await fs.readFile(env.DECLARATION_SCHEMA_PATH,'utf8')),
 profile:{id:'system',provider:env.IAIC_PROVIDER||'openai',model:env.IAIC_MODEL,baseUrl:env.IAIC_MODEL_BASE_URL||'',credentialRef:'system-key'},resolveSecret:()=>env.AI_API_KEY,
 tokenPolicy:{maximum:100000,price:{revision:'demo-platform-units-v1',input:1,cachedInput:1,output:1}},
 resolveActor:request=>request.headers.get('authorization')==='Bearer '+env.APP_TOKEN?actor:null});
if(env.DEMO_ALLOWANCE_UNITS){
 if(!env.DEMO_ALLOWANCE_REFERENCE||!Number.isSafeInteger(Number(env.DEMO_ALLOWANCE_UNITS))||Number(env.DEMO_ALLOWANCE_UNITS)<=0)throw Error('Explicit positive allowance and stable grant reference required');
 await app.ledger.grant(await app.scope(actor),{reference:env.DEMO_ALLOWANCE_REFERENCE,amount:Number(env.DEMO_ALLOWANCE_UNITS),evidence:{source:'explicit-demo-operator-grant'}});
}
const server=createServer(async(req,res)=>{try{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1048576){res.writeHead(413).end();return;}chunks.push(chunk);}const method=req.method||'GET';const response=await app.http(new Request('http://localhost'+req.url,{method,headers:req.headers,signal:AbortSignal.timeout(30000),...(!['GET','HEAD'].includes(method)?{body:Buffer.concat(chunks)}:{})}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500).end();}});
app.start();server.listen(Number(env.PORT||3012),'127.0.0.1',()=>console.log('User Assistant demo listening on loopback; host-configured model and declaration schema active.'));
let closing=false;async function close(){if(closing)return;closing=true;await app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await pool.end();}
process.once('SIGINT',close);process.once('SIGTERM',close);
