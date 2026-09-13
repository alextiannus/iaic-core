import {fail, key} from './contracts.js';
export class Subscriptions {
  constructor({store, plans, resolveScope, authorize, resolveSource, now = () => new Date()}) {
    if (typeof store?.get !== 'function' || typeof store?.apply !== 'function' || typeof plans?.get !== 'function' || typeof resolveScope !== 'function' || typeof authorize !== 'function' || typeof resolveSource !== 'function' || typeof now !== 'function') throw new Error('Subscriptions requires store, plans, scope, policy, verified source and clock ports');
    Object.assign(this, {store, plans, resolveScope, authorize, resolveSource, now});
  }
  async scope(actor, action, input) {
    if (await this.authorize(actor, {action, input}) !== true) throw fail('Subscription access denied', 403);
    return key(await this.resolveScope(actor));
  }
  async read(actor) {
    const scopeId = await this.scope(actor, 'read', {}), subscription = await this.store.get(scopeId);
    const instant = new Date(this.now());
    if (!Number.isFinite(instant.getTime())) throw fail('Subscription clock unavailable', 503);
    const effective = Boolean(subscription && subscription.state === 'active' && Date.parse(subscription.validFrom) <= instant.getTime() && instant.getTime() < Date.parse(subscription.validUntil));
    return {subscription, checkedAt: instant.toISOString(), effective, entitlements: effective ? structuredClone(subscription.plan.entitlements) : {}};
  }
  async require(actor, entitlement, {atLeast} = {}) {
    key(entitlement);
    if (atLeast !== undefined && (!Number.isFinite(atLeast) || atLeast < 0)) throw fail('Numeric entitlement requirement must be finite and nonnegative');
    const current = await this.read(actor), value = current.entitlements[entitlement];
    if (!current.effective || (atLeast === undefined ? value !== true : typeof value !== 'number' || value < atLeast)) throw fail('Subscription entitlement unavailable', 403);
    return {entitlement, value, revision: current.subscription.revision, checkedAt: current.checkedAt};
  }
  async apply(actor, {sourceId, expectedRevision}) {
    key(sourceId);
    const scopeId = await this.scope(actor, 'apply', {sourceId});
    const source = await this.resolveSource(sourceId, {actor, scopeId});
    if (!source || source.sourceId !== sourceId || source.scopeId !== scopeId || source.confirmed !== true) throw fail('Subscription source is not confirmed for this scope', 409);
    return this.store.apply({scopeId, sourceId, expectedRevision, sequence: source.sequence, state: source.state, validFrom: source.validFrom, validUntil: source.validUntil, plan: this.plans.get(source.planId, source.planVersion)});
  }
}
