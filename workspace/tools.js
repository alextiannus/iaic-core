export function workspaceTools(workspace,actor){
 const path={type:'string',minLength:1,maxLength:300},revision={type:'integer',minimum:1};
 const projectWriteInput=input=>Object.fromEntries(['path','mediaType','expectedRevision'].filter(key=>input&&Object.hasOwn(input,key)).map(key=>[key,input[key]]));
 const tool=(name,description,properties,required,handler)=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},handler,...(name==='my_write_workspace'?{projectHistoryInput:projectWriteInput}:{})});
 return [
  tool('my_list_workspace','List this Assistant workspace documents without loading their bodies; follow nextCursor.',{after:path,limit:{type:'integer',minimum:1,maximum:50}},[],value=>workspace.list(actor,value)),
  tool('my_read_workspace','Read a workspace document or an exact artifact reference. Working materials are not authoritative business facts.',{path,revision,digest:{type:'string',pattern:'^[a-f0-9]{64}$'}},['path'],value=>workspace.read(actor,value)),
  tool('my_write_workspace','Save a text working document. Use revision 0 to create, or the current revision to update; keep returned reference for later citation.',{path,content:{type:'string',maxLength:256000},mediaType:{type:'string',enum:['text/plain','text/markdown','application/json']},expectedRevision:{type:'integer',minimum:0}},['path','content','expectedRevision'],value=>workspace.write(actor,value)),
  tool('my_delete_workspace','Delete a workspace document and all of its stored revisions using its current revision.',{path,expectedRevision:revision},['path','expectedRevision'],value=>workspace.remove(actor,value))
 ];
}
