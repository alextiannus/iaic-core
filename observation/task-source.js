// Ports retain ownership: Task history belongs to Tasks, usage to the allowance ledger.
export function createTaskObservationSource({tasks,ledger,resolveContext,resolveRelease}){
 if(typeof tasks?.get!=='function'||typeof tasks?.history!=='function'||typeof ledger?.taskUsage!=='function'||typeof resolveContext!=='function'||typeof resolveRelease!=='function')throw new Error('Task observation source requires owner, task, usage and pinned-release ports');
 return async(sourceId,request)=>{
  const context=await resolveContext(sourceId,request);if(!context)return null;
  const task=await tasks.get(context.actor,context.taskId);if(!['succeeded','failed'].includes(task.status))return null;
  const usage=await ledger.taskUsage(context.billingScope,task.id);if(!usage.complete)return null;
  const release=await resolveRelease(task,{...request,actor:context.actor});if(!release)return null;
  const history=await tasks.history(context.actor,task.id);
  if(usage.requests==='0'&&history.events.some(e=>e.kind==='model_requested'))return null;
  const measured=history.events.filter(e=>e.kind==='model_usage'&&e.data?.usage!=null).length;if(BigInt(usage.requests)<BigInt(measured))return null;
  const observedAt=new Date(task.updated_at).toISOString(),durationMs=Date.parse(observedAt)-new Date(task.created_at).getTime();
  return {sourceId,sourceScope:request.sourceScope,confirmed:true,record:{releaseId:release.releaseId,manifestDigest:release.manifestDigest,observedAt,success:task.status==='succeeded',durationMs,toolErrors:history.calls.filter(c=>['failed','unknown'].includes(c.status)).length,providerTokens:usage.providerTokens,platformUnits:usage.platformUnits}};
 };
}
