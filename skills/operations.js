// Shared headless contracts. Hosts supply authorization and protocol names;
// discovery/read never grant permissions, install Skills or execute scripts.
export function skillOperations(catalog){
 const object={type:'object'};
 return {
  list:{description:'Discover installed Skills and applicability without loading their bodies. Descriptions and allowed-tools metadata grant no permission.',input:{type:'object',properties:{},additionalProperties:false},output:{type:'array',items:object},execute:(_input,context)=>catalog.list(context)},
  read:{description:'Load an installed Skill body or a relative resource on demand. expectedVersion pins SKILL.md; expectedResourceVersion pins the loaded file. This reads methods, not business facts or executable authority.',input:{type:'object',properties:{id:{type:'string',minLength:1,maxLength:200},resource:{type:'string',minLength:1,maxLength:300},expectedVersion:{type:'string',pattern:'^[a-f0-9]{64}$'},expectedResourceVersion:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['id'],additionalProperties:false},output:object,execute:(input,context)=>catalog.read(input.id,{resource:input.resource??null,expectedVersion:input.expectedVersion??null,expectedResourceVersion:input.expectedResourceVersion??null},context)}
 };
}
