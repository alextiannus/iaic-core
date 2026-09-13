// Explicit preflight only; never a fallback from a real provider.
export const fixtureFactory=()=>({next:async({messages})=>{
 const c=JSON.parse(messages.find(m=>m.role==='user').content),calls=c.calls.filter(x=>x.status==='succeeded');let action;
 if(calls.length===0)action={type:'call',name:'my_read_assistant_memory',input:{key:'style'}};
 else if(calls.length===1)action={type:'call',name:'assistant.skills.list',input:{}};
 else if(calls.length===2)action={type:'call',name:'assistant.skills.read',input:{id:calls[1].result[0].id}};
 else if(calls.length===3)action={type:'call',name:'my_search_knowledge',input:{}};
 else if(calls.length===4)action={type:'call',name:'my_read_knowledge',input:{id:calls[3].result.items[0].reference.id}};
 else if(calls.length===5){const ready=JSON.parse(calls[4].result.text).filter(r=>r.state==='ready'),project=c.session.events.find(e=>e.kind==='user_message').data.text.match(/Project-[a-f0-9]+/)[0];action={type:'call',name:'my_write_workspace',input:{path:'result.json',content:JSON.stringify({project,selectedIds:ready.map(r=>r.id).sort().reverse(),totalUnits:ready.reduce((n,r)=>n+r.units,0)}),expectedRevision:0}};}
 else if(calls.length===6)action={type:'call',name:'my_read_workspace',input:{path:'result.json'}};
 else action={type:'finish',result:{summary:'Verified fixture result.',artifacts:[calls[6].result.reference]}};
 return {...action,usage:{inputTokens:1,outputTokens:1}};
}});
