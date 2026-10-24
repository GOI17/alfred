---
id: context
description: Alfred project context and history - traces decisions, architecture, and completed work
owner: core
---

# Alfred Project Context

## Overview

Alfred is a local-first product with three independent capabilities: Workspace for projects, conversations, and local tools; Memory for persistent knowledge; and Agent Harness for operating agents, subagents, and skills across coding harnesses. Use each capability on its own, or connect them explicitly through public contracts. Agent Harness uses a harness-agnostic core with hexagonal architecture and DDD principles.

## Architecture

### Core Philosophy

- **Local-first execution (compute, not persistence)**: No provider calls for deterministic operations. Memory persistence may be local (SQLite) or remote (Postgres) according to tenant storage choice; the HTTP process remains local. See Memory Hosting below.
- **Memory hosting policy**: Storage backend selection rules per tenant kind live in `.ai/policies/memory-hosting-policy.md`. Human agents require Postgres; coding agents are asked on `alfred init`; the server always binds to loopback, independently of database location.
- **Memory filesystem workspace hierarchy policy**: The relationship between filesystem workspaces and Alfred Memory tenants is governed by `.ai/policies/memory-workspace-policy.md`. Workspaces are not tenants; `tenant_access` is many-to-many with explicit inheritance.
- **Harness-agnostic Agent Harness**: Core has no knowledge of specific harnesses (Pi, opencode, VSCode, etc.)
- **User-owned model assignment**: Model selection happens at runtime, not hardcoded
- **Deny by default**: Security policy requires explicit approval for privileged actions
- **Multiple workspaces**: Users can have different Alfred installations in different directories

### Packages

```
packages/
├── cli/              # Neutral product command composition
├── workspace/        # Independent projects/conversations/tools capability
├── memory/           # Memory domain and ports
├── memory-server/    # Local-only Memory service and standalone CLI
├── agent-harness/    # Agent Harness public command facade
├── core/             # Agent Harness business logic, no adapter imports
├── profile-manager/  # Runtime profiles from GOI17/agents: PATH/provider/model/plugin portability
├── pi-adapter/       # First-party Pi harness adapter
├── codex-adapter/    # Codex custom agents + repo skills preview
└── opencode-adapter/ # opencode harness adapter (translation spike)
```

### Adapters

| Harness | Status | Implementation |
|---------|--------|----------------|
| Pi | `executable-spike` | `packages/pi-adapter/` |
| opencode | `executable-translation-spike` | `packages/opencode-adapter/` |
| VSCode | `compatibility-contract` | Design doc only |
| Claude | `compatibility-contract` | Design doc only |
| Codex | `executable-translation-spike` | `packages/codex-adapter/` |
| Kiro | `compatibility-contract` | Design doc only |

Codex uses the main session for the Orchestrator role through project
instructions. The adapter generates a managed primary instruction block and
five specialist custom agents. Approved installer application preserves existing
AGENTS.md text and honors an active AGENTS.override.md.

## Agents

Alfred ships with these agents, generated from `.ai/agents/` specs:

| Agent | Mode | Description |
|-------|------|-------------|
| orchestrator | primary | Main coordinator, loads kernel and orchestrates tasks |
| developer | subagent | Coding tasks, follows architecture kernel |
| qa | subagent | Testing, regression coverage design |
| librarian | subagent | Documentation, skill loading |
| architect | subagent | Architecture decisions, DDD patterns |
| reviewer | subagent | Code review, policy enforcement |

## Skills

Skills provide specialized instructions for specific tasks. They are lazy-loaded on demand based on project signals and task context.

## Key Decisions

### 1. Hexagonal Architecture

Core (`packages/core`) has no dependencies on adapter packages. Adapters depend on core, never the reverse. This ensures harness portability and prevents adapter leakage into business logic.

### 2. Local-First Provider Policy

Every provider request is evaluated against local capabilities first. Only when local computation cannot solve the task should a provider be called. This is enforced by `ProviderRequestPolicy`.

### 3. Model Assignment User-Owned

Model selection happens at runtime via user configuration, not hardcoded in agent specs. This allows users to use their own API keys and preferred models.

### 4. Permission Policy Deny-by-Default

All privileged actions (file access, command execution, permission changes) are denied by default. Agents must explicitly request and receive approval before proceeding.


### 5. Runtime Profiles from GOI17/agents

Alfred now includes `packages/profile-manager`, integrating the `GOI17/agents` / `agent-switcher` concept as a first-party runtime profile capability. Runtime profiles let the same agent/harness have separate `work`, `personal`, client, or machine-specific activations without asking users to manually reconcile PATH differences, enabled providers, available models, or plugins.

Tracked profile defaults live in `profiles/`; private machine overlays live in ignored `profiles.local/`. The manager scans tracked JSON/JSONC for likely literal secrets, supports local-only machine capability reports, materializes overlays, and activates `~/.config/<agent>` by symlink only after preview/approval gates. Harness-specific semantics remain adapter-owned.

### 6. Suite Installer Direction

Issue #240 makes Workspace, Memory, and Agent Harness independently selectable
through `.ai/install/components.json` and `--components=workspace,memory,harness`.
All seven nonempty combinations are supported. Approved Apply alone records
`.alfred/setup/components.json`; the separate integration receipt remains
compatible with 1.1.0. Legacy `coding` maps to Agent Harness, `memory` to Memory,
and historical `full` to Agent Harness + Memory. Upgrades do not add Workspace.
Selections do not connect services, MCP, credentials, tenants, or session runtimes.

### 7. Agent-Driven Install

Historical source/Pi artifact installation, update, and uninstall use the shell scripts below. For the published product CLI and recorded project integrations, use `alfred setup` and its reviewed Update flow (available since 1.1.0):

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh

# Update
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/update.sh | sh

# Uninstall
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/uninstall.sh | sh
```

Install scripts validate paths (reject root `/` and protected paths like `.ai/`, `.opencode/`, `harnesses/`).

### 8. Homebrew Distribution

The canonical public tap is `GOI17/homebrew-alfred`. Release 1.1.0 includes
the bundled Go Bubble Tea/Lip Gloss setup UI, separate Node JSONL backend, and
reviewed CLI/project integration updates. Native setup executables are bundled
for Darwin/Linux amd64/arm64; Go is a build-time dependency only.

Issue #240 prepares Workspace for a subsequent release. Existing 1.1.0 packages
do not gain it from a source checkout. Distribution must pass packaged static
asset and real PTY spawn/exit checks on all four targets before availability is
claimed. Playwright browser engines remain separately installed, opt-in tools.

The selected deterministic runtime archive includes reviewed production npm
dependencies and licenses, with a versioned tar.gz, `runtime-manifest.json`,
`SHA256SUMS` and `alfred.rb`. The formula pins the actual release-asset SHA-256
and declares Node. Dependency staging uses the reviewed npm lockfile in an
isolated temporary directory, subject to explicit installation approval.

Release Please continues to collect Conventional Commits into a reviewable
release PR. Merging it creates the stable release and directly invokes the
publisher: validate tag/package version/source revision, build and verify the
runtime, upload immutable assets to that release, verify anonymous downloads,
then update only `Formula/alfred.rb` in `GOI17/homebrew-alfred` with the existing
repository-scoped `HOMEBREW_TAP_DEPLOY_KEY`. Identical assets permit retries;
different existing bytes fail without replacement. Manual copy is recovery only.
Preparing the workflow does not itself publish assets, change tap visibility or
modify the remote formula.

Homebrew installs the shared runtime once. Interactive `alfred setup` uses its bundled Go TUI and installed files without cloning `main`,
retaining preview/approval gates. Node compatibility remains explicit. The backend
binds one-use confirmation to the exact reviewed choices and project context.
Approved harness previews stay project-local under `.alfred/setup/previews`.
Managed runtime initialization and exact-scope consent remain per project under
`.alfred/runtime/`; they do not modify the shared installation or replace Memory
`alfred init`. Model selection remains user-owned and outside setup. See
`packaging/homebrew/README.md` for candidate builds and activation requirements.


### 9. Independent product capabilities

Workspace, Memory, and Agent Harness share product identity without depending on
one another. The neutral CLI composes public lazy entrypoints and preserves old
global aliases. Workspace's `SessionPort`/`SessionAdapter` and Memory's
HTTP/client/MCP APIs are optional caller-configured contracts. No peer discovery,
automatic credentials, shared state, or implied ACP backend is introduced.

Workspace's published 175-file source snapshot comes from commit
`1e8c624d65e9814549d8604db181d716bc0dd0f4` (tree
`2683a7993053da9cd3c81293869ba214cdd079ba`). The source checkout/history remain
preserved. The manifest records provenance and intentional transformations.
See `docs/architecture/011-product-capabilities.md` and
`docs/workspace-migration.md`. The application is distinct from existing Memory
filesystem workspace bindings; registry data and identifiers are unchanged.


## Memory Hosting

Alfred Memory runs only as a local loopback process (`ALFRED_MEMORY_HOSTING=local`).
Issue #232 retires the managed hosted service and deployment workflow. The local
console uses same-origin API requests; public Pages provides setup instructions.
Wildcard binds and other hosting modes are rejected before the registry opens.

| Process | Tenant storage | Availability |
|---|---|---|
| Local loopback HTTP | SQLite per coding tenant | supported |
| Local loopback HTTP | User-chosen Postgres, local or remote | supported |

Storage policy, authentication, tenants, OAuth and MCP remain intact. Cloud
clients cannot reach the loopback process. Earlier hosting roadmaps and `.ai/architecture/memory-hosting-modes.md` are historical;
see `.ai/execution/memory-local-only.md` for the current runtime contract.

Key concepts introduced in v0.3.0:

- **Tenant** — a universe of data with one physical DB (SQLite or Postgres).
- **Memory filesystem workspace** — a directory on disk where an agent invokes Alfred Memory; distinct from the Workspace application.
- **`tenant_access`** — many-to-many binding of workspaces to tenants with
  `access IN ('owner', 'reader')` and explicit `inherited` flag.
- **`alfred_registry`** — the control-plane SQLite that lives in `~/.alfred/registry.sqlite`.

The two new policies govern creation and traversal:

- `.ai/policies/memory-hosting-policy.md` — storage backend selection rules.
- `.ai/policies/memory-workspace-policy.md` — workspace invariants and the (a)/(b)/(c) safety guard.

The roadmap for shipping this lives at `.ai/roadmaps/0.3.0.md` and `.ai/roadmaps/0.3.0.json`.

## Completed Milestones

### MVP Release 0.2.0

Released: Achieved MVP status with:
- Pi adapter (executable spike)
- opencode adapter (translation spike)
- Eval runner CLI for regression gates
- Install/update/uninstall scripts for user workspace deployment
- VSCode, Claude, Codex, Kiro covered by compatibility contracts

### Phase 13: Install Management

Implemented:
- `scripts/shell/install.sh` - Installs Pi agent files to user workspace
- `scripts/shell/uninstall.sh` - Removes Pi agent files
- `scripts/shell/update.sh` - Updates existing installation
- Path validation (rejects root and protected paths)
- Trace event emission to `.alfred/observability/install-trace.json`
- `buildPiInstallPreview()` and `writePiInstallPreview()` functions in pi-adapter

### Phase 7-12: Adapter System

Implemented:
- Harness compatibility matrix (`.ai/harnesses/compatibility-matrix.json`)
- Adapter design docs for all six target harnesses
- Pi adapter with runtime spikes for phases 2-6
- opencode adapter translation spike
- Adapter hardening contract and readiness evaluation

## Project Structure

```
.alfred/                  # Installed Alfred artifacts (created by install.sh)
├── config.json           # Pi harness configuration
├── agents/               # Agent specifications
├── skills/               # Skill manifests
└── pi-adapter/           # Pi adapter files

.ai/                     # Alfred source of truth (never touched by install.sh)
├── agents/               # Agent specs (orchestrator, developer, qa, etc.)
├── harnesses/           # Harness design docs and compatibility matrix
├── policies/             # Security, delegation, provider request policies
├── domain/               # Domain model, glossary
├── evals/                # Baselines, regression gates, eval suites
├── instructions/         # Install management, operational instructions
├── releases/             # Release candidates and validation
├── roadmaps/             # Release roadmaps
├── observability/        # Generated traces
└── skills/               # Skill definitions

scripts/                 # Development scripts
├── shell/                # Install/update/uninstall scripts
└── validate-*.mjs        # Phase validators

packages/                 # Source code
├── cli/                  # Product composition
├── workspace/            # Projects, conversations, local tools
├── memory/               # Persistence domain
├── memory-server/        # Standalone local Memory service
├── agent-harness/        # Agent Harness command facade
├── core/                 # Harness-agnostic Agent Harness business logic
├── profile-manager/      # Runtime profile planning and activation
├── pi-adapter/           # Pi harness adapter
├── codex-adapter/        # Codex harness adapter
└── opencode-adapter/     # opencode harness adapter
```

## References

- Domain Model: `.ai/domain/model.md`
- Architecture Kernel: `packages/core/src/index.js`
- Pi Adapter: `packages/pi-adapter/src/runtime.js`
- Compatibility Matrix: `.ai/harnesses/compatibility-matrix.json`
- Install Instructions: `.ai/instructions/install-management.md`
- Install Component Manifest: `.ai/install/components.json`
- Runtime Profile Manager: `packages/profile-manager`
