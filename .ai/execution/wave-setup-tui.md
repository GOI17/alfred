---
id: execution/wave-setup-tui
description: Replace interactive setup with Wave's Go terminal UI framework
owner: developer
phase: implementation-design
issue: 222
---

# Wave-style setup TUI

## Evidence and scope

Base main3257f808, one shared native worktree issue-222-wave-setup-tui.
Architect confirmed Wave uses Go/Bubble Tea0.25.0/Lip Gloss0.9.1, an Init/Update/View
loop, alternate screen, WindowSizeMsg, keyboard menus/pickers and Darcula palette
(background#2B2B2B, foreground#A9B7C6, orange#CC7832, blue#6897BB, gray#808080).
Wave's macOS-specific backend must not be imported; reuse the presentation model
and preserve attribution for copied MIT material. Go1.27.2 already exists locally.

Current setup.mjs invokes install.sh, forcing Node TUI for Homebrew. install.sh
stages discovery/pathfinder modules, supports Node/OpenTUI, validates quoted
assignment output, then executes its existing preview/apply workflow. The source
OpenTUI0.4.5 package is not bundled; runtime allowlist bundles the Node frontend.
Existing runtime smoke drives scripted Node events. Replace the default interactive
alfred setup experience with the confirmed Go framework, retaining explicit CLI
and automation compatibility. Do not migrate unrelated installers or core policies.

## R1: Frontend and backend ownership

Go frontend: packages/setup-tui/** (Developer1 only). Node JSONL bridge:
scripts/setup/bridge.mjs and tests; setup routing, packaging/build integration:
Developer integration owner. Shared worktree only; no second tree per specialist.
The frontend owns rendering, focus/navigation, resize, inputs and confirmation.
The backend owns validation, deterministic preview, exact approval binding and
existing install.sh execution. No core changes are needed. No model assignment,
secret entry or credentials are added to this setup UI.

## R2: JSONL session protocol

The UI accepts --backend-node PATH and --backend-script PATH and starts that fixed
executable/argument pair without shell evaluation. setup.mjs supplies trusted
absolute bundled paths. Keep one backend subprocess per UI session; one JSON
object per line on stdin/stdout. UI terminal rendering is separate from protocol.

Request: {schema:"alfred.setup/v1", id:string,
operation:"discover"|"preview"|"apply", selection?:Selection,
previewToken?:string, confirmed?:true}.
Response: {schema:"alfred.setup/v1", id:string, ok:boolean,
data?:object, error?:{code:string,message:string}}.
Selection: {edition:"coding"|"memory"|"full", harnesses:string[],
memory:"decide-later"|"existing-tenant"|"local-sqlite"|"postgres",
name:string, path:string, profiles:boolean}.
Harness IDs: opencode, codex-cli, codex-app, pi; empty array means none.
Discover data: {version:string, defaults:Selection,
capabilities:{platform:string,arch:string,node:string,harnesses:object},
packaged:boolean}. Preview data: {text:string,previewToken:string}.
Apply data: {text:string}. All displayed backend text must be terminal-safe.
Unknown fields/types/operations and oversized requests fail closed. EOF exits
promptly; errors do not disclose raw environment, secrets or stack traces.

## R3: Preview and apply

Initial/default action is preview. Reviewing options alone never authorizes writes.
Backend invokes existing installer with explicit argv and no interactive fallback
or downloads. Each successful preview creates a random session-only token bound
to exact normalized selection and current project/root context. Another preview
invalidates the token. Apply requires the same selection, token and confirmed:true,
consumes token before execution, and rejects stale/absent/replayed approvals.
UI shows the actual preview before offering explicit Apply and Cancel choices.
Editing selection invalidates approval. Cancel/EOF/errors never invoke apply.
Homebrew reuse of shared runtime remains --no-clone, with immutable installed-root
selection; no writes to shared binaries. Existing installer safety and per-project
managed-runtime consent remain authoritative; TUI does not create runtime grants.

## R4: Interaction and distribution

Keyboard-first screens with clear selected item, back/cancel, readable sections,
editable install/context name and source install path; packaged path is read-only.
Handle narrow terminals, Unicode, resize and terminal cleanup on exit. No
arbitrary raw control sequences in externally sourced labels/output.
Default interactive alfred setup launches bundled Go binary. Explicit no-TTY and
legacy automation continue existing deterministic CLI/Node behavior. Missing or
wrong-platform packaged binary fails clearly; do not silently fetch or pretend
Node is the requested UI. Native executables must be selected for supported
Darwin/Linux amd64/arm64 targets and included in runtime inventory/checksums.
Build with pinned modules, reproducible flags and CGO disabled; no runtime Go,
network fetch or toolchain installation. Keep existing Homebrew automation.

## R5: Permissions and verification

User authorized reading packages/core and .ai/harnesses ONLY in222; no writes.
.agents/.codex/.opencode permissions do not carry over. The user approved pinned Go module downloads and runtime npm lock staging in
isolated temporary caches; no global installed Alfred0.7.3/config/data mutation.
No baseline changes. Canonical architecture/TypeScript skills read.

Go model tests + actual PTY: navigate/edit/review/cancel/apply, resize, EOF and
cleanup. Bridge subprocess tests: exact token binding, no writes for preview,
malformed input, terminal safety and no shell interpolation. Real packaged smoke
must launch the Go binary; go version -m verifies pinned frameworks. Existing
CLI/setup and runtime tests remain registered. Reviewer/QA gates precede PR.

## Completion

- [x] Issue, single worktree, current inventory and Wave stack confirmed.
- [x] Disjoint ownership and JSONL protocol defined before code edits.
- [x] Approved isolated dependency staging, pinned Go module and four-target native build.
- [x] Frontend/backend/routing and package integration complete; final confirmation UX accepted.
- [x] Independent PTY/packaged smoke and security review pass.
- [ ] PR and evidence prepared; global installation unchanged.

## Integration evidence

The bridge clears inherited ALFRED_INSTALL_* overrides, executes explicit argv
with stdin ignored and --no-clone in both source and packaged modes, and keeps
stdout exclusively JSONL. One-use approval is invalidated on malformed previews,
changed selection, duplicate requests and cancellation. EOF/SIGTERM latch abort
before any refresh-to-apply transition; subprocess groups receive TERM then KILL.
Terminal strings strip ANSI and bidi controls; paths reject directional controls.

The existing installer now accepts --skip-profile-manager and a validated
--preview-output at the invoking project's .alfred/setup/previews. All generation,
handoff summaries and displayed paths use that root; adapter relative output is
computed from the immutable source root. Preview creates no directories; approved
apply creates review files only, never live harness files or runtime grants.
Legacy source installer behavior remains available explicitly.

Final broad Node run: npm test EXIT0,699 passed,2 optional skipped,0 failed;
19 release gates and legacy PTY checks PASS. Logs:
/tmp/alfred-222-full-test-final.log. Targeted backend/launcher/setup15/15 PASS
(/tmp/alfred-222-backend-tests.log). Temporary dependency/workspace links removed;
only the test-generated console build was restored. No baselines/protected source
changed. Prior validator wording mismatch was corrected to the current truthful
preview description; no coverage was removed.

The public installed0.7.3 program remains unchanged. This source change awaits a
new reviewed release; no asset publication, tap change or global setup occurred.

Final independent QA confirmation PTYs at80x24 and40x12 passed: Enter,
pasted y and multi-character yy produce zero applies; genuine y submits exactly
one unchanged selection/token with confirmed:true; repeated y does not duplicate.
Evidence: /tmp/alfred-222-qa-confirm/review.md and results.json.
Final actual-source archive SHA256:
fc46c3c16ae0e9e8f267e8465ac394a963699189fcf0bd174bab907ce5070824.
Real packaged Go default CLI PTY, Ctrl-C, alternate-screen/termios restoration,
untouched workspace, managed runtime, SQLite, MCP CRUD and live HTTP PASS;
external network attempts0/provider calls0. All four native target builds repeated
with identical hashes. Host binary SHA256:
19e596b008fde140f967c5eeddb82bc37209a99daa6758037eefbf3e8e240f9f.
The candidate is exploratory0.7.3, not a replacement for published0.7.3 assets.
