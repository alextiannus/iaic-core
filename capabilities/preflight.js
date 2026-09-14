// Trusted host validation, after authorization and before any domain effect.
// Feedback is public to the caller/model; applications must not put secrets here.
export function preflightResult(value){
 if(typeof value==='boolean')return {valid:value};
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||typeof value.valid!=='boolean'
  ||Reflect.ownKeys(value).some(key=>!['valid','feedback'].includes(key))
  ||(Object.hasOwn(value,'feedback')&&(typeof value.feedback!=='string'||!value.feedback.trim()||value.feedback.length>2000)))throw new Error('Invalid capability preflight result');
 return {valid:value.valid,...(value.feedback===undefined?{}:{feedback:value.feedback})};
}
