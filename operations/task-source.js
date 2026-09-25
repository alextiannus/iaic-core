// Uses the Task owner's summary port; no second Task state or history store.
export async function readAgentTaskSources({tasks,actor,instanceId,configuredProfileRef=null,provider=null,clock=()=>Date.now()}){
 const page=await tasks.agentSummary(actor,instanceId),at=clock();
 const ref=id=>({source:'TaskStore',id,revision:null});
 const envelope=items=>({items,complete:page.complete,observedAt:new Date(at).toISOString(),validUntil:new Date(at+10000).toISOString(),reference:ref(instanceId)});
 return {
  tasks:envelope(page.items.map(t=>({id:t.id,status:t.status,waitingReason:t.waiting_reason??null,resultState:t.unknown_result?'unknown':['succeeded','failed','cancelled'].includes(t.status)?'known':'pending',reference:ref(t.id)}))),
  interactions:envelope(page.items.map(t=>({id:t.id,type:'request',from:actor.subjectId,to:instanceId,taskId:t.id,stage:t.status==='running'?'running':['succeeded','failed','cancelled'].includes(t.status)?'result-recorded':'admitted',basis:'observed',reference:ref(t.id)}))),
  models:envelope(page.items.map(t=>({taskId:t.id,configuredProfileRef,boundModel:t.model==='host-model-resolver'?null:t.model,requestedModel:t.requested_model??null,actualModel:null,provider,basis:'observed',reference:ref(t.id)})))
 };
}
