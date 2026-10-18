---
id: alfred-runtime-authority
issue: 217
description: Managed Alfred-first runtime resolution, project consent and executable CLI boundary
phase: issue-217-first-vertical-slice
status: first-slice-and-core-policy-verified
owner: architect
---

# Alfred runtime authority

## Goal and first deliverable

Install Alfred once; initialize each project independently. Alfred owns instruction resolution, consent, policy evaluation and orchestration for managed requests. Hosts implement execution capabilities within their own security controls.

The first vertical slice is executable `alfred runtime init`, `alfred runtime run` and `alfred runtime status`. Keep existing Memory `alfred init` semantics intact. A plan-only command or generated host instruction is not completion of this slice.

## Scope clarification: actions belong to skills

Examples such as opening a URL illustrate Alfred-first resolution; they are not feature requirements, mandatory contracts or acceptance criteria for #217. Concrete actions belong to future Alfred skills. This objective provides the generic skill resolution, authorization and invocation boundary, without encoding example-specific behavior in the runtime. The existing `read-text-v1` slice is a verified foundation, not a requirement to implement every illustrated action as a built-in contract.

## Requirements

### R1: Alfred-first state transitions

1. Validate initialization and canonical workspace identity. Read Alfred instructions first on every request, including requests with existing grants.
2. Instruction resolution returns `matched`, `absent`, or `failed`. A permission denial is not absence. Invalid configuration, ambiguous resolution and lookup errors fail closed.
3. A matched instruction uses Alfred policy gates and the managed execution port. Never discover global options for this branch, including execution failure or denial.
4. Only confirmed `absent` enables discovery of applicable global options. Discovery reads metadata only; it must not read candidate source content before consent or a valid existing grant. Invalid discovery terminates with failure.
5. No global match returns `no_match`. Otherwise select a concrete option and display its identity, source and requested scope. Validate policy before offering consent.
6. Consent choices are exactly `Permitir`, `Permitir siempre`, `Cancelar`. Once authorizes this request and option only. Always persists a content-bound, exact-scope grant in this workspace only. Cancel terminates without execution or trying another option.
7. Immediately before execution recheck workspace identity, selected content digest, exact requested scope, instruction applicability and permissions. Changed inputs require fresh resolution/consent or fail closed; never silently substitute another option.
8. Invoke the execution port and record its actual outcome. Execution failure is terminal for this request, with no alternative-provider, global-option or instruction fallback.

### R2: Developer API contract

The implementation provides `resolveRuntimeRequest(request, ports)` in `packages/core/src/runtime-authority.js` and exports it through the existing core entrypoint. It resolves authority and authorization; execution is coordinated by a core application use case `runRuntimeRequest(request, ports)` that rechecks before invoking `ports.execute`. These may share one internal state machine; do not duplicate rules across adapters.

Request fields: `request_id`, `workspace_id` (canonical workspace path supplied by infrastructure), explicit `action` and `scope`, and optional `option_id`. Free-form `input` is not required by this slice. User input is data, never implicit shell code.

Resolution outcomes: `ready | approval_required | no_match | denied | cancelled | failed`. Execution additionally reports `completed` or `failed`, with execution result and reason. Discovery is triggered only by the internal Alfred-lookup `absent` outcome, not by any generic falsy result. Distinguish lookup failure, policy denial and missing consent in machine-readable reasons.

Injected ports: Alfred instruction lookup; global option discovery; project grant load/save; consent; policy evaluation; current workspace/content revalidation; execution; trace sink. Use existing core permission and trace functions where applicable. Core imports no host SDK, filesystem or child-process implementation for this feature. Start with small functions and injected objects rather than new package hierarchies.

Each option carries stable identity, source, content digest and supported action/scope. Applicability must be deterministic and explicit for the supported first-slice input format; do not claim unrestricted natural-language instruction understanding. Consent responses bind to the presented request/option/digest/scope; reject stale or forged selections.

### R3: Project persistence

`runtime init` is idempotent and creates runtime-specific project state under `.alfred/` without overwriting Memory configuration or creating tenants/API keys. Record schema version and canonical workspace binding. Use `.alfred/runtime/project.json` for workspace binding and `.alfred/runtime/grants.json` for grants; report them through status.

A persistent grant binds canonical workspace path, option identity/source, content digest and exact action/scope. Do not use `resolveProjectIdentity().project_root`: it merges worktrees. Bind initialization to the canonical workspace so copying `.alfred/` to another project does not transfer grants. Reinitialization in a different location requires fresh consent. Symlink aliases resolve to the same canonical workspace; sibling worktrees do not. Run/status resolve the nearest initialized ancestor from ordinary subdirectories, stopping at a `.git` directory or worktree `.git` file. An uninitialized nested repository cannot inherit parent grants; explicit nested initialization creates an independent workspace.

Persist using atomic replacement. Never write grants to home/global config, shared Git metadata or another worktree. Changed option content invalidates its grant. Denial cannot be overridden by a stored grant. Non-TTY with no matching valid grant fails closed without prompting or executing. Once-consent is never persisted. Persistence failure on Always is terminal, not silent conversion to Once.

### R4: Integration and staged scope

- Existing dispatch point: `packages/memory-server/scripts/alfred.mjs`. Add a thin runtime command module alongside its existing commands; filesystem adapters can live in `scripts/runtime/` with a thin CLI bridge. They must contain I/O only, not a second domain implementation.
- Existing Memory `scripts/init.mjs`, `src/init.js` and `src/profiles/init-profiles.js` are not the runtime initialization domain.
- Core owns resolution, grant matching and orchestration. Existing `orchestrateTask`, `evaluatePermission` and `createTraceEvent` are integration candidates, not proof that request interception exists.
- First ship the reviewed built-in `read-text-v1` contract: execute an authorized file read and return its exact validated snapshot. This is actual managed execution for instruction loading, not general host/tool orchestration. Do not add arbitrary shell, argv or node-script execution in this slice. Tests must assert real returned file content and consent enforcement.
- Follow with Pi/OpenCode/Codex host bridges using the same application API. `packages/pi-adapter/src/runtime.js` currently has runtime spikes; Codex/OpenCode runtime files generate artifacts. Generated instructions can advertise the CLI but cannot establish mandatory interception.
- Copilot and other hosts require verified bridges before claiming coverage. Per-host enforcement and unsupported capabilities must be explicit. Native host requests outside the managed boundary remain outside first-slice guarantees.
- Durable background loops and restart/resume are later work. Issue #193 semantic tool contracts remain related and narrower.

### R5: Minimal catalog and executable contract

Use versioned schema version 1 for the project manifest and global catalog. Instructions match explicit action and exact scope, with disposition `deny` or `execute` and a concrete option reference for execution. Options identify stable ID, canonical source, contract ID, action, scope and content digest. Global catalog defaults to `~/.alfred/runtime/options.json` and is optional; read it only after confirmed Alfred instruction absence. Missing required Alfred manifest is `failed`; a valid empty instructions list is `absent`. A missing optional global catalog is `no_match`. Unknown contracts, malformed schemas and ambiguous matches fail closed.

Agreed manifest shape: `{version: 1, instructions: [{id, action, scope, disposition: "deny" | "execute", option}], options: [...]}`; omit `option` for denial. Option shape: `{id, source, contract: "read-text-v1", action, scope, digest}`. `source` is a canonical absolute local text-file path; digest is raw lowercase SHA-256 hexadecimal (64 characters). Global catalog shape: `{version: 1, options: [...]}`. Initialization accepts `--instructions` pointing to the shared required manifest. Run selects explicit `--action`, `--scope`, and optionally `--option`; these are matching labels, not arbitrary execution commands.

Consent binds the declared digest, which remains untrusted until verified. After consent or a valid grant, recheck permission, read the selected source once, verify its actual digest, and return only that exact snapshot, preserving a UTF-8 BOM in `result.content`. A mismatch is terminal and returns no source content. A test must prove Cancelar and non-TTY missing consent perform zero candidate-content reads.

Only `read-text-v1` is initially supported. Bind grants to content and contract implementation/version digests as well as option and scope. Execute the exact snapshot that was validated; avoid a second unchecked path read. Discovery metadata and source access remain subject to policy. No option can expand its scope or write to its source.

### R6: Acceptance and validation

Tests must prove actual managed execution, not only routing output:

- Init twice preserves project state and Memory settings; status reports initialized workspace and actual boundary.
- Alfred match executes its route; global discovery is never invoked for matched, denied, malformed, ambiguous or failed lookup cases.
- Confirmed absence discovers globals; Once executes once without grant persistence; Always survives restart only for the exact option/content/scope/workspace; Cancel executes nothing.
- Changed content, broadened scope, copied project state and sibling worktrees cannot reuse consent. Valid grants still require Alfred-first resolution and permission evaluation.
- Non-TTY without consent, failed grant persistence, execution failure and revalidation failure execute nothing further and never fallback.
- Mutation between resolution and execution cannot run changed content. Bind execution to the validated snapshot or verify the exact executable content immediately at the execution boundary.
- Trace request, resolution, discovery, consent, permission, revalidation and actual execution outcome with correlated IDs; do not log secrets or full sensitive inputs.
- Local deterministic tests and existing relevant regression gates pass with zero added provider requests. Never update baselines without separate human approval.

### R7: Delegation, tool necessity and task lifecycle refinement

This user-requested refinement continues #217 in its existing dedicated worktree. It supersedes former small/simple direct-handling rules. See `.ai/policies/delegation.md`, `.ai/agents/orchestrator.md`, `AGENTS.md` and `.ai/development.md`.

- Direct response is allowed only for one quick conversational question with an answer already available and no analysis, code, commands, external lookup, tool or other action required. Unknown facts cannot establish this exception. Small edits and read-only analysis remain delegated.
- No tools when the requested result can be produced without them. Necessary delegation, native Git worktree lifecycle and required action/verification tools are allowed to fulfill explicit obligations; optional business tools and proactive side effects are not justified by their availability.
- Explicit architecture resolution: the quick plain-answer exception requires no repository action or worktree, reconciling the universal new-task worktree wording with no tools. Every other independent task, including read-only work, gets a fresh native Git worktree. Same-task continuations/subagents reuse the verified parent worktree. This is not a broad read-only exemption.
- The Orchestrator delegates all nonquick tasks and chooses scheduling. Parallel execution requires explicit independence and known disjoint write scopes; dependencies or uncertain scopes require sequencing; invalid dependency graphs block scheduling. Specialist assignments do not require recursive delegation.
- At parent-task completion ask whether to remove its worktree. No answer authorizes nothing; preserve changes, branches and remotes. Removal is never automatic and cannot discard uncommitted/unmerged work.
- Alfred product precedence remains bounded by platform system/security controls. Missing specialist capability leads to a proposal/blocker, never direct task execution.

Developer API: extend `orchestrateTask` with optional `requestFacts`, `taskContext` and `workItems`. Quick facts require `question_count === 1`, `answer_known === true`, and exact false for `requires_analysis`, `requires_code`, `requires_actions`, `requires_external_state`, `requires_tools`. Missing/unknown facts are conservative. Any nonempty or malformed `workItems` disqualifies claimed quick facts; the quick exception requires no declared work items. Validate work items before accepting a quick bypass. Task context carries `task_id`, optional `continuation_of`, expected `repository_root`, `worktree_path`, `branch`, and observed `worktree: {task_id, verified, repository_root, path, branch}`. `reuse_verified` requires same-task ownership, `verified === true`, and exact agreement between expected and observed repository, path and branch. Same-task missing or mismatched evidence returns `reuse_requires_verification`; unknown or unrelated task ownership returns `create_required`. Bare `verified: true` is insufficient. These are core decisions based on adapter evidence; actual native lifecycle execution remains pending. Work items carry `id`, `depends_on`, `write_scopes`, `independent`; parallelism must account for path overlap and dependency relationships. Unknown scope means sequential, not an empty implicit scope. The core returns lifecycle and scheduling decisions; adapters perform necessary Git/delegation mechanics and report actual outcomes.

Validation must cover removal of typo/one-file/rename/formatting direct shortcuts, exact quick facts, unknown conservative behavior, necessary versus unnecessary tools, independent read-only task isolation, same-task ownership reuse, disjoint parallel scheduling, sequential dependencies, invalid graphs and cleanup choice without automatic deletion. Do not convert illustrative user actions into built-in contracts.

Refinement completion (core decision-level verified; native lifecycle pending):

- [x] Source and routing policy implement R7 without small-task bypasses at the core decision level.
- [x] Adversarial QA and full tests/checks/evals pass for R7 without baseline changes.
- [ ] Host lifecycle integration verifies actual creation/reuse and asks cleanup at completion; planning metadata alone is not execution evidence.

## Completion conditions

- [x] Runtime init/run/status implemented with actual read-text-v1 execution.
- [x] First-slice behavioral acceptance verified, including no-fallback, consent and workspace isolation.
- [x] Focused tests, npm check and existing baseline comparison pass without baseline updates.
- [x] Full npm test gate green after rebase onto main, including installer PTY, all 19 release gates and release automation.
- [x] Runtime traces prove resolution, consent and actual execution outcomes.
- [x] Host coverage explicitly states managed CLI only; native bridges remain pending.
- [ ] Full issue #217 objective reviewed separately after staged host integration; this slice does not establish universal host authority.

## References

- `docs/architecture/010-runtime-authority.md`
- `.ai/development.md`
- `packages/core/src/index.js`
- `packages/core/src/project-identity.js`
- `packages/memory-server/scripts/alfred.mjs`
- `packages/codex-adapter/README.md`

## Verified documentation examples

Actual CLI help and the guide init/status/global run example were checked with temporary project/home fixtures. Interactive Once returned exact BOM-preserving content and persisted no grant; noninteractive missing consent rejected execution. The main session additionally verified a real PTY Always flow: project A persists its grant, project B is denied, and a new Alfred deny overrides the stored grant without reading a malformed external catalog.

Previous first-slice verification, before R7 (not evidence that the new refinement passes): branch implementation `60778d2` is based directly on main `2ebe950`. `npm test` exits 0, including the actual installer PTY, all 19 release gates and release automation. `npm run check` exits 0. The existing eval-runner baseline comparison passes with zero regressions and no baseline updates. These successful results supersede the initial-base validation; the earlier installer timeout is not a current failure.

Focused evidence includes QA 117/117, CLI 13/13 and runtime 43/43 (overlapping suites, not additive counts). Reviewer final assessment has no findings. The CLI executable mode remains 100755; main's package scripts are preserved with runtime registrations added. Native host bridges, generic skill invocation and the full #217 objective remain pending.

## Architecture trace

Decision `issue-217-runtime-authority-v1`: core owns authority; CLI is the first enforced boundary; canonical workspace and content bind consent; host-native interception is staged. This inline trace records the documentation decision without writing unrelated observability files.

Architecture decision trace `issue-217-policy-refinement-v1`: actor architect; source explicit user correction; task continuation #217; worktree verified at 09f008c on issue-217-alfred-runtime-authority, base main 2ebe950. Decision: replace small-task shortcuts, preserve the single no-analysis/no-action conversational exception, require isolation for all substantive tasks and user-chosen cleanup. Tool calls used for necessary policy edits, coordination and validation; no provider request initiated by tools. Quick-answer traces use the response/session channel without an additional logging call.

## R7 final verification

QA summary `/tmp/alfred-217-policy-summary.json`: npm test exits 0 with 660 cases (658 passed, 2 opt-in PostgreSQL tests skipped, 0 failed); all 19 release gates pass. npm check passes. Eval runner passes with 19 baselines, 17 results, 4 comparisons and 0 regressions. Independent policy tests pass 24/24. Baselines are unchanged. The temporary root dependency symlink was removed, the existing package dependency link preserved, and generated console output restored and verified. Logs: `/tmp/alfred-217-policy-test-complete.log`, `/tmp/alfred-217-policy-check-final.log`, `/tmp/alfred-217-policy-eval-final.log`.

This verifies core policy decisions, not installed native host worktree/delegation lifecycle automation. That integration and the full #217 goal remain pending. Main owns integration/commit/push and offers the cleanup choice for the current task; no worktree removal is automatic.
