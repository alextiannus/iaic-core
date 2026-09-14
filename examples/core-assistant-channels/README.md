# User Assistant through IM and local files

```sh
export SUBMISSION_TEST_DATABASE_URL=postgresql://.../isolated_test_database
node examples/core-assistant-channels/run.mjs
```

The deterministic example starts a task from a synthetic Telegram message, asks a question, rebuilds the IM service and supplies clarification through a separately linked Slack account. The actual User Assistant submits an application-defined Declaration, checks its original receipt, creates `declaration.txt` in a temporary local directory, reads it back and queues a completion reply. Cleanup removes only its temporary directory and isolated database schema.

Duplicate and concurrent incoming events reuse the original task, duplicate clarification does not submit twice, changed event text conflicts, notifications use the existing outbox, and revoked access prevents publication and file reading. This is a runnable composition fixture, not a deployed bot, paid-model evaluation or remote desktop client.

For application wiring, see [channels](../../channels/README.md), [local devices](../../devices/README.md) and [User Assistant](../core-user-assistant/README.md). Add file/browser tools through `openUserAssistant({extraCapabilities, extensionRevision, ...})`; update `extensionRevision` whenever the host's tool semantics or bindings change. The base demo's outcome remains a verified Declaration; a general file-only assistant needs its own host outcome contract.
