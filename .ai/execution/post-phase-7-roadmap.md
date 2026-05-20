# Post-Phase-7 Roadmap

The seven architecture phases are complete. The next step is not another vague phase; it is release readiness.

## Current Candidate

`architecture-kernel-0.1.0` is the first local-first, harness-agnostic release candidate.

## Completed Phases

- Phase 1: architecture kernel.
- Phase 2: Pi runtime spike.
- Phase 3: agent/subagent system.
- Phase 4: security and permissions enforcement.
- Phase 5: evals and regression gates.
- Phase 6: skill packs and lazy loading.
- Phase 7: harness portability.

## Release Readiness

- All phase validators must pass.
- Roadmap validation must pass.
- Provider calls must remain `0` for deterministic readiness checks.
- Baseline updates require human approval.
- Work continues through issue -> branch -> PR -> merge.

## Next Milestones

- `release-0.1.0`: package the completed architecture kernel as a reproducible release candidate.
- `adapter-hardening`: harden executable adapter previews without leaking harness concepts into core.
- `eval-runner-package`: move deterministic validation into package-level eval runner APIs.
