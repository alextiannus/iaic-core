# Developer tools

Install the Core archive in a project to obtain its `iaic` npm executable. The CLI returns JSON, exits nonzero on error and does not automatically retry writes. `IAIC_BEARER_TOKEN` supplies credentials without placing them in command arguments. Commands:

```sh
iaic list --url https://your-host/capabilities
iaic call notes.read --url https://your-host/capabilities --input input.json
iaic call notes.write --url https://your-host/capabilities --input input.json --request-key stable-request-id
iaic init ./my-app --core-package /absolute/path/to/immedi-iaic-core-0.1.0.tgz
iaic init ./my-agent --core-package /absolute/path/to/immedi-iaic-core-0.1.0.tgz --template agent
iaic migrate --config ./migrations.mjs
```

List/call use the existing HTTP client and preserve its permissions, input/output schemas, task receipts and unknown-outcome guidance. Input is a JSON file, not shell-evaluated source. Keep the same request key and reconcile after a lost write response. The current CLI request deadline is 30 seconds; durable tasks continue on their existing server path.

## Application starter

Init creates a new directory with a local-only capability HTTP server, its contract test, package manifest and a copied Core archive. Existing directories are rejected. Run npm install, npm test, and set APP_TOKEN before npm start. The server defaults to loopback port 3000. Its identity mapping is a development fixture; the application supplies production authentication, TLS and hosting. This is a Capability starter, not a completed AI Native Application or an imposed Assistant UI. Add Core Runtime, Task, Session, Memory, Knowledge, Skills and model modules for the application's responsibilities; see the configured-jobs example for their existing composition.

The archive is explicitly supplied because this source candidate has not been published to the npm registry. Copying it into vendor keeps the generated project independent of the original checkout. Init never installs dependencies or deploys automatically.

## PostgreSQL migration adapter

A trusted local configuration module exports `async open()` returning `{pool,namespace,migrations,close?}`. Migrations are ordered `{id,sql}` entries with unique ascending IDs. The CLI closes the supplied connection resource when complete. `migratePostgres` is also an independently usable library function and leaves pool ownership with its caller.

```js
import {Pool} from 'pg';
export async function open() {
  return {
    pool: new Pool({connectionString: process.env.DATABASE_URL}),
    namespace: 'my-application',
    migrations: [{id: '001', sql: 'CREATE TABLE example_items(id text PRIMARY KEY)'}]
  };
}
```

The adapter serializes migration batches within a database schema, records IDs/order/SHA-256 digests, rejects removed/reordered/edited history, and applies all pending scripts and their records in one transaction. Scripts must not manage transactions themselves or use statements incompatible with a transaction, such as CREATE INDEX CONCURRENTLY. This runner does not infer data migrations or reverse destructive changes. Application authors own the SQL and rollback strategy. Existing Core store initialize methods remain independent; they are not silently replaced by a universal schema migration.

Verified paths include an installed npm bin, generation plus independent npm installation and application contract test, actual CLI HTTP request envelopes, concurrent PostgreSQL migration runs, digest drift rejection and rollback after a failing script. The persistent Agent template is described below; deployment-provider adapters remain incomplete.

## Persistent Agent template

Use `--template agent` to generate an application with the existing AgentRegistry/Runtime, Task, scoped Memory/Workspace/Knowledge, selected Skills, Session references, model profiles and platform allowance. It adds application-owned app.mjs composition, job.json configuration, server/config/grant scripts and deterministic tests. It does not add another Runtime or force a role taxonomy. The generated README explains real model configuration, explicit allowance issuance and the host outcome verifier.

Its independent installation test closes the originating Session, changes the default model and executes queued work in a separate Node process. The task retains the original model, resources and identity; saved artifacts and allowance settlement survive. This verifies queued-work process separation, not a process kill during an external write or actual-model quality. Scheduling/Mandate/handoff modules remain reusable but are not automatically wired into this minimal starter.
