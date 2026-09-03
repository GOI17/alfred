---
id: execution/release-0.7.0
description: Publish the OAuth, recovery, Neon, setup, and Homebrew improvements as Alfred 0.7.0.
phase: issue-153-release-0.7.0
author: core
issue: 153
---

# Alfred 0.7.0 release

## Goal

Publish the completed changes since `v0.6.0` as an immutable `v0.7.0`
release and update the private Homebrew tap automatically.

## Included scope

1. Direct OAuth for ChatGPT Actions and the deployed callback contract.
2. Neon pooled-connection compatibility for tenant schemas.
3. API-key recovery readiness, a secure one-time result page, and a validated
   post-recovery OAuth continuation.
4. Guided setup correctness fixes.
5. Automatic private Homebrew tap publication.

The draft `alfredlabs.org` Resend migration is excluded until its external
domain, DNS, credential, delivery, and rollback checks are approved and pass.

## Requirements

1. The root distribution, installer, OpenAPI contract, GPT metadata, Homebrew
   validation, and release metadata must agree on version `0.7.0`.
2. The release must be built from the exact validated `main` commit.
3. Checks, tests, release validation, Homebrew validation, formula style,
   audit, upgrade, and formula tests must pass.
4. Publishing the stable GitHub Release must automatically update the private
   tap with the same tag and exact revision.
5. Provider calls must remain `0`.

## Completion conditions

- [x] Issue #148 is merged into the release source.
- [x] Version-bearing distribution contracts agree on `0.7.0`.
- [x] Repository and release validators pass.
- [x] GitHub Release `v0.7.0` is published.
- [x] The tap formula points to the exact `v0.7.0` commit.
- [x] Homebrew upgrade and formula tests pass.
- [x] Provider calls remain `0`.

## Traceability

- Issue: `#153`
- Branch: `issue-153-release-0.7.0`
- Previous release: `v0.6.0`
- Release metadata: `.ai/releases/release-0.7.0.json`
- Trace: `.ai/observability/generated/release-0.7.0.json`
