---
id: execution/automatic-release-chain
description: Prepare reviewable releases from main and publish the GitHub Release and private Homebrew tap as one automated chain.
phase: issue-160-complete-release-automation
author: core
issue: 160
---

# Automatic release chain

## Goal

Complete the release path after a feature or fix reaches `main`: prepare a
reviewable version PR, publish the stable GitHub Release when that PR is merged,
and update the private Homebrew tap from the exact immutable tag.

## Requirements

### R1: Release preparation

1. Run Release Please on pushes to `main` and by manual dispatch.
2. Use Conventional Commits to determine whether a release is eligible and its
   semantic version increment.
3. Keep pre-1.0 features on patch increments so the next eligible release after
   `0.7.0` is `0.7.1`.
4. Create or update a release PR. Never publish every feature merge directly.
5. Keep the release PR human-reviewable before its merge creates a tag.

### R2: Version coherence

1. The release PR must update the root package version, suite installer,
   canonical Memory OpenAPI contract, GPT metadata, and changelog.
2. Homebrew validation must derive the current version from `package.json`
   instead of embedding a historical release number.
3. Current contract tests must derive the expected version from the root
   manifest. Historical release evidence remains immutable and separately
   callable.
4. A deterministic validator must reject version drift or missing updater
   declarations.

### R3: Publishing

1. Merging the release PR creates the stable `vX.Y.Z` tag and GitHub Release.
2. Automatic release creation must directly invoke the existing tap publisher
   as a reusable workflow.
3. Preserve manual dispatch by stable tag and manually published release
   compatibility.
4. The tap must remain pinned to the exact release tag and commit revision.
5. The tap publisher must remain idempotent.

### R4: Security and governance

1. Use the repository-scoped `GITHUB_TOKEN` only for the source repository.
2. Keep `HOMEBREW_TAP_DEPLOY_KEY` as the only credential allowed to write to
   `GOI17/homebrew-tap`; do not introduce a PAT.
3. Give each workflow only the permissions it needs.
4. Exempt only Release Please PRs authored by `github-actions[bot]` on the exact
   generated branch prefix from the human linked-issue convention.
5. Require conventional titles for ordinary PRs so squash merges remain
   machine-readable for future release calculation.
6. All validation and release preparation remain deterministic with
   `provider_calls: 0`.
7. Enable the repository setting that permits `GITHUB_TOKEN` to create release
   PRs only after explicit human approval. The workflow must never approve or
   merge its own PR.

## Completion conditions

- [x] Pushes to `main` are configured to prepare or update a release PR.
- [x] Merging that PR is configured to create the GitHub Release.
- [x] The same release run invokes the private tap publisher directly.
- [x] Manual release and dispatch paths remain supported.
- [x] Active version surfaces are release-managed and validated.
- [x] No PAT or new cross-repository credential is required.
- [x] Required tests and validators pass with provider calls at zero.
- [ ] Repository authorization for Actions-created PRs is explicitly approved
      and enabled.

## References

- Issue: https://github.com/GOI17/alfred/issues/160
- Release workflow: `.github/workflows/release-please.yml`
- Tap publisher: `.github/workflows/release-homebrew-tap.yml`
- Release configuration: `release-please-config.json`
- Version manifest: `.release-please-manifest.json`
- Packaging guide: `packaging/homebrew/README.md`
