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

## Project Files

This project follows a structured approach with source-of-truth files in the `.ai/` directory.

### Core Documentation

| File | Description |
|------|-------------|
| `.ai/context.md` | Project overview, architecture, key decisions, and completed milestones |
| `.ai/development.md` | Development guidelines, SDD process, branch naming, PR requirements |
| `.ai/domain/model.md` | Domain entities, value objects, use cases, and ports (DDD) |
| `.ai/domain/glossary.md` | Terminology definitions |

### Agents

| File | Description |
|------|-------------|
| `.ai/agents/orchestrator.md` | Primary coordinator agent |
| `.ai/agents/developer.md` | Coding tasks agent |
| `.ai/agents/qa.md` | Testing and regression agent |
| `.ai/agents/librarian.md` | Documentation and skill loading agent |
| `.ai/agents/architect.md` | Architecture decisions agent |
| `.ai/agents/reviewer.md` | Code review and policy enforcement agent |

### Harnesses

| File | Description |
|------|-------------|
| `.ai/harnesses/pi/adapter-design.md` | Pi harness adapter design |
| `.ai/harnesses/opencode/adapter-design.md` | opencode adapter design |
| `.ai/harnesses/vscode/adapter-design.md` | VSCode compatibility contract |
| `.ai/harnesses/claude/adapter-design.md` | Claude compatibility contract |
| `.ai/harnesses/codex/adapter-design.md` | Codex compatibility contract |
| `.ai/harnesses/kiro/adapter-design.md` | Kiro compatibility contract |
| `.ai/harnesses/compatibility-matrix.json` | Capability preservation matrix |

### Policies

| File | Description |
|------|-------------|
| `.ai/policies/security.md` | Security policy (deny-by-default) |
| `.ai/policies/delegation.md` | Delegation and routing policy |
| `.ai/policies/provider-request-policy.md` | Local-first provider policy |
| `.ai/policies/model-assignment.md` | User-owned model assignment |

### Instructions

| File | Description |
|------|-------------|
| `.ai/instructions/install-management.md` | Install/update/uninstall instructions |

### Evals

| File | Description |
|------|-------------|
| `.ai/evals/baselines/` | Evaluation baselines |
| `.ai/evals/regression-gates.json` | Regression gate policy |

### Source Code

| File | Description |
|------|-------------|
| `packages/core/src/index.js` | Core domain logic (harness-agnostic) |
| `packages/pi-adapter/src/runtime.js` | Pi adapter runtime |
| `packages/pi-adapter/src/cli.js` | Pi adapter CLI |
| `packages/opencode-adapter/src/runtime.js` | opencode adapter runtime |

### Scripts

| File | Description |
|------|-------------|
| `scripts/shell/install.sh` | Installation script |
| `scripts/shell/update.sh` | Update script |
| `scripts/shell/uninstall.sh` | Uninstall script |
| `scripts/validate-phase-13.mjs` | Phase 13 validator |

### Releases

| File | Description |
|------|-------------|
| `.ai/releases/release-0.1.0.md` | Release 0.1.0 |
| `.ai/releases/release-0.2.0.md` | Release 0.2.0 (MVP) |
