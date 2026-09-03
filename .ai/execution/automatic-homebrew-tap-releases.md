---
id: execution/automatic-homebrew-tap-releases
description: Publish immutable Alfred release pins to the private Homebrew tap automatically.
phase: issue-149-auto-tap-releases
author: core
issue: 149
---

# Automatic Homebrew tap releases

## Goal

Update `GOI17/homebrew-tap/Formula/alfred.rb` automatically after a stable
Alfred GitHub Release is published.

## Decisions

1. A Homebrew tap is released by updating its formula repository; it does not
   need a duplicate GitHub Release.
2. The source workflow uses `release.published` and ignores prereleases.
3. Cross-repository Git access uses a write deploy key scoped only to
   `GOI17/homebrew-tap`, not a personal access token.
4. The formula stays on private Git source and is pinned by both semantic tag
   and the exact release commit.
5. Publication pushes only `Formula/alfred.rb` after deterministic validation.

## Requirements

### R1: Release validation

1. Accept stable tags matching `vX.Y.Z` only.
2. Require the tag version to equal the root `package.json` version.
3. Resolve the checked-out tag to a 40-character commit revision.
4. A manual dispatch must accept an explicit tag and follow the same checks.

### R2: Formula publication

1. Run the existing generator tests and Homebrew contract validator.
2. Generate the formula with private Git source, tag, and exact revision.
3. Validate Ruby syntax and Homebrew style before pushing.
4. Reject any tap worktree change outside `Formula/alfred.rb`.
5. Re-running an already-current release must succeed without a commit.

### R3: Authentication boundary

1. Store the private deploy key as `HOMEBREW_TAP_DEPLOY_KEY` in Alfred Actions
   secrets.
2. Register only the public key in `GOI17/homebrew-tap` with write access.
3. Do not log, commit, or persist private key material outside GitHub Actions
   secret storage.
4. Keep the source repository `GITHUB_TOKEN` read-only.

### R4: Traceability

1. Add deterministic tests for trigger, validation, credential boundary,
   formula generation, and push scope.
2. Document setup, rotation, manual dispatch, and failure recovery.
3. Emit trace events with `provider_calls: 0`.

## Completion conditions

- [ ] Stable releases update the private tap automatically.
- [x] Prereleases and version mismatches fail closed.
- [x] The formula is validated before publication.
- [x] The deploy key is scoped to the tap and absent from output/history.
- [ ] An idempotent `v0.6.0` workflow dispatch passes.
- [x] Tests and checks pass.
- [x] Provider calls remain `0`.

## References

- Issue: `#149`
- Existing validation: `.github/workflows/homebrew.yml`
- Formula generator: `scripts/generate-homebrew-formula.mjs`
- Tap: `GOI17/homebrew-tap`
- GitHub deploy-key guidance: `https://docs.github.com/en/actions/concepts/security/compromised-runners#cross-repository-access`
- GitHub release events: `https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release`
- Homebrew tap maintenance: `https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap`
