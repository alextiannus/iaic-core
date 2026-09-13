# OpenAPI discovery and selected HTTP bindings

OpenApiCatalog takes a host-loaded JSON document and exposes list(), get(operationId), revision and bindings(selections). It discovers GET/POST/PUT/PATCH/DELETE operations from a bounded OpenAPI 3.0 or 3.1 document. An omitted operationId uses METHOD plus path as its stable selector; duplicate selectors are rejected. The catalog owns a copied snapshot and its SHA256 revision. It does not fetch document URLs or remote references, install Tools or use document-supplied server URLs.

```js
const catalog = new OpenApiCatalog({document});
const discovered = catalog.list();
const bindings = catalog.bindings([{
  operationId: 'readItem', name: 'remote.item.read', effect: 'read',
  input: myValidatedInputSchema, output: myValidatedOutputSchema,
  authorize: currentApplicationPolicy,
  revalidate: currentResultReader
}]);
const capabilities = importHttpCapabilities({
  baseUrl: approvedServiceUrl, bindings, resolveHeaders: currentCredentialHeaders
});
```

This composes the existing HTTP importer and Dispatcher. Host selections explicitly define Capability name, read/write effect, input/output JSON schemas, authorization, verification/projection and any idempotency contract. get() exposes resolved parameter/request/response metadata for that selection process. There is no automatic schema-dialect conversion or inference of business permissions from an HTTP method or a security declaration. Supply a current result revalidator for Runtime history, as with manual HTTP bindings. Include catalog.revision and host binding policy in the deployed Task revision contract.

Arguments use optional path, query and body groups. The supported mapping profile handles scalar simple path parameters, scalar form query parameters and application/json request bodies. Required parameter/body presence and scalar parameter types are checked; path segments are encoded and query values use URLSearchParams through the existing importer. Path-level parameters are inherited and an operation-level parameter overrides the same location/name. Full JSON constraints and response semantics are enforced by the explicit host schemas and verifiers, not by the catalog metadata alone. Model arguments cannot supply headers, an origin or undeclared parameter names. Current credential headers and the approved service prefix remain host-owned.

The catalog implements a limited profile, not a full OpenAPI validator or conformance claim. Documents are limited to 2 MB, 1,000 operations and bounded reference expansion (10,000 nodes, depth 40 and 2 MB of expanded strings). Nonrecursive local JSON pointers without siblings are supported. Recursive/external references, reference siblings, header/cookie parameters, complex array/object parameter serialization, reserved-value serialization, non-JSON bodies and unsupported path syntax fail explicitly. Only the listed HTTP methods are discovered; unsupported methods are not exposed. For these cases, use a manually reviewed importHttpCapabilities binding or a dedicated provider adapter. OpenAPI 3.2, YAML loading and automatic remote document refresh are not supplied.

The format and parameter model are based on the [OpenAPI 3.0.4 specification](https://spec.openapis.org/oas/v3.0.4.html). Description text, examples, server entries and security declarations are source data, never authorization. A host must verify a downloaded document before choosing bindings; no credentials should be placed in it. Standard Capability authorization, response verification, timeout, no-redirect and unknown-write reconciliation behavior remain in the HTTP importer and Dispatcher.

The integration fixture sends a real loopback HTTP request, checks encoded path/query and host credentials, and denies later access after policy changes. Additional checks cover JSON body presence, undeclared arguments, scalar mismatch, duplicate operation IDs and unsupported references/serialization. It does not exercise a production API or certify every OpenAPI document.
