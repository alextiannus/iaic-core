// Display-only projection after current authorization and result revalidation.
export function boundedHistory(data,maxBytes,overflow){
 let content=JSON.stringify(data);
 if(Buffer.byteLength(content)<=maxBytes||overflow==='error')return content;
 const calls=data.calls.map(call=>({...call}));
 const ids=new Set(calls.map(call=>call.id));
 const latest=data.events.findLast(event=>event.kind==='call_settled'&&ids.has(event.data?.callId))?.data.callId??calls.at(-1)?.id;
 const omitted=[];
 for(const call of calls){
  if(call.id===latest||call.status!=='succeeded'||call.result===undefined)continue;
  const replacement={...call,result:null,resultOmitted:true};
  if(Buffer.byteLength(JSON.stringify(replacement))>=Buffer.byteLength(JSON.stringify(call)))continue;
  Object.assign(call,replacement);omitted.push(call.id);
  content=JSON.stringify({...data,calls,contextProjection:{mode:'omit-old-results',omittedResultCallIds:[...omitted]}});
  if(Buffer.byteLength(content)<=maxBytes)break;
 }
 return content;
}
