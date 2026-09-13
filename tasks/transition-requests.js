import {createHash} from 'node:crypto';
const conflict=message=>Object.assign(new Error(message),{statusCode:409});
export function transitionBinding({action,version,input,requestKey}){
 if(typeof requestKey!=='string'||!requestKey||requestKey.length>500||!['resume','provide_input'].includes(action)||typeof version!=='string'||!version)throw conflict('A stable key, original version and resume/input action are required');
 if(action==='provide_input'&&(typeof input!=='string'||!input.trim()||input.length>8000))throw conflict('A bounded nonempty clarification is required');
 const request={action,version,...(action==='provide_input'?{input}:{})};
 return {requestKey,action,requestDigest:createHash('sha256').update(JSON.stringify(request)).digest('hex')};
}
export function checkedTransition(receipt,binding){
 if(receipt&&receipt.requestDigest!==binding.requestDigest)throw conflict('Transition request key belongs to different input, action or version');
 return receipt?.task??null;
}
