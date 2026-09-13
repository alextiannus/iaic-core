# Persistent Task working plans

`TaskPlans` is an optional planning module over the existing Workspace interface.
It stores one bounded JSON working document per Task, using Workspace version
checks, scope, source attribution and exact references. There is no new database,
executor, scheduler or prescribed workflow. User, Business and Platform Agents
can use the same module.

```js
const plans = new TaskPlans({
  workspace,
  readTask: (actor, id) => runtime.state(actor, id)
});
const tools = createTaskPlanCapabilities({plans, authorize});
const context = new ContextAssembler({
  planProvider: ({actor, task}) => plans.read(actor, {id: task.id})
});
```

The host must supply a current-authorized Task reader and appropriately scoped
Workspace. Both are checked on each access. Shared `createAgentTaskCapabilities`
accepts `plans`; final Tool names respect its optional namespace. The generated
Agent app accepts `enablePlans: true`. Add `tasks.plan.read` and
`tasks.plan.update` to the job's explicit Tool configuration and Task allowedTools
when the Agent should use them. Plan updates are not enabled by the shared
composition's default read-only Tool scope. Version configuration changes with
the Agent implementation. Existing generated applications are not rewritten.

The read operation returns `{taskId, revision, steps, reference}`. A new plan has
revision zero and no reference. Update takes `{id, expectedRevision, steps}` and
returns its original saved revision/reference. Steps have unique `id`, a short
`description`, `status` (`pending`, `in_progress`, `done`, `blocked`), and optional
brief `note`. There are at most 20 steps and 16,000 UTF-8 bytes of step data.
Plans may be revised, reordered or shortened; there is no enforced task graph.
Concurrent stale updates reject; the caller must read current state. An Agent
Tool call may access only its executing Task's plan. External callers still need
current access to the referenced Task and Workspace. Terminal Tasks are readable
but cannot be updated through this module.

Plan state is **Agent/user working material**, not verified business facts,
authorization or a Task state transition. A `done` step cannot complete a Task.
The Runtime's existing application verifier still owns completion. Plans do not
execute steps, increase budgets, authorize tools, or remove the need to inspect
original operation receipts. `planProvider` supplies the current plan on each
inference, so old successful call-body elision does not remove current progress.
It retains normal context-size limits; this is not unbounded memory. Historical
plan reads refresh current content and update inputs omit old step bodies from
context. Original Workspace revisions and audit records remain subject to their
own retention policies.

Documents live at `plans/tasks/<Task UUID>.json` within the host's Workspace
scope. This is a conventional location, not a security boundary. Authorized
generic Workspace editing can change or delete these working materials; format
and Task bindings are checked on read. A malformed plan fails explicitly. A
missing/deleted plan is not evidence that business work never occurred; the
Workspace tombstone prevents silent recreation after deletion. A race with Task
cancellation does not undo a previously admitted write. Lost update responses
remain unknown under normal Runtime rules; exact stored references can support
host reconciliation but there is no automatic replay or reconciliation claim.

`examples/core-task-plans` demonstrates reconstruction, plan revision, a rejected
false completion claim, one independently queried business effect, readback and
fresh application verification. It uses a deterministic model. It does not prove
better actual-model planning or completion; prior actual workflow failures remain.
