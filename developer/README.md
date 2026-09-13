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

Verified paths include an installed npm bin, generation plus independent npm installation and application contract test, actual CLI HTTP request envelopes, concurrent PostgreSQL migration runs, digest drift rejection and rollback after a failing script. The persistent Agent template is described below; a default local Docker deployment adapter is described below; cloud provider adapters remain incomplete.

## Persistent Agent template

Use `--template agent` to generate an application with the existing AgentRegistry/Runtime, Task, scoped Memory/Workspace/Knowledge, selected Skills, Session references, model profiles and platform allowance. It adds application-owned app.mjs composition, job.json configuration, server/config/grant scripts and deterministic tests. It does not add another Runtime or force a role taxonomy. The generated README explains real model configuration, explicit allowance issuance and the host outcome verifier.

Its independent installation test closes the originating Session, changes the default model and executes queued work in a separate Node process. The task retains the original model, resources and identity; saved artifacts and allowance settlement survive. This verifies queued-work process separation, not a process kill during an external write or actual-model quality. Scheduling/Mandate/handoff modules remain reusable but are not automatically wired into this minimal starter.

## Deployment adapter

The CLI accepts a trusted configuration module exporting `open(): {adapter, close?}`. An adapter implements `deploy(requestKey)`, `inspect(requestKey)` and `stop(requestKey)`, returning JSON receipts. Host/provider errors that may follow acceptance must carry `outcomeUnknown: true` and the original requestKey. The CLI never retries deployments. Applications may supply their own cloud adapter without importing a Docker implementation or changing Capability/Agent modules.

```sh
iaic deploy --config ./deployment.mjs --request-key release-2026-09-13
iaic deployment-status --config ./deployment.mjs --request-key release-2026-09-13
iaic deployment-stop --config ./deployment.mjs --request-key release-2026-09-13
```

The supplied `DockerDeployment` default starts a long-lived application from an already available immutable image. This differs from the bounded code-execution sandbox. Configuration is trusted host code:

```js
import {DockerDeployment} from '@immedi/iaic-core';
export async function open() {
  return {adapter: new DockerDeployment({
    namespace: 'my-app',
    image: process.env.APP_IMAGE_DIGEST,
    command: ['node', '/app/server.mjs'],
    containerPort: 3000,
    healthPath: '/health',
    environment: () => ({DATABASE_URL: process.env.DATABASE_URL})
  })};
}
```

The image must end in an immutable sha256 digest (or be a local sha256 image ID); prebuild/pull it separately. The process must listen on 0.0.0.0 inside its container and implement an unauthenticated health endpoint that returns 200 only when ready. No host paths or Docker socket are mounted. Applications persist data in separately configured database/object services. The container uses a non-root numeric user, read-only root, bounded temporary storage, removed Linux capabilities and explicit CPU/memory/process limits. Default egress uses Docker networking; this is a trusted deployed application, not an untrusted-code execution boundary.

The default adapter binds an ephemeral port to host loopback and reports its endpoint. Health probes use a fixed local HTTP path, refuse redirects and have a two-second deadline. Inspect returns absent, prepared, starting, ready, stopped or unknown plus an exact container ID. A ready receipt establishes the health response, not business-goal completion. A reverse proxy/TLS/public route and production identity integration remain host responsibilities; automatically switching public traffic between releases is not supplied.

Namespace and request key select a durable Docker container name. Nonsecret configuration is bound by digest; changing image/command/resources under that key is rejected. Deploy also checks supplied environment keys and values against the existing container before returning it. Environment values go through Docker's stdin env-file, not shell command text, arguments, receipt JSON or labels. The Docker daemon still holds those values in its normal container configuration; credentials must come from trusted host configuration. Do not put secrets into command arguments or the namespace.

A repeated deployment returns the original container without restarting it, including after it stopped. A lost create/start response is unconfirmed: use deployment-status with the same key. If a crash leaves only a prepared container, this adapter does not automatically start it. Stop shuts down a running container and retains its receipt; it does not claim to cancel an in-flight create/start or remove containers. Host reconciliation/cleanup handles abandoned prepared containers explicitly. Distinct release keys create distinct instances; image build, durable desired-state reconciliation, cloud deployment, traffic activation/rollback and automatic retention are not yet included.

The independent core-deployment example uses a real Docker HTTP workload, deployment/status/stop CLI processes, reconstruction, stable instance identity, changed-config rejection and a deliberately lost start acknowledgement. It verifies authenticated workload access and keeps secret values out of returned receipts. Its fixture containers are explicitly removed after verification; no production application or database is changed.
