# Alfred

Alfred handles the operational burden so humans focus on decisions.

Alfred is a local-first product with three independent capabilities: Workspace for projects, conversations, and local tools; Memory for persistent knowledge; and Agent Harness for operating agents, subagents, and skills across coding harnesses. Use each capability on its own, or connect them explicitly through public contracts.

| Capability | Product command | Standalone command | Responsibility |
|---|---|---|---|
| Workspace | `alfred workspace` | `alfred-workspace` | Projects, conversations, files, terminals, and local tools |
| Memory | `alfred memory` | `alfred-memory` | Persistent knowledge, tenants, local API, MCP, and console |
| Agent Harness | `alfred harness` | `alfred-agent-harness` | Agents, skills, policies, runtime profiles, and harness integration |

The shared CLI composes commands; the capabilities do not require one another.
Selecting multiple capabilities does not connect services, credentials, MCP, or
session runtimes. See [product capabilities](docs/product-capabilities.md) and
[the Workspace migration guide](docs/workspace-migration.md).

**Availability:** the Workspace package and namespaced commands described here
are available in source and require a release after 1.1.0. They are not included in Alfred
1.1.0. A checkout change does not update an installed Homebrew package. Workspace
release artifacts must pass native terminal and web asset checks on macOS and
Linux, on both x64 and arm64, before distribution is declared ready.


## Human Installation

Alfred is available from the public `GOI17/homebrew-alfred` tap. Published
runtime archives include locked production dependencies. Check `alfred version`
for the installed release; source documentation may describe a later release.

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

Install the runtime once. Run `alfred setup` from the project directory you want
to configure. The opening screen shows CLI/project versions and offers Update
or Continue setup. For an initial installation, the Go UI reviews and prepares
previews. It then shows an
exact project file list for Codex CLI/App and OpenCode and asks for a **second
approval** to install those files. Declining keeps previews only. Completion
reports verified files on disk; start a new harness session to load them.
Previews stay in `.alfred/setup/previews/<session>` outside the shared runtime.
Conflicting files, JSONC ambiguity, changed plans and symlinks stop activation;
existing unrelated settings are preserved. Pi remains preview-only in this UI.
Explicit flags and `alfred setup --legacy-ui` retain the existing interface;
`--apply` alone prepares previews and does not approve live harness installation.
Initial harness preparation uses bundled files; it does not download source,
compile Go or install dependencies. An explicitly approved runtime update uses
Homebrew to download the published package.
Model assignment remains user-owned; setup does not change `~/.alfred/models.json`.
For later releases, open `alfred setup` in the project and choose **Update**.
Alfred checks the canonical stable release and Homebrew tap without blocking the
menu. After you review and approve an available CLI upgrade, it relaunches the
new runtime and offers a separate review of project integration changes. Saved
harness choices are reused; the setup questionnaire does not need repeating.
The project can also be refreshed when Brew has already updated the CLI.

Installation receipts track managed files and instruction/configuration portions.
Local edits, missing files or ambiguous legacy evidence are shown as conflicts.
Matching 1.0.1 installations can be adopted from their project-local previews;
preview-only installations still need their first activation. Offline checks
leave Continue setup and local project updates usable. To skip the release
lookup explicitly, use `ALFRED_SETUP_CHECK_UPDATES=0 alfred setup`.

An existing 1.0.1 CLI needs one bootstrap upgrade to 1.1.0 or later: `brew update` followed by
`brew upgrade GOI17/alfred/alfred`. Subsequent updates are offered in setup.

Releases with the composition layer offer independent Workspace, Memory, and Agent Harness choices:

```sh
alfred setup --components=workspace,memory,harness
```

Choose any nonempty combination. Approved Apply records the selection in
`.alfred/setup/components.json`; preview and discovery do not write it. Existing
1.1.0 integration receipts remain valid. Historical `coding` maps to Agent
Harness, `memory` to Memory, and `full` to Agent Harness + Memory. Updating an
older installation never silently adds Workspace.

For each project, initialize managed execution separately:

```sh
alfred harness runtime init --instructions /absolute/path/to/shared/instructions.json
alfred harness runtime status
```

Run those commands in each project's directory. Runtime initialization is
separate from Memory `alfred memory init`; project state and exact-scope approvals stay
under that project's `.alfred/runtime/`, outside the shared installation.
See the [packaging and release guide](packaging/homebrew/README.md) for artifacts,
verification, current availability and the automatic publishing pipeline.

The existing `curl | sh` source bootstrap remains documented in the
[install guide](https://alfred.alfredlabs.org/docs/install.html); it is separate
from the prepared versioned runtime package.

## Local Workspace

After building the Workspace package or installing a release that includes it:

```sh
alfred workspace serve --port 4310 --data-dir /absolute/path/to/workspace-state
# Equivalent standalone command:
alfred-workspace serve --port 4310 --data-dir /absolute/path/to/workspace-state
```

Open <http://127.0.0.1:4310/>. State lives outside the installed package.
Starting Workspace does not start Memory or configure an Agent Harness runtime.
Browser tools require separately installed Playwright browser engines when used;
ordinary Workspace operation does not require them. See
[Workspace](packages/workspace/README.md) for configuration and runtime adapters.

## Local Memory

Alfred Memory runs only on your computer. The managed hosted service is retired.

```bash
alfred memory init --profile=coding --backend=sqlite --name my-memory
ALFRED_MEMORY_REQUIRE_AUTH=true alfred memory serve
```

Open <http://127.0.0.1:3000/console/> and unlock it with the API key printed by
`init`. Keep the server running. SQLite and user-chosen Postgres storage remain
available; the HTTP service always binds to loopback.
See the [Memory quickstart](docs/QUICKSTART.md).

## Skill inventory and lifecycle

`alfred harness skills` inspects skills on disk and manages their installation receipts.
Use `$alfred skills list`, `search`, `add`, `remove`, or `create` from Codex chat;
in OpenCode, use its generated `/alfred skills ...` command. Codex uses the
`alfred` skill and does not register a custom native `/alfred` slash command.
`create` authors a validated local draft; installation is a separate request.
Source changes do not update an already installed Homebrew release.

```sh
alfred harness skills list
alfred harness skills search testing --limit 5
alfred harness skills add https://github.com/owner/repo --name selected-skill --harness codex
alfred harness skills info tdd --harness codex --scope project
alfred harness skills install ./skills/tdd --harness codex
alfred harness skills install ./skills/tdd --harness codex --apply
alfred harness skills update tdd --harness codex
alfred harness skills remove tdd --harness codex
```

`install`, `update`, and `remove` preview by default; add `--apply` to authorize
the selected operation. Offline inventory reports location, declared version
when present, revision/digest, and management/integrity status. Existing setup
skills are unmanaged by the skill manager until explicitly adopted from an
identical source. Setup uses a separate receipt for updating the complete project
integration.
See the [skill manager guide](packages/skill-manager/README.md) for GitHub sources,
project/global destinations, migration, and inventory coverage.

Existing global commands such as `alfred init`, `alfred serve`, `alfred runtime`,
and `alfred skills` remain compatibility aliases. On Alfred 1.1.0, use those
aliases until upgrading to a release with the namespaced commands.

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
├── cli/         # Product command composition; lazy capability dispatch
├── workspace/   # Standalone projects/conversations/tools application
├── agent-harness/ # Agent Harness command facade
├── core/        # Agent Harness domain, use cases, ports, policies
├── installer-tui/ # OpenTUI adapter for the guided installer
├── memory/      # Memory domain and ports
├── memory-server/ # Standalone local Memory service/CLI
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
