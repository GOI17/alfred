---
id: execution/phase-13-pi-agent-install-management
model_assigned: false
description: SDD for pi agent install, update, and uninstall scripts following install-management instructions
phase: phase-13-pi-agent-install-management
author: core
---

# Phase 13: Pi Agent Install Management

## Goal

Implement SDD-driven install/update/uninstall scripts for the Pi agent following the install-management instructions. Pi is the first-party harness adapter that requires installation scripts for user workspace deployment.

## Background

From `.ai/instructions/install-management.md`, the Pi adapter has status `executable-spike` and requires:
1. An install script accessible via `curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh`
2. An uninstall script
3. An update script
4. Path validation ensuring installation never targets root

## Terms

- **GOI17/alfred**: The GitHub repository hosting Alfred installation scripts
- **Pi agent files**: Agent specifications, skill metadata, and adapter configuration for the Pi harness
- **User workspace**: Any directory where Alfred is installed; multiple workspaces supported
- **Installation path**: User-provided target directory (must not be `/` or contain protected segments)

## Requirements

### R1: Install Script

**Endpoint**: `https://raw.githubusercontent.com/GOI17/alfred/main/install.sh`

**Behavior**:
1. Detect if user provided a custom installation path via `--path` or positional argument
2. Validate the installation path:
   - Must not be root (`/`)
   - Must not be protected paths (`.ai/`, `.opencode/`, `harnesses/`)
   - Must be a writable directory
3. Download Pi agent files from the official source (raw.githubusercontent.com/GOI17/alfred/main/pi/latest)
4. Locate only Pi agent files in the user workspace (not the full Alfred repository)
5. Create the following structure in the target path:
   ```
   {target-path}/
   ├── AGENTS.md                    # Orchestrator instructions
   ├── .alfred/
   │   ├── config.json              # Pi harness configuration
   │   ├── agents/                  # Agent specifications
   │   │   ├── orchestrator.md
   │   │   ├── developer.md
   │   │   ├── qa.md
   │   │   └── ...
   │   ├── skills/                  # Skill manifests (not bodies)
   │   │   └── registry.json
   │   └── pi-adapter/              # Minimal adapter files
   └── README.md                    # Workspace-specific instructions
   ```
6. Generate a trace event for the install operation

**Installation path validation rules**:
- If path is `/`, reject with error `installation_path_is_root`
- If path contains `.ai/` or `.opencode/` or `harnesses/`, reject with error `installation_path_protected`
- If path is not writable, reject with error `installation_path_not_writable`

**CLI usage**:
```bash
# Default installation (current directory)
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh

# Custom path
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --path ./my-alfred-workspace

# Dry-run preview
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --path ./my-alfred-workspace --dry-run
```

### R2: Uninstall Script

**Endpoint**: `https://raw.githubusercontent.com/GOI17/alfred/main/uninstall.sh`

**Behavior**:
1. Locate the Alfred installation in the current directory or provided path
2. Validate the target path is not protected
3. Remove only the `.alfred/` directory and `AGENTS.md` (preserve user files)
4. Generate a trace event for the uninstall operation

**CLI usage**:
```bash
# Uninstall in current directory
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/uninstall.sh | sh

# Uninstall in specific path
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/uninstall.sh | sh -s -- --path ./my-alfred-workspace

# Dry-run preview
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/uninstall.sh | sh -s -- --path ./my-alfred-workspace --dry-run
```

### R3: Update Script

**Endpoint**: `https://raw.githubusercontent.com/GOI17/alfred/main/update.sh`

**Behavior**:
1. Detect the current installation path
2. Compare local version with remote version
3. If identical, report `no_change` and exit
4. If different, download updated files and atomically replace
5. Generate a trace event with `diff_detected: true`

**CLI usage**:
```bash
# Update current installation
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/update.sh | sh

# Update specific path
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/update.sh | sh -s -- --path ./my-alfred-workspace

# Dry-run preview
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/update.sh | sh -s -- --path ./my-alfred-workspace --dry-run
```

### R4: Trace Events

Every operation must emit a trace object:

```json
{
  "trace_id": "phase-13-pi-agent-install-management",
  "timestamp": "ISO-8601",
  "event": "install_management_operation",
  "actor": "pi-install",
  "data": {
    "operation": "install | update | uninstall",
    "target_path": "<path>",
    "status": "pass | fail",
    "error_code": "<code or null>",
    "human_approval": true,
    "provider_calls": 0
  }
}
```

Trace output: `.alfred/observability/install-trace.json`

## Technical Approach

### Script Implementation

Each script is a standalone shell script that:
1. Uses `curl` to fetch necessary assets from `https://raw.githubusercontent.com/GOI17/alfred/main`
2. Validates inputs locally (no external calls for validation)
3. Performs atomic file operations using temp files + rename
4. Emits trace to local file

### File Structure

The install script downloads only these files from raw.githubusercontent.com/GOI17/alfred/main:
- `pi/latest/AGENTS.md`
- `pi/latest/.alfred/config.json`
- `pi/latest/.alfred/agents/*.md`
- `pi/latest/.alfred/skills/registry.json`
- `pi/latest/.alfred/pi-adapter/*`

### Path Validation

All scripts use the same `validate_path()` function:
- Reject if path is `/` or empty
- Reject if path contains protected segments: `.ai/`, `.opencode/`, `harnesses/`
- Reject if path is not a directory or not writable

## Runtime Artifacts

- Install script: `scripts/install.sh` (local development) + `https://raw.githubusercontent.com/GOI17/alfred/main/install.sh` (production)
- Uninstall script: `scripts/uninstall.sh` (local development) + `https://raw.githubusercontent.com/GOI17/alfred/main/uninstall.sh` (production)
- Update script: `scripts/update.sh` (local development) + `https://raw.githubusercontent.com/GOI17/alfred/main/update.sh` (production)
- Trace output: `{target-path}/.alfred/observability/install-trace.json`

## Completion Conditions

- [ ] `curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh` downloads and runs without errors
- [ ] Install script validates path and rejects root (`/`)
- [ ] Install script rejects protected paths (`.ai/`, `.opencode/`, `harnesses/`)
- [ ] Install script creates only Pi agent files in target workspace
- [ ] Uninstall script removes only `.alfred/` and `AGENTS.md`
- [ ] Update script correctly detects no-change scenarios
- [ ] All operations emit trace events to `{target-path}/.alfred/observability/install-trace.json`
- [ ] Provider calls remain zero for all operations
- [ ] `--dry-run` previews work for all operations

## References

- Install management instructions: `.ai/instructions/install-management.md`
- Pi adapter design: `.ai/harnesses/pi/adapter-design.md`
- Pi adapter runtime: `packages/pi-adapter/src/runtime.js`
- Phase 7 harness portability: `.ai/evals/baselines/phase-7-harness-portability.json`
