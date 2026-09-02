---
id: execution/alfred-setup-command
description: Replace the standalone alfred-install executable with the Alfred setup subcommand.
phase: issue-124-alfred-setup
author: core
issue: 124
---

# Alfred setup command

## Goal

Make `alfred setup` the only public entry point for guided Alfred
configuration. Homebrew remains responsible for package installation; Alfred
itself is responsible for environment setup.

Issue #134 removes model assignment from this command: `alfred setup` does not
prompt for, preview, approve, create, or modify `~/.alfred/models.json`. Runtime
model resolution and standalone reconfiguration remain separate capabilities.

## Requirements

### R1: CLI contract

1. Add `setup` to the main `alfred` dispatcher and help output.
2. Forward setup arguments and terminal I/O to the existing deterministic
   `install.sh` implementation.
3. With no arguments, request the existing guided TUI flow.
4. Propagate the installer's exit status.

### R2: Homebrew package boundary

1. Install only the public `alfred` executable.
2. Remove the `alfred-install` wrapper completely.
3. Mark the packaged command with `ALFRED_DISTRIBUTION=homebrew`.
4. For a Homebrew setup, reuse the immutable packaged source via `--no-clone`
   and force the package `libexec` path.

### R3: Safety

1. Preserve preview-first behavior.
2. Do not write live harness configuration during formula installation or a
   setup preview.
3. Keep provider calls at 0.

### R4: Release

1. Publish the breaking command change as `0.6.0`.
2. Update current documentation to use `alfred setup`.
3. Regenerate, audit, publish, upgrade, and test the private formula.
4. Confirm `alfred-install` is absent after upgrade.

## Completion conditions

- [x] CLI setup preview passes.
- [x] Formula generator tests pass.
- [x] Homebrew validator and formula style pass.
- [x] Release `v0.6.0` is published from a validated commit.
- [x] Tap formula passes strict audit, upgrade, and `brew test`.
- [x] `alfred version` reports `0.6.0`.
- [x] `command -v alfred-install` fails after cleanup.
- [x] Provider calls remain 0.
