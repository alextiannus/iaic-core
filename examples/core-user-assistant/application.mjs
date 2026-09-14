import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {openApplication} from '@immedi/iaic-core/developer/templates/agent/app.mjs';
import {createApplicationHttpHandler} from '@immedi/iaic-core/developer/templates/agent/http.mjs';
import {createDeclarationAdapter} from './declarations.mjs';
import {describeCompanion} from './persona.mjs';
export const tools=['assistant.skills.list','assistant.skills.read','my_list_assistant_memories','my_read_assistant_memory','my_remember_assistant_memory','my_forget_assistant_memory','my_write_workspace','my_read_workspace','tasks.plan.read','tasks.plan.update','declarations.contract','declarations.submit','declarations.get'];
export async function openUserAssistant({pool,authorize,authorizeSubmission,payloadSchema,profile,resolveSecret,tokenPolicy,modelFactory,persona,resolveActor}){
 const declarations=await createDeclarationAdapter({pool,authorize,authorizeSubmission,payloadSchema});
 const skillRoot=fileURLToPath(new URL('./skills/',import.meta.url));
 const job={id:'user-assistant-demo',role:'user-assistant',purpose:describeCompanion(persona)+' Help the user prepare and submit their own Declaration with application-defined fields. Discover the declaration Skill, use private memory/workspace, clarify missing fields, and verify original receipts.',capabilities:['agent.work'],configuration:{skills:['declarations/SKILL.md'],knowledge:[],tools}};
 const revision=createHash('sha256');for(const file of ['application.mjs','declarations.mjs','persona.mjs','skills/declarations/SKILL.md'])revision.update(await fs.readFile(new URL(file,import.meta.url)));revision.update(JSON.stringify({job,payloadSchema,profile}));
 const app=await openApplication({pool,job,skillRoot,version:'user-assistant-'+revision.digest('hex'),profiles:[profile],resolveSecret,tokenPolicies:{[profile.id]:tokenPolicy},modelFactory,authorize,enablePlans:true,extraCapabilities:declarations.capabilities,runtimeLimits:{maxTurns:20,maxCalls:16},
  verifyOutcome:async(_input,result,{actor,history})=>{
   const receipts=history.calls.filter(c=>c.capability==='declarations.get'&&c.status==='succeeded'&&c.result?.status==='recorded');
   for(const c of receipts){const row=await declarations.lookup(actor,c.input.requestKey);if(row&&isDeepStrictEqual(row.receipt,(({status,...receipt})=>receipt)(c.result)))return true;}
   return false;
  }});
 return {...app,job,declarations,http:resolveActor?createApplicationHttpHandler({app,job,resolveActor}):null};
}
