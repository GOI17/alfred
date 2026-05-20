# Phase 3: Agent/Subagent System

Goal: implement Orchestrator and initial specialists.

## Scope

- Implement task classification.
- Implement no-delegation-for-small-tasks rule.
- Implement specialist selection.
- Implement temporary specialist proposal flow.
- Add evals for routing and temporary agent lifecycle.

## Runtime Artifacts

- Routing policy: `.ai/agents/routing-policy.json`.
- Core use cases: `packages/core/src/index.js`.
- Pi runtime path: `packages/pi-adapter/src/runtime.js#runPiAgentSystemSpike`.
- Deterministic validator: `scripts/validate-phase-3.mjs`.
- Generated trace: `.ai/observability/generated/phase-3-delegation-decision.json`.
- Baseline: `.ai/evals/baselines/phase-3-agent-system.json`.

## Completion Conditions

- Small/simple tasks classify as `small` and stay with the Orchestrator.
- Matching complex tasks delegate to the best active specialist.
- Missing-specialist tasks do not fake delegation; they emit a TemporaryAgent proposal that requires human approval.
- Routing decisions do not call providers.
- `pnpm validate:phase3`, `pnpm check`, and `pnpm test` pass.
