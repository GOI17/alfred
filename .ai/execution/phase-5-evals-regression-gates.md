# Phase 5: Evals + Regression Gates

Goal: measure prompt, agent, skill, and policy changes.

Tasks:

- Implement eval runner.
- Implement baseline comparison.
- Implement regression report.
- Implement prompt/agent/skill version locks.
- Require human approval before baseline updates.

## Runtime Artifacts

- Eval gate policy: `.ai/evals/regression-gates.json`.
- Version locks: `.ai/versions/locks.json`.
- Runtime entrypoint: `packages/pi-adapter/src/runtime.js#runPiEvalGateSpike`.
- Validation script: `scripts/validate-phase-5.mjs`.
- Generated trace: `.ai/observability/generated/phase-5-regression-gate.json`.
- Baseline: `.ai/evals/baselines/phase-5-evals-regression-gates.json`.

## Completion Conditions

- Compare Phase 1 through Phase 4 current deterministic results against baselines.
- Emit `regression_gate_evaluated` with zero provider calls.
- Report zero regressions for the current baseline.
- Block baseline updates unless a human explicitly approves them.
- Keep `packages/core` dependency-free and harness-agnostic.
