# Alfred setup TUI

Keyboard-first setup using Bubble Tea **0.25.0** and Lip Gloss **0.9.1**,
with Wave's spacious Darcula presentation. See [NOTICE](NOTICE) for attribution
and [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt) for linked module notices.

Run `alfred setup` from the project you want to configure. Choose Coding,
Memory or Full, select coding tools, choose memory settings when applicable,
and review the setup name, installation location and runtime profiles.
The shared packaged installation location is read-only; it is distinct from
the current project. The UI does not create managed-runtime consent grants.

Menus use arrows or j/k; Space toggles coding tools. Text fields preserve
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
`discover` supplies defaults, `preview` supplies actual text and an opaque
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
