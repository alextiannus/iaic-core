# Telegram, WhatsApp and WeCom internal applications

These adapters connect text to the existing `AssistantChannel`, Task dispatcher and Notifications Outbox. Accounts must be explicitly linked by provider + installation + sender. Channel credentials never enter model arguments. A sender with the same ID in another installation is not the same principal.

| Provider | Incoming | Outgoing | Deliberate scope |
| --- | --- | --- | --- |
| Telegram Bot API | Secret-header verified JSON, direct/group/supergroup text, forum topic, commands addressed to this bot | `sendMessage`, original chat/topic and provider message ID | Human senders; anonymous sender-chat and other bots' commands ignored |
| WhatsApp Cloud API | Raw-body HMAC, verification challenge, batched text, WABA and phone-number binding | Text API, current host text-window check, accepted recipient/message receipt | Phone-addressed direct messages; templates, groups, attachments and status recovery not included |
| WeCom internal application | Signed encrypted challenge/XML, CorpID/AgentID/employee binding, exact 64-bit message IDs | Application text API to one employee, accepted message ID | Internal application, not personal WeChat, Official Account, customer-service account or group webhook robot |

Telegram and WhatsApp adapters use Node's fetch directly against fixed official endpoints. The WeCom encrypted entry reuses open-source `@wecom/crypto@1.0.1` and `fast-xml-parser@5.11.1`; install these optional peers only in hosts using `channels/wecom-webhook.js`. The main Core entry does not load them. These are not represented as Tencent-maintained packages. WeCom XML rejects DTD/entity declarations and preserves numeric IDs as strings.

## Receive and acknowledge

Keep the exact original request body as a Buffer; do not reserialize JSON before signature verification. Route each endpoint to a host-configured installation. Do not choose credentials from body fields.

```js
import {readTelegramWebhook, readWhatsAppWebhook, whatsappWebhookChallenge}
  from '@immedi/iaic-core';
import {readWecomWebhook} from '@immedi/iaic-core/channels/wecom-webhook.js';

// Telegram POST, after applying a 1 MiB request size limit:
const telegram = readTelegramWebhook(rawBody, {
  installationId: configuredInstallation.id,
  secretToken: configuredInstallation.webhookSecret,
  providedSecret: request.headers['x-telegram-bot-api-secret-token'],
  botUsername: configuredInstallation.botUsername,
});
if (telegram) await durableIngress.accept(telegram);
// Only then return HTTP 200. Workers call assistantChannel.receive(message).

// WhatsApp GET: return this string as the challenge response.
const challenge = whatsappWebhookChallenge(query, {verifyToken: configuredVerifyToken});
// WhatsApp POST:
const messages = readWhatsAppWebhook(rawBody, {
  installationId, businessAccountId, phoneNumberId, appSecret,
  signature: request.headers['x-hub-signature-256'],
});
await durableIngress.acceptBatch(messages); // persist ALL messages before HTTP 200

// WeCom GET/POST: query contains timestamp, nonce, msg_signature and optional echostr.
const result = readWecomWebhook({rawBody, query}, {
  installationId, corpId, agentId, token, encodingAESKey,
});
if (result.challenge !== undefined) return sendPlainText(result.challenge);
await durableIngress.acceptBatch(result.messages);
return sendPlainText('success');
```

The snippets show separate provider routes, not one handler executing every branch. `durableIngress` is a host-supplied persistent queue, not a Core export or an in-memory callback. Reject invalid verification without dispatch; acknowledge only after durable acceptance, then run the Agent asynchronously. Workers reuse Core's Inbox for event/identity deduplication. Cryptographic verification alone does not prevent replay: duplicate event IDs must still go through Inbox. WeCom checks callback timestamp age (default 600 seconds, host-configurable); the queue processes the already verified message, not an expired raw callback.

Configure Telegram `setWebhook` with the matching `secret_token`; set the bot's group permissions/privacy mode for the intended traffic. `botUsername` permits `/status@YourBot task` while other bots' commands are ignored. Group projections remain host-controlled; group membership never grants access to another user's private Task.

WhatsApp requires an app subscribed to the configured WABA and phone. `readWhatsAppWebhook` returns text messages only; delivery-status callbacks and other events do not start Tasks. It does not yet normalize username/business-scoped IDs or Groups API events. Use the original verified timestamp/event in the host to maintain messaging eligibility, rather than extending the window when a queue replays an old message.

WeCom requires an internal application with configured callback Token/EncodingAESKey and the appropriate visible employee range. `corpId` is verified after decryption; `agentId` is verified inside the message. Pass AgentID as a number, and preserve MsgId as a string when calling `wecomMessage` with a separately verified object. Employees and their roles remain application-owned. A separate group or intelligent-bot API requires a separate adapter; this application channel cannot be treated as personal/group chat access.

## Notifications delivery

```js
import {createTelegramNotificationDelivery, createWhatsAppNotificationDelivery,
  createWecomNotificationDelivery} from '@immedi/iaic-core';

// Within Notifications.resolveDelivery(job), after resolving its exact installation:
const common = {route: job.source.route,
  authorize: route => currentOutboundPolicy(job.source.identity, route)};
return createTelegramNotificationDelivery({...common,
  resolveBotToken: installationId => secrets.currentBotToken(installationId)});

// WhatsApp branch; select a currently supported Graph version explicitly:
return createWhatsAppNotificationDelivery({...common, phoneNumberId, apiVersion,
  resolveAccessToken: installationId => secrets.currentAccessToken(installationId),
  canSendText: route => messagingPolicy.canSendTextNow(route)});

// WeCom branch; access token must belong to this corporation and internal app:
return createWecomNotificationDelivery({...common, agentId,
  resolveAccessToken: installationId => secrets.currentAccessToken(installationId)});
```

The host caches/refreshes tokens and enforces current installation/principal binding. WhatsApp's `canSendText` is mandatory: if the conversation is not eligible, this adapter returns `not_sent`; the application may use an approved-template workflow separately. It does not silently turn a Task result into a template send.

Text is sent literally without inferred Markdown/HTML. Telegram and WhatsApp text are capped at 4096 characters; WeCom text at 2048 UTF-8 bytes to avoid provider truncation. Project a bounded summary and artifact link for longer results. There is no automatic splitting that could partly deliver then repeat a whole response.

`delivered` in Core's Notifications contract means provider-accepted, not user-read or business-completed. A lost/invalid/wrong-recipient response becomes `unknown`; adapters do not retry and do not invent provider idempotency headers. Core's Outbox key is a local operation identity, not permanent remote deduplication. Uncertain sends require provider evidence/host reconciliation; automatic status callback/query recovery is not supplied here. HTTP errors are intentionally conservative Unknown results. Tokens and provider error payloads are not returned to the model; hosts must also redact URL/query tokens in network/access logs.

## Evidence and next application step

`test/iaic-provider-channels.test.js` checks raw verification, batch/identity isolation, encrypted WeCom callbacks, tampering, exact message IDs, command/topic mapping, sender receipts, window/revocation checks and byte limits. `examples/core-assistant-channels` uses real PostgreSQL and one User Assistant Task across Telegram, Slack, Lark, WhatsApp and WeCom; all network sends use test responses. The independently installed example supplies the optional WeCom packages explicitly.

Configure the application's credentials, public webhook endpoints, durable ingress, account links and notification worker, then validate a real conversation in each controlled account. No live bot provisioning, real employee messages or production deployment is claimed by these fixtures.

Protocol sources: [Telegram Bot API](https://core.telegram.org/bots/api), [Meta webhook payloads](https://www.postman.com/meta/whatsapp-business-platform/folder/vzaxn16/webhook-payload-reference), [Meta text-message reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/text/), [WeCom application messages](https://developer.work.weixin.qq.com/document/path/90236), [WeCom received messages](https://developer.work.weixin.qq.com/document/path/90239), [open-source WeCom crypto](https://www.npmjs.com/package/@wecom/crypto). Meta's old Node SDK is archived; it is a reference, not a new runtime dependency.
