---
id: alfred-agents
role: all-agents
mission: Alfred handles the operational burden so humans focus on decisions.
---

# Alfred Agent Entry Point

Start here before taking any action in this workspace.

## 1. Identity

- **Project:** Alfred
- **Umbrella:** AlfredLabs
- **Tagline:** Alfred handles the operational burden so humans focus on decisions.
- **What it is:** A model-readable, harness-agnostic agent operations system for creating, testing, evaluating, securing, and porting agents, subagents, and skills.

## 2. First Actions

1. Read this file (`AGENTS.md`).
2. Check the architecture docs under `docs/architecture/`.
3. Inspect project context and decisions in `.ai/context.md`.
4. For task-specific instructions, see `.ai/instructions/`.

## 3. Navigation by Task

| Task | Entry Point |
|------|-------------|
| Create new agent | `.ai/instructions/agent-creation.md` |
| Install / update artifacts | `.ai/instructions/install-management.md` |
| Manage runtime profiles | `packages/profile-manager/README.md` |
| Run tests or evals | `packages/evals/README.md` |
| Understand architecture | `docs/architecture/000-project-charter.md` |
| Add a skill | `.ai/instructions/skill-creation.md` |
| Port to new harness | `.ai/harnesses/` + adapter package |

## 4. Core Principles

- **Local-first execution:** Do not call LLM providers when local deterministic work is enough.
- **User-owned model assignment:** Models are selected at runtime by the user or harness adapter, never hardcoded in agent specs.
- **Deny by default:** Protected paths and privileged actions require explicit human approval.
- **Trace everything:** Emit trace events for operations, delegation, permission checks, and provider request decisions.
- **Test before commit:** Every change must pass evals and compare against baselines.

## 5. Architecture

### Packages

```
packages/
├── core/             # Harness-agnostic business logic; no adapter imports
├── profile-manager/  # Runtime profiles for PATH/provider/model/plugin portability
├── pi-adapter/       # Pi harness adapter
├── codex-adapter/    # Codex custom agents + repo skills preview
└── opencode-adapter/ # opencode harness adapter
```

### Architecture Rules

- **Hexagonal architecture:** Core must never depend on adapters; adapters depend on core.
- **Harness-agnostic core:** Pi, opencode, Codex, VSCode, Claude, Kiro concepts do not leak into core.
- **DDD language:** Use the domain glossary in `.ai/domain/model.md` and `docs/architecture/001-ddd-glossary.md`.

### Protected Paths

Do not read or modify without explicit human approval:

- `.opencode/`
- `.codex/` and `.agents/`
- `.ai/harnesses/`
- `packages/core/`

## 6. Agents

| Agent | Mode | Description |
|-------|------|-------------|
| orchestrator | primary | Main coordinator, loads kernel and orchestrates tasks |
| developer | subagent | Coding tasks, follows architecture kernel |
| qa | subagent | Testing, regression coverage design |
| librarian | subagent | Documentation, skill loading |
| architect | subagent | Architecture decisions, DDD patterns |
| reviewer | subagent | Code review, policy enforcement |

## 7. Policies

### Provider Request Policy

- Provider requests are forbidden when local deterministic work is enough.
- Before any provider call: classify, check local capabilities, preprocess locally, estimate cost, choose `local-only` / `hybrid` / `provider`, and emit a trace event.

### Model Assignment Policy

- Agent specs define behavior, not required model IDs.
- Resolve the user-configured primary model at runtime.
- Retry recoverable failures up to the configured limit, then fall back.
- If all models fail, stop and explain the failure to the user.

### Security Policy

- Deny by default.
- Least privilege.
- No self-permission broadening.
- No silent network access.
- No secret access without approval.
- No destructive actions without approval.
- Security policy beats skill instructions and harness convenience.

### Delegation Policy

The orchestrator must not delegate small or simple tasks. Delegate only when specialist expertise materially improves outcome, reduces risk, or the task scope exceeds direct handling. If no specialist fits, propose a TemporaryAgent; do not promote it without human approval. Every delegation decision must emit a trace event.

## 8. Feature Development Process

Every change follows SDD (Spec-Driven Development):

1. Create a GitHub issue describing goal, context, tasks, and acceptance criteria.
2. Create a branch: `issue-{number}-{short-title}`.
3. Read existing specs in `.ai/`, then create or update the spec in `.ai/execution/` or the relevant directory.
4. Implement following the spec, keeping provider calls at zero for deterministic operations.
5. Use atomic file operations (temp + rename).
6. Emit trace events.
7. Open a PR that links `Closes #${issue_number}` and passes tests/type checks/validators.

## 9. Installing Alfred Artifacts

When the user provides a URL to install Alfred artifacts (for example, "install this https://github.com/GOI17/alfred"):

1. Load `.ai/instructions/install-management.md`.
2. Detect the active harness from the runtime environment.
3. Check the harness compatibility matrix (`.ai/harnesses/compatibility-matrix.json`).
4. Generate installation previews using the adapter package.
5. Apply preview files to the harness config directory only after human approval.
6. Emit trace events for every operation.

**Never git clone repositories directly. Never run package manager install commands in the user workspace without explicit approval.**

## 10. References

- Domain model: `.ai/domain/model.md`
- Project context: `.ai/context.md`
- Development guidelines: `.ai/development.md`
- Architecture: `docs/architecture/`
- Install instructions: `.ai/instructions/install-management.md`
- Compatibility matrix: `.ai/harnesses/compatibility-matrix.json`
- Skill registry: `.ai/skills/registry.json`
- Manifest: `.ai/manifest.json`
