# Alfred

Alfred handles the operational burden so humans focus on decisions.

Alfred is a model-readable, harness-agnostic agent operations system for creating, testing, evaluating, securing, and porting agents, subagents, and skills.

## Human Installation

Install Git, GitHub CLI (`gh`), and Homebrew on the target computer first.
Your GitHub account needs read access to both private repositories:
[`GOI17/homebrew-alfred`](https://github.com/GOI17/homebrew-alfred) (the tap) and
[`GOI17/alfred`](https://github.com/GOI17/alfred) (the source). Authenticate over
HTTPS, configure Git to use that account, and verify both before installing:

```sh
gh auth login --hostname github.com --git-protocol https
gh auth setup-git --hostname github.com
gh api repos/GOI17/homebrew-alfred --jq .full_name
gh api repos/GOI17/alfred --jq .full_name
git ls-remote https://github.com/GOI17/homebrew-alfred.git HEAD
git ls-remote https://github.com/GOI17/alfred.git HEAD
brew tap GOI17/alfred
brew install GOI17/alfred/alfred
alfred version
alfred setup
```

Run the install only after both API and Git checks succeed. A private repository
can return `404` when your account lacks access; that does not prove publication
failed. See [Homebrew access troubleshooting](https://alfred.alfredlabs.org/docs/install.html#homebrew-troubleshooting)
for formula and publisher checks. `gh auth setup-git` configures the Git
credential helper for GitHub on this computer.

Homebrew maps `GOI17/alfred` to `GOI17/homebrew-alfred`. The old
`GOI17/homebrew-tap` name currently redirects to it; changing capitalization
does not fix authentication.

Use the fully qualified formula name: plain `brew install alfred` resolves to
the unrelated Alfred macOS application cask. The formula itself writes no live
harness configuration; `alfred setup` remains guided and preview-first. Setup
does not ask for model assignments and never creates or changes
`~/.alfred/models.json`; model selection remains user-owned runtime
configuration outside setup.

The existing `curl | sh` bootstrap remains available in the
[install guide](https://alfred.alfredlabs.org/docs/install.html).

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
| Manage runtime profiles | `packages/profile-manager/README.md` |
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
├── installer-tui/ # OpenTUI adapter for the guided installer
├── memory/      # Vendor-agnostic persistent memory MVP
├── profile-manager/ # Runtime profiles for PATH/provider/model/plugin portability
├── pi-adapter/  # Pi.dev runtime integration
├── opencode-adapter/ # opencode runtime integration
├── codex-adapter/    # Codex custom agents + repo skills preview
├── vscode-adapter/   # VSCode compatibility preview
└── evals/            # Eval runner, baselines, reports

.ai/
├── install/        # Suite component manifest for installer UX
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
