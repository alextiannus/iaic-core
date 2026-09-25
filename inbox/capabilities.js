import {defineCapability} from '../capabilities/index.js';
const id = {type:'string',minLength:1,maxLength:100};
export function createInboxCapabilities({inbox,prefix='inbox'}) {
  return ['list','get','unreadCount','markRead','markUnread','archive','history','project'].map(operation => {
    const read = ['list','get','unreadCount','history'].includes(operation);
    const properties = operation === 'list' ? {before:{type:'string'},limit:{type:'integer',minimum:1,maximum:100},archived:{type:'boolean'}} : operation === 'unreadCount' ? {} : {id,...(operation === 'project' ? {kind:{enum:['conversation','task']}} : {})};
    const execute = (input,{actor}) => operation === 'list' ? inbox.list(actor,input) : operation === 'project' ? inbox.project(actor,input.id,{kind:input.kind}) : inbox[operation](actor,input.id);
    return defineCapability({name:`${prefix}.${operation.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())}`,description:`${operation} the current user's Inbox. Reading is not business completion; Task projection requires an action reference and current permission.`,
      input:{type:'object',properties,required:['list','unreadCount'].includes(operation)?[]:operation==='project'?['id','kind']:['id'],additionalProperties:false},
      output:operation==='unreadCount'?{type:'integer'}:operation==='history'?{type:'array',items:{type:'object'}}:{type:'object'},effect:read?'read':'write',
      ...(read?{revalidate:(input,_old,context)=>execute(input,context)}:{retry:'never-replay'}),authorize:async()=>true,implementation:{kind:'function',execute}});
  });
}
