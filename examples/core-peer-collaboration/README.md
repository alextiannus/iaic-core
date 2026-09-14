# Peer collaboration composition

```sh
export SUBMISSION_TEST_DATABASE_URL='postgresql://localhost/iaic_example'
node examples/core-peer-collaboration/run.mjs
```

Requires Node 20, PostgreSQL and the optional MCP/A2A SDKs installed by repository
`npm ci`. Uses synthetic identities in a temporary schema which is removed afterward.
`fixture.mjs` composes the independent peer services and one example domain command.
It is runnable wiring, not a production identity or logistics/payment integration.

The example sends through a real loopback HTTP listener, repeats the same request
through in-process MCP and official A2A SDK mappings, checks one persisted logical
message and public conflict codes, reconstructs the services, delivers/acknowledges,
and explicitly invokes a domain capability. Ordinary messages create no domain facts.

The accompanying `test/iaic-peer-collaboration.integration.test.js` exercises seven
PostgreSQL scenarios, including SIGKILL after an HTTP receiver records the original
effect. The test advances the lease deadline in SQL to avoid waiting for lease expiry,
then reconstructs a worker and queries the original receipt without a second effect.
This does not simulate host loss or prove an actual provider's idempotency behavior.

See [the module contract](../../collaboration/peer/README.md) for required host ports,
receipt meanings, migration/disable behavior and remaining implementation limits.
