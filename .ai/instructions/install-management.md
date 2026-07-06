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
4. Apply the preview files to the harness config directory.
5. Emit trace events for every operation.

## Modes

### Mode 0: Human-First Suite Install

Use for humans installing Alfred itself. Run `curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh` without advanced flags so the TUI can explain edition, harness, runtime profiles, Memory setup, name, and preview/apply. Use `--edition`, `--name`, `--harness`, and `--apply` only for automation after decisions are known.

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
   - `executable-spike` (Pi) or `executable-translation-spike` (opencode): proceed to generate preview.
   - `compatibility-contract` (VSCode, Claude, Codex, Kiro): STOP. Show the message: `[Agent] is not supported by Alfred currently`.
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

CLI:
```
alfred-install update --source <path> --target <path> [--type agent|skill|adapter] [--dry-run] [--force]
```

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

CLI:
```
alfred-install uninstall --target <path> [--type agent|skill|adapter] [--dry-run] [--force]
```

## Trace Event Format

Every operation must emit a trace object matching `createInstallTrace`:

```json
{
  "trace_id": "phase-13-install-management",
  "timestamp": "ISO-8601",
  "event": "install_management_operation",
  "actor": "alfred-install",
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