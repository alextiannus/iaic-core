import {createHash} from 'node:crypto';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const id=v=>typeof v==='string'&&v.trim()&&v.length<=200;
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Composition port only: resource stores never depend on the account database.
export class DirectoryResourceScopes {
 constructor({applicationId,directory,authorize}){
  if(!id(applicationId)||typeof directory?.current!=='function'||typeof authorize!=='function')throw fail('Resource namespace, current directory and resource policy required');
  Object.assign(this,{applicationId,directory,authorize});
 }
 resolver({owner,resourceId}){
  if(!['personal','organization'].includes(owner)||!id(resourceId))throw fail('Explicit resource owner and identifier required');
  return (actor,{access,operation}={})=>this.resolve(actor,{owner,resourceId,access,operation});
 }
 async resolve(actor,{owner,resourceId,access,operation}){
  if(!['personal','organization'].includes(owner)||!id(resourceId)||!['read','write'].includes(access)||!id(operation))throw fail('Explicit resource operation required');
  const current=await this.directory.current(actor);
  const accountId=current?.account?.id,organizationId=current?.organization?.id;
  if(typeof accountId!=='string'||!accountId.trim()||accountId.length>500||current.account.state!=='active')throw fail('Active resource account required',403);
  if(owner==='organization'&&(typeof organizationId!=='string'||!organizationId.trim()||organizationId.length>500||current.organization.state!=='active'||current.membership?.state!=='active'||current.membership.accountId!==accountId||current.membership.organizationId!==organizationId))throw fail('Current organization membership required',403);
  const ownerId=owner==='personal'?accountId:organizationId;
  if(await this.authorize({actor,current,owner,ownerId,resourceId,access,operation})!==true)throw fail('Resource operation denied',403);
  // Typed owner encoding separates personal and organization namespaces, even
  // when their external identifiers are equal. Existing private partitions stay intact.
  return {applicationId:'iaic-resource-v1:'+digest(this.applicationId),subjectId:digest([owner,ownerId]),assistantId:resourceId};
 }
}
