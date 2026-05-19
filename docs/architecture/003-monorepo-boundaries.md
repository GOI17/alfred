# Monorepo Boundaries

Alfred uses a lightweight multipackage monorepo to preserve boundaries without premature distribution complexity.

## Packages

- `core`: harness-agnostic domain/application/ports.
- `pi-adapter`: Pi.dev integration, depends on core.
- `evals`: eval runner, baselines, reports, replay, depends on core.
- `cli`: local commands and project operations, depends on core and selected adapters.

## Split Rule

Do not create more packages until pressure exists. Security, permissions, traceability, local-first execution, and skill routing stay in core initially.
