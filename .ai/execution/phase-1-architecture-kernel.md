# Phase 1: Architecture Kernel

Goal: create foundations for all pillars without fully implementing every pillar.

Required outputs:

- DDD glossary.
- Domain model.
- Package boundaries.
- Permission policy schema.
- Trace event schema.
- Eval case/result schemas.
- Initial agent specs.
- Pi adapter design.
- Local-first provider policy.
- Starter eval suites.
- Sample traces.

Completion condition: another model can implement Phase 2 without reading prior conversation.

## Completion Checklist

- [x] DDD glossary: `.ai/domain/glossary.md` and `docs/architecture/001-ddd-glossary.md`.
- [x] Domain model: `.ai/domain/model.md`.
- [x] Package boundaries: `docs/architecture/003-monorepo-boundaries.md` and package manifests.
- [x] Permission policy schema: `.ai/policies/permissions.schema.json`.
- [x] Provider request policy schema and example: `.ai/policies/provider-request-policy.schema.json` and `.ai/policies/provider-request-policy.example.json`.
- [x] Trace event schema: `.ai/observability/schemas/trace-event.schema.json`.
- [x] Eval case/result schemas: `.ai/evals/schemas`.
- [x] Initial agent specs: `.ai/agents/*.md` plus `.ai/agents/registry.json`.
- [x] Pi adapter design: `.ai/harnesses/pi/adapter-design.md` and `.ai/harnesses/pi/extension-design.md`.
- [x] Local-first provider policy: `.ai/policies/provider-request-policy.md` and `.ai/execution/local-capabilities.json`.
- [x] Starter eval suites: `.ai/evals/suites` and `.ai/evals/datasets`.
- [x] Sample traces: `.ai/observability/examples`.
- [x] Phase 2 handoff: `.ai/execution/phase-2-handoff.md`.

## Validation

Phase 1 is validated locally by `scripts/validate-phase-1.mjs`. It performs deterministic checks only and makes zero provider calls.
