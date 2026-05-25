---
id: instructions/install-management
model_assigned: false
description: Model-readable instructions for Alfred artifact install, update, and uninstall operations.
phase: phase-13-install-management
author: core
---

# Install / Update / Uninstall Instructions

## Purpose

Provide deterministic, reproducible instructions for installing, updating, and uninstalling Alfred artifacts (agents, skills, adapters) into a user workspace.

## Modes

### Mode 1: Initial Install (user does NOT have Alfred locally)

When the user wants to use Alfred from a harness (opencode, VSCode, Pi) but has not cloned the Alfred repository, the install process is harness-aware and preview-based.

1. Detect the active harness from the runtime environment.
2. Check the harness compatibility matrix for the adapter status:
   - **Executable adapter** (`executable-spike` or `executable-translation-spike`): proceed to generate preview.
   - **Contract-only** (`compatibility-contract` or `external-script`): STOP and show message to user.
3. For executable adapters, generate previews ONLY. Do NOT write harness config by default.
4. If the user approves, copy preview files to the live harness config directory.
5. After installing or changing agents/skills, restart the harness because config is loaded at startup.

### Mode 2: Artifact Management (user already has Alfred)

When Alfred is already present in the workspace, use the core install APIs for individual artifact operations.

## Rules

1. **Local-only execution**: these instructions never require provider calls.
2. **Deny by default**: any target path matching protected segments (`.opencode/`, `.ai/`, `harnesses/`) must reject unless `--force` is used **and** a human approval trace is recorded.
3. **Human approval for protected paths**: before writing to a protected path, the system must obtain explicit human approval and log it.
4. **Trace every operation**: after any install, update, or uninstall, write a trace event to `.ai/observability/generated/phase-13-install-management.json`.
5. **Dry-run first**: when uncertain, run `--dry-run` first to preview the operation without side effects.
6. **Atomic writes**: all file writes must use a temporary file + `fs.renameSync` pattern.
7. **Harness-aware previews**: initial install must detect the harness and generate the correct preview using the adapter package, not install the full Alfred repo.

## Install Operations

### Initial Install (Mode 1)

When to use:
- The user does not have Alfred cloned locally.
- The user is running inside opencode, VSCode, or Pi and wants to set up Alfred.

Process:
1. Detect the active harness.
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

### Artifact Install (Mode 2)

When to use:
- The user already has Alfred in the workspace.
- A new artifact (agent, skill, adapter) needs to be added.

Process:
1. Parse arguments: `--source`, `--target`, `--type`, optional `--dry-run`, optional `--force`.
2. Validate the target path with `validateInstallPath({ permissions, targetPath, force })`.
3. If validation is `denied` and `human_approval_required` is true, request human approval.
4. If validation fails for any other reason, stop and return the error.
5. If the target already exists and `--force` is not set, stop with reason `target_already_exists`.
6. If `--dry-run` is true, compute and return the plan without writing.
7. Create the target directory if it does not exist.
8. Read the source file content.
9. Write to a temporary path next to the target.
10. Rename the temporary file to the target path atomically.
11. Emit an install trace event.

CLI:
```
alfred-install install --source <path> --target <path> [--type agent|skill|adapter] [--dry-run] [--force]
```

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

## Validation Checklist

Before marking an install/update/uninstall operation as complete:
- [ ] `validateInstallPath` returned `valid: true`.
- [ ] Any protected path has explicit human approval recorded.
- [ ] File was written atomically (temp + rename).
- [ ] Trace event was written to `.ai/observability/generated/phase-13-install-management.json`.
- [ ] Provider calls remained zero.
- [ ] `--dry-run` preview was offered if the user was uncertain.
