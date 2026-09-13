import {defineCapability} from '../capabilities/index.js';
export function createSubscriptionCapabilities({subscriptions, prefix = 'subscriptions'}) {
  const read = (_input, {actor}) => subscriptions.read(actor);
  return [defineCapability({name: `${prefix}.read`, description: 'Read the current scoped subscription and effective entitlements. Expiry is checked now. Entitlements are not a spendable platform allowance or provider Token balance.',
    input: {type: 'object', properties: {}, additionalProperties: false}, output: {type: 'object', required: ['subscription','checkedAt','effective','entitlements'], properties: {subscription: {type: ['object','null']}, checkedAt: {type: 'string'}, effective: {type: 'boolean'}, entitlements: {type: 'object'}}, additionalProperties: false},
    effect: 'read', authorize: async () => true, revalidate: (input, _old, context) => read(input, context), implementation: {kind: 'function', execute: read}}),
    defineCapability({name: `${prefix}.apply`, description: 'Apply a trusted confirmed subscription source using expectedRevision (zero creates). The host source defines scope, plan, sequence and period; caller input cannot set them. The receipt may describe a historical replay; read current subscription separately.',
      input: {type: 'object', properties: {sourceId: {type: 'string', minLength: 1, maxLength: 500}, expectedRevision: {type: 'integer', minimum: 0, maximum: 2147483646}}, required: ['sourceId','expectedRevision'], additionalProperties: false},
      output: {type: 'object', properties: {subscription: {type: 'object'}, replayed: {type: 'boolean'}}, required: ['subscription','replayed'], additionalProperties: false},
      effect: 'write', retry: 'idempotent', authorize: async () => true, implementation: {kind: 'function', execute: (input, {actor}) => subscriptions.apply(actor, input)}})];
}
