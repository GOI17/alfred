---
id: execution/homebrew-public-install
issue: 219
owner: developer
status: implementation-reviewed-publication-pending
---

# Public Homebrew installation

## Goal

Provide `brew install GOI17/alfred/alfred` using a public dedicated `homebrew-alfred` tap and versioned Alfred release assets. Follow the public Quicksilver pattern reported by the architect: selected deterministic tar.gz, SHA256SUMS and formula assets; retain automatic updates to the canonical tap with the existing repository-scoped deploy key; manual copy is recovery only. Source is already PUBLIC. Do not revive closed #204 / #206 or their private-source publication machinery.

## Evidence and inventory

Base: origin/main e9e4e3e0a8afce432a15a8e4d3f3ff8cb9bdbf67. Dedicated native worktree: issue-219-homebrew-public-install. Original dirty checkout is preserved.

- `scripts/generate-homebrew-formula.mjs` supports Git tag/revision and public tag archive SHA256, but not a complete release runtime.
- `packaging/homebrew/README.md`, root README and installation guidance still describe private collaborators and GOI17/tap.
- `.github/workflows/release-please.yml` creates release PRs and calls the cross-repository tap publisher. `release-homebrew-tap.yml` currently uses a tap deploy key and pushes a Git-source formula.
- `packages/memory-server/scripts/setup.mjs` reuses the Homebrew package root; project/harness activation must remain separate from installing the package.
- The current formula copies source and declares Node but does not materialize production npm dependencies needed by Memory/MCP (pg, nodemailer, MCP SDK, zod and workspace package links).
- Guided `install.sh` can download OpenTUI or stage core modules. Package validation must exercise actual entrypoints with an isolated HOME, not only `alfred version`.
- Closed PR #206 contains a reviewed allowlist archive builder, production dependency lock and runtime verifier. Selectively reuse these utilities, update current runtime/module coverage, and remove assumptions that Alfred source must remain private. Do not import its private-source publication policy or old executable artifact hashes.
- Main session confirms current tap is PRIVATE, formula is old Git-source v0.7.2 at 28f64f4c1afe97390ae29639c15d170087e1a92e, and latest Alfred release is v0.7.2. Those artifacts do not contain current main.
- Architect reference research: Wave and Quicksilver use dedicated public taps; Quicksilver publishes deterministic selected archive/checksums/formula assets and copies formula manually without cross-repository secrets.

## Requirements

### R1: Deterministic selected runtime

Build only explicit runtime files and approved production dependencies; exclude tests, workflow/config credentials, local state, execution traces and source history. Normalize ordering, ownership, timestamps and modes. Inventory paths/hashes and bind source revision plus build inputs. Include current managed runtime CLI/service and required workspace packages. Reject links/path traversal, missing inputs and unexpected dependency closure. Preserve third-party licenses. Same inputs produce identical bytes.

### R2: Public formula and assets

Generate `alfred-X.Y.Z-runtime.tar.gz`, runtime manifest, `SHA256SUMS` and `alfred.rb`. Formula points to GOI17/alfred release assets, uses the real archive SHA256, and declares Node. Keep the qualified install command to avoid collision with the unrelated Alfred macOS app. No placeholder checksum may be described as release-ready. Existing v0.7.2 assets must not be overwritten by newly built code; candidate outputs remain local until a new version/tag is chosen through the normal release flow.

### R3: Install once, configure projects explicitly

Homebrew installs shared commands/runtime only. Setup remains preview-first, with project-specific runtime state and grants outside the installed package. Packaged setup must not silently clone main or fetch an unrelated binary. Use the bundled Node TUI when packaging does not include OpenTUI. Test version/help, preview, real Memory/MCP dependencies and actual managed runtime read-text execution against temporary HOME/project fixtures.

### R4: Publication boundaries

Reuse Release Please, but prepare/upload assets to the Alfred release before automatically updating the canonical GOI17/homebrew-alfred formula using the existing deploy key. Preserve automatic updates; do not introduce new cross-repository credentials. Produce a reviewed tap README and formula, with manual copy as recovery only. No visibility changes, release creation/upload, tap commits or remote activation during preparation. Final approval must name version, exact assets/checksums and tap changes, followed by credential-free download and Homebrew installation validation.

### R5: Validation and permissions

Canonical skills: `.ai/skills/project/architecture-docs/SKILL.md` and `typescript-project/SKILL.md`; `.agents` copies are absent. User now authorizes READ ONLY of packages/core, .ai/harnesses and .agents exclusively in this worktree; no modifications there. No .codex/.opencode access, no live harness writes, no baselines changes. The user explicitly approved `npm ci --omit=dev --ignore-scripts` in isolated temporary staging using the reviewed runtime lock;109 production packages were installed there; no package-manager installs in the worktree. No provider calls.

## Implementation order

1. Adapt selected archive builder/lock and fixture tests; include new runtime and Memory package paths.
2. Add release-source formula generation, deterministic checksum outputs, and tap README proposal.
3. Extend the existing automatic publisher to upload same-repository assets before updating the canonical tap, preserving release-tag/version validation and idempotence.
4. Update public installation guidance and packaged setup behavior, retaining preview gates.
5. Run focused fixtures, approved actual runtime checks, then independent QA/review. Present final artifacts before any publication.

## Completion conditions

- [x] New issue/worktree, inventory and initial source/workflow tests (9/9).
- [x] Deterministic package and formula tests pass (36 Homebrew tests, including workflow/publisher regressions).
- [x] Actual packaged runtime and isolated project configuration checks pass (1911 files; loopback HTTP, SQLite, six MCP tools, setup previews and managed runtime).
- [x] Local exploratory assets and tap proposal reviewed with actual checksums; reviewer reports no open findings. Public release artifacts await a new committed version/tag.
- [ ] Publication explicitly approved and activated; anonymous Homebrew installation verified.

## References

- https://github.com/GOI17/alfred/issues/219
- Historical https://github.com/GOI17/alfred/pull/206 (closed, not a publication approval)
- `packaging/homebrew/README.md`
- `.ai/instructions/install-management.md`

## Validation evidence and limits

Final focused checks: `npm run check`, `npm run validate:eval-runner`,
`npm run homebrew:test` (36/36), `npm run validate:homebrew`, and
`npm run validate:release-automation` passed. Independent QA's earlier focused
fixture run passed21/21. SQLite/search regressions passed11/11; additional
same-tenant project filtering regression passed after reviewer feedback.

Real smoke exposed two minimal runtime fixes: create the SQLite parent directory
for a fresh HOME, and route keyword search before the generic memory ID route,
including projectId filtering. Reviewer verified both and the reviewed-lock,
exclusive temporary-file and packaged setup guidance regressions.

Local logs: `/tmp/alfred-219-final-smoke.log`,
`/tmp/alfred-219-final-{check,eval,homebrew,validator,release}.log` and
`/tmp/alfred-219-qa-fixtures.log`. Candidate locations are recorded locally in
`/tmp/alfred-219-runtime-paths.json`; they are not committed release assets.
Final exploratory archive SHA256:
`68eb0a8b6c37319c7655f685ec6e5c415cf6edb18d16834613f3ecc34d7d1e7d`.
It was built from reviewed working-tree sources with base revision metadata and
must not be published as v0.7.2. Future release automation builds the exact new tag.

No live Homebrew install, release upload, tap write or visibility change occurred.
Known preexisting generated-project policy-relative references are outside this
packaging task; shared runtime policies and inline instructions remain included.

Final broad run: all npm test suites and installer PTY checks passed; release
validator passed18/19 gates, with only SQLite parity count10 vs fixed9 failing.
The new fresh-HOME regression was moved unchanged into dedicated
`sqlite-fresh-home.test.js`, preserving the original parity suite byte-for-byte.
Targeted final verification: `npm run memory:test`91/91 (including fresh-HOME),
original parity9/9 and `npm run validate:eval-runner` PASS. No baseline/count edits.
The full suite was not repeated after this test-only relocation. Production
staging and temporary workspace/OpenTUI links resolved initial missing dependencies;
all temporary links were removed. No new dependency installation was needed.
