# Alfred

Alfred handles the operational burden so humans focus on decisions.

Alfred is a model-readable, harness-agnostic agent operations system for creating, testing, evaluating, securing, and porting agents, subagents, and skills.

## Human Installation

Alfred is available from the public `GOI17/homebrew-alfred` tap. Release
`v0.7.3` ships the verified runtime archive and locked production dependencies.

```sh
brew install GOI17/alfred/alfred
alfred version
alfred setup
```

Use the fully qualified formula name to distinguish Alfred from the unrelated
Alfred macOS application cask. The formula downloads a versioned runtime archive
with a pinned SHA-256, including locked production dependencies; Node is a
Homebrew dependency. It installs shared commands without activating a harness.
No GitHub login is required for the public download.

Install the runtime once. Review `alfred setup` previews before approving any
project or live harness configuration. This branch replaces the default interactive
setup with a bundled Go TUI using Wave's Bubble Tea/Lip Gloss framework and Darcula
palette. The published0.7.3 installer still uses the older UI until the next release.
The new UI reviews the actual plan before asking for explicit confirmation; canceling
makes no setup changes. Approved harness previews go under the invoking project's
`.alfred/setup/previews`, outside the shared installation. Explicit setup flags,
non-TTY previews and `alfred setup --legacy-ui` retain the automation interface.
No setup downloads code, compiles Go, or installs dependencies at runtime.
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

## Local Memory

Alfred Memory runs only on your computer. The managed hosted service is retired.

```bash
alfred init --profile=coding --backend=sqlite --name my-memory
ALFRED_MEMORY_REQUIRE_AUTH=true alfred serve
```

Open <http://127.0.0.1:3000/console/> and unlock it with the API key printed by
`init`. Keep the server running. SQLite and user-chosen Postgres storage remain
available; the HTTP service always binds to loopback.
See the [Memory quickstart](docs/QUICKSTART.md).

## Skill inventory and lifecycle

`alfred skills` inspects skills on disk and manages their installation receipts.
Use `$alfred skills list`, `search`, `add`, `remove`, or `create` from Codex chat;
in OpenCode, use its generated `/alfred skills ...` command. Codex uses the
`alfred` skill and does not register a custom native `/alfred` slash command.
`create` authors a validated local draft; installation is a separate request.
Source changes do not update an already installed Homebrew release.

```sh
alfred skills list
alfred skills search testing --limit 5
alfred skills add https://github.com/owner/repo --name selected-skill --harness codex
alfred skills info tdd --harness codex --scope project
alfred skills install ./skills/tdd --harness codex
alfred skills install ./skills/tdd --harness codex --apply
alfred skills update tdd --harness codex
alfred skills remove tdd --harness codex
```

`install`, `update`, and `remove` preview by default; add `--apply` to authorize
the selected operation. Offline inventory reports location, declared version
when present, revision/digest, and management/integrity status. Existing setup
skills are unmanaged until explicitly adopted from an identical source.
See the [skill manager guide](packages/skill-manager/README.md) for GitHub sources,
project/global destinations, migration, and inventory coverage.

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
