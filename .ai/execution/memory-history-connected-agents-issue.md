## Goal

Memory app lets authenticated users consult their memory history and identify agents with current, server-observed connection/activity evidence, distinguishing stale/disconnected entries.

## Context

User explicitly requested implementation through validation and a reviewable PR in the existing Git worktree. Related #102 concerns broader memory provenance, and #201 concerns client visibility/browser management but explicitly excludes presence. This issue delivers the requested history/presence vertical slice without adopting those issues' unrelated provenance or deletion scope. Coordinate with #197/#199 future list contracts; do not modify other agents' branches.

## Tasks

- [ ] Investigate and reuse current Memory listing, authenticated tenant resolution, and connection/activity signals.
- [ ] Write SDD specification with explicit chronological-history and presence semantics.
- [ ] Implement authenticated history API/UI with useful existing metadata, deterministic ordering and bounded navigation.
- [ ] Implement real agent activity/connection observation and UI; never infer connected status from registration alone.
- [ ] Preserve tenant/workspace boundaries, redact credentials, and handle empty/error/stale/logout states.
- [ ] Add deterministic regression coverage and run allowed checks against baseline.
- [ ] Record traces, document limitations, and open a reviewable PR.

## Acceptance criteria

- History is reachable in the Memory web app and shows ordered records with useful available content/type/namespace/source/time metadata.
- Navigation remains deterministic for equal timestamps; empty results and failures are clear and recoverable.
- Connected/recently active agents require a real server-observed transport/activity signal with documented expiration; registered credentials and durable work sessions alone never count as presence.
- Old/disconnected records are visibly distinct; unknown or unsupported presence is reported honestly.
- All data derives from authenticated tenant context. Workspace scope must not be fabricated or broadened, and requests cannot override tenant authorization.
- No keys, hashes usable as credentials, OAuth tokens, or internal exception details appear in new views/responses/traces.
- UI uses safe text rendering and prevents stale asynchronous responses after logout or credential changes.
- Tests cover history ordering/navigation, tenant isolation, observed/stale/disconnected activity, empty/error states and regressions.
- No protected paths, dependency installation, live secrets, destructive operations or LLM-provider application calls are needed; any true blocker requires specific user authorization.

## Delivery

Base: local main at aed06409b339c6fef59ac615d5dfca4e079ade21. Existing checkout: memory-history-connected-agents. Rename its branch to issue-N-memory-history-connected-agents after issue creation. Single cohesive PR with spec, code, tests and traces; do not merge/deploy.
