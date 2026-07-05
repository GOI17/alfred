---
id: context
description: Alfred project context and history - traces decisions, architecture, and completed work
owner: core
---

# Alfred Project Context

## Overview

Alfred is a local-first agent operations runtime. It designs, tests, evaluates, secures, and ports agents, subagents, and skills across AI coding harnesses. The system is harness-agnostic and uses hexagonal architecture with DDD principles.

## Architecture

### Core Philosophy

- **Local-first execution (compute, not persistence)**: No provider calls for deterministic operations. Memory persistence may be local (SQLite) or remote (Postgres) based on hosting mode; see Memory Hosting below.
- **Memory hosting policy**: Storage backend selection rules per tenant kind live in `.ai/policies/memory-hosting-policy.md`. Human agents require Postgres; coding agents are asked on `alfred init`; self-hosted servers use Postgres.
- **Workspace hierarchy policy**: The relationship between filesystem workspaces and Alfred Memory tenants is governed by `.ai/policies/memory-workspace-policy.md`. Workspaces are not tenants; `tenant_access` is many-to-many with explicit inheritance.
- **Harness-agnostic**: Core has no knowledge of specific harnesses (Pi, opencode, VSCode, etc.)
- **User-owned model assignment**: Model selection happens at runtime, not hardcoded
- **Deny by default**: Security policy requires explicit approval for privileged actions
- **Multiple workspaces**: Users can have different Alfred installations in different directories

### Packages

```
packages/
├── core/             # Harness-agnostic business logic, no adapter imports
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

The installer is being moved from a Memory-centered flow to a suite component model. `.ai/install/components.json` is the draft source of truth for install editions (`coding`, `memory`, `full`) and components. Memory is now modeled as one installable component family rather than the definition of Alfred itself.

### 7. Agent-Driven Install

Installation, update, and uninstall of Alfred artifacts is agent-driven via shell scripts fetched from GitHub:

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh

# Update
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/update.sh | sh

# Uninstall
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/uninstall.sh | sh
```

Install scripts validate paths (reject root `/` and protected paths like `.ai/`, `.opencode/`, `harnesses/`).


## Memory Hosting

Alfred Memory supports four hosting modes. See `.ai/architecture/memory-hosting-modes.md` for the full matrix.

| Mode | Backend | Use case | Status |
|---|---|---|---|
| `local-only` | SQLite per tenant | Solo dev on a single laptop | shipped (MVP) |
| `self-hosted` | Postgres per tenant | Multi-agent, multi-machine, auditable | target of v0.3.0 |
| `federated` | per-agent SQLite/Postgres with sync | Strict local-first with sync | deferred to v0.4.0 |
| `hybrid` | Postgres in cloud + SQLite cache | Mostly online with offline fallback | deferred to v0.4.0 |

Key concepts introduced in v0.3.0:

- **Tenant** — a universe of data with one physical DB (SQLite or Postgres).
- **Workspace** — a directory on disk where an agent invokes Alfred Memory.
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
├── core/                 # Harness-agnostic business logic
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