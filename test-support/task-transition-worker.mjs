import {Pool} from 'pg';
import {AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
const {schema,id,actor}=JSON.parse(process.env.IAIC_TRANSITION_WORKER);
const pool=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL,options:`-c search_path=${schema}`});
const cap=defineCapability({name:'work.run',description:'Transition fixture',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Fixture',tools:[],verify:()=>true}}),dispatcher=new CapabilityDispatcher({capabilities:[cap]});
const runtime=new AgentRuntime({store:new TaskStore({pool}),dispatcher,model:{name:'fixture',next:()=>{throw new Error('No model expected');}},context:new ContextAssembler({skillRoot:'/tmp'}),version:'v1'});dispatcher.tasks=runtime;await runtime.initialize();
await runtime.transition(actor,id,{action:'provide_input',input:'original clarification',requestKey:'original-request'});
// The parent sees a test barrier, not a response to the submitting client.
process.send({committed:true});setInterval(()=>{},1000);
