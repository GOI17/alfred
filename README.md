# Alfred

Alfred handles the operational burden so humans focus on decisions.

Alfred is a model-readable, harness-agnostic agent operations system for creating, testing, evaluating, securing, and porting agents, subagents, and skills.

## Agent Entry Point

You are an AI agent working in an Alfred workspace. Start here to find your next step.

### Your First Action

1. **Read `AGENTS.md`** — contains your mission, architecture rules, security policy, and evaluation requirements.
2. **Check `docs/architecture/`** — understand project structure and decisions.
3. **Follow execution phases** in `.ai/execution/` — work through tasks in established order.

### Navigation by Task

| Task | Entry Point |
|------|-------------|
| Create new agent | `.ai/instructions/agent-creation.md` |
| Install / update artifacts | `.ai/instructions/install-management.md` |
| Run tests or evals | `packages/evals/README.md` |
| Understand architecture | `docs/architecture/000-project-charter.md` |
| Add a skill | `.ai/instructions/skill-creation.md` |
| Port to new harness | `.ai/harnesses/` + adapter package |

### Key Rules

- **Local-first**: do not call LLM providers when local computation can solve the task.
- **Trace everything**: emit trace events for all operations.
- **Deny by default**: protected paths require explicit human approval.
- **Test before commit**: every change must pass evals and compare against baseline.

### Architecture

```
packages/
├── core/        # Domain, use cases, ports, policies (harness-agnostic)
├── memory/      # Vendor-agnostic persistent memory MVP
├── pi-adapter/  # Pi.dev runtime integration
├── opencode-adapter/ # opencode runtime integration
├── codex-adapter/    # Codex custom agents + repo skills preview
├── vscode-adapter/   # VSCode compatibility preview
└── evals/            # Eval runner, baselines, reports

.ai/
├── instructions/   # Agent-readable task instructions
├── harnesses/      # Harness specs and compatibility matrix
├── execution/      # Phase-based task execution order
└── evals/          # Baselines and regression gates
```

### Protected Paths

Do not read or modify without explicit human approval:
- `.opencode/` — harness config
- `.codex/` and `.agents/` — Codex custom agents/skills config
- `.ai/harnesses/` — harness specs
- `packages/core/` — core domain (adapters may depend, core must not)

---

For human operators: see `AGENTS.md` for operational details.
