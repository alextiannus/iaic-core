import {createCapabilityHttpHandler} from '@immedi/iaic-core';

// Application-owned exposure, derived from the controls actually registered by
// openApplication. Capability authorization and Task ownership remain current.
export function createApplicationHttpHandler({app,job,resolveActor}){
 return createCapabilityHttpHandler({dispatcher:app.dispatcher,resolveAccess:async request=>{
  const actor=await resolveActor(request);if(!actor)return null;
  const capabilities=[...app.dispatcher.capabilities.keys()].filter(name=>name==='agent.work'||name.startsWith('tasks.')||job.configuration.tools.includes(name));
  return {actor,capabilities};
 }});
}
