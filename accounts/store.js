import fs from 'node:fs/promises';
const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
export function identifier(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw fail('A nonempty identifier is required');
  return value;
}
function revision(value) { if (!Number.isInteger(value) || value < 0 || value >= 2147483647) throw fail('Expected revision is required; use zero to create'); }
function profile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Profile must be a JSON object');
  let encoded, decoded;
  try { encoded = JSON.stringify(value); decoded = JSON.parse(encoded); } catch { throw fail('Profile must be serializable JSON'); }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw fail('Profile must serialize to an object');
  return encoded;
}
const entity = row => row ? {id: row.id, state: row.state, profile: row.profile, revision: row.revision, updatedAt: new Date(row.updated_at).toISOString()} : null;
const member = row => row ? {organizationId: row.organization_id, accountId: row.account_id, state: row.state, roles: row.roles, revision: row.revision, updatedAt: new Date(row.updated_at).toISOString()} : null;
const tableFor = kind => {
  if (kind === 'account') return 'iaic_accounts';
  if (kind === 'organization') return 'iaic_organizations';
  throw fail('Unknown account entity kind');
};

// Trusted storage port. Authorization and credential mapping live in the service/host.
export class PostgresAccountStore {
  constructor({pool, namespace}) { this.pool = pool; this.namespace = identifier(namespace); }
  async initialize() { await this.pool.query(await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8')); }
  async get(kind, id) {
    return entity((await this.pool.query(`SELECT * FROM ${tableFor(kind)} WHERE namespace=$1 AND id=$2`, [this.namespace, identifier(id)])).rows[0]);
  }
  async put(kind, id, {state = 'active', profile: data = {}, expectedRevision}) {
    const table = tableFor(kind); identifier(id); revision(expectedRevision);
    if (!['active', 'suspended'].includes(state)) throw fail('Invalid account or organization state');
    const values = [this.namespace, id, state, profile(data), expectedRevision];
    const query = expectedRevision === 0
      ? `INSERT INTO ${table}(namespace,id,state,profile,revision) SELECT $1,$2,$3,$4::jsonb,1 WHERE $5::integer=0 ON CONFLICT DO NOTHING RETURNING *`
      : `UPDATE ${table} SET state=$3,profile=$4::jsonb,revision=revision+1,updated_at=now() WHERE namespace=$1 AND id=$2 AND revision=$5 RETURNING *`;
    const row = (await this.pool.query(query, values)).rows[0];
    if (!row) throw fail('Entity is missing or its revision changed', 409);
    return entity(row);
  }
  async membership(organizationId, accountId) {
    return member((await this.pool.query('SELECT * FROM iaic_memberships WHERE namespace=$1 AND organization_id=$2 AND account_id=$3', [this.namespace, identifier(organizationId), identifier(accountId)])).rows[0]);
  }
  async putMembership(organizationId, accountId, {state = 'active', roles = [], expectedRevision}) {
    identifier(organizationId); identifier(accountId); revision(expectedRevision);
    if (!['active', 'removed'].includes(state) || !Array.isArray(roles) || roles.some(r => typeof r !== 'string' || !r.trim() || r.length > 200) || new Set(roles).size !== roles.length) throw fail('Invalid membership state or role labels');
    const values = [this.namespace, organizationId, accountId, state, JSON.stringify(roles), expectedRevision];
    const query = expectedRevision === 0
      ? `INSERT INTO iaic_memberships(namespace,organization_id,account_id,state,roles,revision) SELECT $1,$2,$3,$4,$5::jsonb,1 WHERE $6::integer=0 ON CONFLICT DO NOTHING RETURNING *`
      : `UPDATE iaic_memberships SET state=$4,roles=$5::jsonb,revision=revision+1,updated_at=now() WHERE namespace=$1 AND organization_id=$2 AND account_id=$3 AND revision=$6 RETURNING *`;
    let row;
    try { row = (await this.pool.query(query, values)).rows[0]; }
    catch (error) { if (error.code === '23503') throw fail('Account and organization must exist in this namespace', 409); throw error; }
    if (!row) throw fail('Membership is missing or its revision changed', 409);
    return member(row);
  }
  async listMembers(organizationId, {after = '', limit = 50} = {}) {
    identifier(organizationId);
    if (typeof after !== 'string' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('Invalid membership page');
    return (await this.pool.query('SELECT * FROM iaic_memberships WHERE namespace=$1 AND organization_id=$2 AND account_id>$3 ORDER BY account_id LIMIT $4', [this.namespace, organizationId, after, limit])).rows.map(member);
  }
  async listMemberships(accountId, {after = '', limit = 50} = {}) {
    identifier(accountId);
    if (typeof after !== 'string' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('Invalid membership page');
    return (await this.pool.query('SELECT * FROM iaic_memberships WHERE namespace=$1 AND account_id=$2 AND organization_id>$3 ORDER BY organization_id LIMIT $4', [this.namespace, accountId, after, limit])).rows.map(member);
  }
  async access(accountId, organizationId = null) {
    identifier(accountId);
    if (organizationId === null) {
      const account = await this.get('account', accountId);
      return account?.state === 'active' ? {account, organization: null, membership: null} : null;
    }
    identifier(organizationId);
    // A single current database snapshot joins account, organization and membership.
    const row = (await this.pool.query(`SELECT to_jsonb(a) AS account,to_jsonb(o) AS organization,to_jsonb(m) AS membership
      FROM iaic_accounts a JOIN iaic_memberships m ON m.namespace=a.namespace AND m.account_id=a.id
      JOIN iaic_organizations o ON o.namespace=m.namespace AND o.id=m.organization_id
      WHERE a.namespace=$1 AND a.id=$2 AND o.id=$3 AND a.state='active' AND o.state='active' AND m.state='active'`, [this.namespace, accountId, organizationId])).rows[0];
    return row ? {account: entity(row.account), organization: entity(row.organization), membership: member(row.membership)} : null;
  }
}
