# Persistent Agent application starter

This is application-owned glue over the existing Core Runtime and resource modules. It supplies a configurable persistent working subject with scoped Memory, Workspace, selected Skills, sourced Knowledge, Session links, independent model settings and platform allowance accounting. It has no UI or mandatory role taxonomy. It does not copy an external companion framework.

Install with `npm install --ignore-scripts`. Set an isolated `SUBMISSION_TEST_DATABASE_URL` and run `npm test`. The test submits work, closes its Session, changes the default model, stops the initial Runtime, then runs queued work in a separate Node process. It confirms original model binding, existing resources, artifact references, scoped access and allowance settlement, plus pause on zero allowance and resume after explicit funding. `fixture-model.mjs` is only for this deterministic test; the real server never imports it. This is process-separated queued-work recovery, not a kill during a remote write or real-model quality acceptance.

For actual use, set DATABASE_URL, APP_TOKEN, APP_SUBJECT, APP_ORGANIZATION, IAIC_MODEL and AI_API_KEY. Optionally set IAIC_PROVIDER=chat-completions and IAIC_MODEL_BASE_URL to a compatible HTTPS base endpoint. Run `npm start`; it binds loopback port 3000 by default. Replace the single-user token mapping in server.mjs with application authentication and current organization membership checks before wider use.

The model defaults to the configured system profile. No platform allowance is granted automatically. A trusted local operator can explicitly run `npm run grant -- 1000000 UNIQUE_REFERENCE`; these are platform-issued units, not currency or literal provider Token credits. Model calls reserve and settle through the existing ledger and stop when allowance is insufficient. `config.mjs` contains starter allowance rates that the application owns. `openApplication` also accepts the existing userModels port for BYOK; no separate model or billing engine is introduced.

Call `agent.work` through `/capabilities/agent.work` with a stable requestKey and input containing goal, requiredArtifacts and an explicit allowedTools subset from job.json. Query `/capabilities/tasks.get` with `{id}` use tasks.cancel for cancellation, and tasks.resume after restoring allowance or resolving another resumable wait. An input-required wait still requires the existing host Runtime input flow. Direct resource tools use the same authorized dispatcher. The SDK exposes models, memory, sessions and knowledge modules for host integrations; there is no generic UI or public allowance-grant endpoint.

Edit job.json for responsibility, selected Skills, Knowledge IDs and available tools. Knowledge content and user memory remain in their existing stores; this starter does not invent source records. The host may populate them through app.knowledgeStore/app.memory with its own authorization. The default runtime revision hashes app/config/server code, job configuration, selected Skill files and the pinned Core archive at startup; changed executable resources cannot silently resume an old binding. Applications adding other executable resources must include them in this revision or bind their evaluated release manifest. Default resource scope distinguishes organization plus user and job; sharing is an explicit application policy.

The example verifier checks artifact and tool evidence. Replace config.mjs verifyOutcome with independent checks for the application's actual goal; do not treat this fixture as semantic certification. Proactive scheduling, Mandates, handoffs, provider-specific deployment, webhook adapters and richer model-management endpoints can use the existing modules but are not wired into this minimal template. Graceful shutdown closes the shared Runtime; database pool ownership remains with the host composition.

## Optional gateway composition

`openApplication` accepts optional `routing: {resolvePolicy, availability}` and returns `app.modelRouting` (null by default). These are the existing AssistantModelRouting ports: provide current authorized ordered profile IDs with a policy revision, plus trusted availability signals. The first route must match the selected profile for new Tasks. All alternatives use the same credential mode. Old Tasks resolve only their original model; changing health/default preference cannot silently replace it. Keep current application checks in the policy. No automatic routing policy is inferred from environment or model output.

For shared provider capacity/rates, initialize PostgresModelCapacity and PostgresModelRateLimits in host code before openApplication. Use the existing modelFactory port:

```js
import {createModelProvider, rateLimitedModel, capacityModel} from '@immedi/iaic-core';
const app = await openApplication({
  ...applicationOptions,
  routing: {resolvePolicy, availability},
  modelFactory: config => rateLimitedModel({
    model: capacityModel({model: createModelProvider(config), capacity}),
    rates,
    maximumTokens: request => trustedTokenUpperBound(request),
  }),
});
```

Here capacity/rates are already initialized stores for the correct provider account. For multiple accounts/deployments, select their own stores in the factory. The app still owns pool lifetime and all credentials/configuration. AssistantModels applies the original per-profile ledger wrapper outside these providers; do not wrap another metered gateway inside modelFactory. No allowance is issued automatically, and BYOK behavior remains unchanged. Read Core agent/RATES.md for fixed-window semantics and estimator requirements.

The second generated test exercises these actual modules with PostgreSQL, confirms selected fallback persistence through service reconstruction, verifies settled rate/capacity/allowance state and current route revocation. Its provider and health signals are fixtures; it is not a real-model failover or process-kill test. Optional retention cleanup remains a separate explicit host policy; it is not enabled by this starter.
