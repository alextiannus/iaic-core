import {Pool} from 'pg';import {TaskStore} from '../tasks/store.js';import {AgentRuntime} from '../agent/runtime.js';import {TokenLedger} from '../billing/token-ledger.js';import {meteredModel} from '../billing/metered-model.js';import {defineCapability,CapabilityDispatcher} from '../capabilities/index.js';import {ContextAssembler} from '../context/index.js';
const pool=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL,options:`-c search_path=${process.env.IAIC_TEST_SCHEMA}`});
const actor={scopeId:'fixture',subjectId:'owner'},scope={applicationId:'fixture',subjectId:'owner'},ledger=new TokenLedger({pool});await ledger.initialize();await ledger.grant(scope,{reference:'fixture',amount:100,evidence:{fixture:true}});
const cap=defineCapability({name:'agent.work',description:'Fixture',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Test',tools:[],verify:()=>true}});
const dispatcher=new CapabilityDispatcher({capabilities:[cap]}),store=new TaskStore({pool});
const model=meteredModel({model:{name:'fixture',next:async request=>{process.send({kind:'accepted',taskId:request.billingContext.taskId});return new Promise(()=>{});}},ledger,scope,policy:{maximum:20,price:{revision:'v1',input:1,output:1,cachedInput:1}}});
const runtime=new AgentRuntime({store,dispatcher,model,context:new ContextAssembler({skillRoot:'/tmp'}),version:'v1'});dispatcher.tasks=runtime;await runtime.initialize();
process.once('SIGTERM',async()=>{const state=await runtime.drain({timeoutMs:20});process.send({kind:'drain',...state},()=>process.exit(state.requiresTermination?0:1));});
await dispatcher.invoke('agent.work',{}, {actor,callId:'original'});await runtime.tick();
