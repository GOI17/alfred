---
id: execution/proactive-memory
description: Capture grounded durable memories without waiting for an explicit save request.
phase: issue-210-proactive-memory
author: architect
issue: 210
---

# Proactive Memory

## Goal

Alfred identifies useful durable information in the active conversation and
persists a narrow memory without waiting for the user to say “remember this”.
The agent proposes grounded candidates; a deterministic MemoryPolicy and the
existing MemoryService decide and perform persistence. Successful writes are
reported briefly to the user. Explicit memory CRUD remains compatible.

## Current evidence

- `packages/memory/src/policy.js` evaluates candidates but is not connected to
  `createMemoryService` in `packages/memory/src/domain.js`.
- HTTP, Action, and remote MCP paths converge on MemoryService. Local stdio MCP
  delegates through `packages/memory-client` to HTTP.
- MCP currently describes `memory_create` as requiring an explicit user request.
- The GPT source prompt describes manual writes but no proactive selection loop.
- The Codex adapter distributes `.ai/agents/orchestrator.md` as its primary
  instruction source; editing that source does not require live harness writes.

## Design decisions

1. Add `captureMemory(userId, input)` to MemoryService and transport it as
   `memory_capture` and `POST /memories/capture`. Keep existing CRUD operations
   and their response shapes intact. A separate operation makes a skipped
   proactive candidate an ordinary result and avoids weakening compatibility
   for intentional user-created facts.
2. Keep capture policy and persistence orchestration in `packages/memory`.
   Transports authenticate, validate their wire format, delegate, and serialize.
   Do not import harness or provider concepts into the policy or service.
3. Use the already-running agent to identify candidates. Do not introduce an
   LLM extraction service, provider calls, a background transcript watcher, or
   a model assignment. Every capture operation has zero provider calls.
4. Deduplicate exact normalized content in the same tenant and namespace.
   Do not merge paraphrases, overwrite conflicting facts, or add semantic
   duplicate detection. Lookup must cover matching records beyond the first
   page; unrelated tenants and namespaces are never duplicates.
5. Honor the user's active opt-out and per-candidate exclusions. Persistent
   account-level memory settings are outside this change. Agent instructions
   retain the opt-out for the active conversation and pass it to capture.
6. Keep context transient. Store the selected memory and small capture metadata
   only; never store a full conversation, raw context, or rejected candidate.
7. Existing authorization and hosting boundaries still apply. Capture does not
   connect new accounts, configure a remote destination, broaden permissions,
   or silently fall back to an unconfigured storage location.

## Capture contract

Input is `{ candidate, context }`. Candidate uses existing memory fields,
including concise `content`, `source`, optional `type`, `namespace`, `projectId`,
`tags`. Use a strict candidate allowlist; arbitrary metadata is not required
and may be rejected. Type may be inferred by MemoryPolicy when omitted. Context
is `{ evidence, origin, persistenceDisabled? }`: evidence is the minimal relevant
source statement (at most 2,000 characters), origin is `user` or `verified`, and
persistenceDisabled explicitly suppresses auto-save. It must not contain the
whole transcript. Candidate content is at most 1,000 characters and must be an
exact normalized excerpt of evidence. Agent instructions preserve the source
wording when selecting this narrow excerpt. All schemas and declarations use
these fields consistently.

The agent must select only information directly stated by the user or supported
by an observed, authoritative project source. A source label alone does not
prove that a candidate is true. The deterministic policy rejects obvious
uncertainty, questions, hypothetical or transient material; instructions govern
semantic grounding beyond those checks. Do not claim semantic entailment has
been mechanically verified.

The result is one of:

- `{ status: "created", memory, reason }` after the store confirms a write.
- `{ status: "duplicate", memory, reason }` when an equivalent memory already
  exists in the authorized tenant and namespace and no write occurred.
- `{ status: "skipped", reason }` when policy rejects a candidate or auto-save
  is disabled. Rejected content and context are absent from this result.

Malformed requests retain normal validation errors. Storage or transport errors
remain errors; they must never become successful capture results. The HTTP
endpoint uses a documented success status for the result union and existing
error envelopes. OAuth requires `memory:write`; internal duplicate checks are
scoped to the authorized tenant. The authenticated identity always comes from
the existing transport, never request-supplied context.

Capture normalizes and validates input, checks opt-out and MemoryPolicy before
persistence, derives namespace using existing rules, looks for exact duplicates,
and writes at most one new memory per accepted call. The service returns the
stored memory identifier, enabling ordinary read/search verification later.
No new database schema is required. Exact duplicate protection is deterministic
for completed repeated calls; distributed concurrency guarantees must not be
claimed unless implemented and verified.

## Policy requirements

- Recognize reusable preferences, decisions, workflows, corrections, project
  information, references, and stable facts in English and Spanish.
- “Prefiero respuestas breves” and “I prefer concise answers” are affirmative
  durable candidates without a save request.
- An allowed type alone must not turn an ambiguous or transient proactive
  candidate into a durable one. Empty content cannot be rescued by a type,
  tag, source, or unrelated context keyword.
- Explicit auto-save opt-out and “do not remember this” / “no guardes esto”
  override positive durability signals. Context can express those exclusions
  even when the candidate has been summarized without the exclusion phrase.
- Reject secrets and credentials, sensitive personal or payment data, raw
  transcripts, internal reasoning, logs, current execution state, and obvious
  uncertainty in both languages. The pattern-based guard is conservative and
  is not described as a comprehensive secret detector.
- Check relevant candidate fields and supplied source context for rejection
  signals before returning permission to persist. Never emit their contents
  into traces, validation details, or skipped results.

## Agent behavior and distribution

Update the source Orchestrator instructions, MCP server instructions/tool
metadata, GPT prompt, and Action schema together:

1. During ordinary work, identify a small, specific, useful durable statement.
2. Respect current memory availability, configured destination, authorization,
   and any user opt-out. Do not ask for a separate save request for routine
   accepted candidates.
3. Call capture with minimal grounding context. Prefer it over ordinary create
   for proactive writes; a rejected capture must not be retried through create.
4. State that a memory was saved only for a confirmed `created` result, with a
   concise summary. A duplicate requires no new-save claim. A skipped candidate
   must not interrupt ordinary work. Report persistence failures honestly.
5. Keep explicit create/update/delete tools available. Preserve existing delete
   confirmation and tenant isolation rules.

Refresh any tracked generated primary instruction block required for repository
consistency through its approved source workflow. This feature does not apply
new instructions to live harness configuration or publish the hosted GPT.

## Observability

Capture emits auditable TraceEvents for allowed, skipped, duplicate, created,
and failed outcomes through a testable trace interface. Events identify the
operation, outcome, safe reason code, and `provider_calls: 0`. Optional memory
IDs are allowed after success. Events never include candidate content, context,
source excerpts, credentials, or exception messages that can contain input.
The coordinator records architecture and delegation decisions in the task trace.

## Acceptance criteria

1. A connected agent is instructed to invoke capture for a grounded durable
   statement even when the user never requests saving it; generated/source
   instruction tests cover MCP, GPT, and Orchestrator distribution.
2. Real MemoryService capture writes both example preferences, preserves the
   intended namespace/source, and returns identifiers retrievable afterward.
3. Policy-denied, uncertain, temporary, secret-bearing, opt-out, and malformed
   examples do not write; positive metadata/type cannot bypass rejection.
4. Repeating a completed capture returns `duplicate` and leaves one matching
   record. Same content in another tenant or namespace remains independent.
5. HTTP, OpenAPI Action, local stdio MCP, and remote MCP adapters expose the
   contract with matching client methods, declarations, and schemas. At least
   HTTP plus MCP integration tests prove persistence through the shared service;
   adapter tests cover delegation/authentication for the remaining routes.
6. Missing credentials and missing `memory:write` authorization deny capture.
   Request-supplied tenant fields cannot redirect capture or duplicate lookup.
7. Injected storage and transport failures never return `created`, and traces
   and skipped results contain no rejected raw content or source context.
8. Existing CRUD tests continue passing. No live harness writes, provider calls,
   baseline changes, or database migrations are introduced.
9. Relevant package checks, tests, repository validators, and existing eval
   baseline comparison pass. Open a reviewable PR linking `Closes #210`.

## Validation strategy

Use deterministic tests with actual in-memory and SQLite stores where available,
HTTP test servers, and MCP handlers. Verify resulting store state, isolation,
status unions, auth failures, and redacted trace payloads. Static instruction
checks establish the shipped agent guidance but do not prove a model will always
select every useful candidate; no blanket automatic-recall claim is warranted.
Do not spend provider tokens for these checks. Preserve current baselines.

## Implementation evidence

- `packages/memory/src/capture.js` owns validation, policy evaluation, scoped
  exact deduplication, persistence and redacted outcome traces. MemoryService
  exposes it through all HTTP, MCP and Action adapters and both client APIs.
- `packages/memory/test/capture.test.js` covers policy/storage outcomes;
  `packages/memory-server/test/proactive-capture.acceptance.test.mjs` passes
  14 independent cases, including actual stdio MCP to HTTP to SQLite, database
  reopen, remote MCP OAuth, three HTTP surfaces, isolation and failure handling.
- Final MCP/OpenAPI/GPT instruction and schema contracts pass 48 tests.
- `pnpm check` passes. Behavioral suites in `pnpm test` pass; its release
  validator initially identified stale exact test counts. The manifest now
  matches the current GPT (12), console build (11) and opencode (12) suites,
  and `node scripts/validate-release-0.4.1.mjs` passes all 19 gates. The latter
  two test files were unchanged by this feature. No baseline files changed.
- Eval runner comparison passes against 19 existing baselines with 17 current
  results, zero regressions and zero application provider calls.
- Independent review reproduced and verified fixes for secret-in-sentence,
  natural-language opt-out, raw-log and task-only preference false positives.
- Live harness configuration and hosted GPT publication remain operator rollout
  steps; this change ships the source guidance and executable capture contract.
