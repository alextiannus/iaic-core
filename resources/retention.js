const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
// Stores own expiry predicates and CAS erasure; this module owns bounded work
// and current host authorization. It never accepts a caller-controlled cutoff.
export class RetentionSweep {
 constructor({resolveStore,authorize}){
  if(typeof resolveStore!=='function'||typeof authorize!=='function')throw fail('Retention store and current authorization ports required');
  Object.assign(this,{resolveStore,authorize});
 }
 async run(actor,{sourceId,limit=100}){
  if(typeof sourceId!=='string'||!sourceId.trim()||sourceId.length>200||!Number.isInteger(limit)||limit<1||limit>100)throw fail('Retention source and limit 1–100 required');
  const check=async()=>{if(await this.authorize(actor,{sourceId,operation:'expire'})!==true)throw fail('Retention denied',403);};
  await check();const store=await this.resolveStore(actor,{sourceId});
  if(typeof store?.expired!=='function'||typeof store?.expire!=='function')throw fail('Retention source is unavailable',503);
  const candidates=structuredClone(await store.expired({limit}));
  if(!Array.isArray(candidates)||candidates.length>limit||candidates.some(c=>typeof c?.id!=='string'||!c.id||!Number.isSafeInteger(c.revision)||c.revision<1)||new Set(candidates.map(c=>c.id)).size!==candidates.length)throw fail('Invalid retention candidates',503);
  const result={sourceId,examined:candidates.length,erased:[],changed:[],batchFull:candidates.length===limit};
  for(const {id,revision} of candidates){
   try{
    await check();
    let receipt;
    try{receipt=await store.expire({id,revision});}catch(error){if(error.statusCode===409){result.changed.push({id,revision});continue;}throw error;}
    if(receipt?.id!==id||receipt.revision!==revision+1)throw fail('Retention erasure receipt is unconfirmed',503);
    result.erased.push({id,revision:receipt.revision});
   }catch(error){throw Object.assign(error,{retentionProgress:structuredClone(result)});}
  }
  return result;
 }
}
