import {fail} from './store.js';
export class Notifications {
  constructor({store, resolveScope, authorize, resolveDelivery}) {
    if (!store || ['enqueue','get','claim','recoverExpired','canSend','finish','control','history'].some(name => typeof store[name] !== 'function') || typeof resolveScope !== 'function' || typeof authorize !== 'function' || typeof resolveDelivery !== 'function') throw new Error('Notifications requires storage, scope, authorization and delivery resolver ports');
    Object.assign(this, {store, resolveScope, authorize, resolveDelivery});
  }
  async scope(actor, action, input) {
    if (await this.authorize(actor, {action, input}) !== true) throw fail('Notification access denied', 403);
    return this.resolveScope(actor);
  }
  async enqueue(actor, input) {return this.store.enqueue(await this.scope(actor, 'enqueue', input), input);}
  async get(actor, input) {return this.store.get(await this.scope(actor, 'read', input), input.requestKey);}
  async history(actor, input) {return this.store.history(await this.scope(actor, 'read', input), input.requestKey);}
  async retry(actor, input) {return this.store.control(await this.scope(actor, 'retry', input), input.requestKey, 'retry');}
  async cancel(actor, input) {return this.store.control(await this.scope(actor, 'cancel', input), input.requestKey, 'cancel');}
  async tick({leaseSeconds = 60, signal} = {}) {
    await this.store.recoverExpired();
    const job = await this.store.claim({leaseSeconds});
    if (!job) return null;
    let delivery;
    try {
      if (signal?.aborted) throw new Error('Worker stopped before send');
      delivery = await this.resolveDelivery(job);
      if (delivery?.allowed !== true || typeof delivery?.send !== 'function') throw new Error('Delivery is not currently authorized');
    } catch {
      return this.store.finish(job, {status: 'not_sent', reason: 'delivery-unavailable-before-send'});
    }
    if (!await this.store.canSend(job)) return this.store.get(job.scopeId, job.requestKey);
    if (signal?.aborted) return this.store.finish(job, {status: 'not_sent', reason: 'worker-stopped-before-send'});
    let result;
    try {
      result = await delivery.send({idempotencyKey: job.id, message: job.message, source: job.source, signal});
      if (!['delivered','not_sent','unknown'].includes(result?.status)) result = {status: 'unknown', reason: 'unrecognized-channel-result'};
    } catch {result = {status: 'unknown', reason: 'delivery-response-unavailable'};}
    return this.store.finish(job, result);
  }
  async reconcile(actor, input) {
    const scope = await this.scope(actor, 'reconcile', input), job = await this.store.get(scope, input.requestKey);
    if (!job || job.state !== 'unknown') throw fail('Notification has no unknown delivery to reconcile', 409);
    const delivery = await this.resolveDelivery(job);
    if (delivery?.allowed !== true || typeof delivery?.query !== 'function') throw fail('Authorized notification reconciliation unavailable', 409);
    const result = await delivery.query({idempotencyKey: job.id});
    if (!['delivered','not_sent','unknown'].includes(result?.status)) throw fail('Invalid reconciliation result', 502);
    return this.store.finish(job, result);
  }
}
