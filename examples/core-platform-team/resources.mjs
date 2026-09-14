import {MemoryStore,AssistantMemory,AssistantWorkspace,SkillCatalog,createAgentTaskCapabilities,defineCapability} from '@immedi/iaic-core';

// Native resources reuse Core services; shared team artifacts stay in the host.
export async function openNativeResources({pool,documents,applicationId,definitionId,native,authorize,skillRoot,skillEntries}){
 const resolveScope=async actor=>{await authorize(actor);return {applicationId,assistantId:definitionId,subjectId:'native:'+native.subjectId};};
 const sourceFor=actor=>({kind:'platform-agent-note',author:JSON.stringify([actor.scopeId,actor.subjectId])});
 const store=new MemoryStore({pool});await store.initialize();
 const memory=new AssistantMemory({store,resolveScope,sourceFor});
 const workspace=new AssistantWorkspace({store:documents,resolveScope,sourceFor});
 const skills=new SkillCatalog({root:skillRoot,entries:skillEntries,selectEntries:async({actor})=>{await authorize(actor);return skillEntries;}});
 await skills.list({actor:native});
 const capabilities=createAgentTaskCapabilities({name:'platform.self.work',toolNamespace:'platform.self',memory,workspace,skillCatalog:skills,authorize,verifyOutcome:async()=>false})
  .filter(capability=>capability.implementation.kind==='function')
  .map(capability=>capability.name==='platform.self.my_remember_assistant_memory'?defineCapability({...capability,description:'Record a durable note for your own Platform Agent work. Preserve uncertainty and source evidence; inferred claims are not user preferences, authority or verified system facts. Use the current revision when updating.'}):capability);
 return {memory,workspace,skills,capabilities};
}
