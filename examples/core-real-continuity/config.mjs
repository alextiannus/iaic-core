import {fileURLToPath} from 'node:url';
export const actor={subjectId:'continuity-user',scopeId:'synthetic-continuity'};
const memoryUpdate=process.env.IAIC_CONTINUITY_MEMORY_UPDATE==='1';
export const tools=['assistant.skills.list','assistant.skills.read','my_search_knowledge','my_read_knowledge','my_read_assistant_memory','my_list_assistant_memories','my_write_workspace','my_read_workspace','my_read_assistant_session',...(memoryUpdate?['my_remember_assistant_memory']:[])];
export const options={skillRoot:fileURLToPath(new URL('./skills/',import.meta.url)),version:process.env.IAIC_SOURCE_REVISION,
 job:{id:'continuity',purpose:'Produce verified working artifacts for the user after the conversation ends.',capabilities:['agent.work'],configuration:{skills:['source-summary/SKILL.md'],knowledge:['working-guide'],tools}},
 profiles:[{id:'system',model:process.env.IAIC_MODEL,provider:process.env.IAIC_PROVIDER||'chat-completions',baseUrl:process.env.IAIC_MODEL_BASE_URL,credentialRef:'host'}],resolveSecret:()=>process.env.IAIC_MODEL_API_KEY,
 tokenPolicies:{system:{maximum:100000,price:{revision:'fixture-allowance-v1',input:1,cachedInput:1,output:1}}},
 runtimeLimits:{maxTurns:memoryUpdate?20:12,maxCalls:memoryUpdate?30:12,maxBatchCalls:4,modelTimeoutMs:60000,taskTimeoutMs:300000},
 authorize:a=>a.subjectId===actor.subjectId&&a.scopeId===actor.scopeId,
 verifyOutcome:async(_i,r,{history})=>r.artifacts.length===1&&history.calls.some(c=>c.capability==='my_read_workspace'&&c.status==='succeeded')};

if(process.env.IAIC_CONTINUITY_FIXTURE==='1'){const {fixtureFactory}=await import('./fixture-model.mjs');options.modelFactory=fixtureFactory;}
