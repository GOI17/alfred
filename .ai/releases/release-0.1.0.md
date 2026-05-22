# Release 0.1.0

`release-0.1.0` packages the completed Alfred architecture kernel as a reproducible local release candidate.

## Scope

- Architecture kernel and DDD model.
- Pi-first runtime spike.
- Agent routing and temporary specialist proposal flow.
- Security and deny-by-default permission enforcement.
- Regression gates, baselines, observability, and reproducibility metadata.
- Project-scoped lazy skill loading.
- Harness portability contracts and executable adapter hardening.
- Package-level eval runner APIs.

## Reproducibility

- Validation is local-only.
- Provider calls allowed: `0`.
- The validated git commit source is recorded in `.ai/observability/generated/release-0.1.0.json` without pinning a squash-merge-sensitive hash.
- Static baselines do not pin a commit hash because squash merge changes the final commit id.

## Validation

Run `pnpm validate:release`, `pnpm check`, and `pnpm test`.
