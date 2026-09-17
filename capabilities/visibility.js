// Consumption surface is selected by trusted composition, never by business input.
const fail=(message,code,statusCode=403)=>Object.assign(new Error(message),{code,publicCode:code,statusCode});
export function validateSurface(surface){
 if(!['model','host'].includes(surface))throw fail('Invalid capability surface','INVALID_CAPABILITY_SURFACE',400);
 return surface;
}
export function capabilityVisible(capability,surface){
 validateSurface(surface);
 const visibility=capability?.visibility??'both';
 return Boolean(capability)&&['both',surface].includes(visibility);
}
export function assertCapabilitySurface(capability,surface){
 if(!capabilityVisible(capability,surface))throw fail('Capability is not available on this surface','CAPABILITY_SURFACE_DENIED');
}
export function assertModelHistory(history,dispatcher){
 for(const call of history.calls)assertCapabilitySurface(dispatcher.capabilities.get(call.capability),'model');
}
