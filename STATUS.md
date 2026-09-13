# Candidate status and practical limits

Source revision: `19e80c637e83a16f2197cebacfe729d804ca0e54`.

This candidate is private and has no selected open-source license yet. It is a standalone extraction for review and reuse preparation, not a claim of public publication, final application acceptance or support for every environment.

## Usable foundation

The existing modules provide capability contracts/dispatch, a persistent Agent work loop and task/call state, model providers/profiles and per-scope selection, encrypted own-model credentials, platform allowance rules, memory lifecycle operations, selected Skill loading, sourced Knowledge, versioned Workspace artifacts, persistent job identity/configuration, Session timelines, schedules/events/recurring work, Mandates and bounded same-owner handoffs. MCP and ESM expose shared capability contracts.

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
