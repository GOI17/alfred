---
id: agent-role-routing-fix
description: Isolate specialist roles without expanding permissions and correct the durable opencode generator.
owner: orchestrator
phase: human-accepted-merge-ready
---

# Agent Role Routing Fix

- Issue: https://github.com/GOI17/alfred/issues/200
- Branch: `issue-200-goal-loop-ulw-clean`
- Status: Bootstrap application and fresh-session role isolation were reported by Developer. QA technical validation is PASS for static role isolation and the issue #200 regressions; Reviewer policy technical review is PASS with no blocking findings. The user explicitly requested “haz el PR Y MERGE”, accepting the bounded fresh-Developer runtime evidence, the historical risk from disappeared concurrent worktree changes, and a single PR even if it exceeds 400 changed lines. The clean branch from `main` resolves the contaminated-base/issue #191 blocker. The acceptance gates are resolved and `merge-ready=true`; active configuration was not inspected, restart/hot-reload behavior is not independently verified, and the change is not yet merged or closed.

## Context and Verified Cause

Prior read-only inspection confirmed that all five installed specialist prompts contain two
Orchestrator STOP-and-delegate/routing blocks despite declaring `mode: subagent`.
These blocks are emitted by `buildAgentFileContent` in
`packages/opencode-adapter/src/runtime.js`.
Developer's canonical specification requires implementation, but the injected routing
instructs it to delegate implementation to itself without an available Task tool.
Librarian's read-only restriction is intentional and must remain unchanged.

## Requirements

### R1 — Restrict the bootstrap edit surface
Modify only `.opencode/agents/{developer,architect,qa,reviewer,librarian}.md`.
Remove both injected Orchestrator STOP-and-delegate/routing blocks from each file.
Do not modify Orchestrator, `AGENTS.md`, global configuration, `.codex/`, `.agents/`,
`packages/core/`, or application code during this bootstrap.

### R2 — Preserve canonical content and safeguards
Preserve each file's frontmatter byte-for-byte, including existing `edit: ask` and
`bash: ask` settings. Preserve quoted canonical specialist specifications exactly.
Preserve shared security, protected-path, model-assignment, and provider-policy content.
If removing an injected block would remove a shared safeguard, retain that safeguard
without its Orchestrator-specific routing. Do not enable YOLO or broaden permissions.

### R3 — Establish specialist-specific scope
Insert a role boundary outside the unchanged canonical quotation:
Developer implements authorized changes; Architect handles architecture/DDD decisions;
QA handles testing and verification; Reviewer handles review and policy enforcement;
Librarian searches, reads, summarizes, and indexes knowledge without writing files.
Each specialist returns out-of-scope work to its parent with the requested next role.
Do not require self-delegation, nested Task availability, or permission escalation.
Role ownership never overrides existing security restrictions or approval requirements.

### R4 — Activate only through restart
Installed prompt edits do not hot-reload or change running-session instructions.
Restart opencode and create a fresh Developer delegation before verification.
QA must verify role isolation after restart; do not claim success from file edits alone.

### R5 — Correct the durable generator after fresh-session verification
After restart, a fresh Developer may modify `buildAgentFileContent` and focused
regression coverage under issue #200. Keep both injected routing blocks for the
primary Orchestrator, but replace them for specialists with role-specific scope
and shared safeguards. Installed `.opencode` prompts are ignored local bootstrap
artifacts and must not be staged, force-added, or committed.

## Checklist

### Bootstrap
- [x] Apply only the five authorized specialist prompt edits. Developer reports exact before/after preservation of frontmatter and canonical quotations.
- [x] Remove both injected Orchestrator routing blocks per specialist and preserve shared safeguards. Independent QA static checks passed for R1–R3.
- [x] Confirm specialist role boundaries, retained Orchestrator routing, intentional Librarian readonly, and unchanged permission/model settings. Historical preservation relies on Developer's comparison; QA had no independent before snapshot.
- [x] Restart opencode and create a fresh Developer delegation. The new session reports effective `developer` specialist authority, no applicable auto-delegation instruction, and direct implementation tools.
- [x] Obtain independent QA technical verification of static specialist role isolation.
- [x] Resolve the runtime-evidence gate through explicit human acceptance of the bounded fresh-Developer evidence. This is acceptance, not verification: active configuration was not inspected and restart/hot-reload behavior remains independently unverified.

### Durable follow-up
- [x] Correct generator output through Developer after restart, without changing Orchestrator routing.
- [x] Add Developer-authored deterministic regression coverage for specialist isolation, canonical preservation, retained safeguards, and Librarian read-only behavior.
- [x] Obtain independent QA technical verification of the ULW gate, static role isolation, GOAL/LOOP/ULW contracts, registry mutation coverage, checks, and diff-check.
- [x] Obtain Reviewer policy technical review: PASS with no blocking findings; both low recommendations were resolved by adding the ULW primary-role gate and exact pre-existing registry-contract coverage.
- [x] Complete the applicable SDD technical validation and review gates before the explicitly requested PR-and-merge workflow.
- [x] Resolve the global HOLD by explicit human acceptance of the bounded runtime evidence and the historical disappeared-change risk. The user also accepts one `single-pr` delivery with a size exception above 400 changed lines. Treat the branch as merge-ready, but not as merged or closed until those events occur.

## Evidence and Next Step

Developer reports applying the five installed specialist prompt edits without application-code changes,
with exact before/after frontmatter and canonical-quotation comparisons and shared safeguards preserved.
Reported Developer prompt hash: `ec364cb5cfdd` → `41f4d2d83a60`.
Independent QA passed static checks for R1–R3 but had no independent before snapshot;
its findings do not independently establish the historical diff or runtime behavior.
Orchestrator retains routing; Librarian remains read-only. No permission expansion is reported.

The fresh runtime identifies this invocation as the `developer` specialist and
explicitly scopes Orchestrator STOP-and-delegate routing away from delegated
specialists. It provides direct file editing and command tools and no nested
Task/delegation tool requirement. The Developer therefore implemented the
authorized change directly without self-delegation.

The orchestration record identifies that fresh invocation as task/session
`ses_f862cf66fffeBLn0gAiDwb8EHK`. The observable result attributed to it is the
direct worktree diff for the generator, canonical skills, adapter tests, and SDD
evidence, together with its report that opencode tests passed 11/11 and Codex
tests passed 6/6. This establishes that the fresh Developer invocation produced
the implementation diff directly. It does not provide a complete runtime
transcript, prove the content or activation state of live harness configuration,
or constitute independent QA verification.

`buildAgentFileContent` now emits the existing routing table and routing rules
only for the primary Orchestrator. Each specialist receives its own role boundary,
the unchanged quoted canonical specification, conservative generated frontmatter,
and shared local-first, protected-path, approval, permission, trace, and
user-owned-model safeguards. Librarian remains explicitly read-only through its
canonical quotation and generated role boundary.

Current focused opencode check and tests pass (12/12), including role isolation,
canonical preservation, and the direct skill-registry regression added after
review. The original fresh invocation reported 11/11 before that additional
test. R4 fresh-Developer runtime evidence and R5 Developer implementation are
recorded. Those complete opencode and Codex adapter suites remain Developer
evidence because QA intentionally avoided suite imports that traverse protected
paths.

Independent QA technical validation is PASS. QA verified the blocking ULW
primary-Orchestrator gate, static specialist role isolation, GOAL/LOOP/ULW
contracts, exact registry preservation and constraints with 22/22 injected
mutations detected, applicable checks, and `git diff --check`. This does not
verify the content of active harness configuration, prove restart or hot reload,
or supersede the bounded fresh-Developer evidence above.

Reviewer policy technical review is PASS with no blocking findings. Its two low
recommendations are resolved: ULW now carries an explicit blocking primary-role
gate in the delivered body, and the persistent registry test compares both
pre-existing entries against their complete expected contracts.

The clean rebuild starts exactly from `main`, so the contaminated original base
and its issue #191-only commits are no longer blockers. Previously observed
concurrent `console-web`/`site` changes still disappeared without a preservation
snapshot, and that historical uncertainty cannot be reconstructed from current
evidence.

The user explicitly requested “haz el PR Y MERGE” and accepted that historical
risk together with the bounded fresh-Developer runtime evidence. This human
acceptance resolves the remaining gates without converting either limitation
into technical verification: active harness configuration was not inspected,
and restart/hot-reload behavior remains independently unverified. The user also
accepted a single PR even if the diff exceeds 400 changed lines, establishing a
`single-pr` size exception rather than a chained-PR requirement. The resulting
state is `merge-ready=true`; no merge or issue closure is recorded before it
actually occurs.

<!-- Trace: task_classified=authorized-execution-record-update; role=developer-specialist; delegation=none-specialist-direct-update; skills_loaded=architecture-docs,sdd-apply; permission_allowed=two-explicit-execution-files-only; provider_request_avoided=local-only; runtime-task-session=ses_f862cf66fffeBLn0gAiDwb8EHK; runtime-evidence=bounded-fresh-developer-evidence-human-accepted-not-live-config-verification; durable-generator-fix=implemented; developer-adapter-suites=opencode-12-pass,codex-6-pass; independent-qa-technical=pass-22-of-22-mutations; reviewer-policy-technical=pass-no-blockers-low-recommendations-resolved; clean-branch-base=main; contaminated-base-blocker=resolved; disappeared-concurrent-change-risk=human-accepted; active-config-inspected=false; restart-hot-reload-independently-verified=false; delivery=single-pr-size-exception-human-accepted; user-request=pr-and-merge; global-gate=resolved-by-human-acceptance; merge-ready=true; merged=false; closed=false. -->
