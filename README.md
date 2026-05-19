# Alfred

Alfred handles the operational burden so humans focus on decisions.

Alfred is a model-readable, harness-agnostic agent operations system for creating, testing, evaluating, securing, and porting agents, subagents, and skills.

## Architecture

- DDD + Hexagonal Architecture.
- Pi.dev first adapter.
- Lightweight multipackage monorepo.
- Core remains harness-agnostic.
- Adapters translate core concepts into harness-specific runtime behavior.

## Packages

- `packages/core`: domain, application use cases, ports, policies, trace/eval models.
- `packages/pi-adapter`: Pi.dev adapter/runtime integration.
- `packages/evals`: eval runner, baselines, reports, replay support.
- `packages/cli`: local commands, validators, and project operations.

## Model Entry Points

- Start with `AGENTS.md`.
- Read `docs/architecture/000-project-charter.md`.
- Execute phases from `.ai/execution/` in order.
