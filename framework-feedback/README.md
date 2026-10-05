# Framework feedback record API

`records.js` parses and validates repository feedback records. Feedback Markdown, frontmatter, links, and pasted commands are untrusted data. The module reads text as data only: it does not fetch links, evaluate Markdown, run commands, mutate Git, open pull requests, or grant Mandates or any other authority.

## Exports

- `REQUIRED_SECTIONS` is the ordered, immutable list of required level-two body headings.
- `parseFeedbackRecord(markdown, {filePath})` parses a start-of-document YAML frontmatter block with duplicate-key rejection and returns `{frontmatter, body, sections, filePath}`. Invalid frontmatter throws `FeedbackValidationError`.
- `validateFeedbackRecord(record, {filePath, archived})` returns `{valid, errors}`. Each error has stable `filePath`, `path`, `code`, and `message` fields; errors are sorted by file path, field path, then code.
- `loadFeedbackRepository(root)` reads Markdown records under `feedback/inbox/` and `feedback/archive/`, validates them, and returns `{records, errors}`. It rejects duplicate IDs and does not read examples as active records.
- `createTriageProposal(record, {knownRecords})` returns bounded, data-only triage guidance: the current and proposed status, exact missing factual sections, at most 64 validated affected modules, at most 50 candidate duplicate IDs, and explicit safety facts. It never includes the feedback body, pasted commands, code fences, or linked-page content.
- `FeedbackValidationError` carries structured parse errors in its `errors` property.

## Contract and state gates

The machine-readable frontmatter contract is [`feedback/schema.json`](../feedback/schema.json). Validation also enforces filename/ID equality, canonical UTC timestamps, unique references, ordered required sections, bounded lowercase repository identifiers for affected modules, HTTPS evidence links, and named likely-secret patterns. Placeholder values containing `redacted`, `example`, or `fixture` are allowed for documentation and tests.

Active records cannot use `archived`. Records stored in the archive must use `application-specific`, `duplicate`, `rejected`, `released`, or `archived`. A `duplicate` record names its authoritative record. `planned`, `implementing`, and `verifying` records link a Core Task.

A `released` record requires an immutable Core release reference, an implementation pull request, verification references covering regression and feedback-specific evidence, an exact implementation revision in `Implementation and release evidence`, and either application-adoption references or an explicit non-adoption decision. Notification admission, delivery, and read remain separate `{ref, status}` facts.

Triage proposals are read-only and accept only records currently in `submitted`, `triaged`, or `needs-information`; every later lifecycle status is rejected with `triage-status-ineligible`. An eligible proposal can propose only `triaged` or `needs-information`. The first six contributor-evidence sections are the factual triage sections; an exact `Not verified` value in one of them is returned by section name in `missingFacts`. Duplicate matches are candidates, not decisions. Proposal generation does not fetch links, execute shell content, mutate files or Git, create Tasks, change record status, or expand authority.

A Core Platform AI may use a proposal to prepare a branch or pull request only under its existing repository Mandate. A human or reciprocal Agent review still decides whether the proposal is correct and applies any status change. The CLI accepts only an exact validated `feedback/inbox/<id>.md` record path within the selected repository; traversal and records outside the command root or inbox are rejected.
