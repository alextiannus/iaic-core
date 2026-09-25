import {fail, text} from './store.js';
export class Inbox {
  constructor({store, resolveScope, authorize, resolveProjection}) {
    if (!store || ['receive','get','list','mark','claim','finish','history'].some(k => typeof store[k] !== 'function') || typeof resolveScope !== 'function' || typeof authorize !== 'function') throw Error('Inbox requires store, trusted scope and current authorization ports');
    Object.assign(this,{store,resolveScope,authorize,resolveProjection});
  }
  async scope(actor, action) {
    if (await this.authorize(actor,{action}) !== true) throw fail('Inbox access denied',403);
    return text(await this.resolveScope(actor));
  }
  async current(actor, action, item) {
    if (!item) throw fail('Inbox item not found',404);
    if (await this.authorize(actor,{action,item}) !== true) throw fail('Inbox item access denied',403);
  }
  async receive(actor, input) {return this.store.receive(await this.scope(actor,'receive'),input);}
  async list(actor, input) {
    const page = await this.store.list(await this.scope(actor,'list'),input);
    // Retained titles are a Host policy; never expose sensitive references in the list.
    return {...page, items: page.items.map(({id,title,category,priority,createdAt,deliveredAt,readAt,archivedAt,version}) => ({id,title,category,priority,createdAt,deliveredAt,readAt,archivedAt,version}))};
  }
  async unreadCount(actor) {return (await this.list(actor,{limit:1})).unreadCount;}
  async get(actor, id) {const value = await this.store.get(await this.scope(actor,'read'),id); await this.current(actor,'read',value); return value;}
  async mark(actor, id, action) {const scope = await this.scope(actor,action); const value = await this.store.get(scope,id); await this.current(actor,'read',value); await this.current(actor,action,value); return this.store.mark(scope,id,action);}
  async markRead(actor,id) {return this.mark(actor,id,'read');}
  async markUnread(actor,id) {return this.mark(actor,id,'unread');}
  async archive(actor,id) {return this.mark(actor,id,'archive');}
  async history(actor,id) {const value = await this.get(actor,id); return this.store.history(value.scopeId,id);}
  async project(actor,id,{kind}) {
    const value = await this.get(actor,id);
    if (!['conversation','task'].includes(kind)) throw fail('Invalid projection kind');
    if (kind === 'task' && !value.actionRef) throw fail('Ordinary notification cannot create a Task',409);
    await this.current(actor,'project:'+kind,value);
    if (typeof this.resolveProjection !== 'function') throw fail('Projection adapter unavailable',409);
    const adapter = await this.resolveProjection(actor,{kind,item:value});
    if (typeof adapter?.send !== 'function' || typeof adapter?.query !== 'function') throw fail('Idempotent send and query ports required',409);
    const {projection:job,claimed} = await this.store.claim(value.scopeId,id,kind,kind === 'task' ? value.actionRef : value.id);
    if (!claimed && job.state !== 'unknown') return job;
    // Recheck after asynchronous resolution/claim and immediately before any Host effect.
    try {await this.current(actor,claimed ? 'project:'+kind : 'reconcile:'+kind,value);}
    catch(error) {if(claimed)await this.store.finish(job,{status:'not_sent'});throw error;}
    let result;
    try {
      const context = {idempotencyKey:job.id,item:value};
      result = claimed ? await adapter.send(context) : await adapter.query(context);
      if (!['delivered','not_sent','unknown'].includes(result?.status) || (result.status === 'delivered' && (typeof result.reference !== 'string' || !result.reference.trim() || result.reference.length > 2000))) result = {status:'unknown'};
    } catch {result = {status:'unknown'};}
    return this.store.finish(job,result.status === 'delivered' ? {status:'delivered',reference:result.reference} : {status:result.status});
  }
}
