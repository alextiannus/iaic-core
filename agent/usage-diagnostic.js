// Shared model-error metadata contract. Never copy provider messages or bodies.
export function usageDiagnostic(value){
 if(!value||typeof value.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.requestId))return null;
 const result={requestId:value.requestId};
 if(['http','aborted','timeout','provider_error','missing_usage'].includes(value.kind))result.kind=value.kind;
 if(Number.isInteger(value.providerStatus)&&value.providerStatus>=400&&value.providerStatus<=599)result.providerStatus=value.providerStatus;
 if(Number.isFinite(value.retryAfterMs)&&value.retryAfterMs>=0&&value.retryAfterMs<=86400000)result.retryAfterMs=value.retryAfterMs;
 if(typeof value.providerCompleted==='boolean')result.providerCompleted=value.providerCompleted;
 return result;
}
