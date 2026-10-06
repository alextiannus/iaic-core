import {createHash} from 'node:crypto';

const fail=(code,statusCode=409)=>Object.assign(new Error(code),{code,statusCode});
const clone=value=>structuredClone(value);
const label=value=>typeof value==='string'&&value.trim().length>0&&value.length<=500;
function canonical(value,depth=0){
 if(depth>20)throw fail('ACCESS_PROFILE_INVALID',400);
 if(value===null||typeof value==='boolean'||typeof value==='string'||(typeof value==='number'&&Number.isFinite(value)))return value;
 if(Array.isArray(value))return Array.from(value,v=>canonical(v,depth+1));
 if(value&&[Object.prototype,null].includes(Object.getPrototypeOf(value)))return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k],depth+1)]));
 throw fail('ACCESS_PROFILE_INVALID',400);
}
function digest(value){
 const json=JSON.stringify(canonical(value));
 if(Buffer.byteLength(json)>1048576)throw fail('ACCESS_PROFILE_INVALID',400);
 return createHash('sha256').update(json).digest('hex');
}
function names(value){
 if(!Array.isArray(value)||value.length>500||!Array.from(value).every(label)||new Set(value).size!==value.length)throw fail('ACCESS_PROFILE_INVALID',400);
 return [...value].sort();
}
function grants(value){return {permissions:names(value?.permissions),mandates:names(value?.mandates)};}
function reference(value){
 if(!label(value?.id)||!label(value?.version))throw fail('ACCESS_PROFILE_INVALID',400);
 return {id:value.id,version:value.version};
}
function profile(value){return {...reference(value),...grants(value)};}
function state(value,contextId){
 if(value?.contextId!==contextId||!label(value.revision)||!label(value.policyRevision)||value.eligible!==true)throw fail('ACCESS_PROFILE_INELIGIBLE');
 const identity={};
 for(const key of ['scopeId','principalId','role','market']){
  if(!label(value.identity?.[key]))throw fail('ACCESS_PROFILE_INVALID',400);
  identity[key]=value.identity[key];
 }
 return {contextId,revision:value.revision,policyRevision:value.policyRevision,identity,profile:profile(value.profile),overrides:{grant:grants(value.overrides?.grant),revoke:grants(value.overrides?.revoke)},effective:grants(value.effective),denied:grants(value.denied),eligible:true};
}
function entry(before,target){
 const effective={},changes={};
 for(const key of ['permissions','mandates']){
  effective[key]=[...new Set([...target[key],...before.overrides.grant[key]])].filter(x=>!before.overrides.revoke[key].includes(x)&&!before.denied[key].includes(x)).sort();
  changes[key]={add:effective[key].filter(x=>!before.effective[key].includes(x)),retain:effective[key].filter(x=>before.effective[key].includes(x)),remove:before.effective[key].filter(x=>!effective[key].includes(x))};
 }
 const after={identity:clone(before.identity),profile:clone(target),overrides:clone(before.overrides),effective};
 const changed=digest({profile:before.profile,effective:before.effective})!==digest({profile:target,effective});
 return {contextId:before.contextId,before,after,changes,changed};
}

// Deterministic migration harness. Host owns eligibility, approval, current
// authorization and atomic revision/audit/receipt storage; no role grants here.
export class AccessProfileReconciler {
 constructor(ports){
  for(const name of ['authorize','resolveProfile','readContext','approve','readReceipt','appendRevision'])if(typeof ports?.[name]!=='function')throw fail('ACCESS_PROFILE_PORT_REQUIRED',400);
  this.ports={...ports};
 }
 async allowed(actor,action,contextId){
  if(await this.ports.authorize({actor,action,contextId})!==true)throw fail('ACCESS_PROFILE_DENIED',403);
 }
 async preview(actor,{profile:ref,contextIds}){
  ref=reference(ref);contextIds=names(contextIds);
  if(!contextIds.length||contextIds.length>100)throw fail('ACCESS_PROFILE_INVALID',400);
  // Authorize all requested IDs before resolving or returning any snapshots.
  for(const id of contextIds)await this.allowed(actor,'preview',id);
  const target=profile(await this.ports.resolveProfile({actor,profile:clone(ref)}));
  if(target.id!==ref.id||target.version!==ref.version)throw fail('ACCESS_PROFILE_TARGET_MISMATCH');
  const entries=[];
  for(const id of contextIds){
   const before=state(await this.ports.readContext({actor,contextId:id}),id);
   await this.allowed(actor,'preview',id);
   if(before.profile.id!==target.id)throw fail('ACCESS_PROFILE_TARGET_MISMATCH');
   entries.push(entry(before,target));
  }
  for(const id of contextIds)await this.allowed(actor,'preview',id);
  const body={schema:'iaic.access-profile-plan.v1',target,entries};
  return {...body,digest:digest(body)};
 }
 async apply(actor,{plan,approvalId}){
  // Snapshot the caller's plan before any async port. A digest is integrity,
  // never permission: the Host approval port binds actor, digest and expiry.
  plan=clone(plan);
  if(!label(approvalId)||plan?.schema!=='iaic.access-profile-plan.v1'||!Array.isArray(plan.entries)||!plan.entries.length||plan.entries.length>100)throw fail('ACCESS_PROFILE_INVALID',400);
  const target=profile(plan.target),entries=plan.entries.map(e=>entry(state(e.before,e.contextId),target));
  if(new Set(entries.map(e=>e.contextId)).size!==entries.length||entries.some(e=>e.before.profile.id!==target.id))throw fail('ACCESS_PROFILE_INVALID',400);
  const body={schema:plan.schema,target,entries};
  if(plan.digest!==digest(body)||digest({...plan,digest:null})!==digest({...body,digest:null}))throw fail('ACCESS_PROFILE_PLAN_CHANGED');
  if(await this.ports.approve({actor,approvalId,digest:plan.digest})!==true)throw fail('ACCESS_PROFILE_APPROVAL_REQUIRED',403);
  const results=[];
  for(const item of entries){
   const contextId=item.contextId,operationKey='access-profile:'+digest({digest:plan.digest,contextId});
   const request={actor,contextId,operationKey,planDigest:plan.digest,approvalId,expected:clone(item.before),next:clone(item.after)};
   try{
    await this.allowed(actor,'apply',contextId);
    // Reconcile the original operation BEFORE comparing revisions: a lost
    // acknowledgement legitimately leaves the Context at the next revision.
    let receipt=await this.ports.readReceipt({actor,contextId,operationKey});
    if(!receipt){
     const current=state(await this.ports.readContext({actor,contextId}),contextId);
     if(digest(current)!==digest(item.before))throw fail('ACCESS_PROFILE_CONFLICT');
     const currentTarget=profile(await this.ports.resolveProfile({actor,profile:reference(target)}));
     if(digest(currentTarget)!==digest(target))throw fail('ACCESS_PROFILE_TARGET_MISMATCH');
     await this.allowed(actor,'apply',contextId);
     if(await this.ports.approve({actor,approvalId,digest:plan.digest})!==true)throw fail('ACCESS_PROFILE_APPROVAL_REQUIRED',403);
     if(!item.changed){results.push({contextId,operationKey,status:'unchanged',revision:current.revision});continue;}
     try{receipt=await this.ports.appendRevision(clone(request));}
     catch{
      // A transport exception says nothing about commit outcome. Only the
      // original operation receipt establishes success; never invent a key.
      receipt=await this.ports.readReceipt({actor,contextId,operationKey});
      if(!receipt){results.push({contextId,operationKey,status:'unknown'});continue;}
     }
    }
    await this.allowed(actor,'apply',contextId);
    if(receipt.contextId!==contextId||receipt.operationKey!==operationKey||receipt.planDigest!==plan.digest||receipt.previousRevision!==item.before.revision||!label(receipt.revision)||receipt.revision===item.before.revision)throw fail('ACCESS_PROFILE_RECEIPT_MISMATCH');
    results.push({contextId,operationKey,status:'applied',revision:receipt.revision});
   }catch(error){
    const known=['ACCESS_PROFILE_DENIED','ACCESS_PROFILE_APPROVAL_REQUIRED','ACCESS_PROFILE_CONFLICT','ACCESS_PROFILE_INELIGIBLE','ACCESS_PROFILE_TARGET_MISMATCH','ACCESS_PROFILE_RECEIPT_MISMATCH'];
    results.push({contextId,operationKey,status:known.includes(error?.code)?'blocked':'unknown',...(known.includes(error?.code)?{code:error.code}:{})});
   }
  }
  return {digest:plan.digest,complete:results.every(r=>['applied','unchanged'].includes(r.status)),results};
 }
}
