export function agentIdentityTools(registry,actor,definitionId){
 return [
  {name:'my_get_assistant_identity',description:'Read the Assistant role, developer-defined responsibility, revision and durable work identity. A role is not an authority grant.',inputSchema:{type:'object',properties:{},additionalProperties:false},handler:()=>registry.describe(actor,definitionId)},
  {name:'my_get_assistant_identity_history',description:'Read the scoped append-only Agent lifecycle revisions. Continue with after equal to the last returned revision.',inputSchema:{type:'object',properties:{after:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50}},additionalProperties:false},handler:input=>registry.history(actor,definitionId,input)},
  {name:'my_set_assistant_state',description:'Pause future Assistant admission or reactivate it. In-flight actions may complete. Reactivation does not automatically resume waiting tasks. Supply the current instance revision.',inputSchema:{type:'object',properties:{state:{type:'string',enum:['active','paused']},expectedRevision:{type:'integer',minimum:1,maximum:2147483646}},required:['state','expectedRevision'],additionalProperties:false},handler:input=>registry.setState(actor,definitionId,input)}
 ];
}
