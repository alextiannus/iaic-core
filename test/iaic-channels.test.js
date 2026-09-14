import test from 'node:test';import assert from 'node:assert/strict';
import {telegramMessage,slackMessage,channelMessage,AssistantChannel} from '@immedi/iaic-core';
test('text normalizers ignore bot/edit traffic and validate IDs without claiming authentication',()=>{
 assert.equal(telegramMessage({edited_message:{text:'edit'}},{installationId:'bot'}),null);
 assert.equal(telegramMessage({message:{from:{is_bot:true},text:'bot'}},{installationId:'bot'}),null);
 assert.throws(()=>telegramMessage({message:{from:{id:1},chat:{id:2,type:'private'},text:'x'}},{installationId:'bot'}));
 assert.equal(slackMessage({team_id:'t',type:'event_callback',event:{type:'message',subtype:'bot_message',text:'x'}},{installationId:'app',teamId:'t'}),null);
 assert.throws(()=>slackMessage({team_id:'wrong'},{installationId:'app',teamId:'t'}),{statusCode:403});
 assert.throws(()=>channelMessage({}));
});
test('IM ingress fails closed before task creation and does not infer group authorization',async()=>{
 let calls=0;const message={provider:'test',installationId:'app',conversationId:'c',senderId:'u',eventId:'e',kind:'group',text:'Do it'};
 const channel=new AssistantChannel({inbox:{},dispatcher:{invoke:()=>calls++},notifications:{},resolveBinding:()=>({actor:{subjectId:'u'},identity:'bound'}),authorize:(_a,{message})=>message.kind==='direct',project:()=>({text:'x'}),allowedTools:[]});
 await assert.rejects(channel.receive(message),{statusCode:403});assert.equal(calls,0);
});
test('a later identical question has its own notification while repeated polling deduplicates',async()=>{
 const keys=[];let reference='1';
 const channel=new AssistantChannel({inbox:{},dispatcher:{invoke:async()=>({id:'task',status:'waiting',waitingReason:'input',inputRequest:{question:'Which one?',reference}})},notifications:{enqueue:async(_actor,input)=>{keys.push(input.requestKey);return input;}},resolveBinding:()=>({actor:{subjectId:'u'},identity:'bound'}),authorize:()=>true,project:()=>({text:'Which one?'}),allowedTools:[]});
 const message={provider:'test',installationId:'app',conversationId:'c',senderId:'u',eventId:'e',kind:'direct',text:'Do it'};
 await channel.publish(message,'task');await channel.publish(message,'task');reference='2';await channel.publish(message,'task');
 assert.equal(keys[0],keys[1]);assert.notEqual(keys[1],keys[2]);
});
