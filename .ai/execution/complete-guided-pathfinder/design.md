---
id: execution/complete-guided-pathfinder/design
description: Complete the guided installer with full local discovery, model setup, and responsive hierarchy.
phase: phase-13-install-management
author: architect
issue: 95
---

# Design: Complete Guided Pathfinder

## Technical Approach

Keep `install.sh` as discovery/apply authority and the TUI as a pure decision adapter. Before launch, the shell creates a mode-`0700` private directory containing a mode-`0600` versioned discovery JSON. `install-app.mjs` reads it and passes validated data to `install-pathfinder.mjs`; no discovery or preview file survives preview/cancel. Smart defaults come from `detectMachineModels()` and `buildSmartModelDefaults()`, without provider requests.

## Architecture Decisions

| Decision | Choice and rationale |
|---|---|
| Discovery boundary | `install.sh` invokes a local Node discovery helper and passes `ALFRED_INSTALL_DISCOVERY_FILE`; a file avoids environment-size/quoting risks. Curl bootstrap downloads the helper and canonical package modules into the private directory, preserving core/profile ownership instead of duplicating model policy in the TUI. |
| Model ownership | TUI selects `smart-defaults`, `custom-models`, `keep-existing`, or `configure-later`. IDs come only from local detection or editable user input; Alfred never invents them. Installer output is a wildcard primary, optional orchestrator/developer primary overrides, and one global fallback chain—never per-agent fallback chains. |
| Write gate | `~/.alfred/models.json` is written only when an interactive Review was visited for the current model plan, Apply explicitly confirmed, `APPLY=true`, and `MODEL_WRITE_APPROVED=true`. Existing config defaults to “Keep existing”; replacement is named on Apply. |
| Explanation semantics | Preserve immutable recommendation reasons, but render rationale from current decisions. Changed fields say “Changed from recommendation; your selection is respected,” never reuse stale recommendation claims or infer user intent. |

## Data Flow and Contracts

```text
install.sh -> private discovery.json -> TUI decisions -> validated assignments
     -> shell revalidates plan -> explicit Apply -> atomic models write/install
```

Discovery schema `alfred.install.discovery/v1` contains:

- `os`: platform, release, architecture;
- `node`: status, version, major, required major;
- `harnesses`: existing installed/not-installed map;
- `models`: sanitized `suggestions`, proposed config, validation status;
- `install`: Alfred-home, selected-target, and models-config existence;
- `git`: availability, workspace root, project root, repository state, linked-worktree state;
- `provider_calls: 0`.

Only environment-variable **names**, socket paths, and model suggestions are recorded—never credential values. Missing/invalid schema fields become `unknown`; legacy harness status remains a fallback.

Existing assignments remain unchanged. Add optional shell-quoted `MODEL_STRATEGY`, `MODEL_WRITE_APPROVED`, and `MODEL_PLAN_SHA256`; old TUI output defaults them to `configure-later`/`false`/empty. Add all three to the strict allow-list and duplicate-key checks, with enum/boolean/digest validation. Do not IPC proposed JSON, model IDs, plan paths, or executable module paths.

The shell validates proposed config with `validateModelsConfig`, writes a same-directory temporary file with mode `0600`, then renames it atomically. Failure removes the temporary file and leaves existing config untouched. Emit `model_assignment_configured` and `provider_request_avoided`; install trace records approval and `provider_calls: 0`.

## Compatibility and Security

Preserve playback tokens, current-input variables, result-file behavior, text/non-TTY fallback, and existing assignment meanings. Discovery is read-only and local; model assignment remains user-owned. No provider endpoint is contacted, no secret value is captured, and no live harness or protected project config is modified.

`ALFRED_INSTALL_APP_TUI_LAYOUT` accepts `fullscreen` or `inline`. Missing and unknown values normalize to `fullscreen` for compatibility. This is an installer environment selector, not a new global Alfred CLI option. Playback remains deterministic and exposes the selected normalized layout without requiring a TTY. Normal shell environment inheritance carries the selector through `install.sh`; no executable path or unvalidated value is added to result IPC.

Fullscreen retains the alternate-screen, raw-mode, hidden-cursor, and SGR mouse lifecycle. It clears only the alternate screen while active, disables mouse reporting and leaves the alternate screen on every completion, cancellation, signal, or error path. Rendering always owns at most `max(0, rows - 1)`: `rows=0` and `rows=1` render empty text with no exceptions, while `rows>=2` may use at most `rows - 1` even for the minimal resize status. The physical last terminal row is therefore preserved exactly.

Inline retains raw keyboard navigation but never enters the alternate screen, enables mouse reporting, or emits a whole-terminal clear. It hides/restores the cursor and owns only its natural compact row range. Redraw starts from the current owned final row, moves up by at most the prior owned height, erases each owned line, renders the new content, and clears stale owned rows when a render shrinks. Resize and cleanup calculate prior physical rows by placing ANSI-free grapheme clusters into terminal columns: wide CJK and emoji graphemes move intact to the next row when they do not fit, and combining/ZWJ sequences use the same widths as display rendering. This relative ownership protocol cannot address terminal history above the first owned row. Completion, cancellation, SIGINT/SIGTERM/SIGHUP, and errors restore raw/cursor state and erase transient owned rows when the output stream remains writable, allowing installer output to continue at that location. Mouse input is intentionally disabled in inline mode so screen-relative coordinates cannot trigger incorrect actions.

## Presentation

Controls are edition-derived: Coding hides Memory; Memory hides Profiles and Models; Full shows all. Previews also omit inapplicable rows—internal sentinels such as `not-needed-for-coding-edition` never reach users. Central label maps render “Coding,” “Runtime profiles,” “Use detected smart defaults,” etc.; reducers and IPC retain stable enums.

At 80x24, use one ANSI-bordered active panel, compact discovery summary, persistent preview, and one help line without overflow. At width >=100, use bordered two-column panels for choices/discovery and current rationale. ANSI-aware clipping/padding ignores SGR bytes. Cyan marks focus, green safe/detected, yellow changed/approval, red blockers; text and borders retain meaning with `NO_COLOR` or non-TTY output.

Fullscreen keeps compact panels at the top, anchors status/preview/help near the bottom, and reserves one untouched terminal row below the help line. Inline places status/preview/help immediately after the panels with no vertical filler. Both footers identify the normalized layout when it fits the existing single-line footer budget.

Invoke inline mode for a local installer path with:

```sh
ALFRED_INSTALL_APP_TUI_LAYOUT=inline ALFRED_INSTALL_FORCE_TUI=1 sh /path/install.sh
```

## Files and Tests

| File | Change |
|---|---|
| `install.sh` | Build/pass discovery, validate additive IPC, gate and atomically write models, trace. |
| `scripts/tui/install-discovery.mjs` | New local probe using profile-manager/core exports. |
| `scripts/tui/install-app.mjs` | Validate discovery input; preserve terminal/playback behavior; own fullscreen and inline terminal lifecycles. |
| `scripts/tui/install-pathfinder.mjs` | Conditional controls, model decisions, dynamic rationale, labels, ANSI panels, and layout-aware pure rendering. |
| `scripts/tui/install-pathfinder.test.mjs` | State, labels, rationale-after-edit, model shape, grapheme-aware physical rows, natural inline height, strict zero-row fullscreen behavior at `rows<=1`, and 80x24 tests for both layouts. |
| `scripts/validate-suite-installer.mjs` | OS/Node/provider/install/git fixtures; legacy IPC; both PTY lifecycles plus CJK/emoji resize and cleanup; preview/cancel no-write; existing-config protection; confirmed atomic write and traces. |

Reuse existing profile-manager/core tests as contract gates. `scripts/shell/install.sh` remains a compatibility reference, not a second implementation. Run `npm run profile-manager:test`, `npm run core:test`, and `npm run validate:suite-installer`. No migration, harness-config write, provider call, or open design question.

## Addendum: Manual Model Assignment

This addendum supersedes the earlier three-strategy and discovery-only model-plan details for issue #95 / PR #97.

### Contract and behavior

`custom-models` is an additive stable `MODEL_STRATEGY` value. In Coding and Full editions, Configure offers:

- wildcard/global primary (required for `custom-models`);
- optional orchestrator primary override;
- optional developer primary override;
- one ordered global fallback chain.

The resulting config is limited to `*`, `orchestrator`, `developer`, and top-level `fallbacks`. Empty overrides are omitted. The editor never creates `orchestrator.fallbacks`, `developer.fallbacks`, or any other per-agent fallback chain, and it contains no built-in model IDs. Local smart defaults may seed the draft; without model signals the draft is empty and Configure offers both **Enter custom models** and **Configure models later**, with `configure-later` remaining the no-write recommendation. Existing behavior remains: `smart-defaults` is offered only with a valid detected primary, `keep-existing` only when a config exists and remains the default then, and `configure-later` is always available. Memory edition and legacy text/non-TTY fallback remain unchanged.

Model IDs follow the canonical core contract: strings must be non-empty after trimming for the emptiness check and contain no C0/DEL control characters. Provider-qualified values such as `anthropic/claude-sonnet-4` and `ollama/qwen2.5-coder:7b` are opaque; do not split, resolve, allow-list, contact, or rewrite them. The plan shape rejects unknown keys and entry-level `fallbacks`, then `validateModelsConfig()` is still the authoritative semantic validator.

### Private plan transport and gate

The shell allocates a fixed mode-`0600` path such as `$APP_TUI_PRIVATE_DIR/model-plan.json` and passes it as `ALFRED_INSTALL_MODEL_PLAN_FILE`. The path is never returned by the TUI, accepted from result IPC, or stored inside the plan:

```json
{"schema":"alfred.install.model-plan/v1","strategy":"custom-models","models":{"*":{"primary":"user/provider-model"},"fallbacks":[]},"provider_calls":0}
```

The TUI accepts only the fixed `model-plan.json` name in a mode-`0700`, effective-uid-owned, non-symlink private directory. It rejects unsafe existing targets, writes exact plan bytes through a mode-`0600` `O_EXCL` sibling temporary file, fsyncs, and renames. Raw IDs and paths never enter shell assignments. For an approved custom apply only, result IPC adds `MODEL_PLAN_SHA256`, exactly 64 lowercase hexadecimal characters containing SHA-256 of those exact renamed plan bytes. The strict allow-list rejects duplicate, malformed, or unexpected digests. Missing digest remains backward compatible for old/non-custom output, but an approved `custom-models` apply requires it.

Configure and full Preview show the draft. Custom Review exposes a dedicated **Inspect exact models.json** overlay containing the exact pretty-printed canonical target JSON, with ordered fallbacks and content-preserving wrapping/pagination at 80x24. State records the model revision, pagination shape, and pages displayed. Review shows `not inspected`, `pages x/y`, or `inspected`; approval is unavailable until every page for the current revision has been displayed. Continue remains blocked until the current custom revision is valid, fully inspected, and explicitly approved. Any model edit or strategy change increments/changes the revision and clears inspected pages, approval, and stale Review/Apply eligibility. Apply may serialize approval and the digest only when Review covered that current revision and the user explicitly chose apply. Smart-default behavior remains unchanged.

For custom apply, one Node authority process verifies the expected fixed parent/name, directory and plan ownership, non-symlink type, and exact private modes. It opens the plan once with `O_NOFOLLOW` where available, checks the opened fd with `fstat`, reads once from that fd, hashes the exact bytes, and constant-time compares the IPC digest before parsing. It rejects unknown schema keys, calls staged canonical `validateModelsConfig()`, and writes those already-validated values to `~/.alfred/models.json` through a same-directory mode-`0600` `O_EXCL` temporary file, fsync, and rename without reopening the plan pathname. Validation, substitution, digest, ownership, mode, or symlink failures preserve the prior target. The shell independently requires app mode, `APPLY=true`, `MODEL_WRITE_APPROVED=true`, and a valid strategy-specific config. Preview-only, cancel, missing/tampered plans, `keep-existing`, and `configure-later` never write. Private discovery/plan files are removed on every exit.

### Interaction, sanitization, and persistence

Both fullscreen and inline layouts use the same editor reducer. Up/Down traverses fields and fallback rows; Enter enters/commits text editing; Left/Right moves a grapheme-safe cursor while editing and retains enum behavior otherwise; Backspace/Delete edit; Escape cancels the field draft before performing phase navigation. Fallback Add/Remove/Move controls preserve explicit order without comma-delimiting opaque IDs. Fullscreen mouse hit regions may focus controls; inline remains keyboard-only. Input and playback reject newlines, terminal control strings, ESC/C1 sequences, and invalid code points before state or plan persistence; all rendering still passes through terminal-output sanitization.

Opaque IDs use trimming only to test emptiness. Valid leading/trailing ordinary spaces are preserved in editor state, canonical config, exact Review, private plan, preview JSON, digest-bound apply, and the final target. Optional whitespace-only overrides are omitted; the required wildcard and every fallback remain invalid when whitespace-only.

After the gate, emit `model_assignment_configured`, `provider_request_avoided`, and an install trace with strategy, approval, and `provider_calls: 0` only after the corresponding outcome.

Tests cover no-signal availability, all four strategy combinations, optional overrides/global fallback ordering, exact whitespace preservation, opaque provider-qualified and shell-metacharacter IDs, invalid/control input, plan ownership/mode/symlink/tamper rejection, digest absence/malformed/duplicate/unexpected/mismatch cases, no IDs or paths in result IPC, multi-page exact inspection and revision invalidation, Review/Apply gating, cancel/preview/keep no-write behavior, fd-based atomic replacement/failure cleanup, private-directory cleanup, and zero provider calls. Pure TUI tests cover grapheme cursor routing, every model field, fallback controls, content-preserving exact JSON wrapping, and all pages at 80x24. Real PTY coverage navigates the full editor in fullscreen and inline; installer integration reuses the canonical core validator and verifies the exact reviewed JSON is written.
