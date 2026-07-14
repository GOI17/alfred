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
| Model ownership | TUI selects `smart-defaults`, `keep-existing`, or `configure-later`; it never invents IDs. Canonical output is wildcard primary/fallbacks, one global fallback chain, and only orchestrator/developer primary overrides when selected by the core builder—never per-agent fallback defaults. |
| Write gate | `~/.alfred/models.json` is written only when an interactive Review was visited, Apply explicitly confirmed, `APPLY=true`, and `MODEL_WRITE_APPROVED=true`. Existing config defaults to “Keep existing”; replacement is named on Apply. |
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

Existing assignments remain unchanged. Add optional shell-quoted `MODEL_STRATEGY` and `MODEL_WRITE_APPROVED`; old TUI output defaults them to `configure-later`/`false`. Add both to the strict allow-list, duplicate-key checks, and enum/boolean validation. Do not IPC proposed JSON or executable module paths.

The shell validates proposed config with `validateModelsConfig`, writes a same-directory temporary file with mode `0600`, then renames it atomically. Failure removes the temporary file and leaves existing config untouched. Emit `model_assignment_configured` and `provider_request_avoided`; install trace records approval and `provider_calls: 0`.

## Compatibility and Security

Preserve playback tokens, current-input variables, result-file behavior, text/non-TTY fallback, and existing assignment meanings. Discovery is read-only and local; model assignment remains user-owned. No provider endpoint is contacted, no secret value is captured, and no live harness or protected project config is modified.

## Presentation

Controls are edition-derived: Coding hides Memory; Memory hides Profiles and Models; Full shows all. Previews also omit inapplicable rows—internal sentinels such as `not-needed-for-coding-edition` never reach users. Central label maps render “Coding,” “Runtime profiles,” “Use detected smart defaults,” etc.; reducers and IPC retain stable enums.

At 80x24, use one ANSI-bordered active panel, compact discovery summary, persistent preview, and footer without overflow. At width >=100, use bordered two-column panels for choices/discovery and current rationale, filling available height. ANSI-aware clipping/padding ignores SGR bytes. Cyan marks focus, green safe/detected, yellow changed/approval, red blockers; text and borders retain meaning with `NO_COLOR` or non-TTY output.

## Files and Tests

| File | Change |
|---|---|
| `install.sh` | Build/pass discovery, validate additive IPC, gate and atomically write models, trace. |
| `scripts/tui/install-discovery.mjs` | New local probe using profile-manager/core exports. |
| `scripts/tui/install-app.mjs` | Validate discovery input; preserve terminal/playback behavior. |
| `scripts/tui/install-pathfinder.mjs` | Conditional controls, model decisions, dynamic rationale, labels, ANSI panels. |
| `scripts/tui/install-pathfinder.test.mjs` | State, labels, rationale-after-edit, model shape, ANSI width, 80x24/wide tests. |
| `scripts/validate-suite-installer.mjs` | OS/Node/provider/install/git fixtures; legacy IPC; preview/cancel no-write; existing-config protection; confirmed atomic write and traces. |

Reuse existing profile-manager/core tests as contract gates. `scripts/shell/install.sh` remains a compatibility reference, not a second implementation. Run `npm run profile-manager:test`, `npm run core:test`, and `npm run validate:suite-installer`. No migration, harness-config write, provider call, or open design question.
