# Lark / Feishu integration

Candidate.97 supplies public declarations for both exports from
`@immedi/iaic-core/channels/lark.js`. The installed strict NodeNext consumer checks
normalization, delivery result narrowing and compatibility with official SDK
1.74.0 without an ambient shim. This does not supply root/module-wide types.

Two independent modules share the existing User Assistant runtime:

- `channels/lark.js`: receive verified text events and deliver Task projections through Notifications.
- `mcp/lark.js`: import selected tools from the official open-source Lark MCP server into the existing CapabilityDispatcher. No second Agent runtime, memory or billing implementation.

The MCP integration reuses [larksuite/lark-openapi-mcp](https://github.com/larksuite/lark-openapi-mcp), pinned and tested at npm `@larksuiteoapi/lark-mcp@0.5.1` (MIT). The [official CLI](https://github.com/larksuite/cli) is another broad Agent interface; Core uses MCP because its existing importer preserves tool schemas without adding a shell-command parser. We do not fork either project or include their code in Core runtime dependencies. Applications install the server separately; the pinned development dependency validates compatibility.

## IM ingress and replies

```js
import {larkMessage, createLarkNotificationDelivery} from '@immedi/iaic-core/channels/lark.js';

// A worker consumes an event already verified and durably accepted by the host.
// Supports the V2 envelope or the official SDK's flattened callback object.
const message = larkMessage(verifiedEvent, {
  installationId: installation.id, appId: installation.appId,
  tenantKey: installation.tenantKey, botOpenId: installation.botOpenId,
});
if (message) await assistantChannel.receive(message);

// Inside Notifications.resolveDelivery(job), choose this exact installation's SDK client.
return createLarkNotificationDelivery({
  client: await clients.forInstallation(job.source.route.installationId),
  route: job.source.route,
  authorize: route => currentOutboundPolicy(job.source.identity, route),
});
```

The host verifies/decrypts incoming events with the official SDK/webhook contract, handles challenges, and persists/acknowledges before dispatch. The normalizer is not authentication. It checks configured app and tenant, accepts human text in direct/group conversations, and removes only the configured bot's own mention tokens. Bot messages and non-text payloads are ignored. Installations and `open_id` account links must be host-managed; never equate IDs from different apps or tenants.

Group access requires a host policy and a group-safe Task projection. Being a group member does not grant access to another user's task, private memory or files. Use an explicit mention policy in ingress if the bot should respond only when mentioned. The sample default remains direct-message only.

Delivery uses official Node SDK `im.message.create` or `im.message.reply` (mapping checked against SDK 1.74.0). Lark `root_id` is the reply target message ID stored in Core's generic `threadId`; the provider's `thread_id` (`omt_...`) is not a message ID. Outbox UUID passes unchanged as `uuid`. A verified receipt must contain a message ID and the bound chat ID. API failure or uncertain response remains unknown, with no adapter retry. UUID deduplication is time-limited; it is not permanent exactly-once delivery. See [official message API](https://open.feishu.cn/document/server-docs/im-v1/message/create) and [UUID contract](https://larksuite.github.io/oapi-sdk-java/com/lark/oapi/service/im/v1/model/CreateMessageReqBody.Builder.html). SDK/network retry policy is the host's responsibility.

## Broader Lark capabilities

`LARK_TOOL_CATALOG` contains 89 explicitly classified read/write tools; `selectLarkTools` selects domains or individual tools. The default selection is `im`. Additional domains are `documents`, `wiki`, `base`, `calendar`, `tasks`, `contacts`, and `meetings`.

| Module | Available bindings |
| --- | --- |
| IM | List/search/get groups; join public groups; add/remove members; announcements; send/reply/update/forward messages; reactions and pins |
| Documents | Read/create documents, blocks and folders; list/copy/move Drive files; metadata |
| Wiki | List/read/search nodes; create/move/rename nodes |
| Base | Tables, fields and views; record search/read/create/update and batch writes |
| Calendar | Calendars, events, free/busy, attendees, event replies and meeting groups |
| Tasks | Read/create/update tasks and lists, members and reminders |
| Contacts | Users, identifier lookup and departments |
| Meetings | Meeting/recording metadata and reservation |

These are importable contracts, not a claim that every API has been exercised against a live tenant. Supported token types, scopes and resource permissions differ by tool. Selection fails explicitly if the server does not expose a chosen tool; narrow it to the supported set. Other official MCP tools can use the generic `importMcpCapabilities` with explicit effects and authorization. Media transfer, interactive card callbacks, voice and meeting participation need their own provider integration; recording metadata is not live meeting participation.

```js
import {selectLarkTools, importLarkCapabilities} from '@immedi/iaic-core/mcp/lark.js';

const selection = {
  domains: [],
  tools: ['im.v1.chat.search', 'im.v1.chatMembers.meJoin', 'im.v1.message.reply'],
};
// Start the official server with -t containing these exact dot-form names:
const enabledTools = selectLarkTools(selection).map(row => row.tool).join(',');
const capabilities = await importLarkCapabilities({
  client: connectedDiscoveryClient, ...selection,
  identity: 'user', // or 'bot'; fixed by this host binding
  authorize: (actor, input, {lark}) => currentLarkPolicy(actor, input, lark),
  resolveClient: ({actor, larkIdentity}) => connections.current(actor, larkIdentity),
});
// Add capabilities to the application's registry, and only the required names
// to its existing User Assistant allowedTools. Example local name:
// lark.im.v1.chatmembers.mejoin
```

Use a host-launched stdio server, for example `npx -y @larksuiteoapi/lark-mcp@0.5.1 mcp -c snake`, with `LARK_TOOLS=enabledTools`. Provide `APP_ID`, `APP_SECRET` and any `USER_ACCESS_TOKEN` through the host secret environment. Set `LARK_DOMAIN` to `https://open.larksuite.com` for Lark or `https://open.feishu.cn` for Feishu. Set `LARK_TOKEN_MODE=user_access_token` for a user binding or `tenant_access_token` for a bot binding; do not share one user's connection with another actor. OAuth/token refresh and process disposal belong to the host. See [official configuration](https://github.com/larksuite/lark-openapi-mcp/blob/main/docs/usage/configuration/configuration.md).

The importer removes model control of `useUAT`, injects the fixed identity, re-resolves the current connection for execution, and preserves official input schemas and MCP content. Reads and writes pass normal Core authorization. Writes require a stable call ID and use `never-replay`; a Core call ID alone is not Lark idempotency. Returned MCP content is provider evidence, not automatic business-outcome verification. Applications should inspect operation-specific responses/read back critical results. Do not drive Notifications through this generic MCP path: use the SDK delivery adapter above for its explicit receipt semantics.

`im.v1.chatMembers.meJoin` joins as the current user/bot and supports public groups under the platform's conditions. Private-group access requires invitation or authorized member management, not an arbitrary join-by-ID. See the [official join API](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/chat-members/me_join).

## Validation and live setup boundary

- `test/iaic-lark.test.js`: inbound app/tenant and thread mapping, SDK send/reply, revocation and uncertain receipts.
- `examples/core-assistant-channels`: real PostgreSQL Task/Inbox/Outbox and cross-channel task lookup; substituted Lark delivery endpoint.
- `examples/core-lark-mcp`: real official MCP server, all 89 schema imports, actual MCP transport/handlers, group join/reply/document mapping, fixed user/bot identity and denied/uncertain writes; substituted SDK network boundary.

No live Lark credentials or group operations are used by these fixtures. Before application acceptance, configure tenant/app credentials and API scopes, bot/event subscriptions, verified durable ingress and account links; then exercise the application's real group and direct-message flow. That work is separate from the runnable Core integration.
