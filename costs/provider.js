const fail=message=>Object.assign(new Error(message),{statusCode:400});
const uint=v=>{if(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)v=String(v);if(typeof v!=='string'||! /^(0|[1-9][0-9]{0,23})$/.test(v))throw fail('Nonnegative integer amount required');return BigInt(v);};
const rate=v=>{
 if(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)v=String(v);
 if(typeof v!=='string'||! /^(0|[1-9][0-9]{0,23})(\.[0-9]{1,6})?$/.test(v))throw fail('Nonnegative decimal minor-unit price with at most six decimals required');
 const [whole,fraction='']=v.split('.'),trimmed=fraction.replace(/0+$/,'');return {text:whole+(trimmed?'.'+trimmed:''),scaled:BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'))};
};
const denominator=1000000000000n;
const text=v=>typeof v==='string'&&v.trim()&&v.length<=500;
export function providerCostBasis(value,{mode,model=null}={}){
 const fields=['format','revision','currency','minorUnitScale','bearer','accountReference','model','inputPerMillionMinor','cachedInputPerMillionMinor','outputPerMillionMinor','missingCachedInput'];
 if(!value||Object.keys(value).some(k=>!fields.includes(k))||value.format!=='iaic.provider-cost.v1'||!text(value.revision)||! /^[A-Z]{3}$/.test(value.currency||'')||!Number.isInteger(value.minorUnitScale)||value.minorUnitScale<0||value.minorUnitScale>6||!['platform','user'].includes(value.bearer)||!text(value.accountReference)||!text(value.model)||!['uncached','incomplete'].includes(value.missingCachedInput)||(mode&&value.bearer!==(mode==='BYOK'?'user':'platform'))||(model!==null&&value.model!==model))throw fail('Explicit compatible provider currency price basis required');
 return {...value,inputPerMillionMinor:rate(value.inputPerMillionMinor).text,cachedInputPerMillionMinor:rate(value.cachedInputPerMillionMinor).text,outputPerMillionMinor:rate(value.outputPerMillionMinor).text};
}
export function estimateProviderCost(usage,basis){
 basis=providerCostBasis(basis);const input=uint(usage.inputTokens),output=uint(usage.outputTokens);
 const reported=usage.cachedInputTokens!==null&&usage.cachedInputTokens!==undefined;
 if(!reported&&basis.missingCachedInput==='incomplete'&&basis.inputPerMillionMinor!==basis.cachedInputPerMillionMinor)return null;
 const cached=reported?uint(usage.cachedInputTokens):0n;if(cached>input)throw fail('Cached tokens exceed input usage');
 // Output already includes reasoning usage. Keep fractions until aggregation.
 const minorUnitsNumerator=(input-cached)*rate(basis.inputPerMillionMinor).scaled+cached*rate(basis.cachedInputPerMillionMinor).scaled+output*rate(basis.outputPerMillionMinor).scaled;
 return {kind:'usage_rate_estimate',currency:basis.currency,minorUnitScale:basis.minorUnitScale,minorUnitsNumerator:String(minorUnitsNumerator),denominator:String(denominator),cacheUsage:reported?'reported':basis.inputPerMillionMinor===basis.cachedInputPerMillionMinor?'rate_independent':'assumed_uncached'};
}
// Read-only projection over immutable admission prices and confirmed usage. This
// module never grants allowance, settles payments or changes provider evidence.
export class ProviderCostAccounting {
 constructor({ledger}){if(typeof ledger?.costCalls!=='function')throw fail('Scoped confirmed usage projection port required');this.ledger=ledger;}
 async task(scope,taskId){
  const calls=await this.ledger.costCalls(scope,taskId);if(!Array.isArray(calls)||calls.length>1000)throw fail('Bounded Task cost sources required');
  const totals=new Map(),receipts=[],seen=new Set();let pending=0,unpriced=0,incompleteUsage=0,released=0;
  for(const call of calls){
   if(!['SYSTEM_MANAGED','BYOK'].includes(call.mode)||!text(call.requestId)||seen.has(call.requestId))throw fail('Unique cost source receipts required');seen.add(call.requestId);
   if(call.state==='released'){released++;continue;}
   if(call.state!=='settled'||!call.entryId){pending++;continue;}
   if(!call.costBasis){unpriced++;continue;}
   const basis=providerCostBasis(call.costBasis,{mode:call.mode});
   if(call.inputTokens===null||call.outputTokens===null){incompleteUsage++;continue;}
   const value=estimateProviderCost(call,basis);if(!value){incompleteUsage++;continue;}
   const group=JSON.stringify([basis.currency,basis.minorUnitScale,basis.bearer,basis.accountReference]);
   const prior=totals.get(group)||{currency:basis.currency,minorUnitScale:basis.minorUnitScale,bearer:basis.bearer,accountReference:basis.accountReference,minorUnitsNumerator:0n};prior.minorUnitsNumerator+=BigInt(value.minorUnitsNumerator);totals.set(group,prior);
   receipts.push({requestId:call.requestId,entryId:call.entryId,priceRevision:basis.revision,model:basis.model,...value});
  }
  return {kind:'usage_rate_estimate',requests:calls.length,priced:receipts.length,pending,unpriced,incompleteUsage,released,complete:pending===0&&unpriced===0&&incompleteUsage===0,totals:[...totals.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>({...v,minorUnitsNumerator:String(v.minorUnitsNumerator),denominator:String(denominator),minorUnitsCeiling:String((v.minorUnitsNumerator+denominator-1n)/denominator)})),receipts};
 }
}
