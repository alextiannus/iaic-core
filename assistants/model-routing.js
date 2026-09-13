const fail=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode,providerNotCalled:true});
// Routing happens before Task creation. Each returned gateway keeps the actual
// profile identity and its own metering; no next() error triggers another model.
export class AssistantModelRouting {
 constructor({models,resolvePolicy,availability}) {
  if(typeof models?.snapshot!=='function'||typeof models?.resolve!=='function'||typeof models?.target!=='function'||typeof resolvePolicy!=='function'||typeof availability!=='function')throw fail('Model routing requires model, current policy and availability ports',400);
  Object.assign(this,{models,resolvePolicy,availability});
 }
 async state(actor,agent) {
  const policy=await this.resolvePolicy({actor,agent});
  if(!policy||typeof policy.revision!=='string'||!policy.revision.trim()||policy.revision.length>200||!Array.isArray(policy.profileIds)||!policy.profileIds.length||policy.profileIds.length>16||policy.profileIds.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(policy.profileIds).size!==policy.profileIds.length)throw fail('Current model routing policy is unavailable',403);
  const ids=[...policy.profileIds],revision=policy.revision;
  const snapshot=await this.models.snapshot(actor);
  return {ids,revision,snapshot};
 }
 async resolve({actor,agent=null,modelIdentity=null}) {
  const state=await this.state(actor,agent),{snapshot,ids}=state;
  let profile;
  if(modelIdentity!==null) {
   profile=snapshot.profiles.find(p=>p.modelIdentity===modelIdentity);
   if(!profile||!ids.includes(profile.id))throw fail('Original task model is unavailable or no longer authorized',403);
  } else {
   // Policy cannot silently replace the user's selected model with a new primary.
   if(ids[0]!==snapshot.selectedProfile)throw fail('Routing policy must start with the selected model');
   const primary=snapshot.profiles.find(p=>p.id===ids[0]);
   if(!primary)throw fail('Selected model is unavailable');
   for(const id of ids) {
    const candidate=snapshot.profiles.find(p=>p.id===id);
    if(!candidate||candidate.credentialMode!==primary.credentialMode)throw fail('Route cannot change credential mode or use an unavailable profile');
   }
   for(const id of ids) {
    const candidate=snapshot.profiles.find(p=>p.id===id);
    const status=await this.availability({actor,agent,profile:candidate});
    if(status==='available'){profile=candidate;break;}
    if(status!=='unavailable')throw fail('Model availability is unknown',503);
   }
   if(!profile)throw fail('No configured route is currently available',503);
  }
  const identity=profile.modelIdentity,id=profile.id,mode=profile.credentialMode;
  const gateway=modelIdentity===null?await this.models.target(actor,id):await this.models.resolve({actor,modelIdentity});
  if(gateway.name!==identity)throw fail('Model profile changed during routing');
  const check=async()=>{
   const current=await this.state(actor,agent);
   const present=current.snapshot.profiles.find(p=>p.id===id&&p.modelIdentity===identity&&p.credentialMode===mode);
   if(!present||!current.ids.includes(id))throw fail('Selected route is no longer authorized',403);
  };
  await check();
  return Object.freeze({...gateway,routing:Object.freeze({policyRevision:state.revision,profileId:id,modelIdentity:identity}),next:async request=>{
   request.signal?.throwIfAborted();
   await check();
   request.signal?.throwIfAborted();
   return gateway.next(request);
  }});
 }
}
