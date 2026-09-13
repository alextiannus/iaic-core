import {defineCapability} from '../capabilities/index.js';
const id = {type: 'string', minLength: 1, maxLength: 500};
const revision = {type: 'integer', minimum: 0, maximum: 2147483646};
const object = (properties, required) => ({type: 'object', properties, required, additionalProperties: false});
const entity = object({id, state: {enum: ['active', 'suspended']}, profile: {type: 'object'}, revision: {type: 'integer', minimum: 1}, updatedAt: {type: 'string'}}, ['id','state','profile','revision','updatedAt']);
const member = object({organizationId: id, accountId: id, state: {enum: ['active','removed']}, roles: {type: 'array', items: {type: 'string'}}, revision: {type: 'integer', minimum: 1}, updatedAt: {type: 'string'}}, ['organizationId','accountId','state','roles','revision','updatedAt']);
const nullable = schema => ({anyOf: [schema, {type: 'null'}]});
const page = {after: {type: 'string'}, limit: {type: 'integer', minimum: 1, maximum: 100}};

export function createAccountCapabilities({directory, prefix = 'directory'}) {
  const capabilities = [];
  const add = (name, description, input, output, execute, write = false) => {
    const read = (value, {actor}) => execute(actor, value);
    capabilities.push(defineCapability({name: `${prefix}.${name}`, description, input, output, effect: write ? 'write' : 'read',
      ...(write ? {retry: 'never-replay'} : {revalidate: (value, _previous, context) => read(value, context)}),
      authorize: async actor => {await directory.current(actor); return true;},
      implementation: {kind: 'function', execute: read}}));
  };
  for (const kind of ['account', 'organization']) {
    add(`${kind}.read`, `Read an authorized ${kind} profile and current lifecycle revision.`, object({id}, ['id']), nullable(entity), (actor, value) => directory.get(actor, kind, value.id));
    add(`${kind}.write`, `Create or replace an authorized ${kind}. Zero expectedRevision creates; existing records require their current revision. State/profile are replaced, not merged. After a lost response, read current state before deciding next steps.`,
      object({id, expectedRevision: revision, state: {enum: ['active','suspended']}, profile: {type: 'object'}}, ['id','expectedRevision','state','profile']), entity,
      (actor, {id, ...value}) => directory.put(actor, kind, id, value), true);
  }
  add('membership.read', 'Read an authorized organization membership and its current revision.', object({organizationId: id, accountId: id}, ['organizationId','accountId']), nullable(member),
    (actor, value) => directory.membership(actor, value.organizationId, value.accountId));
  add('membership.write', 'Create or replace membership state and role labels using its expected revision. Role labels do not grant permissions without host policy. Removal does not delete domain data.',
    object({organizationId: id, accountId: id, expectedRevision: revision, state: {enum: ['active','removed']}, roles: {type: 'array', items: {type: 'string', minLength: 1, maxLength: 200}, uniqueItems: true}}, ['organizationId','accountId','expectedRevision','state','roles']), member,
    (actor, {organizationId, accountId, ...value}) => directory.putMembership(actor, organizationId, accountId, value), true);
  add('membership.list', 'List authorized memberships, including removed records. Page after the last accountId.', object({organizationId: id, ...page}, ['organizationId']), {type: 'array', items: member},
    (actor, {organizationId, ...value}) => directory.listMembers(actor, organizationId, value));
  add('membership.list_for_account', 'List an authorized account\'s organization memberships. Page after the last organizationId. Membership existence is not active access.', object({accountId: id, ...page}, ['accountId']), {type: 'array', items: member},
    (actor, {accountId, ...value}) => directory.listMemberships(actor, accountId, value));
  return capabilities;
}
