import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Pool} from 'pg';
import {AssistantChannel,PostgresChannelInbox,telegramMessage,slackMessage,larkMessage,createLarkNotificationDelivery,LocalDirectoryDevice,LocalFiles,createLocalFileCapabilities,PostgresDeviceOperations,PostgresNotificationStore,Notifications} from '@immedi/iaic-core';
import {openUserAssistant} from '../core-user-assistant/application.mjs';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;assert.ok(connectionString);
const schema='im_demo_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`}),directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-user-files-'));
const actor={scopeId:'demo',subjectId:'user-one'};let app,allowed=true;
try {
 const operations=new PostgresDeviceOperations({pool,namespace:'local-files'});await operations.initialize();
 const device=await LocalDirectoryDevice.open({directory});
 const files=new LocalFiles({store:operations,resolveOwner:a=>a.scopeId+':'+a.subjectId,authorize:(a,i)=>allowed&&a.subjectId===actor.subjectId&&i.deviceId==='user-folder',resolveDevice:()=>device});
 app=await openUserAssistant({pool,authorize:a=>a.scopeId==='demo',authorizeSubmission:a=>a.subjectId===actor.subjectId,
  payloadSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},
  profile:{id:'system',provider:'openai',model:'fixture',credentialRef:'fixture'},resolveSecret:()=> 'fixture',tokenPolicy:{maximum:100,price:{revision:'fixture',input:1,cachedInput:1,output:1}},
  extraCapabilities:createLocalFileCapabilities({files}),extensionRevision:'local-files-v1',
  modelFactory:()=>({next:async({messages})=>{
   const c=JSON.parse(messages.find(m=>m.role==='user').content),calls=c.calls.filter(x=>x.status==='succeeded');let action;
   if(!c.events.some(e=>e.kind==='input'))action={type:'wait',question:'What text should I submit and save?'};
   else if(calls.length===0)action={type:'call',name:'declarations.submit',input:{requestKey:'declaration-one',payload:{text:'My declaration'}}};
   else if(calls.length===1)action={type:'call',name:'declarations.get',input:{requestKey:'declaration-one'}};
   else if(calls.length===2)action={type:'call',name:'local.files.create',input:{deviceId:'user-folder',requestKey:'export-one',name:'declaration.txt',text:'My declaration'}};
   else if(calls.length===3)action={type:'call',name:'local.files.read',input:{deviceId:'user-folder',name:'declaration.txt'}};
   else {assert.equal(calls[3].result.text,'My declaration');action={type:'finish',result:{summary:'Declaration submitted; declaration.txt saved and read back.',artifacts:[]}};}
   return {...action,usage:{inputTokens:1,outputTokens:1}};
  }})});
 await app.ledger.grant(await app.scope(actor),{reference:'synthetic-test-budget',amount:1000,evidence:{fixture:true}});
 const inbox=new PostgresChannelInbox({pool,namespace:'user-assistant'});await inbox.initialize();
 const outbox=new PostgresNotificationStore({pool,namespace:'im'});await outbox.initialize();const sent=[];
 const notifications=new Notifications({store:outbox,resolveScope:a=>a.scopeId+':'+a.subjectId,authorize:a=>a.subjectId===actor.subjectId,
  resolveDelivery:async job=>{
   const authorize=()=>allowed&&job.source.identity==='demo:assistant:user-one'&&['telegram:bot-one:7','slack:slack-one:U-seven','lark:lark-one:ou_user'].includes([job.source.route.provider,job.source.route.installationId,job.source.route.senderId].join(':'));
   if(job.source.route.provider==='lark')return createLarkNotificationDelivery({route:job.source.route,authorize,client:{im:{message:{create:async input=>{sent.push(input);return {code:0,data:{chat_id:input.data.receive_id,message_id:'om_fixture_reply'}};}}}}});
   return {allowed:authorize(),send:async input=>{sent.push(input);return {status:'delivered',reference:'fixture-provider:'+input.idempotencyKey};}};
  }});
 const options={inbox,dispatcher:app.dispatcher,notifications,allowedTools:app.job.configuration.tools,
  resolveBinding:m=>['telegram:bot-one:7','slack:slack-one:U-seven','lark:lark-one:ou_user'].includes([m.provider,m.installationId,m.senderId].join(':'))?{actor,identity:'demo:assistant:user-one'}:null,
  authorize:(_a,{message})=>allowed&&message.kind==='direct',
  project:task=>({text:task.inputRequest?.question||task.result?.summary||`Task ${task.id}: ${task.status}`})};
 let channel=new AssistantChannel(options);
 const start=telegramMessage({update_id:1,message:{from:{id:7},chat:{id:8,type:'private'},text:'Submit and save my declaration.'}},{installationId:'bot-one'});
 const [task,duplicate]=await Promise.all([channel.receive(start),channel.receive(start)]);assert.equal(duplicate.taskId,task.taskId);
 await assert.rejects(channel.receive({...start,text:'Altered event'}),{statusCode:409});
 await assert.rejects(new AssistantChannel({...options,resolveBinding:()=>({actor,identity:'another-binding'})}).receive(start),{statusCode:409});
 assert.equal((await app.runtime.tick()).waiting_reason,'input');
 const question=await channel.publish(start,task.taskId);assert.match(question.notification.message.text,/What text/);
 // Rebuild channel service; a separately host-bound Slack identity resumes the same Core task.
 channel=new AssistantChannel(options);
 const reply=slackMessage({team_id:'team',type:'event_callback',event_id:'reply-one',event:{type:'message',channel:'dm',channel_type:'im',user:'U-seven',text:`/reply ${task.taskId} My declaration`}},{installationId:'slack-one',teamId:'team'});
 await channel.receive(reply);await channel.receive(reply);
 assert.equal((await app.runtime.tick()).status,'succeeded');
 const result=await channel.publish(start,task.taskId);assert.match(result.notification.message.text,/saved and read back/);
 assert.equal((await fs.readFile(path.join(directory,'declaration.txt'),'utf8')),'My declaration');
 assert.equal((await pool.query('SELECT * FROM demo_user_declarations')).rowCount,1);
 assert.equal((await pool.query('SELECT * FROM iaic_channel_inbox')).rowCount,2);
 assert.equal((await files.create(actor,{deviceId:'user-folder',requestKey:'export-one',name:'declaration.txt',text:'My declaration'})).status,'created');
 await channel.publish(start,task.taskId);
 const lark=larkMessage({event_type:'im.message.receive_v1',event_id:'lark-status',app_id:'cli_fixture',tenant_key:'tenant',sender:{sender_type:'user',sender_id:{open_id:'ou_user'}},message:{chat_id:'oc_fixture',chat_type:'p2p',message_type:'text',content:JSON.stringify({text:`/status ${task.taskId}`})}},{installationId:'lark-one',appId:'cli_fixture',tenantKey:'tenant'});
 assert.equal((await channel.receive(lark)).taskId,task.taskId);
 while(await notifications.tick()){}assert.ok(sent.length>0);
 assert.ok(sent.some(input=>input.data?.receive_id==='oc_fixture'));
 allowed=false;await assert.rejects(channel.publish(start,task.taskId),{statusCode:403});await assert.rejects(files.read(actor,{deviceId:'user-folder',name:'declaration.txt'}),{statusCode:403});
 console.log(JSON.stringify({example:'core-assistant-channels',normalizedProviders:['telegram','slack','lark'],larkSdkSendMapping:true,crossChannelHostBinding:true,durableInbox:true,clarification:true,declarationReceipt:true,realTemporaryLocalFile:true,notificationOutbox:true,liveProvider:false,remoteDeviceTransport:false,modelMode:'deterministic'}));
} finally {await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(directory,{recursive:true,force:true});}
