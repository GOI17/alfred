---
id: goal-loop-ulw
description: Add project-scoped GOAL, LOOP, and ULW skills without changing runtime authority.
owner: developer
phase: human-accepted-merge-ready
---

# GOAL, LOOP, and ULW Skills

- Issue: https://github.com/GOI17/alfred/issues/200
- Branch: `issue-200-goal-loop-ulw-clean`
- Execution strategy: local-only; provider calls remain zero.

## Goal

Ship three canonical, lazily loaded project skills. GOAL constrains work to an
observable objective, LOOP repeats work within finite budgets, and ULW enables
intensive orchestration only when the current Codex session already provides
authoritative evidence of user-owned approval and sandbox bypass.

## Requirements

### R1 — Canonical project skills and lazy metadata

- Add canonical bodies at `.ai/skills/project/{goal,loop,ulw}/SKILL.md`.
- Add explicit registry records without changing existing records.
- Keep every skill project-scoped and `loadsBodyByDefault: false`.

### R2 — GOAL preserves authority and records proof

- Require an explicit objective, observable acceptance criteria, authorized
  scope, approval state, and stop conditions.
- Preserve existing approval gates and report criterion-level evidence.
- Stop as blocked rather than infer approval or expand scope.

### R3 — LOOP is finite and interruptible

- Require finite iteration, retry, and no-progress limits.
- Account for iterations and retries separately without resetting counters.
- Check cancellation and stop on completion, budget exhaustion, no progress,
  policy denial, or an unmet approval gate.
- Never change permissions, models, harness settings, or approval state.

### R4 — ULW requires a pre-existing user-owned Codex YOLO session

- Permit activation only by the effective primary Orchestrator. Specialists and
  subagents stop and return the request to their parent or primary Orchestrator;
  do not rely on registry metadata as native enforcement.
- Require authoritative current-session evidence that the runtime is Codex and
  that both approval bypass and sandbox bypass are already effective.
- Treat missing, stale, user-asserted-only, or conflicting evidence as blocked.
- Report non-Codex runtimes as unsupported.
- Never enable bypass, relaunch a harness, edit harness configuration, broaden
  permissions, or select a model.

### R5 — Preview delivery and honest limitations

- Opencode and Codex install previews copy canonical skill files into their
  existing preview artifact paths without writing live configuration.
- Preserve lazy loading and preview approval gates.
- Do not invent Pi body installation until its adapter has a supported skill
  body target; its existing preview remains metadata-only.
- Document session-only execution, no durable/background/resume semantics, and
  no guaranteed native slash-command parity.

### R6 — Deterministic evidence and independent gates

- Add focused adapter regressions for canonical body delivery, lazy metadata,
  role isolation, retained Orchestrator routing, safeguards, and permissions.
- Add one direct registry regression proving unique GOAL/LOOP/ULW records,
  project scope, lazy loading, expected body paths, exact preservation of both
  pre-existing entry contracts, and Orchestrator-only ULW metadata.
- Run local checks with zero provider calls.
- Distinguish independently executed QA checks from complete adapter suites
  reported as Developer evidence.
- Do not update human-owned baselines.

## Completion Conditions

- [x] Canonical skill bodies and lazy registry entries exist.
- [x] Opencode specialist generation excludes Orchestrator-only routing while
      Orchestrator output retains it.
- [x] Opencode and Codex previews contain canonical skill bodies.
- [x] Both previews preserve ULW's blocking primary-Orchestrator role gate, and
      the direct registry regression covers role metadata and lazy invariants.
- [x] Limitations and unsupported runtime behavior are documented.
- [x] Focused deterministic checks pass: opencode 12/12, Codex 6/6, adapter
      syntax checks, registry integrity, and scoped diff whitespace validation.
- [x] QA technical validation PASS: ULW role gate, static role isolation,
      GOAL/LOOP/ULW contracts, 22/22 registry mutations detected, checks, and
      diff-check. Complete adapter suites remain Developer evidence because QA
      avoided imports through protected paths.
- [x] Reviewer policy technical PASS with no blocking findings; both low
      recommendations are resolved by the ULW role gate and exact regression
      coverage for pre-existing registry entries.
- [x] Resolve the runtime-evidence gate through explicit human acceptance of the
      bounded fresh-Developer evidence. This is not active-config or hot-reload
      verification: active configuration was not inspected, and restart/hot-reload
      behavior remains independently unverified.
- [x] Resolve the global HOLD through explicit human acceptance of the historical
      risk from disappeared concurrent `console-web`/`site` changes for which no
      preservation snapshot exists. The clean branch from `main` resolves the
      contaminated-base/issue #191 blocker.
- [x] Record the user's explicit “haz el PR Y MERGE” delivery decision and
      acceptance of one `single-pr` size exception even if the diff exceeds 400
      changed lines. The change is merge-ready, but is not yet merged or closed.

## Human Delivery Decision

The user's explicit request to create the PR and merge it resolves the remaining
human-decision gates. The accepted evidence remains bounded: it does not prove
the content or activation state of live harness configuration, and no active
configuration or hot-reload behavior was inspected. The user also accepts the
historical disappeared-change uncertainty and chooses one PR despite the
400-line review-budget threshold. Therefore `merge-ready=true` under a
`single-pr` size exception; `merged=false` and `closed=false` remain in force
until those events actually occur.

## References

- `.ai/execution/agent-role-routing-fix.md`
- `.ai/skills/registry.json`
- `packages/opencode-adapter/src/runtime.js`
- `packages/codex-adapter/src/runtime.js`

<!-- Trace: task_classified=issue-200-execution-record-update; role=developer-specialist; delegation=none-specialist-direct-update; permission_allowed=two-explicit-execution-files-only; provider_request_avoided=local-deterministic-work; skills_loaded=architecture-docs,sdd-apply; ulw-primary-role-gate=preserved-in-opencode-and-codex-previews; developer-opencode-tests=12-pass; developer-codex-tests=6-pass; independent-qa-technical=pass-22-of-22-registry-mutations; reviewer-policy-technical=pass-no-blockers-low-recommendations-resolved; clean-branch-base=main; contaminated-base-blocker=resolved; disappeared-concurrent-change-risk=human-accepted; bounded-runtime-evidence=human-accepted-not-active-config-verification; active-config-inspected=false; restart-hot-reload-independently-verified=false; delivery=single-pr-size-exception-human-accepted; user-request=pr-and-merge; global-gate=resolved-by-human-acceptance; merge-ready=true; merged=false; closed=false. -->
