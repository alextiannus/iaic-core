import {defineCapability} from '../capabilities/index.js';
const key = {type: 'string', minLength: 1, maxLength: 500};
const input = {type: 'object', properties: {requestKey: key}, required: ['requestKey'], additionalProperties: false};
export function createNotificationCapabilities({notifications, prefix = 'notifications'}) {
  return ['enqueue','get','history','retry','cancel','reconcile'].map(operation => {
    const read = ['get','history'].includes(operation), execute = (value, {actor}) => notifications[operation](actor, value);
    return defineCapability({name: `${prefix}.${operation}`, description: ({
      enqueue: 'Queue a notification for a logical recipient/channel under a stable requestKey. This is admission, not proof of delivery. The host resolves destination and current send permission.',
      get: 'Read the current scoped notification state and channel receipt. Delivered means the adapter-defined delivery milestone, not necessarily human reading.',
      history: 'Read the persisted delivery attempts for this scoped notification.',
      retry: 'Explicitly retry a notification only after definitive non-delivery. Unknown outcomes must be reconciled first.',
      cancel: 'Cancel a pending notification. Already sending or delivered notifications cannot be undone here.',
      reconcile: 'Query the authorized channel for an unknown delivery using the original identity. Does not send another notification.'
    })[operation], input: operation === 'enqueue' ? {type: 'object', properties: {requestKey: key, recipientId: key, channel: key, message: {type: 'object'}, source: {type: 'object'}}, required: ['requestKey','recipientId','channel','message'], additionalProperties: false} : input,
    output: operation === 'history' ? {type: 'array', items: {type: 'object'}} : {type: ['object','null']}, effect: read ? 'read' : 'write',
    ...(read ? {revalidate: (value, _old, context) => execute(value, context)} : {retry: operation === 'enqueue' ? 'idempotent' : 'never-replay'}),
    authorize: async () => true, implementation: {kind: 'function', execute}});
  });
}
