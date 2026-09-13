import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const url=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;
if(!url)throw new Error('Set SUBMISSION_TEST_DATABASE_URL to an isolated PostgreSQL database');
const env={...process.env,DATABASE_URL:url,SUBMISSION_TEST_DATABASE_URL:url};delete env.DEMO_MODEL_API_KEY;
const examples=["core-notes", "core-workspace", "core-assistant", "core-knowledge", "core-sessions", "core-deferred", "core-identities", "core-triggers", "core-recurring", "core-events", "core-mandates", "core-mcp", "core-handoffs", "core-agent-composition", "core-result-waits", "core-usage-reconciliation", "core-configurable-jobs", "core-http", "core-mcp-import", "core-accounts"];
for(const name of examples){const r=spawnSync(process.execPath,['examples/'+name+'/run.mjs'],{cwd:root,env,encoding:'utf8',timeout:180000});if(r.status!==0){process.stderr.write(r.stderr||r.stdout);throw new Error(name+' failed');}process.stdout.write(r.stdout);}
console.log(JSON.stringify({examples:examples.length,status:'passed',modelMode:'deterministic'}));
