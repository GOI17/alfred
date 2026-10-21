---
id: setup-harness-activation
description: Reviewed project harness activation through the guided setup bridge.
owner: developer
phase: issue-234
issue: 234
status: ready-for-review
---

# Reviewed setup harness activation

User direction: fix the 1.0.0 guided setup that prepared previews without offering live activation. Installed version and original-project inventory confirmed current 1.0.0 and missing project Alfred skill; no claim is made about other installation roots or session loading.

## Contract

1. Existing review/confirmation prepares suite resources and fresh adapter previews only.
2. A second review enumerates only newly generated, selected Codex/OpenCode files, exact project destination, operation and content digest. A separate explicit confirmation authorizes activation. Decline reports previews only.
3. One-use consent binds selection, project identity, generated file bytes and current target snapshots. Mutated source/target, missing/reused token, symlinks, unsafe paths, malformed markers and conflicting files reject before live writes. Setup targets the invoking directory (including a worktree), never its Git common checkout or shared Cellar runtime.
4. Preserve user AGENTS text through the existing managed-block merge, honoring active AGENTS.override.md. Preserve normal existing OpenCode JSON settings; reject JSONC ambiguity or artifact collisions instead of replacing user files. Do not print configuration values/secrets.
5. Enumerated writes use temporary files and rename. Prevalidate all; verify resulting hashes and required Alfred skill/agents/command per selected harness. A mid-write failure reports exact completed paths and does not claim success. Retry requires fresh review.
6. Report files verified on disk, not session activation. Start a new harness session. Pi remains preview-only with an explicit limitation. Memory-only/no-harness preparation does not claim harness activation.
7. Emit sanitized operation/approval/verification traces with provider_calls=0. No network, package install, real user configuration access, protected source reads or baseline updates are needed for implementation tests.

## Scope

Bridge protocol and Go UI, bounded activation helper, adapter manifest emission, focused fixture tests, packaging inclusion and affected setup documentation. Preserve existing installer generation, agent/skill contents and core boundaries. Legacy installer behavior is not expanded in this fix.

## Validation

Use isolated fixture homes/projects and adapter-shaped manifests for approval/denial, stale/replay, target/worktree binding, symlink/path traversal, existing configuration, partial failure, idempotence and verification. Test Go UI transitions, existing launcher/protocol safety and packaging allowlist. Reuse cached Go dependencies offline. Public adapter/CLI APIs may run as black-box regression tests in owned fixtures; do not inspect protected dependency source or actual user configuration. Compare existing deterministic setup tests; do not change eval baselines.

Validation completed locally:

- `npm run setup:test`: 36/36 PASS, including real installer/adapter generation and combined Codex CLI + Codex App + OpenCode activation in isolated project/home fixtures.
- `npm run homebrew:test`: 42/42 PASS (formula, release workflow, archive/allowlist and setup packaging contracts).
- `node --test packages/codex-adapter/test/chat-skill.test.mjs packages/opencode-adapter/test/chat-skill.test.mjs`: 3/3 PASS (included in the initial 49-test focused run).
- `node scripts/validate-suite-installer.mjs`: PASS, including real legacy PTY lifecycle tests.
- `npm run setup:check`, `node --check scripts/verify-runtime.mjs`, `node scripts/validate-homebrew.mjs`, `node scripts/validate-instructions-install-management.mjs`, and `git diff --check`: PASS. The existing install-management evaluation baseline was checked and not updated.
- Go tests were attempted offline from `packages/setup-tui` with `GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local go test ./...`; blocked by absent cached `golang.org/x/sync@v0.1.0`. No module download occurred. Go files are gofmt-clean. All new Go tests run through the existing CI `go test ./...` step.
- Full built-runtime smoke remains pending CI on macOS/Linux, where the existing isolated dependency staging is available. `verify-runtime.mjs` now exercises the packaged bridge, real adapter manifests, separate confirmation and required installed files, in addition to native PTY cancellation.

No package installation, live user harness changes, baseline changes, commits, publication or provider requests were performed. The only external lookup was the authorized GitHub issue metadata; setup and tests remained local. Only the dedicated #234 worktree was edited. Parent owns independent review, PR and CI gates; do not merge before Go and packaged-runtime verification pass.
