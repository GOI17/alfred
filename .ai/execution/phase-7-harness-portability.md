# Phase 7: Harness Portability

Goal: prove Alfred is harness-agnostic.

Tasks:

- Implement opencode adapter.
- Add Claude adapter or compatibility notes.
- Add Codex adapter or compatibility notes.
- Add VSCode adapter or compatibility notes.
- Add Kiro adapter or compatibility notes.
- Maintain compatibility matrix.

## Runtime Artifacts

- Compatibility matrix: `.ai/harnesses/compatibility-matrix.json`.
- Executable Pi adapter remains in `packages/pi-adapter`.
- Executable opencode translation spike lives in `packages/opencode-adapter`.
- Claude, Codex, VSCode, and Kiro are covered by compatibility contracts until executable adapters are promoted.
- Generated trace: `.ai/observability/generated/phase-7-harness-portability.json`.
- Baseline: `.ai/evals/baselines/phase-7-harness-portability.json`.
- Validator: `scripts/validate-phase-7.mjs`.

## Completion Conditions

- All six target harnesses preserve required Alfred capabilities through native, adapter, generated, or external-script strategies.
- opencode translation produces deterministic agent, skill, and permission artifact previews without writing harness config into core.
- Core remains dependency-free and does not import adapter packages.
- Provider calls remain zero.
- `pnpm check` and `pnpm test` pass.
