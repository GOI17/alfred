# Design: Guided Pathfinder Installer

Issue: #93

## Technical Approach

Replace the long form with a deterministic state machine while retaining the Node TUI as the terminal adapter and `install.sh` as the install-plan/apply authority. Extract pure recommendation, transition, and layout functions into a small sibling module; keep raw input, ANSI control, playback, and shell serialization in `install-app.mjs`. No core or harness adapter changes are needed.

| Decision | Tradeoff / rationale |
|---|---|
| One active phase per screen | Fits 80x24 and lowers cognitive load; revisiting choices takes a transition. |
| Recommendations use passed local signals only | Reproducible, provider calls remain zero, and no secrets/provider endpoints are probed. |
| TUI selects intent; shell performs effects | Preserves preview/approval boundaries and existing installer ownership. |
| In-memory decision traces before approval | Avoids pre-approval files; the existing applied-install trace remains the persistent record. |

## State Machine and Transitions

State contains `phase`, `decisions`, `recommendation`, `focus`, `overlay`, `history`, `done`, and `cancelled`.

```text
Discover --Use recommended--> Review --continue--> Apply --confirm--> exit
    | Customize                 | edit                    | back
    v                           v                         v
  Choose --next--> Configure --next-----------------> Review
```

`Why` opens a local explanation overlay and returns to its phase. `p` opens a full-preview overlay from every phase; `Esc`/`p` closes it. Back never discards edits. Apply offers preview-only and apply-safe-steps; `APPLY=true` is emitted only after explicit confirmation. Cancel exits 130. The TUI itself writes no install, profile, model, or harness files; its optional result file is IPC only.

## Deterministic Recommendation Rules

1. Accept valid current values as user-owned seeds; invalid values use existing fallbacks.
2. Recommend `coding` unless a valid current edition was supplied.
3. For `auto`, select every locally reported installed supported harness; if none, select `none`. Explicit harness selections remain unchanged.
4. Recommend `runtime-profiles` for coding/full; memory uses `not-needed-for-memory-edition`.
5. Recommend `decide-later` for Memory in memory/full; coding uses `not-needed-for-coding-edition`.
6. Preserve name/path seeds; otherwise derive the existing defaults. Preview-only remains the execution default.
7. Guidance may state that users own per-agent **primary** overrides plus one global fallback chain. It must not select model IDs or claim per-agent fallback defaults.

Each result includes reason codes and an in-memory `installer_recommendation_computed` event with `provider_calls: 0`; apply continues to persist the existing `install_management_operation` trace.

## Responsive Rendering

At 80x24, render a one-line title/progress marker, concise guidance, only the active controls, one-line persistent preview, and two-line key help. Truncate by ANSI-aware display width; scroll long option lists and the full-preview overlay. At widths >=100, show all phase names and a two-column body (choices left, rationale right). Mouse hit regions come from rendered blocks, not fixed row arithmetic. Keyboard operation remains complete without mouse.

## Compatibility Strategy

Preserve `ALFRED_INSTALL_APP_TUI_EVENTS`, `..._SCRIPT`, `..._RENDER`, `..._RESULT_FILE`, all current-input variables, and tokens `up/down/left/right/space/enter/backspace/text:*`, `set:*`, `mouse:*`, and `submit`. `set:*` patches canonical decisions independent of phase; `submit` immediately serializes for legacy playback. Keep a playback-only legacy mouse-coordinate map while interactive mouse uses layout hit regions.

Output remains shell-quoted assignments for `EDITION`, `HARNESS`, `PROFILE_STRATEGY`, `MEMORY_SETUP`, `NAME`, `APPLY`, `SKIP_PROFILE_MANAGER`, `TUI_USED`, `TUI_MODE='app'`, plus optional `TARGET_PATH`. No model assignment or harness config is emitted.

## File Changes

| File | Action |
|---|---|
| `scripts/tui/install-pathfinder.mjs` | Create pure recommendations, reducer, preview model, and responsive layout. |
| `scripts/tui/install-app.mjs` | Replace form navigation with phase orchestration; retain terminal/playback/assignment adapters. |
| `scripts/validate-suite-installer.mjs` | Extend playback, 80x24/wide rendering, transition, mouse, safety, and contract assertions. |
| `install.sh` | No planned behavior change; only adjust if integration exposes a launcher regression. |

## Interfaces / Contracts

`recommend({ current, harnessStatus }) -> { decisions, reasons, providerCalls: 0 }`; `transition(state, action) -> state`; `render(state, { columns, rows }) -> { text, hitRegions }`; `serializeAssignments(decisions) -> string`. Recommendations and rendering are pure. Terminal dimensions may be overridden in playback tests, never as install decisions.

## Testing Strategy

- Pure tests: every recommendation branch, phase/back/overlay transitions, conditional Memory/profile fields, and no implicit apply.
- Rendering: snapshots/invariants at 80x24 and wide sizes; no overflow; persistent preview and keyboard copy always present.
- Compatibility: replay existing event strings and exact required assignments, quoting, optional path, result-file behavior, and legacy mouse case.
- Integration: run `npm run validate:suite-installer`; assert preview creates no `~/.alfred` or project files and provider calls are zero.

## Rollout and Open Questions

Ship behind no new flag: playback and non-TTY fallback remain unchanged. Revert by restoring the current app TUI; shell behavior is unaffected.

- Should narrow-terminal full preview paginate or scroll continuously? Recommend paging for deterministic tests.
- Persistent pre-approval traces conflict with “no files before approval”; this design keeps them in memory. Confirm whether stderr JSON tracing is desired later.
