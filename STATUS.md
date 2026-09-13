# Candidate status and practical limits

Source revision: `19e80c637e83a16f2197cebacfe729d804ca0e54`.

This standalone repository is public. Its reuse license remains undecided and does not block capability development. Public source availability is not a claim of final framework/application acceptance or support for every environment.

## Usable foundation

The existing modules provide capability contracts/dispatch, a persistent Agent work loop and task/call state, model providers/profiles and per-scope selection, encrypted own-model credentials, platform allowance rules, memory lifecycle operations, selected Skill loading, sourced Knowledge, versioned Workspace artifacts, persistent job identity/configuration, Session timelines, schedules/events/recurring work, Mandates and bounded same-owner handoffs. MCP, HTTP, the remote SDK and ESM expose shared capability contracts.

The configured-job example combines these foundations into scoped work, Session-to-scheduled-task continuity and external Agent access. The other examples demonstrate individual modules or smaller combinations. Methods and resource selectors are injected; there is no dependency on a private application server.

## Boundaries retained

- Currently verified runtime is Node 20. This candidate has not expanded its runtime support claim. PostgreSQL is required by these persistent adapters; alternate database adapters are not supplied.
- Authentication, company sharing, job configuration storage/distribution, business rules and UI belong to applications. Revision comparison inside AgentRegistry is not a distributed configuration transaction.
- Provider Tokens, platform-issued allowance units and actual currency cost are distinct. Payment/top-up fulfillment and provider financial accounting need application integration.
- Memory deletion or source invalidation does not globally erase audit, Session text, externally copied content or all derived artifacts. Automatic knowledge ingestion and complete retention policy are not supplied.
- Schedules may be delayed; an accepted schedule is not a finished task. Closing a Session does not cancel independent work. Multi-party task access and service-principal policy are explicit host choices.
- Collaboration is bounded and same-owner. General cross-principal delegation, complete A2A, every MCP protocol feature and arbitrary remote-tool installation are not claimed.
- Results are checked against the host's verifier. Passing schemas and artifact checks does not prove every generated statement is correct.

## Model evidence

The standalone suite uses deterministic models to verify interfaces and persistence. Earlier bounded real-provider samples proved several working paths, but broad application quality remains incomplete. In a recent Session-continuity sample, the model scheduled work and generated/read the correct artifact after service reconstruction, then repeated reads until the sample's six-call limit. The child remained waiting rather than formally finishing. That sample is retained as partial, not passed; this candidate does not hide it or substitute a deterministic result for model-quality acceptance.

Application-specific report quality and business acceptance remain separate work. The framework can be usable as a foundation while Harness/model execution efficiency and broader community extensions continue to improve.

## Foundational development priorities

The design's complete capability map remains the target; headless design does not remove foundational services from that scope. Current modules are usable building blocks, not completion of the entire map.

1. Protocol access: HTTP discovery/execution and a typed remote client are now supplied alongside MCP export. Explicit MCP tool import with paginated discovery is now available. Explicit JSON HTTP API import is now available with host request/schema/credential bindings. OpenAPI document discovery, A2A and general external identity mapping adapters remain incomplete.
2. Application foundation: allowance accounting, events and workspace persistence exist. A replaceable account/organization/member directory and shared Capability factory are now supplied, including a default PostgreSQL adapter. A separate subscription/entitlement service now supplies plan snapshots, confirmed-source updates, effective periods and replay receipts. Durable notification delivery now has an independent outbox, channel ports and attempt/reconciliation lifecycle. Concrete provider channels, monetary billing defaults and payment/refund adapters are still needed. Applications continue to own business-specific rules and UI.
3. Execution resources: add replaceable device/code execution and sandbox ports; do not place these inside the model loop or business application.
4. Evaluation and evolution: reusable dataset execution, outcome gates, baseline comparison and evidence storage now exist in the evaluation module. Revision/release manifests, experiments/canary and production rollback tooling remain to be built. Repository CI and current runtime version fences are useful parts, not a full general evaluation/release platform. External Codex may act as Platform AI without another mandatory internal Agent.

These items are capability work. Broader security hardening and final acceptance follow usable foundational implementations, without changing the design's concepts or adding mandatory role classes.
