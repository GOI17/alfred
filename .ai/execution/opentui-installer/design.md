---
id: execution/opentui-installer
description: Adopt OpenTUI as the preferred terminal backend for the Alfred installer.
phase: phase-13-install-management
author: developer
issue: 100
---

# OpenTUI Installer Backend

## Goal

Use OpenTUI, the terminal framework that powers OpenCode, for Alfred's guided
installer without weakening the existing preview, approval, discovery, model
plan, or shell IPC contracts.

## Context

The Pathfinder domain state machine and responsive view model already live in
`scripts/tui/install-pathfinder.mjs`. The existing
`scripts/tui/install-app.mjs` also owns terminal escape sequences, raw input
decoding, mouse reporting, resize behavior, and cleanup.

OpenTUI can own the terminal lifecycle and structured keyboard/mouse events.
Its native renderer currently requires Bun or Node 26.4+ with experimental FFI,
while Alfred supports Node 22+. Therefore OpenTUI is an additive preferred
backend, not a replacement for the dependency-free Node backend.

## Requirements

### R1: Preserve the Pathfinder domain

1. OpenTUI must reuse `createPathfinderState()`, `transition()`,
   `controlsFor()`, `render()`, `modelPlanForState()`, and
   `serializeAssignments()`.
2. Edition, harness, profile, Memory, model, name, target, Review, and Apply
   behavior must remain backend-independent.
3. Provider calls must remain zero.

### R2: OpenTUI terminal adapter

1. Add a private workspace package using pinned `@opentui/core`.
2. Use OpenTUI's alternate-screen renderer, structured keyboard events,
   resize-aware root, and mouse events.
3. Preserve keyboard-only operation and the existing shortcuts.
4. Render meaningful focus/status markers without relying only on color.
5. Support terminals at 80x24 and wider.

### R3: Security and approval

1. No live Alfred, model, profile, or harness file may be written before Apply.
2. Custom model plans must retain the fixed private path, mode, ownership,
   canonical validation, atomic write, and SHA-256 digest contract.
3. Result assignments must retain the strict shell allow-list consumed by
   `install.sh`.
4. Cancel and signal paths must restore the terminal and emit no result.

### R4: Compatibility fallback

1. The existing Node TUI remains available for Node 22+, playback tests, inline
   layout, and any OpenTUI launch failure.
2. Backend choice must be deterministic and observable through
   `ALFRED_INSTALL_TUI_BACKEND=auto|opentui|node`.
3. `auto` prefers a verified standalone OpenTUI executable, then a compatible
   local OpenTUI development runtime, then the Node backend.
4. `opentui` fails closed to the Node backend; it must never install packages in
   the user's workspace or silently bypass result validation.

### R5: Standalone distribution

1. Provide Bun compile targets for Darwin arm64/x64 and Linux arm64/x64.
2. Produce SHA-256 sidecars for every executable.
3. Add a GitHub Actions build workflow that uploads the binaries as artifacts.
4. `install.sh` may download only a versioned executable with a matching
   checksum; otherwise it uses the Node backend.

### R6: Verification

1. Unit-test OpenTUI key mapping, line tone selection, backend selection, and
   result serialization without loading the native renderer.
2. Run the existing Pathfinder, discovery, and suite installer validators.
3. Add package check/test scripts to the root quality gates.

## Interfaces

```text
install.sh
  -> private discovery.json
  -> choose backend
     -> verified standalone OpenTUI executable
     -> compatible local OpenTUI source
     -> Node install-app.mjs fallback
  -> private result.env
  -> strict validation
  -> preview/apply authority
```

OpenTUI executable environment inputs remain the existing
`ALFRED_INSTALL_CURRENT_*`, `ALFRED_INSTALL_HARNESS_STATUS`,
`ALFRED_INSTALL_DISCOVERY_FILE`, `ALFRED_INSTALL_MODEL_PLAN_FILE`, and
`ALFRED_INSTALL_APP_TUI_RESULT_FILE` contract.

## Completion Conditions

- [x] OpenTUI package and terminal adapter implemented.
- [x] Shared model-plan security helper used by both backends.
- [x] Deterministic launcher and Node fallback implemented.
- [x] Standalone build script and CI artifact matrix implemented.
- [x] Runtime and release process documented.
- [x] Package and installer validation suites pass.

## References

- Issue: https://github.com/GOI17/alfred/issues/100
- OpenTUI: https://github.com/anomalyco/opentui
- Runtime requirements: https://opentui.com/docs/getting-started/
- Standalone builds: https://opentui.com/docs/reference/standalone-executables/
- Existing state machine: `scripts/tui/install-pathfinder.mjs`
- Existing adapter: `scripts/tui/install-app.mjs`
