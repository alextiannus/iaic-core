export const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
export function key(value) { if (typeof value !== 'string' || !value.trim() || value.length > 500) throw fail('Nonempty subscription identifier required'); return value; }
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export function plan(value) {
  const id = key(value?.id), version = key(value?.version), entitlements = value.entitlements;
  if (!entitlements || typeof entitlements !== 'object' || Array.isArray(entitlements) || Object.entries(entitlements).some(([name, v]) => !name.trim() || !['boolean','string','number'].includes(typeof v) || (typeof v === 'number' && (!Number.isFinite(v) || v < 0)))) throw fail('Plan entitlements require named boolean, string or nonnegative numeric values');
  return {id, version, entitlements: canonical(entitlements)};
}
export function snapshot(value) {
  if (!Number.isInteger(value?.sequence) || value.sequence < 1 || value.sequence >= 2147483647 || !['active','paused','cancelled'].includes(value.state)) throw fail('Subscription requires positive source sequence and a valid state');
  const timestamp = v => { if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw fail('Subscription period requires timestamps'); return new Date(v).toISOString(); };
  const validFrom = timestamp(value.validFrom), validUntil = timestamp(value.validUntil);
  if (Date.parse(validUntil) <= Date.parse(validFrom)) throw fail('Subscription period must end after its start');
  return {sequence: value.sequence, state: value.state, validFrom, validUntil, plan: plan(value.plan)};
}
