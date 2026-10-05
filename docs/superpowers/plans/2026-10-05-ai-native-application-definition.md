# AI Native Application Definition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one canonical, visually explained definition of an AI Native Application and connect it to every contributor entry point.

**Architecture:** `AI_NATIVE_APPLICATION.md` is the only conceptual source of truth. GitHub-native Mermaid diagrams explain principal/Agent relationships, the execution path, the reasoning/Harness boundary, placement decisions, and accountable evolution; existing requirements, acceptance, status, onboarding, and feedback documents retain their narrower responsibilities.

**Tech Stack:** Markdown, GitHub Mermaid, Node.js 20 `node:test`, npm package allowlist.

**Spec:** `docs/superpowers/specs/2026-10-05-ai-native-application-definition-design.md`

## Global Constraints

- Roles express represented responsibility and never grant authority.
- Identity, Permission, Mandate, resource scope, payer, policy, and revocation govern every effect.
- AI may reason and adapt; deterministic Harness code owns authorization, schemas, durable state, money, idempotency, reconciliation, and audit.
- The document must not claim that all Core capabilities, Platform AI automation, application adoption, or production quality are complete.
- Application-specific business truth remains in the application; only reusable domain-neutral mechanisms belong in Core.
- Diagrams must remain reviewable as text and render without external assets or services.

---

### Task 1: Canonical definition and documentation contract

**Files:**
- Create: `AI_NATIVE_APPLICATION.md`
- Create: `test/iaic-ai-native-definition.test.js`
- Modify: `docs/superpowers/specs/2026-10-05-ai-native-application-definition-design.md`

**Interfaces:**
- Consumes: the approved definition and responsibility model in the design spec.
- Produces: a stable public conceptual contract containing the canonical definition, three Agent roles, five Mermaid diagrams, twelve design questions, anti-patterns, and links to status/evidence documents.

- [ ] **Step 1: Write the failing documentation-contract test**

Create a Node test that reads `AI_NATIVE_APPLICATION.md` and asserts the canonical definition, role names, authorization terms, deterministic Harness terms, twelve numbered design questions, Mermaid diagram count, status links, and absence of unsupported completion claims.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/iaic-ai-native-definition.test.js`

Expected: FAIL because `AI_NATIVE_APPLICATION.md` does not exist.

- [ ] **Step 3: Write the canonical document**

Create the document in this order: one-sentence definition, quick design test, visual system map, terms, responsibility table, execution flow, reasoning/Harness boundary, placement decision, persistent responsibility, interoperability, accountable evolution, contributor checklist, anti-patterns, and implementation-status links.

- [ ] **Step 4: Mark the design spec approved and record the visual implementation**

Change spec status from `review-pending` to `approved` and state that GitHub Mermaid is the maintained visual format.

- [ ] **Step 5: Run the focused test**

Run: `node --test test/iaic-ai-native-definition.test.js`

Expected: PASS.

### Task 2: Contributor entry points and package delivery

**Files:**
- Modify: `README.md`
- Modify: `GETTING_STARTED.md`
- Modify: `CORE_REQUIREMENTS.md`
- Modify: `package.json`
- Modify: `scripts/verify-package.mjs`
- Modify: `test/iaic-ai-native-definition.test.js`

**Interfaces:**
- Consumes: `AI_NATIVE_APPLICATION.md` from Task 1.
- Produces: discovery links for repository readers and an installed-package copy verified by the independent package check.

- [ ] **Step 1: Extend the failing contract test**

Assert that README links the definition before setup, Getting Started links it before the first capability, Core Requirements names it as the conceptual contract, the package allowlist contains it, and package verification checks the installed file.

- [ ] **Step 2: Run the test to verify the new assertions fail**

Run: `node --test test/iaic-ai-native-definition.test.js`

Expected: FAIL on missing links and package entries.

- [ ] **Step 3: Add the links and packaging entry**

Add concise links without duplicating the definition. Add `AI_NATIVE_APPLICATION.md` to `package.json#files` and the installed-file access list in `scripts/verify-package.mjs`.

- [ ] **Step 4: Run the focused test again**

Run: `node --test test/iaic-ai-native-definition.test.js`

Expected: PASS.

### Task 3: Validate, commit, and integrate

**Files:**
- Validate all files changed in Tasks 1 and 2.
- Do not stage `.superpowers/` visual-companion state.

**Interfaces:**
- Consumes: the complete documentation change.
- Produces: a reviewed commit, pushed branch, green PR evidence, and merge to `main` without representing the documentation merge as a Core release.

- [ ] **Step 1: Run deterministic checks**

Run: `git diff --check`

Run: `node --test test/iaic-ai-native-definition.test.js test/iaic-framework-feedback.test.js`

Run: `npm run feedback:verify`

Expected: all pass.

- [ ] **Step 2: Run package and full Core checks**

Run under Node 20 with an isolated PostgreSQL database: `npm test` and `npm run verify:core-package`.

Expected: all pass. A missing isolated database is reported as unverified, never converted into a pass.

- [ ] **Step 3: Review the complete intended diff**

Verify links, Mermaid syntax, status claims, terminology, package contents, and that no `.superpowers/` file is staged.

- [ ] **Step 4: Commit and push**

Stage only the intended documentation, test, package, and plan/spec files. Commit with `docs: define AI Native applications` and push the current PR branch.

- [ ] **Step 5: Verify CI and merge**

Wait for the PR head checks. Merge the reviewed PR to `main` only when required checks are green, then verify the remote main revision. Do not call this a new Core release or application adoption.
