# Evals And Reproducibility

## Eval Types

- Contract evals.
- Routing evals.
- Skill activation evals.
- Safety evals.
- Quality evals.
- Regression evals.
- Harness evals.

## Reproducibility Metadata

Record agent version, prompt hash, skill version, policy hash, harness adapter version, model id, model parameters, fixture hash, tool outputs or mocks, environment metadata, timestamp, and seed if available.

## Promotion Gate

Prompt, agent, skill, or policy changes require eval comparison against baseline. Baselines update only after human approval.

## Phase 5 Executable Gate

- `.ai/evals/regression-gates.json` defines deterministic baseline comparison rules.
- `packages/pi-adapter/src/runtime.js#runPiEvalGateSpike` computes current local results for prior phases and compares them to baselines.
- `.ai/versions/locks.json` records version locks and forbids autonomous baseline updates.
- The gate emits `regression_gate_evaluated` with `provider_calls: 0`.
- Any regression blocks promotion until a human accepts the tradeoff and approves a baseline update.
