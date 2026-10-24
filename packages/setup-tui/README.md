# Alfred setup TUI

Keyboard-first setup using Bubble Tea **0.25.0** and Lip Gloss **0.9.1**,
with Wave's spacious Darcula presentation. See [NOTICE](NOTICE) for attribution
and [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt) for linked module notices.

Run `alfred setup` from the project you want to configure. Its first screen shows
the installed CLI and project integration versions. A bounded release check runs
while Continue setup and cancellation remain available. Update waits for this
check, then offers the applicable CLI and/or project action. Choose Continue
setup for an initial configuration, then independently select Workspace, Memory,
and/or Agent Harness, select coding tools when using Agent Harness, choose Memory
settings when applicable,
and review the setup name, installation location and runtime profiles.
The shared packaged installation location is read-only; it is distinct from
the current project. The UI does not create managed-runtime consent grants.

Menus use arrows or j/k; Space toggles capabilities and coding tools. Text fields preserve
literal j/k/q, support Unicode, arrows, Home/End, Backspace/Delete and Ctrl+U.
Esc goes back and retains edits. Ctrl+C cancels from every screen; q closes
menus and result screens. Cancellation after apply starts can leave partial
changes and is not a rollback.

The next action is always a real preview from the existing installer. Scroll
to its end and press Enter to reach confirmation. Press `y` to apply the
reviewed preparation steps, or `n`/Esc to return. This creates previews, not live
harness files. For Codex CLI/App and OpenCode a second scrollable review shows
the exact project destination, paths, actions and hashes. A second `y` installs
only those files; `n`/Esc declines activation and keeps previews. Existing settings
are preserved; conflicting artifacts or JSONC require manual resolution. Pi stays
preview-only. Only verified files produce a success result, with a reminder to
start a new harness session. Enter never applies. Editing or leaving confirmation discards its token. Bracketed paste
is deliberately discarded in this frontend because Bubble Tea 0.25 predates
support for distinguishing pasted input from approval keys. Unbracketed
multi-character input cannot authorize confirmation.

The screen adapts to 80×24 and 40×12. Below 30×10 it asks for a larger terminal
and allows cancellation, but no confirmation. Long previews scroll; names and
paths remain editable even when wider than the viewport. External output is
sanitized for terminal escapes and invisible direction controls.

## Independent capabilities and compatibility

All seven nonempty combinations of Workspace, Memory, and Agent Harness are
supported. The explicit CLI selection is
`alfred setup --components=workspace,memory,harness`. Historical editions remain
compatible: `coding` maps to Agent Harness, `memory` to Memory, and `full` to
Agent Harness + Memory. Updating an existing installation never adds Workspace
implicitly. Release 1.1.0 does not include Workspace; these choices require a
later release that includes it, or the corresponding source build.

Only approved Apply writes product preferences to
`.alfred/setup/components.json` (`alfred.setup.components/v1`). Discovery and
preview do not write the preference file. The managed harness receipt remains
separate at `.alfred/setup/installation.json` (`alfred.setup.installation/v1`),
compatible with 1.1.0. The backend retains integration defaults separately, so
Update can refresh recorded harness files even after a Workspace-only selection.
Preference state does not prove that a harness has loaded its integration.

Selecting capabilities does not connect services, propagate credentials, create
Memory tenants, configure MCP, or install a Workspace session adapter. Memory
remains a local loopback service; its filesystem workspace bindings are distinct
from the Workspace application. Optional connections require explicit public
contracts and caller configuration. See [product capabilities](../../docs/product-capabilities.md).

## Updating an existing setup

Update reuses the saved harness selection. A Homebrew review names the current
and proposed stable versions; an explicit `y` returns control to the Node
launcher. It runs fixed Brew commands, checks the new executable's actual version,
and relaunches it from the original project. The old runtime never performs the
project update after Brew. The new session opens an integration preview; another
explicit confirmation is required before its files change.

The integration receipt stores managed baselines under
`.alfred/setup/installation.json`. Matching legacy 1.0.1 previews can establish a
baseline only after review. Personalized or missing managed files, ambiguous
previews, unsafe paths and retired artifacts stop the update with a conflict.
Unrelated Codex instruction text and OpenCode settings are preserved. An attempt
journal permits a failed update to be reviewed again without accepting edits made
after the failure. A partially updated project never claims the final version.

`ALFRED_SETUP_CHECK_UPDATES=0` disables the remote check, useful offline and in
isolated tests. Explicit flags, legacy UI and noninteractive execution keep their
local behavior. Source installations display available releases but do not run
Homebrew automatically. They may update the project from their current runtime.

## Build and checks

Go 1.21 or newer is required; release builds use the repository's pinned local
Go toolchain. Dependencies are pinned in go.mod/go.sum. Download only with
permission. For an isolated development cache:

```sh
cache_dir=$(mktemp -d /tmp/alfred-setup-go.XXXXXX)
export GOENV=off GOTOOLCHAIN=local
export GOPATH="$cache_dir/path" GOMODCACHE="$cache_dir/mod" GOCACHE="$cache_dir/build"
# Only after dependency-download approval:
go mod download
# Subsequent compilation and tests can remain offline:
GOPROXY=off go test -race ./...
GOPROXY=off CGO_ENABLED=0 go build -mod=readonly -trimpath -buildvcs=false -o "$cache_dir/alfred-setup" .
```

The production builder owns `dist/alfred-setup-{darwin,linux}-{arm64,amd64}`.
Generated executables are ignored by Git. `--version` reports the frontend
framework versions; `go version -m` verifies actual linked modules.

For direct development, use a real terminal and the trusted absolute paths:

```sh
"$cache_dir/alfred-setup" --backend-node "$(command -v node)"   --backend-script /absolute/alfred/scripts/setup/bridge.mjs
```

The frontend starts one child with argv, never shell evaluation. Its private
stdin/stdout carry `alfred.setup/v1` JSONL; terminal rendering uses stderr.
`discover` supplies local defaults/project state; `check-update` separately
checks release availability. `runtime-preview`/`runtime-approve` authorize the
launcher handoff (UI exit20). `project-preview`/`project-apply` reuse the saved
installation and have their own one-use confirmation; `project-decline` drops it.
`preview` supplies actual initial-setup text and an opaque
session token, and `apply` requires the same selection, token and explicit
confirmation. Successful preparation returns an `activation_review` and a new
one-use token. `activate` needs its own explicit confirmation; `decline` consumes
that token without live writes. Source bytes, target snapshots, project identity
and selection are bound to approval. A fresh generation directory and adapter
manifest exclude stale/extra previews; each write uses temporary-file rename.
Failed or partial activation reports what was written without claiming success.
Sanitized JSONL trace events report approval and verification with zero provider
calls. The backend remains the authority for validation, token binding
and installation. Child shutdown uses SIGTERM followed by a bounded fallback;
EOF or terminal signals cancel the UI. No Go installation, dependency download,
model selection or credential entry occurs at runtime.

Unit tests cover approval, navigation, Unicode, resize bounds and paste filtering.
Subprocess tests exercise actual JSONL pipes, malformed responses and cancellation.
The integration owner registers these checks and real packaged PTY smoke; model
render tests alone are not evidence of a successful installation.
