---
id: instructions/install-management
model_assigned: false
description: Instructions for Alfred install/update/uninstall, including suite TUI and agent-driven harness previews.
phase: phase-13-install-management
author: core
---

# Install / Update / Uninstall Instructions

## Purpose

Provide deterministic, reproducible instructions for Alfred installation, update, and uninstall. The root `install.sh` is the human-first suite installer; adapter-driven harness artifact writes remain preview-first and approval-gated.

## Critical Rule

**When the user provides a URL to install Alfred (e.g., "install this https://github.com/GOI17/alfred"), the agent MUST follow the installation process described below. The agent MUST NOT simply git clone the repository. The agent MUST:**

1. Detect the active harness from the runtime environment.
2. Check the harness compatibility matrix for the adapter status.
3. Generate installation previews using the adapter package.
4. Apply the preview files to the harness config directory only after explicit human approval.
5. Emit trace events for every operation.

## Modes

### Mode 0: Human-First Suite Install

Use for humans installing Alfred itself. The public canonical tap distributes
versioned runtime releases. Release 1.1.0 includes the two-stage Go activation
flow and reviewed CLI/project updates. Workspace requires a subsequent release
that includes its package; check the installed version and runtime availability.

```sh
brew install GOI17/alfred/alfred
alfred version
alfred setup
```

Use the fully qualified formula to distinguish this product from the unrelated
Alfred macOS application cask. The formula installs a shared selected runtime
archive, pinned by its actual SHA-256, and declares Node. Locked production
dependencies are already in the archive; installation does not require a GitHub
login, source clone or a package-manager install in the project.

Interactive `alfred setup` uses the installed runtime and bundled Go TUI with
`--no-clone`. Explicit flags/non-TTY previews and `--legacy-ui` remain available.
First review and approve preparation; this creates fresh adapter manifests under
`.alfred/setup/previews/<session>`. Next review the exact invoking-project target,
paths, actions and hashes, then explicitly approve installation. This separate
consent is bound to source contents, target snapshots and selection and is one-use.
No live harness files are written before it. Declining keeps previews only.
Codex preserves the managed primary block and honors AGENTS.override.md; OpenCode
preserves existing JSON settings. Conflicting artifacts, JSONC ambiguity, unsafe
paths and stale plans fail closed. Verified files require a new harness session;
setup cannot prove that a running session loaded them. Pi remains preview-only.
`--apply` in automation still authorizes preparation only; package installation
is not live configuration approval. Model selection remains user-owned.

### Selecting product capabilities

Workspace, Memory, and Agent Harness are independently selectable in setup. The
product CLI accepts `alfred setup --components=workspace,memory,harness` and all
seven nonempty combinations. The corresponding public entrypoints are
`alfred workspace`, `alfred memory`, and `alfred harness`, with standalone
`alfred-workspace`, `alfred-memory`, and `alfred-agent-harness` executables.
These entrypoints require a release that includes the product composition layer;
1.1.0 users retain the existing global aliases until upgrading.

Historical edition mappings are stable: `coding` → Agent Harness, `memory` →
Memory, and `full` → Agent Harness + Memory. Updating an older installation never
adds Workspace automatically. The user selects Workspace explicitly.

Approved Apply alone writes `.alfred/setup/components.json`
(`alfred.setup.components/v1`). Preview and discovery do not write preferences.
The separate `.alfred/setup/installation.json` integration receipt remains
`alfred.setup.installation/v1`, compatible with 1.1.0. Component preferences do
not establish harness activation or erase a recorded harness selection used by
Update. Project updates can still refresh that integration after selecting
Workspace alone.

Selection prepares capabilities; it does not start peer services, create tenants,
propagate credentials, configure MCP, or choose a session runtime. Optional
connections use explicit public contracts and separate caller configuration.
Workspace state remains external to the installed package. Memory's filesystem
workspace bindings, IDs, and tables do not refer to the Workspace application
and are not renamed or migrated by selection. Memory HTTP remains loopback-only.
See `docs/product-capabilities.md` and `docs/workspace-migration.md`.

### Updating a configured project

The interactive setup entry screen reports CLI and project integration versions.
Choose Update to review an available Homebrew upgrade and then review the project
integration changes using saved harness choices. Runtime upgrade and project-file
approval remain separate; resume never implies permission to write project files.
An already-current CLI can still refresh an older project integration.

Setup records managed baselines in `.alfred/setup/installation.json`; the skill
manager's independent receipts are not a substitute for this project receipt.
Matching 1.0.1 previews may be adopted after explicit review. Missing/modified
artifacts, unsafe paths, ambiguous evidence or retired artifacts produce conflicts
without overwriting user work. Partial updates retain recoverable attempt evidence
and do not claim the final integration version. Retry Update, not the questionnaire.

Release lookup is bounded, credential-free and visible. Offline/failed checks
leave the setup menu usable; `ALFRED_SETUP_CHECK_UPDATES=0` disables lookup.
Explicit flags and legacy/noninteractive paths do not add network checks. The
1.1.0 release or later must be installed once through Homebrew by users on 1.0.1;
subsequent releases can be offered inside setup.

For each project's managed requests, run `alfred harness runtime init --instructions
/absolute/path/to/shared/instructions.json` from that project, then `alfred harness
runtime status` (the existing `alfred runtime` alias remains supported). This separate initialization writes project-local
`.alfred/runtime/` state and grants; it does not create Memory tenants or API
keys, change the shared package, or transfer consent between worktrees. Memory
uses `alfred memory init` (the existing `alfred init` alias remains supported). Alfred instructions take precedence; global
options are considered only after confirmed absence, with `Permitir`, `Permitir
siempre` (exact project/option/content/action/scope), or `Cancelar`.

Release Please remains the normal automatic publication path: validate the exact
stable tag/version/revision, build and verify the runtime, publish immutable
`alfred-X.Y.Z-runtime.tar.gz`, `runtime-manifest.json`, `SHA256SUMS` and `alfred.rb`
to the same Alfred release, verify anonymous downloads, then update only the
canonical tap formula using the existing `HOMEBREW_TAP_DEPLOY_KEY`. Identical
asset retries are allowed; different existing bytes must never be overwritten.
Manual formula copying is recovery only. Preparing installation artifacts does
not authorize publication, tap visibility changes or live configuration writes.
See `packaging/homebrew/README.md` for the approved isolated dependency-build
procedure and the remaining activation checks.

The bootstrap alternative remains
`curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh`.
Run it without advanced flags so the TUI can explain capability selection,
harnesses, runtime profiles, Memory setup, name, and preview/apply. Use
`--components` (or legacy `--edition`), `--name`, `--harness`, and `--apply` only
for automation after decisions are known.

### Mode 1: Agent-Driven Harness Artifact Install

Used when:
- User provides a URL to an Alfred artifact
- User requests installation via natural language
- No manual git clone is permitted

Process:
1. Detect the active harness from the runtime environment.
2. Check the harness compatibility matrix (`.ai/harnesses/compatibility-matrix.json`) for adapter status:
   - **Executable adapter** (`executable-spike` or `executable-translation-spike`): proceed to generate preview.
   - **Contract-only** (`compatibility-contract` or `external-script`): STOP and show message to user: `[Agent] is not supported by Alfred currently`.
3. For executable adapters, generate previews ONLY. Do NOT write harness config by default.
4. If the user approves, copy preview files to the live harness config directory.
5. After installing or changing agents/skills, restart the harness because config is loaded at startup.

## Rules

1. **Local-only execution**: these instructions never require provider calls.
2. **Deny by default**: any target path matching protected segments (`.opencode/`, `.ai/`, `harnesses/`) must reject unless `--force` is used **and** a human approval trace is recorded.
3. **Human approval for protected paths**: before writing to a protected path, the system must obtain explicit human approval and log it.
4. **Trace every operation**: after any install, update, or uninstall, write a trace event to `.ai/observability/generated/phase-13-install-management.json`.
5. **Dry-run first**: when uncertain, run `--dry-run` first to preview the operation without side effects.
6. **Atomic writes**: all file writes must use a temporary file + `fs.renameSync` pattern.
7. **Harness-aware previews**: initial install must detect the harness and generate the correct preview using the adapter package, not install the full Alfred repo.
8. **No manual live harness writes**: the suite TUI is supported for humans, but live harness config writes still require preview and explicit human approval.

## Install Operations

### Agent-Driven Harness Artifact Install (Mode 1)

When to use:
- User provides a URL like "install this https://github.com/GOI17/alfred"
- User requests installation via natural language command

Process:
1. Detect the active harness (opencode, VSCode, Pi).
2. Look up the harness in the compatibility matrix (`.ai/harnesses/compatibility-matrix.json`).
3. Check `adapter_status`:
   - `executable-spike` (Pi) or `executable-translation-spike` (opencode, Codex): proceed to generate preview.
   - `compatibility-contract` (VSCode, Claude, Kiro): STOP. Show the message: `[Agent] is not supported by Alfred currently`.
4. Call the harness adapter's install preview generator:
   - opencode: `buildOpencodeInstallPreview({ root })` → `.ai/generated/opencode-install`
   - Pi: native, no install needed
5. If `--dry-run`, return the preview paths without writing live config.
6. If the user approves, copy preview files into the harness's live config directory (e.g. `.opencode/`).
7. Emit an install trace event recording harness, mode, and approval.
8. Advise the user to restart the harness.

### Update

When to use:
- An installed artifact needs to be refreshed because the source changed.
- The artifact type and target path are known.

Process:
1. Parse arguments: `--source`, `--target`, `--type`, optional `--dry-run`, optional `--force`.
2. Validate the target path with `validateInstallPath`.
3. If validation requires human approval, obtain it before proceeding.
4. Verify the source exists; if not, stop with reason `source_not_found`.
5. Verify the target exists; if not, stop with reason `target_not_found`.
6. Read both files and compare content.
7. If the files are identical, return `no_change` and skip the write.
8. If different and not `--dry-run`, write the updated content atomically.
9. Emit an update trace event with `diff_detected` flag.

There is no separate public installer executable. Invoke this operation through
the install-management API after validating the source and target paths.

### Uninstall

When to use:
- An artifact must be removed from the workspace.
- The target path is valid and not protected, or `--force` + human approval is obtained.

Process:
1. Parse arguments: `--target`, optional `--type`, optional `--dry-run`, optional `--force`.
2. Validate the target path with `validateInstallPath`.
3. If validation requires human approval, obtain it before proceeding.
4. Verify the target exists; if not, stop with reason `target_not_found`.
5. If not `--dry-run`, remove the target file.
6. Emit an uninstall trace event.

There is no separate public installer executable. Invoke this operation through
the install-management API after validating the target path.

## Trace Event Format

Every operation must emit a trace object matching `createInstallTrace`:

```json
{
  "trace_id": "phase-13-install-management",
  "timestamp": "ISO-8601",
  "event": "install_management_operation",
  "actor": "alfred-setup",
  "data": {
    "operation": "install | update | uninstall",
    "artifact_type": "agent | skill | adapter",
    "source_path": "<path or null>",
    "target_path": "<path>",
    "status": "pass | fail",
    "human_approval": true | false,
    "provider_calls": 0
  }
}
```

## Error Reference

| Reason | Meaning | Action |
|--------|---------|--------|
| `target_path_matches_protected_paths` | Path is in `.opencode/`, `.ai/`, or `harnesses/`. | Require human approval; do not write without approval. |
| `source_not_found` | The source file does not exist. | Verify the path and retry. |
| `target_already_exists` | The target file already exists during install. | Use `--force` to overwrite, or target a different path. |
| `target_not_found` | The target file does not exist during update or uninstall. | Verify the path and retry. |


## Suite Installer Direction (Draft)

The current installer history conflated Alfred with specific slices: root `install.sh` previously described a Pi agent install, while `scripts/shell/install.sh` focused on Alfred Memory. The next installer UX must install **Alfred as a suite** by edition or by component.

Source of truth: `.ai/install/components.json`.

### Editions

| Edition | Purpose | Core components |
|---|---|---|
| `coding` | Coding harness operations without requiring Memory. | core, agents, skills, profile-manager, opencode/codex adapters, evals |
| `memory` | Alfred Memory only. | memory packages, external AI adapters, console |
| `full` | Whole Alfred operations system. | coding + memory components |

### Required UX

1. Open a guided TUI by default for interactive human installs without advanced flags.
2. Explain why to choose each edition, harness target, profile strategy, Memory setup, and preview/apply mode.
3. Parse `--edition=<coding|memory|full>` or repeated `--component=<id>` for automation and CI.
4. Load `.ai/install/components.json`.
5. Build a deterministic install plan showing packages, required configuration, protected writes, and validations.
6. Run local capability detection before profile activation.
7. Keep Memory setup under Memory components; do not present Memory as the whole Alfred install.
8. Preview harness writes first, then require human approval for live config activation.
9. Emit trace events for both provider calls avoided and installer operations.

### Profile Manager Component

`packages/profile-manager` is the first new suite component. It integrates `GOI17/agents` / `agent-switcher` as Alfred runtime profiles:

- shared defaults: `profiles/<profile>/<agent>/`;
- private machine overlays: `profiles.local/<profile>/<agent>/`;
- local-only capability reports for PATH, providers, models, and plugins;
- tracked secret scanning before materialization;
- activation by `~/.config/<agent>` symlink after preview/approval gates.

## Validation Checklist

Before marking an install/update/uninstall operation as complete:
- [ ] `validateInstallPath` returned `valid: true`.
- [ ] Any protected path has explicit human approval recorded.
- [ ] File was written atomically (temp + rename).
- [ ] Trace event was written to `.ai/observability/generated/phase-13-install-management.json`.
- [ ] Provider calls remained zero.
- [ ] `--dry-run` preview was offered if the user was uncertain.

(End of file - total 186 lines)
