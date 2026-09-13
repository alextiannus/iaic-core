const fail=message=>Object.assign(new Error(message),{statusCode:400});
export const assessmentLevels=['unassessed','uncertain','supported','contradicted'];
export function memoryAssessment({level,reason,evidence=[]},assessor){
 if(!assessmentLevels.includes(level)||typeof reason!=='string'||!reason.trim()||reason.length>2000||!Array.isArray(evidence)||evidence.length>10||(['supported','contradicted'].includes(level)&&!evidence.length)||evidence.some(r=>!r||Object.keys(r).some(k=>!['kind','reference'].includes(k))||typeof r.kind!=='string'||!r.kind.trim()||r.kind.length>100||typeof r.reference!=='string'||!r.reference.trim()||r.reference.length>500))throw fail('Assessment requires a level, reason and bounded evidence references');
 if(!assessor||typeof assessor!=='object'||Array.isArray(assessor)||typeof assessor.kind!=='string'||!assessor.kind.trim()||typeof assessor.reference!=='string'||!assessor.reference.trim())throw fail('Trusted assessor identity/version reference required');
 const result={level,reason,evidence,assessor};if(Buffer.byteLength(JSON.stringify(result))>8000)throw fail('Memory assessment exceeds metadata limit');return JSON.parse(JSON.stringify(result));
}
export function assessmentTool(memory,actor){return {
 name:'my_assess_assistant_memory',effect:'write',authorize:(actor,input)=>memory.canAssess(actor,input),description:'Record an authorized assessment of the current memory revision with reason and evidence references. This is an assessor judgment, not verified business truth or permission. Contradicted statements leave default retrieval until reassessed or corrected.',
 inputSchema:{type:'object',properties:{key:{type:'string',minLength:1,maxLength:200},expectedRevision:{type:'integer',minimum:1},level:{enum:assessmentLevels},reason:{type:'string',minLength:1,maxLength:2000},evidence:{type:'array',maxItems:10,items:{type:'object',properties:{kind:{type:'string',minLength:1,maxLength:100},reference:{type:'string',minLength:1,maxLength:500}},required:['kind','reference'],additionalProperties:false}}},required:['key','expectedRevision','level','reason'],additionalProperties:false},
 projectHistoryInput:input=>Object.fromEntries(['key','expectedRevision','level'].filter(k=>input&&typeof input==='object'&&Object.hasOwn(input,k)).map(k=>[k,input[k]])),
 handler:async input=>{const row=await memory.assess(actor,input);return {key:row.memory_key,revision:row.revision};}
};}
