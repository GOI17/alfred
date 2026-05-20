# Eval Runner Package

The `eval-runner-package` milestone moves deterministic eval reading and current-result computation into `packages/evals`.

## Contract

- `packages/evals` discovers baselines from `.ai/evals/baselines`.
- `packages/evals` computes current results from generated traces and model-readable artifacts.
- `packages/evals` runs the existing core regression gate without provider calls.
- Existing phase validators remain the executable regression guard.
- Baseline updates still require human approval.

## Runtime APIs

- `listEvalBaselines(root)`
- `loadEvalBaselines(root)`
- `computeCurrentEvalResults(root)`
- `runEvalRunner({ root })`

## Completion Conditions

- `packages/evals` no longer has placeholder check/test scripts.
- `scripts/validate-eval-runner.mjs` passes.
- `pnpm check` passes.
- `pnpm test` passes.
