# Current access catalog matrix

`checkAccessCatalogMatrix` is an optional Host CI/startup diagnostic. Import from
`@immedi/iaic-core/developer/access-matrix.js`. It compares explicitly expected
catalog names with independent catalog readers for each trusted Actor/context
fixture and model/host surface. It does not infer Role, Permission or Entitlement
rules. Use the same current Host projection behind the application's protocols.

```js
const result = await checkAccessCatalogMatrix({
  cases: [{name: 'revoked', context: revokedFixture,
    expected: {model: [], host: []}}],
  entrances: [
    {name: 'http', surface: 'model', list: listHttpNames},
    {name: 'mcp', surface: 'model', list: listMcpNames},
    {name: 'ui', surface: 'host', list: listNativeNames}
  ]
});
if (!result.passed) throw new Error('Access catalog matrix failed');
```

Each `list(context)` must authenticate its fixture through the real Host adapter
and return the current names. The helper runs every case/entrance sequentially,
without a catalog cache. Expectations are exact sets: missing and unexpected
names both fail; ordering does not matter. Every used surface needs an explicit
expectation, including empty catalogs. Invalid configuration fails before reads.
Invalid catalogs and rejected reads fail individual checks while other entrances
continue. Reader errors and contexts are not returned. Labels and capability
names ARE in the report: keep it in trusted Host/CI diagnostics, not model or user
responses. Callbacks remain trusted application code and must be read-only.

Use isolated fixtures for entitled/revoked actors, context revisions and scope
boundaries. Each case can carry its own immutable context; do not mutate shared
fixtures in readers. HTTP/MCP readers may share the one authoritative projection,
but must exercise their actual authenticated list paths. The installed example
uses real Core HTTP and MCP adapters with a trusted local identity fixture, not
production credentials or a complete OAuth flow.

This helper has no execute/authorize/grant mutation port. A passing report proves
only the configured catalogs for the supplied fixtures. It cannot prove that a
production resolver refreshed its database, that fixtures cover all roles, or
that execution is authorized. Keep separate cached-catalog/revocation call tests
through the actual Dispatcher (see core-access-diagnostics). Do not probe writes
to discover access. A combined execution matrix runner is still pending.

Migration: opt-in developer module; no runtime, database or Task changes. Preserve
existing Actor/Workspace bindings and operation receipts. Rollback removes only
the optional check/import. candidate.106 support ends 2026-10-02 23:59 UTC.
