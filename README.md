# Alfred

Alfred handles the operational burden so humans focus on decisions.

Alfred is a model-readable, harness-agnostic agent operations system for creating, testing, evaluating, securing, and porting agents, subagents, and skills.

## Human Installation

The public Homebrew distribution is being prepared in issue #219. Alfred's
source repository is public, but the canonical `GOI17/homebrew-alfred` tap is
still private and the current `v0.7.2` release does not contain the new runtime
assets. The commands below describe the intended public flow after activation;
they are not a claim that this package is already publicly installable.

Once the tap and a new runtime release are published:

```sh
brew install GOI17/alfred/alfred
alfred version
alfred setup
```

Use the fully qualified formula name to distinguish Alfred from the unrelated
Alfred macOS application cask. The formula downloads a versioned runtime archive
with a pinned SHA-256, including locked production dependencies; Node is a
Homebrew dependency. It installs shared commands without activating a harness.
No GitHub login is required for the intended public download.

Install the runtime once. Review `alfred setup` previews before approving any
project or live harness configuration. Packaged setup uses its bundled Node
TUI and installed runtime, without cloning `main` or fetching another installer.
Model assignment remains user-owned; setup does not change `~/.alfred/models.json`.
For each project, initialize managed execution separately:

```sh
alfred runtime init --instructions /absolute/path/to/shared/instructions.json
alfred runtime status
```

Run those commands in each project's directory. Runtime initialization is
separate from Memory `alfred init`; project state and exact-scope approvals stay
under that project's `.alfred/runtime/`, outside the shared installation.
See the [packaging and release guide](packaging/homebrew/README.md) for artifacts,
verification, current availability and the automatic publishing pipeline.

The existing `curl | sh` source bootstrap remains documented in the
[install guide](https://alfred.alfredlabs.org/docs/install.html); it is separate
from the prepared versioned runtime package.

## Managed runtime (issue #217)

The [runtime authority guide](docs/runtime-authority.md) describes install-once,
per-project initialization and consent for the first managed CLI slice. Its
initial execution contract reads approved text; native host interception and
general tool execution are outside that slice. See the guide for availability
and implementation limits.

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
