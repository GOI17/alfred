---
id: execution/native-git-worktrees
description: Require native Git task worktrees before repository writes
owner: orchestrator
phase: validated
---

# Native Git worktrees before repository writes

Issue: https://github.com/GOI17/alfred/issues/207

## Goal

Alfred Orchestrator MUST establish an isolated branch and native Git worktree
before the first repository-file write of a task, including delegated writes.

## Requirements

- R1: Classify read-only versus repository-writing work before writes. Code,
  documentation, configuration, specs, generated artifacts and file deletions
  all require isolation; read-only tasks do not.
- R2: Create the branch and worktree with native `git worktree add -b <branch>
  <path> <base>`. All lifecycle operations use native Git, never clones,
  directory copies, harness APIs or Orca worktree creation. Orca may display
  the session without managing worktree creation.
- R3: Reuse a verified dedicated worktree for the same task across edits and
  delegated agents; independent writing tasks each need their own worktree.
  A branch alone or an unrelated existing worktree is insufficient.
- R4: Honor the user-requested base, otherwise resolve the repository default
  base through Git; do not assume the current branch or a hardcoded main/master.
  Preserve dirty checkouts and never reset, clean, stash or switch them as a
  workaround. Report unresolved bases, collisions or Git failures before writes.
- R5: Verify repository identity, worktree path and branch through Git before
  proceeding. Pass verified cwd, branch and task identity to specialists.
  Failure blocks repository writes, including specs and trace files in the
  original checkout; use a non-repository trace channel until isolation exists.
- R6: Emit classification, permission, creation/reuse/verification/failure and
  delegation traces with task, path, branch, base and reason. Isolation does
  not grant protected-path permissions, dependency installation or unsafe cleanup.
- R7: Deliver the canonical policy in every executable primary instruction
  surface (Codex, opencode, Pi), preserve specialist role separation and regenerate
  affected tracked previews. Contract-only harnesses inherit canonical policy.
- R8: Add deterministic regression coverage for policy delivery, task reuse,
  failure/dirty-checkout safeguards and generated-source consistency. Run
  applicable adapter tests, policy/generation checks and eval comparisons without
  updating approved baselines or making LLM provider calls for deterministic work.

## Implementation boundary

Keep the policy canonical in `.ai/agents/orchestrator.md`; adapters should carry
that source rather than duplicate its detailed wording. Update repository entry
and development instructions where needed to prevent writing a spec before
isolation. This is an instruction and generation change, not a new runtime Git
service. Do not edit core or live harness configuration.

Opencode now prefers the task worktree's local `.ai/manifest.json` for both
build and write previews. Explicit `projectRoot` remains authoritative; the
existing shared-source fallback remains available only when local source is
absent. The regression fixture uses divergent instructions in a dirty primary
checkout and a linked worktree to verify source selection and preservation.

## Validation

- [x] Canonical, entry-point and development rules agree.
- [x] Codex, opencode and both Pi primary outputs carry the full canonical body.
- [x] Affected tracked primary previews match generators; obsolete Codex
  Orchestrator custom-agent preview removed.
- [x] New policy/generation contracts: 7/7 PASS.
- [x] Opencode adapter: 12/12 PASS, including dirty-checkout/worktree regression.
- [x] Codex adapter: 6/6 PASS; Pi runtime import PASS.
- [x] Full `pnpm check` PASS; `git diff --check` PASS.
- [x] Policy validator: 12 checks PASS; suite-installer validator PASS.
- [x] Phase-9 generation and adapter-hardening validators PASS.
- [x] Eval runner PASS: 19 baselines, 17 current targets, four regression
  comparisons, zero regressions and zero provider calls. Baselines unchanged.

Commands: `node --test scripts/native-git-worktrees.test.mjs`, package-level
`pnpm --dir packages/{codex,opencode,pi}-adapter test`, `pnpm check`,
`node scripts/validate-policies.mjs`, `node scripts/validate-suite-installer.mjs`,
`node scripts/validate-history.mjs phase9`,
`node scripts/validate-adapter-hardening.mjs`, and
`node scripts/validate-eval-runner.mjs`.

Full `pnpm test` was attempted and stopped in unchanged Memory Server tests:
`@modelcontextprotocol/sdk` is unavailable in this worktree. That package reported
239 passes, one module-load failure and two skips. No dependencies were installed.
The historical phase-13 validator also fails against unchanged installer scripts
because it expects removed path/trace patterns. Neither limitation is a passing
full-suite result. The existing release gate pins opencode to nine tests although
the base already contains twelve; this task does not alter approved baselines.

Validation environment: Node v26.8.1, macOS; task branch based on
`origin/main@84a5e0a`. These tests establish instruction delivery and deterministic
adapter behavior, not runtime enforcement of every future agent action.

## Execution trace

- task_received/task_classified: issue-207; actor=orchestrator;
  repository-writing; deterministic tool strategy=local-only.
- worktree_reused/worktree_verified: user-created native worktree
  `alfred-worktrees/issue-207-native-git-worktrees`, branch
  `issue-207-native-git-worktrees`, base `origin/main@84a5e0a`; verified cwd,
  repository identity, branch, worktree registration and initial clean status.
  Developer and Reviewer reused this worktree; primary checkout unmodified.
- skill_loaded: orca-cli discovery guidance; user explicitly requires native
  Git, so no Orca state operation was needed.
- permission_allowed: user authorized issue implementation and PR delivery,
  then explicitly approved read-only core/harness contracts and affected tracked
  Codex/opencode previews, including obsolete Codex primary preview removal.
  Protected content was not read before approval. No core modification, live
  harness configuration update or dependency installation occurred.
- delegation_decision: target=developer; reason=Orchestrator STOP-and-delegate
  rule and user-directed specialist implementation; skills_considered=[];
  skills_loaded=[]; permissions_requested=scoped source/tests/previews.
- regression_found/resolved: canonical-delivery test exposed opencode reading
  stale instructions from the main checkout; local-source preference fixed it.
- delegation_decision: target=reviewer; reason=reduce cross-adapter policy and
  role-isolation regression risk; permissions_requested=read-only review.
- review_completed: source and primary previews approved; unresolved_findings=0.
- validation_completed: applicable tests/evals PASS; full-suite dependency and
  pre-existing historical-validator limitations recorded above.

Delivery: open a PR with `Closes #207`; do not merge.
