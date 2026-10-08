export function normalizeAction(response){
  if(response?.type==='batch'&&Array.isArray(response.actions)&&response.actions.length>=2&&response.actions.length<=8&&response.actions.every(a=>a?.type==='call'&&typeof a.name==='string'&&a.input&&typeof a.input==='object'&&!Array.isArray(a.input)))return {type:'batch',actions:response.actions.map(a=>({type:'call',name:a.name,input:a.input}))};
  if(response?.type==='delegate'&&response.input&&typeof response.input==='object'&&!Array.isArray(response.input))return {type:'delegate',input:response.input};
  if(response?.type==='call'&&typeof response.name==='string'&&response.input&&typeof response.input==='object'&&!Array.isArray(response.input))return {type:'call',name:response.name,input:response.input};
  if(response?.type==='finish'&&response.result!==undefined)return {type:'finish',result:response.result};
  if(response?.type==='wait'&&typeof response.question==='string'&&response.question.trim())return {type:'wait',question:response.question};
  throw Object.assign(new Error('Model returned an invalid action'),{code:'INVALID_MODEL_ACTION'});
}
