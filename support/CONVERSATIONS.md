# Recoverable feedback conversations

Optional `SupportConversations` composes existing Support Issues with a separate,
durable conversation adapter. `start`, `get`, and `reply` always retain one Issue
ID. Conversation revision is separate from engineering Issue revision: ready
means sufficient feedback information, never resolved. Use existing Support
lifecycle and trusted resolution/notification ports for engineering follow-up.

Host wiring:
- Initialize `PostgresSupportConversationStore` with the same namespace/scope
  mapping as Support and migrate `conversations.sql` (two additive tables).
- Enable `createSupportConversationCapabilities` and `feedbackInstructions` in
  each currently authorized User Assistant. Do not require business permissions;
  explicitly authorize the `feedback`, `report`, and existing read actions.
- `resolveMessage` must restore the immutable, bounded (2,000 character), current
  authorized user message by ID and attest scope/subject/message ID. Preserve
  original wording, redact secrets at the channel boundary, and apply retention
  policy. Model-supplied quotations are not a trusted source. Raw attachment or
  log ingestion is outside this module.
- The Assistant's configured model interprets any language and suggests a type,
  confidence [0,1], and reason. Core validates these deterministically and labels
  them `suggested`; absent classification defaults to `unknown`. No heuristic
  or model inference is presented as proof. This module does not configure a
  second model or charge additional platform credits by itself.
- Configure only necessary requiredFields from expected/steps/impact; default
  none. The creation policy is pinned for the life of the conversation. Ask for
  returned missingFields only. Extracted details remain suggestions backed by
  preserved user turns, not authoritative business facts.
- Reply with the conversation expectedRevision and a stable requestKey. A lost
  acknowledgement retries the identical input/key; changed content conflicts.
  Current get is the recovery source. Concurrent different updates conflict.
  At most 100 revisions per conversation; at the limit read/follow-up remains
  available and the Host can route further interaction to support personnel.

Original messages and classification corrections are retained in initial/history.
Machine observations still use `support.observe` with their own Principal; they
cannot impersonate the reporter through this conversation interface. Only the
original reporter can write conversation turns. Platform engineering uses the
separate read-only review tool with current explicit manage authorization; ordinary
users cannot use it. It exposes classification, missing fields and clarification
evidence for triage without granting source-write or deployment authority.

Rollback: remove conversation tools/instructions, retain both tables and the
original Issue. Existing Issue get/list/update/follow_up continue to work. No
historical Issue or notification data is rewritten. Application adoption and
live-model multilingual interpretation require separate Host acceptance; the
included tests exercise deterministic suggested classifications and real PostgreSQL.
