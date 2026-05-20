# Phase 2 Handoff: Pi Runtime Spike

## Goal

Build the smallest Pi.dev adapter spike that proves Alfred can load the architecture kernel and execute one observable path.

## Inputs

- `.ai/manifest.json` is the Phase 1 entrypoint.
- `.ai/agents/registry.json` lists the initial agents and their specs.
- `.ai/skills/registry.json` defines lazy skill loading policy; it intentionally contains no concrete skills yet.
- `.ai/policies/permissions.example.json` defines deny-by-default permission intent.
- `.ai/policies/provider-request-policy.example.json` defines local-first provider gating.
- `.ai/policies/model-assignment.example.json` defines user-owned model assignment and fallback behavior.
- `.ai/observability/schemas/trace-event.schema.json` defines trace event shape.
- `.ai/evals/suites/local-first.yml` contains the first provider-gating eval cases.

## Phase 2 Scope

- Load `.ai/manifest.json` and fail fast if Phase 1 status is not `complete`.
- Load `orchestrator` from `.ai/agents/registry.json`.
- Load zero or one skill through the lazy skill registry contract.
- Run one local-first eval path without provider calls.
- Emit at least one `provider_request_avoided` trace event.
- Keep agent specs model-agnostic; model selection must come from user-owned configuration.
- Implement retry/fallback behavior as policy-driven runtime behavior, not as agent prompt text.
- Write adapter code under `packages/pi-adapter` only.
- Keep domain/application decisions in `packages/core`.

## Out Of Scope

- Full subagent runtime.
- Full permission enforcement.
- Baseline promotion.
- External skill pack imports.
- Non-Pi harness adapters.

## Done When

- `pnpm check` passes.
- `pnpm test` passes.
- One Phase 2 trace example is produced by code, not hand-written.
- The Pi adapter does not introduce dependencies from `packages/core` to adapter packages.
