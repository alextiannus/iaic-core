# IM as the User Assistant interface

`AssistantChannel` connects a verified incoming text message to the existing Agent/Task dispatcher and notification outbox. It does not own memory, models, allowance, business declarations or a second Agent runtime. One platform principal can use several explicitly linked IM accounts. Provider IDs that happen to match are not evidence of the same user.

```text
IM provider → host authentication + durable ingress → normalizer
  → current account/conversation binding → AssistantChannel
  → existing User Assistant / Tasks / Memory / Skills / allowance
  → application capabilities + authorized local device connector
  → current task projection → Notifications outbox → provider adapter
```

## Small integration contract

```js
const inbox = new PostgresChannelInbox({pool, namespace: 'my-assistant'});
await inbox.initialize();
const channel = new AssistantChannel({
  inbox, dispatcher: app.dispatcher, notifications,
  allowedTools: app.job.configuration.tools,
  resolveBinding: message => accountLinks.lookup({
    provider: message.provider, installationId: message.installationId,
    senderId: message.senderId,
  }), // {actor, identity}; identity includes app, assistant and principal
  authorize: (actor, {message, operation}) => currentChannelPolicy(actor, message, operation),
  project: task => ({text: channelSafeSummary(task)}),
});
// In a worker, after authenticating and durably accepting the provider request:
const message = telegramMessage(verifiedPayload, {installationId: configuredBotId});
if (message) await channel.receive(message);
// A host Task event consumer or poller publishes later questions/completion:
await channel.publish(originalVerifiedMessage, taskId);
```

The normal text command starts a new task (`/new text` is also accepted). `/reply TASK_ID answer`, `/status TASK_ID`, and `/cancel TASK_ID` reuse Core task controls. This first adapter uses explicit task IDs for replies; it does not guess which of several tasks a natural-language answer belongs to. A host may add thread/session routing separately.

Provider + installation + event ID identifies the original event. PostgreSQL binds it immutably to the message and application identity. Repeated task creation and clarification use deterministic Core request keys; changed event content or remapped identity is rejected. Reconstructed workers can continue an accepted event. Notifications deduplicate the same projected state within a route. Reads and publication always recheck current identity and task access. Unknown outbound delivery follows Notifications rules, never an automatic resend based on elapsed time.

The host's `resolveDelivery` must recheck the current account/conversation binding and channel policy immediately before sending. Its source contains the exact installation, conversation, thread, sender and application identity. `delivered` means provider-accepted delivery according to that adapter's evidence; it does not mean the person read it. A provider without idempotent send/query support must leave uncertain deliveries unknown. Do not invent an idempotency header supported by every IM provider.

## Provider coverage and next adapters

| Channel | Included now | Host work before live use |
| --- | --- | --- |
| Telegram | Text update normalizer; ignores edited/bot messages | Bot registration, webhook secret verification, durable acknowledgement, account linking, send mapping |
| Slack | Message event normalizer; team check; ignores subtype/bot events | App installation, raw-body signature/timestamp verification, subscription/challenge handling, durable acknowledgement, send mapping |
| Lark/Feishu | Text event normalizer, app/tenant checks, own-bot mention removal, official SDK text create/thread reply | Verified official SDK event ingress, durable acknowledgement, account linking, tenant/app credentials; see [Lark](LARK.md) |
| DingTalk, WeCom | Same envelope/ports; no built-in provider adapter yet | Provider verification/decryption, identity binding, inbound/outbound adapter |
| WhatsApp, Teams, Discord, Matrix | Same extension boundary; no built-in provider adapter yet | Official application/bot API integration and receipt semantics |
| Personal WeChat | No adapter | Evaluate available official access for the application; do not promise arbitrary personal-account automation |

Normalization is **not authentication**. These functions are not public webhook handlers. Verify the original request using the provider's official contract before parsing/dispatching; persist and acknowledge it within the provider deadline, then process it in a worker. Challenge responses, credentials, attachments, cards, voice and message editing are host/provider concerns. Default to direct conversations; group access and projection require an explicit host policy, particularly for private memories and file content.

Official contracts used for the first mappings: [Telegram Bot API](https://core.telegram.org/bots/api), [Slack message events](https://docs.slack.dev/reference/events/message/). These do not establish that a live installation was tested.

Run the installed-package fixture in `examples/core-assistant-channels`. It uses real PostgreSQL, the actual User Assistant runtime and a real temporary local directory, with synthetic provider payloads and delivery receipts. Live provider accounts and remote device transport are not part of this fixture.

The host controls inbox retention and encrypted database operations. Inbox rows contain original user text and identity bindings; scope and clean them according to the application's retention policy, without deleting keys still needed for replay protection.
