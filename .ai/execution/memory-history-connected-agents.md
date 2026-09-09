---
id: execution/memory-history-connected-agents
description: Show saved-memory history and honest server-observed client activity in the Memory app.
owner: memory
phase: issue-208-memory-history-connected-agents
issue: 208
status: reviewable
---

# Memory history and connected agents

## Goal and context

The authenticated Memory app must expose ordered saved memories and distinguish
clients with real current requests from recently active or inactive clients.
Issue: https://github.com/GOI17/alfred/issues/208. Work stays in the existing
`memory-history-connected-agents` Git worktree on
`issue-208-memory-history-connected-agents`, based on local main
`aed06409b339c6fef59ac615d5dfca4e079ade21`.

The existing console manages tenant access and API keys. `MemoryService.listMemories`
already supplies tenant-scoped records, exact pagination, filters for namespace,
project ID, type and tag, and ordering by `createdAt DESC, id DESC`. Reuse that
contract. Stored records contain current memory state; they do not provide a
durable revision/deletion audit. MCP currently uses stateless HTTP requests
(`sessionIdGenerator: undefined`). API-key `last_used_at` can change during console
authentication and cannot prove agent presence.

## Requirements

1. Add authenticated console access to saved-memory history, reusing the existing
   tenant memory service. Return useful available metadata: content, type, source,
   tags, namespace, project ID, creation time and update time. Show a clear history
   entry point in the app. Never invent missing source identity or earlier versions.
2. Present newest-created records first with stable ID tie-breaking and bounded
   pagination. Expose the existing actual namespace/project filters where useful;
   validate pagination and filter inputs. Keep exact counts/navigation consistent
   with the underlying list result. This is a chronological view of saved records,
   not a revision/deletion audit or snapshot-isolated timeline under concurrent writes.
3. Observe authenticated actual agent-facing requests in a bounded, process-local
   observer shared by server routes. Include OpenAPI and MCP; include ordinary
   memory HTTP requests where the existing integration makes that practical.
   Polling console history/activity, key registration, health checks, and registry
   timestamps must not create or renew agent activity.
4. Derive presence from request lifecycle evidence. `connected` means an observed
   authenticated request remains open within its explicit maximum lifetime.
   Completed requests become `recently_active` within an explicit activity TTL
   (60 seconds), then `inactive`. Transport close, abort, error and
   timeout must release open-request state. Concurrent requests for one identity
   must not become disconnected when only one request ends. Expired observation
   must never remain connected indefinitely.
5. Expose last observed time, observed transport and clear status labels. A
   registered credential alone is never connected. Group observations by verified
   credential/OAuth identity and transport, using safe display identifiers; explain that shared
   credentials can represent multiple agents and do not identify a unique runtime.
   Do not claim durable sessions or background heartbeats unsupported by transport.
6. Derive the tenant exclusively from verified server authentication. Reject or
   ignore caller-selected tenant overrides without widening access. Namespace and
   project ID filters apply only within authorized memory data. A filesystem
   workspace is not a tenant: do not infer workspace membership from arbitrary
   headers or registry credentials. Presence is tenant-scoped with workspace unknown
   until a trustworthy workspace association exists. Show this limitation clearly.
7. Keep the observer bounded and expose its limits honestly: it observes only the
   current server process, resets on restart and does not aggregate replicas.
   Discarded/expired records and unavailable observation must not be represented as
   proof of an agent being offline everywhere. Distinguish inactive observation
   from current connection, and stale UI data from a fresh successful response.
8. Protect private data. New APIs and client requests use no-store semantics.
   Render user content as text, without HTML execution. Do not return/log keys,
   bearer tokens, credential hashes, internal exception details or memory contents
   in observation traces. Use generic recoverable errors and existing auth rules.
9. Both views provide accessible loading, empty, error/retry and refresh states.
   Show last successful refresh/staleness. Logout and credential changes clear
   private views and invalidate/abort outstanding requests; stale responses must
   not repopulate another authenticated context. Polling failures must not display
   old connections as newly confirmed active.
10. Keep operations deterministic and application LLM provider calls at zero.
    Reuse installed dependencies and permitted Memory/console packages; change no
    protected core/harness configuration or other worktrees. Emit project trace
    events for decisions, permission boundaries and validation checkpoints.

## API and presentation contract

Use the existing tenant route pattern:
`GET /console/api/tenants/:id/memories` and
`GET /console/api/tenants/:id/agents`. Require the path tenant ID to match the
verified authenticated tenant; return 404 for cross-tenant targets. History defaults
to 25 records per page and exposes namespace, project ID and type filters. Presence
lists observed identities only. The existing API Keys area may continue showing
credential validity separately; validity is not connection evidence.

## Implemented observation limits

Presence is grouped by verified credential/OAuth identity and transport, scoped to
the authenticated tenant. It observes this server process only; workspace remains
unknown. Shared credentials do not identify unique runtime agents. Registration
alone does not create an observation.

The recent-activity window is 60 seconds; an open request has a maximum observation
lease of 5 minutes. Inactive/disconnected observations are retained for at most
24 hours. The observer is bounded to 1,000 entries and 100 concurrent requests per
identity. These are observation limits, not durable sessions or proof of inactivity
outside this process. Restart clears observation and replicas do not aggregate it.

## Implementation boundaries

Implement within existing `packages/memory-server`, `packages/console-web` and,
only when reuse requires it, unprotected `packages/memory` interfaces. Preserve
hexagonal boundaries and existing Memory list behavior. Use atomic temp-and-rename
file writes. The developer specialist owns application code; QA verifies regression
behavior and reviewer checks security/architecture before delivery.

Related issue #102 covers broader provenance; this work supplies current saved
records without claiming that audit trail. Issue #201 explicitly excludes presence
and remains independent. Coordinate with future list contracts in #197/#199 without
changing other branches or expanding this issue into client deletion or management.

No additional authorization exists for reading/modifying `.opencode/`, `.codex/`,
`.agents/`, `.ai/harnesses/`, or `packages/core/`; dependency installation, secret
access and destructive operations remain excluded. Root test/check commands that
traverse protected paths require specific approval and must be reported as blocked
until granted. Run permitted package checks first. Do not update eval baselines.

## Validation plan

Capture permitted existing package tests/build/static validation before changes,
then compare corresponding results after implementation. Use local deterministic
fixtures, controlled clock/request lifecycle and isolated temporary storage; no live
secrets, remote database credentials or provider requests.

- History: verified authentication, tenant isolation/override attempts, supported
  filters, bounded/invalid pagination, empty results, tied creation timestamps,
  useful metadata, service errors and stable navigation.
- Observation: registration-only is not connected; console polling never renews
  presence; real authenticated OpenAPI/MCP requests create evidence; request finish,
  close, abort, error and lifetime expiry release connection; concurrent requests,
  TTL boundary, bounded retention and separate tenants remain correct.
- Privacy/UI: safe text for hostile memory content, no credential material in new
  responses, no-store, loading/empty/retry/stale states, context changes and delayed
  responses after logout or credential replacement.
- Regression: existing Memory list contract and console/auth behavior remain intact.
  Report allowed checks with exact outcomes and baseline deltas, plus protected-path
  or unavailable-environment checks that could not run. No baseline promotion.

## Validation results

Implementation, QA and reviewer validation completed. Allowed automated suites
reported 395 passes, zero failures and two opt-in real-Postgres tests skipped.
Scoped checks passed; policy validation reported 12 checks. Coverage includes
36 new regressions: 23 observer tests, six backend tests and seven UI tests.

Browser verification confirmed 27-record pagination (25 then two), namespace
filtering to 14 records, hostile text rendered inert, four presence states,
omission of registration-only identities, empty/error states, logout and tenant
switch isolation, and resetting to the first page when edited filters are applied.

Global root checks/evals remain unexecuted because they traverse protected core or
harness paths without authorization. The two opt-in real-Postgres skips leave live
Postgres integration unverified in this session. No dependencies were installed,
secrets accessed, other worktrees written, or eval baselines promoted. Application
provider calls remained zero. Final PR publication is tracked below.

## Completion conditions

- [x] Issue #208 exists and branch follows the required issue naming convention.
- [x] Existing history/authentication/transport capabilities and limits are specified.
- [x] History API/UI meets requirements 1, 2, 6, 8 and 9.
- [x] Actual request observation and UI meet requirements 3–9.
- [x] Allowed tests/build/checks pass against the recorded baseline.
- [x] QA and reviewer findings are resolved or clearly documented as limitations.
- [x] Traces and visible worktree checkpoints record the final outcome.
- [x] Reviewable [PR #211](https://github.com/GOI17/alfred/pull/211) links `Closes #208` and reports validation and limitations.

## References

- `AGENTS.md`; `.ai/context.md`; `.ai/agents/orchestrator.md`.
- `docs/architecture/001-ddd-glossary.md` and `002-hexagonal-architecture.md`.
- `docs/architecture/006-security-model.md`, `007-observability-traceability.md`
  and `008-evals-reproducibility.md`.
- `.ai/policies/memory-workspace-policy.md`.
- `.ai/execution/memory-history-connected-agents-issue.md`.
- `packages/memory/src/index.js`, `packages/memory-server/src/mcp-router.js`,
  `packages/memory-server/src/openapi-router.js`, `packages/console-web/src/index.html`.
