# Phase 10: Eval Runner CLI

Phase 10 exposes `packages/evals` through a deterministic local CLI.

## Runtime

- CLI: `packages/evals/src/cli.js`
- Binary name: `alfred-evals`
- JSON report: `.ai/reports/eval-runner/phase-10-report.json`
- Text report: `.ai/reports/eval-runner/phase-10-report.txt`

## Contract

- Reports are generated locally.
- Provider calls remain `0`.
- Regression gate semantics come from the existing eval runner APIs.
- Missing baselines and missing current results are reported explicitly.

## Validation

- `pnpm validate:phase10`
- `pnpm validate:eval-runner`
- `pnpm check`
- `pnpm test`
