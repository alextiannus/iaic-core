# Current execution policy decisions

`ExecutionPolicy` provides a shared, optional decision and recording contract for
host feature switches, risk rules and other execution constraints. It does not
replace authentication, Capability permission, Mandates, delegation budgets or
application outcome verification, and cannot grant permissions denied there.

```js
const executionPolicy = new ExecutionPolicy({
  decide: async ({actor, capability, input, phase, taskId}) => {
    const rules = await hostRules.current(actor, capability.name);
    return {
      allowed: rules.enabled && rules.permits(input),
      revision: rules.revision,
      reason: rules.enabled ? 'Current application rule' : 'Feature disabled',
      risk: rules.riskLabel // optional host classification
    };
  },
  record: record => audit.append(record) // persist before returning {id}
});
const dispatcher = new CapabilityDispatcher({capabilities, executionPolicy});
```

The Agent application starter accepts the same `executionPolicy` option. The
decision port receives a frozen copy of the actor, input, Capability name/kind/
effect, phase (`admission`, `agent`, `function`) and optional Task/call identifiers.
It must return a plain object containing boolean `allowed`, nonempty bounded
`revision` and `reason`, and optional bounded `risk`. Other fields and truthy
nonboolean verdicts reject. Risk is an attributed host label, not a universal
score or extra authority. The framework provides the contract; applications own
policy storage, live switch values, risk classification and business predicates.

The required recorder receives the decision, actor, Capability descriptor, phase
and identifiers. Arbitrary input payloads are not automatically included. The
host owns actor attribution, durable storage, access and retention, and returns
an `{id}` only after persistence. Missing/invalid receipts or recorder errors
prevent execution. A recorded denial raises `EXECUTION_POLICY_DENIED` with a
policy decision reference. A decision receipt proves a check occurred, not that
the Task was admitted, the Tool executed or a business effect committed.

Dispatcher checks function execution after schema/permission/preflight checks and
before the effect. It also checks Agent admission even with a custom Task port.
The standard Runtime checks direct admission and current Agent execution alongside
existing identity/Mandate/Handoff/grant checks, including after model responses
and during resumed work. Multiple checks of one operation may produce separate
decision records; they must not be counted as separate business effects or model
usage. Revoke between checks to stop later admission; an already admitted effect
or provider call cannot be undone by a switch.

Denied Agent execution uses the existing `waiting/interrupted` state. A later
authorized resume rechecks current policy. Historical result revalidation and
direct Runtime reads retain their existing access rules; stopping execution does
not erase evidence. A host can separately apply policy to a read API Capability.
The normal HTTP adapter may conservatively classify server failures as unknown;
retain existing operation keys and reconciliation rules rather than assuming a
failed response proves no effect. Explicit policy denial is a 403 before execution.

No policy UI, configuration database, risk taxonomy, approval workflow or rollback
engine is added. Omission preserves prior behavior. Ports and supplied rules are
trusted host code; a fake recorder cannot be verified as durable by the framework.
The policy logic belongs in versioned application configuration, while each check
records the current rule revision. See `test/iaic-execution-policy*.test.js` for
PostgreSQL records, a switch changed during inference, reconstruction, HTTP denial,
invalid verdicts/receipts and preservation of base permission.
