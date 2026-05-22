# Adapter Hardening

Adapter hardening turns executable adapter previews into readiness contracts.

## Contract

The source of truth is `.ai/harnesses/adapter-hardening.json`.

## Executable Adapters

- `pi`: validates the runtime paths for local-first orchestration, delegation, security, evals, skills, and roadmap readiness.
- `opencode`: validates generated artifact previews for agents, skills, permissions, and local-first policy mapping.

## Invariants

- Core remains harness-agnostic.
- Model assignment remains user-owned runtime configuration.
- Provider calls remain local-first and deterministic checks use `0` providers.
- Skill bodies remain lazy-loaded.
- Permissions deny by default.
- Writing harness config requires human approval.

## Completion

Run `pnpm validate:adapter-hardening`, `pnpm check`, and `pnpm test`.
