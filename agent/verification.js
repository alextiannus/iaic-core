// Trusted application feedback, never a model-supplied success decision.
export function verificationResult(value){
 if(typeof value==='boolean')return {verified:value};
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||typeof value.verified!=='boolean'
  ||Object.keys(value).some(key=>!['verified','feedback'].includes(key))
  ||(value.feedback!==undefined&&(typeof value.feedback!=='string'||!value.feedback.trim()||value.feedback.length>2000)))throw new Error('Invalid application verification result');
 return {verified:value.verified,...(value.feedback===undefined?{}:{feedback:value.feedback})};
}
