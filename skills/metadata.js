import path from 'node:path';
import {parseDocument} from 'yaml';

const invalid = message => Object.assign(new Error(`Invalid Skill metadata: ${message}`), {statusCode:400});
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Metadata describes applicability. In particular, allowed-tools never grants
// authority; the application's capability registry remains authoritative.
export function skillMetadata(text, entry) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0] !== '---') {
    const name = lines.find(line => line.startsWith('# '))?.slice(2).trim() || path.basename(path.dirname(entry));
    const description = lines.find(line => line.trim() && !line.startsWith('#')) || name;
    return {name, description:description.slice(0,600), format:'legacy-markdown'};
  }
  const end = lines.indexOf('---', 1);
  if (end < 0) throw invalid('frontmatter must have a closing delimiter');
  const document = parseDocument(lines.slice(1,end).join('\n'), {schema:'core', uniqueKeys:true});
  if (document.errors.length || document.warnings.length) throw invalid('frontmatter must be unambiguous YAML');
  let data;
  try { data = document.toJS({maxAliasCount:0}); } catch { throw invalid('aliases are unsupported'); }
  if (!record(data)) throw invalid('frontmatter must be a mapping');
  if (typeof data.name !== 'string' || data.name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name) || data.name !== path.basename(path.dirname(entry))) throw invalid('name must match its directory and use lowercase letters, numbers and single hyphens');
  if (typeof data.description !== 'string' || !data.description.trim() || data.description.length > 1024) throw invalid('description must contain 1–1024 characters');
  const result = {name:data.name, description:data.description, format:'agent-skills'};
  for (const key of ['license','compatibility','allowed-tools']) {
    if (data[key] === undefined) continue;
    if (typeof data[key] !== 'string' || !data[key].trim() || (key === 'compatibility' && data[key].length > 500)) throw invalid(`${key} must be a nonempty string within its limit`);
    result[key] = data[key];
  }
  if (data.metadata !== undefined) {
    if (!record(data.metadata) || Object.values(data.metadata).some(value => typeof value !== 'string')) throw invalid('metadata must map strings to strings');
    result.metadata = data.metadata;
  }
  return result;
}
