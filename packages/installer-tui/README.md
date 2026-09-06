# Alfred Installer TUI

This package is the OpenTUI terminal adapter for Alfred's guided Pathfinder
installer. It reuses the existing deterministic installer state machine and
shell IPC contracts; OpenTUI owns the native terminal lifecycle, structured
keyboard events, resize handling, and optional mouse input.

The visual shell is responsive:

- `128+` columns: step navigation, decision surface, and live preview;
- `96–127` columns: step navigation plus the decision surface and a compact
  preview summary;
- below `96` columns: compact stepper and a single focused decision surface,
  including the supported `80x24` baseline.

Large terminal windows use a centered `148x34` maximum canvas so controls stay
readable instead of stretching across the viewport. Detected, suggested,
chosen, blocked, and approved values retain textual markers when color is
disabled.

Setup explanations are hidden by default. Press `?` to open or close **What
this configuration changes** for the current step, use arrow keys to read its
pages, and press Escape to dismiss it. Discover explains the recommended setup;
Choose explains each edition and the available Runtime Profiles choices.
Changing steps starts with help hidden. The existing `w` help and `r` recommended
setup shortcuts remain supported.

## Development

OpenTUI native rendering requires Bun or Node 26.4+ with experimental FFI.

```bash
pnpm --dir packages/installer-tui test
pnpm --dir packages/installer-tui check
pnpm --dir packages/installer-tui start:node
```

The root installer still supports Node 22+. When a compatible OpenTUI binary or
local runtime is unavailable, `install.sh` uses the dependency-free Node TUI.

## Standalone binaries

Install all OpenTUI native target packages with Bun, then compile:

```bash
bun install --os="*" --cpu="*"
pnpm --dir packages/installer-tui build:standalone
```

Artifacts are written to `packages/installer-tui/dist/` for:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64` (also used by WSL)

Every executable has a `.sha256` sidecar. The shell installer must verify that
digest before execution and falls back to the Node adapter on any mismatch or
launch failure.
