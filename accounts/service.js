import {identifier} from './store.js';
const fail = (message, statusCode) => Object.assign(new Error(message), {statusCode});

export class AccountDirectory {
  constructor({store, namespace, resolveIdentity, authorize}) {
    if (!store || ['get','put','membership','putMembership','listMembers','listMemberships','access'].some(name => typeof store[name] !== 'function') || typeof resolveIdentity !== 'function' || typeof authorize !== 'function') throw new Error('AccountDirectory requires a store, identity resolver and authorization policy');
    this.store = store; this.namespace = identifier(namespace); this.resolveIdentity = resolveIdentity; this.authorize = authorize;
    if (store.namespace !== undefined && store.namespace !== this.namespace) throw new Error('Directory and store namespaces must agree');
  }
  // Credentials are interpreted by the host. Model arguments cannot select identity.
  async actor(credentialContext) {
    const identity = await this.resolveIdentity(credentialContext);
    if (!identity?.accountId) throw fail('Authenticated account required', 401);
    const current = await this.store.access(identity.accountId, identity.organizationId ?? null);
    if (!current) throw fail('Account or organization membership is inactive', 403);
    return Object.freeze({subjectId: current.account.id, organizationId: current.organization?.id ?? null,
      scopeId: JSON.stringify([this.namespace, current.organization?.id ?? null, current.account.id])});
  }
  async current(actor) {
    if (!actor?.subjectId || actor.scopeId !== JSON.stringify([this.namespace, actor.organizationId ?? null, actor.subjectId])) throw fail('Directory actor required', 401);
    const current = await this.store.access(actor.subjectId, actor.organizationId ?? null);
    if (!current) throw fail('Account or organization membership is inactive', 403);
    return current;
  }
  async permitted(actor, action, target) {
    const current = await this.current(actor);
    if (await this.authorize({actor, current, action, target}) !== true) throw fail('Directory operation denied', 403);
  }
  async get(actor, kind, id) { await this.permitted(actor, kind + '.read', {id}); return this.store.get(kind, id); }
  async put(actor, kind, id, value) { await this.permitted(actor, kind + '.write', {id, value}); return this.store.put(kind, id, value); }
  async membership(actor, organizationId, accountId) { await this.permitted(actor, 'membership.read', {organizationId, accountId}); return this.store.membership(organizationId, accountId); }
  async putMembership(actor, organizationId, accountId, value) { await this.permitted(actor, 'membership.write', {organizationId, accountId, value}); return this.store.putMembership(organizationId, accountId, value); }
  async listMembers(actor, organizationId, page) { await this.permitted(actor, 'membership.list', {organizationId}); return this.store.listMembers(organizationId, page); }
  async listMemberships(actor, accountId, page) { await this.permitted(actor, 'membership.listForAccount', {accountId}); return this.store.listMemberships(accountId, page); }
}
