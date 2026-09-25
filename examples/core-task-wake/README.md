# Task committed, application binding missing

Run with isolated PostgreSQL:

```
SUBMISSION_TEST_DATABASE_URL=... node examples/core-task-wake/run.mjs
```

The example creates/drops a random test schema and exercises the actual TaskStore
and Notifications store. It deliberately fails the application-owned SQL binding
after Task commit, rebuilds TaskWake, revokes permission to create new Tasks, and
repairs the original Task/Context link under independent historical authorization.
There is one admission and one link. No model or business executor is run.

Production Hosts must use their existing Runtime admission and current HostTaskContext
checks, not adopt the example's direct TaskStore fixture as a permission bypass.
The example's relation table belongs to the Host; Core defines no application Context
schema. See notifications/TASK_WAKE.md for required ports and cursor scheduling.
