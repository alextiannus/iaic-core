import test from 'node:test';import assert from 'node:assert/strict';import {createAgentTaskCapabilities} from '@immedi/iaic-core/assistants/tasks.js';import {allowsScheduledTask} from '@immedi/iaic-core/deferred/capability.js';
test('Scheduling is explicit, nonrecursive and preserves parent source and authorization constraints',()=>{
 const definitions=createAgentTaskCapabilities({memory:{},workspace:{},deferred:{},authorize:async()=>true,verifyOutcome:async()=>true});const agent=definitions.find(c=>c.name==='assistant.run'),schedule=definitions.find(c=>c.name==='assistant.schedule');
 const task={goal:'Later work',allowedTools:['my_read_workspace']},action={name:'assistant.schedule',input:{dueAt:'2026-10-01T00:00:00Z',task}};
 assert.equal(agent.implementation.allowCall({goal:'Schedule'},action),false);assert.equal(agent.implementation.allowCall({goal:'Schedule',allowedTools:['assistant.schedule','my_read_workspace']},action),true);
 assert.equal(agent.implementation.allowCall({goal:'Schedule',allowedTools:['assistant.schedule']},action),false);
 assert.equal(agent.implementation.allowCall({goal:'Schedule',allowedTools:['assistant.schedule','my_read_workspace']},action,{task:{handoff:{id:'bounded'}}}),false);
 assert.equal(schedule.validateInput(action.input),true);assert.equal(schedule.validateInput({...action.input,task:{...task,allowedTools:['assistant.schedule']}}),false);
 for(const field of ['sourceEventKey','sourceTaskId','session','mandate']){const value=field==='session'?{id:'session',throughSequence:1}:field==='mandate'?{id:'grant'}:'source';const parent={[field]:value};assert.equal(allowsScheduledTask(parent,task,task.allowedTools),false);assert.equal(allowsScheduledTask(parent,{...task,[field]:value},task.allowedTools),true);}
 assert.equal(allowsScheduledTask({}, {...task,delegation:{}},task.allowedTools),false);
});
