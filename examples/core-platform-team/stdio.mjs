import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createCapabilityMcpServer} from '@immedi/iaic-core/mcp/server.js';
import {openPlatformTeam} from './application.mjs';

const env=process.env;
for(const key of ['DATABASE_URL','IAIC_MODEL','IAIC_MODEL_API_KEY'])if(!env[key])throw new Error('Set '+key);
const applicationId=env.PLATFORM_APPLICATION_ID||'iaic-platform',teamId=env.PLATFORM_TEAM_ID||'core';
const native={scopeId:applicationId,subjectId:env.PLATFORM_NATIVE_ID||'native-platform'};
const external={scopeId:applicationId,subjectId:env.PLATFORM_EXTERNAL_ID||'external-platform'};
if(native.subjectId===external.subjectId)throw new Error('Native and external identities must differ');
const revision=createHash('sha256');
for(const name of ['application.mjs','stdio.mjs'])revision.update(await fs.readFile(new URL(name,import.meta.url)));
const pool=new Pool({connectionString:env.DATABASE_URL});let app,server,closing=false;
async function close(){if(closing)return;closing=true;await server?.close();await app?.close();await pool.end();}
try{
 app=await openPlatformTeam({pool,applicationId,teamId,builtinActor:native,authorizeMember:actor=>actor.scopeId===applicationId&&[native.subjectId,external.subjectId].includes(actor.subjectId),profile:{id:'system',provider:env.IAIC_PROVIDER||(env.IAIC_MODEL_BASE_URL?'chat-completions':'openai'),model:env.IAIC_MODEL,baseUrl:env.IAIC_MODEL_BASE_URL||'',credentialRef:'system',invocation:{maxCompletionTokens:8192,parallelToolCalls:true}},resolveSecret:()=>env.IAIC_MODEL_API_KEY,tokenPolicy:{maximum:100000,price:{revision:'platform-host-units-v1',input:1,cachedInput:1,output:1}},version:revision.digest('hex'),skillRoot:fileURLToPath(new URL('./',import.meta.url)),
  // Minimal output/work checks only. Domain-specific outcomes use the factory's verifier port.
  verifyOutcome:async(_input,_result,{history})=>history.calls.some(call=>call.status==='succeeded')
 });
 if(env.PLATFORM_GRANT_ID||env.PLATFORM_GRANT_UNITS){
  const amount=Number(env.PLATFORM_GRANT_UNITS);
  if(!env.PLATFORM_GRANT_ID||!Number.isSafeInteger(amount)||amount<1)throw new Error('Supply a deliberate PLATFORM_GRANT_ID and positive PLATFORM_GRANT_UNITS');
  await app.ledger.grant(app.budgetScope,{reference:env.PLATFORM_GRANT_ID,amount,evidence:{purpose:'Operator-issued platform development allowance'}});
 }
 server=createCapabilityMcpServer({dispatcher:app.dispatcher,resolveAccess:async()=>({actor:external,capabilities:[...app.dispatcher.capabilities.keys()]})});
 server.onclose=()=>{void close();};
 process.once('SIGINT',()=>{void close();});process.once('SIGTERM',()=>{void close();});
 await server.connect(new StdioServerTransport());app.start();
 console.error('Platform Team MCP ready; native work uses the system model and platform allowance.');
}catch(error){await close();throw error;}
