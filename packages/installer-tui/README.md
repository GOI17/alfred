# Alfred Installer TUI

This package is the OpenTUI terminal adapter for Alfred's guided Pathfinder
installer. It reuses the existing deterministic installer state machine and
shell IPC contracts; OpenTUI owns the native terminal lifecycle, structured
keyboard events, resize handling, and optional mouse input.

## Development

OpenTUI native rendering requires Bun or Node 26.4+ with experimental FFI.

```bash
pnpm --filter @alfred-labs/installer-tui test
pnpm --filter @alfred-labs/installer-tui check
pnpm --filter @alfred-labs/installer-tui start:node
```

The root installer still supports Node 22+. When a compatible OpenTUI binary or
local runtime is unavailable, `install.sh` uses the dependency-free Node TUI.

## Standalone binaries

Install all OpenTUI native target packages with Bun, then compile:

```bash
bun install --os="*" --cpu="*"
pnpm --filter @alfred-labs/installer-tui build:standalone
```

Artifacts are written to `packages/installer-tui/dist/` for:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64` (also used by WSL)

Every executable has a `.sha256` sidecar. The shell installer must verify that
digest before execution and falls back to the Node adapter on any mismatch or
launch failure.
