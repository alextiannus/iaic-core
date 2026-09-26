// Host policy only. Never consume overrides from Agent input or model output.
export function capabilityExecutionLimits(dispatcher, overrides = {}) {
  if (!overrides || Array.isArray(overrides) || typeof overrides !== 'object') throw new Error('Capability execution limits must be an object');
  const configured = {};
  for (const [name, value] of Object.entries(overrides)) {
    if (dispatcher.capabilities.get(name)?.implementation.kind !== 'agent') throw new Error('Execution limits require a registered Agent capability');
    if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !['maxCalls','maxTurns'].includes(key))) throw new Error('Unsupported capability execution limit');
    for (const bound of Object.values(value)) if (!Number.isInteger(bound) || bound < 1 || bound > 1000) throw new Error('Capability execution limits must be integers from 1 to 1000');
    configured[name] = Object.freeze({...value});
  }
  return Object.freeze(configured);
}
