import {PostgresInboxStore} from '@immedi/iaic-core/inbox/store.js';
import {Inbox} from '@immedi/iaic-core/inbox/service.js';
import {createInboxCapabilities} from '@immedi/iaic-core/inbox/capabilities.js';
import {TaskStore,SessionStore,AssistantSessions,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
export const actor={scopeId:'service-provider-demo',subjectId:'user',tenant:'demo',workspace:'provider',market:'fixture'};
export async function openDemo(pool,{authorized=()=>true,loseReceipt=()=>false}={}) {
 const scope=a=>JSON.stringify([a.scopeId,a.subjectId,a.tenant,a.workspace,a.market]);
 const authorize=a=>scope(a)===scope(actor)&&authorized();
 const store=new PostgresInboxStore({pool,namespace:'service-provider-demo'}),sessions=new SessionStore({pool}),tasks=new TaskStore({pool,actorCodec:{encode:a=>[scope(a),a.subjectId],decode:([s])=>{const [scopeId,subjectId,tenant,workspace,market]=JSON.parse(s);return {scopeId,subjectId,tenant,workspace,market};}}});
 await store.initialize();await sessions.initialize();await tasks.initialize();
 const sessionScope={applicationId:'inbox-demo',assistantId:scope(actor),subjectId:actor.subjectId};
 const session=await sessions.create(sessionScope,{requestKey:'main',title:'Service provider workspace'});
 const inbox=new Inbox({store,resolveScope:scope,authorize,
  resolveProjection:(_actor,{kind})=>({
   send:async({idempotencyKey,item})=>{
    let reference;
    if(kind==='conversation') {
     const event=await sessions.append(sessionScope,{sessionId:session.id,requestKey:idempotencyKey,expectedSequence:null,kind:'resource_ref',data:{type:'inbox',id:item.id}});reference=session.id+':'+event.sequence;
    } else {
     const task=await tasks.create({actor,capability:'provider.review',input:{inboxItemId:item.id,actionRef:item.actionRef},idempotencyKey,version:'inbox-demo-v1',model:'fixture'});reference=task.id;
    }
    if(loseReceipt(kind))throw Error('Fixture lost response after commit');
    return {status:'delivered',reference};
   },
   query:async({idempotencyKey,item})=>{
    if(kind==='conversation') {
     const event=await sessions.findEvent(sessionScope,session.id,idempotencyKey);
     if(!event)return {status:'unknown'};
     if(event.kind!=='resource_ref'||event.data.id!==item.id||event.data.type!=='inbox')throw Error('Binding mismatch');
     return {status:'delivered',reference:session.id+':'+event.sequence};
    }
    const task=await tasks.findRequest(actor,'provider.review',idempotencyKey);
    if(!task)return {status:'unknown'};
    if(task.input.inboxItemId!==item.id||task.input.actionRef!==item.actionRef)throw Error('Binding mismatch');
    return {status:'delivered',reference:task.id};
   }
  })});
 const timeline=new AssistantSessions({store:sessions,resolveScope:()=>sessionScope,resourceView:async(a,ref)=>{if(ref.type!=='inbox')throw Object.assign(Error('Unknown resource'),{statusCode:404});return inbox.get(a,ref.id);}});
 // Host-owned fixture state and business names, never Core schemas.
 await pool.query('CREATE TABLE IF NOT EXISTS demo_inbox_profile (scope text PRIMARY KEY,name text,description text,published boolean NOT NULL DEFAULT false)');
 await pool.query('INSERT INTO demo_inbox_profile(scope) VALUES($1) ON CONFLICT DO NOTHING',[scope(actor)]);
 const readProfile=async()=> (await pool.query('SELECT name,description,published FROM demo_inbox_profile WHERE scope=$1',[scope(actor)])).rows[0];
 const capability=(name,effect,properties,execute)=>defineCapability({name,description:'Host fixture: '+name,input:{type:'object',properties,required:Object.keys(properties),additionalProperties:false},output:{type:'object'},effect,...(effect==='write'?{retry:'never-replay'}:{revalidate:(i,_old,c)=>execute(i,c)}),authorize:async a=>authorize(a),implementation:{kind:'function',execute}});
 const string={type:'string',minLength:1,maxLength:500};
 const capabilities=[...createInboxCapabilities({inbox}),
  capability('profile.read','read',{},readProfile),
  capability('profile.configure','write',{name:string},async({name})=>{await pool.query('UPDATE demo_inbox_profile SET name=$2 WHERE scope=$1',[scope(actor),name]);return readProfile();}),
  capability('capability.describe','write',{description:string},async({description})=>{await pool.query('UPDATE demo_inbox_profile SET description=$2,published=false WHERE scope=$1',[scope(actor),description]);return readProfile();}),
  capability('capability.publish','write',{reviewedDescription:string},async({reviewedDescription})=>{const result=await pool.query('UPDATE demo_inbox_profile SET published=true WHERE scope=$1 AND name IS NOT NULL AND description=$2 RETURNING published',[scope(actor),reviewedDescription]);if(!result.rowCount)throw Object.assign(Error('Configure profile and review current description first'),{statusCode:409});return result.rows[0];}),
  capability('orders.list','read',{},async()=>({items:[{id:'fixture-1',status:'submitted'}]})),
  capability('orders.read','read',{id:string},async({id})=>{if(id!=='fixture-1')throw Object.assign(Error('Not found'),{statusCode:404});return {id,status:'submitted',fixture:true};})];
 const dispatcher=new CapabilityDispatcher({capabilities});
 const invoke=(name,input={})=>dispatcher.invoke(name,input,{actor,callId:crypto.randomUUID()});
 const seed=async()=>{
  const common={category:'workspace',priority:'normal'};
  const ordinary=await inbox.receive(actor,{...common,requestKey:'status',notificationId:'fixture-status',title:'Order received',summary:'A fixture order is available to view.',relatedObjectRef:'fixture-1'});
  const action=await inbox.receive(actor,{...common,requestKey:'setup',notificationId:'fixture-setup',title:'Complete your workspace',summary:'Add your display name, describe your service and review before publishing.',actionRef:'review-workspace-v1'});
  await inbox.project(actor,ordinary.id,{kind:'conversation'});
  return {ordinary,action};
 };
 return {inbox,store,tasks,sessions,timeline,session,sessionScope,invoke,seed,scope,readProfile};
}
