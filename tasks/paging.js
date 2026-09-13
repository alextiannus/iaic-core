const invalid=()=>Object.assign(new Error('Invalid Task page or continuation cursor'),{statusCode:400});
export const taskPageSchema={type:'object',properties:{limit:{type:'integer',minimum:1,maximum:100},cursor:{type:'string',minLength:1,maxLength:2048},capability:{type:'string',pattern:'^[a-z][a-z0-9_.-]*$',maxLength:200},status:{type:'string',enum:['queued','running','waiting','succeeded','failed','cancelled']}},additionalProperties:false};
export function pageOptions({limit=20,cursor,capability=null,status=null}={}){
 if(!Number.isInteger(limit)||limit<1||limit>100||(cursor!==undefined&&(typeof cursor!=='string'||!cursor||cursor.length>2048))||(capability!==null&&(typeof capability!=='string'||capability.length>200||!/^[a-z][a-z0-9_.-]*$/.test(capability)))||(status!==null&&!taskPageSchema.properties.status.enum.includes(status)))throw invalid();
 return {limit,cursor,capability,status};
}
export function pagePosition(position){
 if(position===null)return null;
 if(!position||typeof position.createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(position.createdAt)||!Number.isFinite(Date.parse(position.createdAt))||typeof position.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(position.id))throw invalid();
 return {createdAt:position.createdAt,id:position.id};
}
