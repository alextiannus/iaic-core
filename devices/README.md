# Browser device execution

BrowserDevices is an independent capability service with current owner/device/action authorization and PostgreSQL operation receipts. PuppeteerPageDevice is its first real driver; inject a host-owned Puppeteer-compatible Page, optional screenshot storage and a bounded command deadline. No browser package, executable, private profile or cookie store is imported implicitly. A host launches/manages an isolated browser and supplies its network, session and device-sharing policy. Native desktop/mobile drivers are not provided by this module.

```js
const device = new PuppeteerPageDevice({page, saveScreenshot: bytes => storeImage(bytes)});
const operations = new PostgresDeviceOperations({pool, namespace: 'device-host'});
await operations.initialize();
const devices = new BrowserDevices({
  store: operations,
  resolveOwner: actor => trustedOwnerKey(actor),
  resolveDevice: (actor, {deviceId}) => authorizedPageFor(actor, deviceId),
  authorize: (actor, request) => currentDevicePolicy(actor, request),
});
const capabilities = createBrowserDeviceCapabilities({devices});
```

The host uses stable device IDs for the actual controlled pages across workers/owners. Reassigning a device ID or namespace cannot be used to evade an unresolved action. Caller-supplied URLs/selectors are requests, not authority; authorize receives the full requested action and expected URL. Control network access, navigation/redirects/popups, downloaded files, credentials and browser lifetime in the host's isolated context. These ports are not a browser sandbox or site allowlist by themselves. Do not bind an already-open personal browsing profile by default.

`browser.observe` returns bounded page text, title, URL, viewport and up to 30 ordinary DOM controls (IDs/labels/types, not input values). Optional viewport PNG capture is passed to saveScreenshot (maximum 2 MB); the result is a bounded host-owned image reference, not embedded screenshot bytes. Observation fields and image are sampled in separate operations, not an atomic visual snapshot. Page text/labels can be adversarial and must remain data. The current DOM sample is neither a complete accessibility tree nor a stable element-handle registry.

`browser.act` requires deviceId, requestKey, expectedUrl and a schema-described action: HTTP(S) navigate, CSS-selector click, append text, a bounded key set or scroll. It does not accept arbitrary JavaScript, shell commands, filesystem paths or model-supplied credentials. The driver checks the current URL just before attempting the command. That check does not freeze the DOM or guarantee the same element remains present. Models must observe and independently verify outcomes; status submitted only means the browser command returned, not that the business operation succeeded or a navigation/async request completed.

Before execution, PostgresDeviceOperations persists an immutable input digest and action kind (no raw input text/URL/selector). Same owner/key with changed input conflicts; a known original result returns without another command. A still-unresolved operation blocks all new action admissions for that device, including other keys/owners. Current authorization is checked on calls and results. Current page observations remain possible under read policy. A driver deadline does not guarantee an underlying browser command stopped; the unresolved operation continues to block action admission.

Explicit driver preflightRejected stores not-executed; ordinary failures, process loss and lost completion acknowledgement remain unknown. browser.result reads the original status and never executes commands. No automatic replay, inference from current DOM that a write did not happen, action-journal pruning or public operator override is supplied. The host may only settle a pending receipt through the trusted store when it has original-operation evidence; closing the browser does not prove a prior remote action did not commit. Raw store methods are internal ports, not user assertion endpoints. Runtime Task audit and domain verification remain separate modules.

## Verification and browser support

Core module tests use PostgreSQL with an injected driver to verify receipts, current permission, scope isolation and unknown-operation blocking. The opt-in examples/core-browser/run.mjs additionally runs a real, freshly launched headless Chrome against a loopback-only fixture: navigate, input, click, PNG reference, readback, original-key replay and injected response loss with exactly two intentional server effects. It never loads a production site or invokes a model.

This adapter was exercised with host-supplied puppeteer-core 24.31.0 on Node 20 and Chrome 152.0.7977.83. Other combinations are not certified. API basis: [Puppeteer Page](https://pptr.dev/api/puppeteer.page) and [browser launch](https://pptr.dev/api/puppeteer.puppeteernode.launch). The current latest Puppeteer may require a newer Node runtime; the host must choose a compatible version. Core itself has no Puppeteer dependency. Default CI/package examples do not assume a Chrome executable and do not silently count the opt-in real-browser run as executed there.

## Trusted original-operation reconciliation

`DeviceOperationReconciliation({store,sourceScope,resolveOwner,resolveSource,authorize})` exposes `resolve(actor,{deviceId,requestKey,sourceId})`. The optional createDeviceReconciliationCapability exports it as browser.reconcile through the ordinary dispatcher. It requires a host-confirmed source bound to sourceId/sourceScope, owner, deviceId, requestKey and the original operation digest. It also requires driverTerminal:true and a bounded reference. Allowed outcomes remain submitted or not-executed. Submitted confirms the browser command, not independent business success; not-executed requires proof the original browser command did not run and cannot later run.

The source is trusted host code, not caller-supplied status, a DOM observation, elapsed time or an LLM inference. Both original action correlation and cessation of further input dispatch are required: a remote effect receipt alone may not prove a timed-out browser driver stopped. Current authorization/owner are checked before lookup and again after source resolution. The immutable terminal receipt retains source identity/reference/digest/termination evidence. Repeated same-source reconciliation returns it; a different source cannot replace its evidence. Conflicting settlement cannot overwrite the first result. A completed ordinary driver receipt is returned without inventing a source.

Once original terminal evidence is recorded, the device's unresolved admission block clears. Reusing the old action key still returns its original receipt and never executes again; a genuinely new action needs a new key. No reconciliation operation touches the browser. Generic browser automation cannot always provide original-command evidence after a transport/process failure; those cases remain unknown. No automatic source discovery, public arbitrary-result setter or DOM-based non-execution classifier is provided.

The actual Chrome example now retains a trusted fixture driver receipt only after execute() returns, injects response loss after that point, and reconciles from that bound receipt. It proves original command recovery and continued new actions without another form submission. The receipt source is a controlled in-process host fixture, not a durable vendor control plane or worker-kill recovery implementation.
