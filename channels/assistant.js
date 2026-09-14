import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
const id = value => {if (typeof value !== 'string' || !value.trim() || value.length > 500) throw fail('Channel identifier required'); return value;};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Only call from a host that has authenticated the provider's raw request.
export function channelMessage(value) {
  const message = Object.fromEntries(['provider','installationId','conversationId','senderId','eventId'].map(k => [k, id(value?.[k])]));
  if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 16000) throw fail('Bounded text message required');
  if (!['direct','group'].includes(value.kind)) throw fail('Channel conversation kind required');
  return {...message, threadId: value.threadId === undefined || value.threadId === '' ? '' : id(value.threadId), kind: value.kind, text: value.text};
}

export class PostgresChannelInbox {
  constructor({pool, namespace}) {this.pool = pool; this.namespace = id(namespace);}
  async initialize() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS iaic_channel_inbox (
      namespace text NOT NULL, event_key text NOT NULL, binding jsonb NOT NULL,
      message jsonb NOT NULL, result jsonb, PRIMARY KEY(namespace,event_key))`);
  }
  async bind(eventKey, binding, message) {
    await this.pool.query('INSERT INTO iaic_channel_inbox(namespace,event_key,binding,message) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [this.namespace,eventKey,binding,message]);
    const row = (await this.pool.query('SELECT binding,message,result FROM iaic_channel_inbox WHERE namespace=$1 AND event_key=$2', [this.namespace,eventKey])).rows[0];
    if (!isDeepStrictEqual(row.binding,binding) || !isDeepStrictEqual(row.message,message)) throw fail('Channel event is bound to another identity or message',409);
    return row.result;
  }
  async complete(eventKey, result) {
    await this.pool.query('UPDATE iaic_channel_inbox SET result=$3 WHERE namespace=$1 AND event_key=$2 AND result IS NULL', [this.namespace,eventKey,result]);
    return (await this.pool.query('SELECT result FROM iaic_channel_inbox WHERE namespace=$1 AND event_key=$2', [this.namespace,eventKey])).rows[0].result;
  }
}

function command(text, allowedTools) {
  const match = /^\/(reply|status|cancel)\s+(\S+)(?:\s+([\s\S]+))?$/.exec(text.trim());
  if (match) {
    const [,action,taskId,answer] = match;
    if (action === 'reply' && !answer?.trim() || action !== 'reply' && answer) throw fail('Use /reply TASK_ID answer, /status TASK_ID or /cancel TASK_ID');
    return {name: {reply:'tasks.provide_input',status:'tasks.get',cancel:'tasks.cancel'}[action], input:{id:taskId,...(action==='reply'?{input:answer}:{})}};
  }
  if (text.trim().startsWith('/') && !text.trim().startsWith('/new ')) throw fail('Unknown assistant command');
  return {name:'agent.work',input:{goal:text.trim().replace(/^\/new\s+/,''),allowedTools}};
}

// IM is an entry/return channel, never a new Agent identity or execution engine.
export class AssistantChannel {
  constructor({inbox, dispatcher, resolveBinding, authorize, notifications, project, allowedTools}) {
    if (!inbox || !dispatcher || !notifications || [resolveBinding,authorize,project].some(f=>typeof f!=='function') || !Array.isArray(allowedTools)) throw fail('Assistant channel requires trusted binding, policy, inbox, task dispatcher and notification ports');
    Object.assign(this,{inbox,dispatcher,resolveBinding,authorize,notifications,project,allowedTools});
  }
  async binding(message, operation) {
    const binding = await this.resolveBinding(message);
    if (!binding?.actor || !binding.identity || await this.authorize(binding.actor,{message,operation}) !== true) throw fail('Channel user or conversation is not currently authorized',403);
    // identity is an immutable application/assistant/principal binding, not a display name.
    return {...binding, identity:id(binding.identity)};
  }
  async receive(verifiedMessage) {
    const message = channelMessage(verifiedMessage), binding = await this.binding(message,'receive');
    const eventKey = hash([message.provider,message.installationId,message.eventId]);
    let result = await this.inbox.bind(eventKey,{identity:binding.identity},message);
    if (!result) {
      const {name,input} = command(message.text,this.allowedTools);
      const current = await this.binding(message,'execute');
      if (current.identity !== binding.identity) throw fail('Channel user binding changed',403);
      const task = await this.dispatcher.invoke(name,input,{actor:current.actor,callId:'channel:'+eventKey});
      result = await this.inbox.complete(eventKey,{taskId:task.id || input.id,operation:name});
    }
    // Read current task state with current principal checks; never return stored private output.
    return this.publish(message,result.taskId);
  }
  async publish(verifiedMessage, taskId) {
    const message = channelMessage(verifiedMessage), binding = await this.binding(message,'publish');
    const task = await this.dispatcher.invoke('tasks.get',{id:id(taskId)},{actor:binding.actor});
    const projection = await this.project(task,{message,actor:binding.actor});
    if (!projection || typeof projection.text !== 'string' || !projection.text.trim() || projection.text.length > 16000) throw fail('Host must project a bounded, channel-safe task response');
    const current = await this.binding(message,'publish');
    if (current.identity !== binding.identity) throw fail('Channel user binding changed',403);
    const route = Object.fromEntries(['provider','installationId','conversationId','threadId','senderId','kind'].map(k=>[k,message[k]]));
    const receipt = await this.notifications.enqueue(current.actor,{
      requestKey:'channel:'+hash([current.identity,route,taskId,task.status,task.waitingReason,task.inputRequest?.reference,projection]),
      recipientId:hash(route),channel:message.provider,message:projection,
      source:{kind:'assistant-channel',identity:current.identity,route,taskId},
    });
    return {taskId,notification:receipt};
  }
}
