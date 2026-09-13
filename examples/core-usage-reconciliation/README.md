# Independent usage reconciliation consumer

Run with installed `@immedi/iaic-core`, `pg`, Node20 and a test `DATABASE_URL`. The script creates/drops a schema, records unknown usage, resolves a trusted fixture source and settles the original request once. No ImmediToday, ERP, model call or UI dependency. The package verification runner executes this against the packed, independently installed Core.
