# Alfred Installer TUI

This package is the OpenTUI terminal adapter for Alfred's guided Pathfinder
installer. It reuses the existing deterministic installer state machine and
shell IPC contracts; OpenTUI owns the native terminal lifecycle, structured
keyboard events, resize handling, and optional mouse input.

The visual shell is responsive:

- `128+` columns: step navigation, decision surface, and live preview;
- `96–127` columns: step navigation plus the decision surface;
- below `96` columns: compact stepper and a single focused decision surface,
  including the supported `80x24` baseline.

Large terminal windows use a centered `148x34` maximum canvas so controls stay
readable instead of stretching across the viewport. Detected, suggested,
chosen, blocked, and approved values retain textual markers when color is
disabled.

Setup explanations are hidden by default. Press `?` to open or close **What
this configuration changes** for the current step, use arrow keys to read its
pages, and press Escape to dismiss it. Discover explains the recommended setup;
Choose groups edition descriptions and the available Runtime Profiles choices
under separate headings. Configure has one editable Path field. Its final folder determines the install
name throughout help, review, and installer output. Enter prefills the effective
path; saving updates the target and name together, and Escape cancels the edit.
Changing steps starts with help hidden. The existing `w` help and `r` recommended
setup shortcuts remain supported.

Keyboard hints appear as a vertical **Keys** list immediately below the main
container. Each line shows one shortcut and its action for the focused option: selectors
show change keys, harness checkboxes show toggle keys, fields show edit keys,
and buttons show their available activation. Text editing and overlays have
their own hints. Read-only help and preview overlays show only Pages and Close. Bottom status and preview summaries are
omitted; `p` opens the full preview and wide terminals retain the separate live
preview panel. Help and preview page numbers appear inside the panel. Panel
height accounts for the keyboard list so focused controls and all pages remain
reachable at `80x24`.

When Memory uses an existing tenant, Configure offers a masked `alk_` API-key
field. It checks syntax locally and keeps the key only for this setup session;
it does not save a connection or contact a server. Escape cancels a replacement.
Completing/cancelling setup, leaving the existing-tenant option, or closing the
session discards the key. Raw values stay out of views, traces, and shell output.

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
