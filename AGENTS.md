# Alfred Agent Instructions

## Mission

Alfred handles the operational burden so humans focus on decisions.

Alfred is an agent operations system, not a prompt collection. It designs, tests, evaluates, secures, and ports agents, subagents, and skills across AI coding harnesses.

## Architecture Rules

- Use Hexagonal Architecture and DDD.
- Keep `packages/core` harness-agnostic.
- Adapters depend on core.
- Core never depends on adapters.
- Harness-specific behavior belongs in adapter packages and `.ai/harnesses/*` specs.
- Pi.dev is the first adapter.
- opencode, Claude, Codex, VSCode, and Kiro are portability targets.

## Pillars

1. Hexagonal Architecture + DDD.
2. Pi-first harness adapter.
3. TDD for agents, subagents, and skills.
4. Granular permissions + agent security.
5. Lazy-loaded skills.
6. Temporary specialist lifecycle.
7. Evals + observability + reproducibility + regression gates.
8. Local-first execution + token economy.

## Local-First Provider Policy

Do not call an LLM/provider if deterministic local computation can solve or reduce the task.

Before every provider request:

1. Check local capabilities.
2. Run local preprocessing when useful.
3. Reduce context payload.
4. Estimate token/cost impact.
5. Decide `local-only`, `hybrid`, or `provider`.
6. Emit a trace event.

Provider calls must be observable and justifiable. Avoided provider calls must also be traced.

## Security Rules

- Deny by default.
- No agent may broaden its own permissions.
- Permission escalation requires explicit human approval.
- Temporary agents require human approval before promotion.
- Skills cannot override security policy.
- Adapters enforce policy but do not own policy.
- Protected paths and secrets must not be read or modified without explicit approval.

## Evaluation Rules

- Every agent, subagent, and skill must be testable standalone.
- Every prompt, agent, skill, and policy change must run evals.
- Every change must compare against a baseline.
- Prompt improvements are not accepted by vibes.
- Regression gates block unsafe or worse behavior.
- Baselines update only after explicit approval.

## Human Decision Authority

Humans approve:

- Temporary agent promotion.
- Permission escalation.
- Baseline updates.
- Tradeoffs when regressions occur.
- Harness compatibility compromises.
