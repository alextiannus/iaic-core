# Framework feedback record API

`records.js` parses and validates repository feedback records. Feedback Markdown, frontmatter, links, and pasted commands are untrusted data. The module reads text as data only: it does not fetch links, evaluate Markdown, run commands, mutate Git, open pull requests, or grant Mandates or any other authority.

## Exports

- `REQUIRED_SECTIONS` is the ordered, immutable list of required level-two body headings.
- `parseFeedbackRecord(markdown, {filePath})` parses a start-of-document YAML frontmatter block with duplicate-key rejection and returns `{frontmatter, body, sections, filePath}`. Invalid frontmatter throws `FeedbackValidationError`.
- `validateFeedbackRecord(record, {filePath, archived})` returns `{valid, errors}`. Each error has stable `filePath`, `path`, `code`, and `message` fields; errors are sorted by file path, field path, then code.
- `loadFeedbackRepository(root)` reads Markdown records under `feedback/inbox/` and `feedback/archive/`, validates them, and returns `{records, errors}`. It rejects duplicate IDs and does not read examples as active records.
- `FeedbackValidationError` carries structured parse errors in its `errors` property.

## Contract and state gates

The machine-readable frontmatter contract is [`feedback/schema.json`](../feedback/schema.json). Validation also enforces filename/ID equality, canonical UTC timestamps, unique references, ordered required sections, HTTPS evidence links, and named likely-secret patterns. Placeholder values containing `redacted`, `example`, or `fixture` are allowed for documentation and tests.

Active records cannot use `archived`. Records stored in the archive must use `application-specific`, `duplicate`, `rejected`, `released`, or `archived`. A `duplicate` record names its authoritative record. `planned`, `implementing`, and `verifying` records link a Core Task.

A `released` record requires an immutable Core release reference, an implementation pull request, verification references covering regression and feedback-specific evidence, an exact implementation revision in `Implementation and release evidence`, and either application-adoption references or an explicit non-adoption decision. Notification admission, delivery, and read remain separate `{ref, status}` facts.

This module provides validation only. It does not implement ID allocation, index generation, a command-line interface, or triage proposals.
