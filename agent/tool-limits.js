// Host-defined, per-Task attempt ceilings. These never grant Tool authority.
export function toolCallLimits(value, tools) {
  if (value === undefined) return undefined;
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Object.entries(value).some(([name, limit]) => !tools.includes(name) || !Number.isSafeInteger(limit) || limit < 0)) {
    throw new Error('Tool call limits must map declared Agent tools to nonnegative safe integers');
  }
  return Object.freeze({...value});
}

export function remainingToolAttempts(limits, calls, allowedTools) {
  return Object.fromEntries(Object.entries(limits ?? {}).filter(([name]) => allowedTools.includes(name))
    .map(([name, limit]) => [name, Math.max(0, limit - calls.filter(call => call.capability === name).length)]));
}
