---
id: execution/setup-contextual-help
description: Hide setup explanations until requested and clarify visible Discover and Choose controls.
owner: core
phase: issue-191-setup-contextual-help
issue: 191
---

# Setup contextual help

## Goal
Reduce default setup clutter and explain visible settings on demand.

## Requirements

### R1: Contextual help
- Hide “What this configuration changes” by default in every step and at every terminal size.
- `?` toggles the explanation for the current step; Escape dismisses it. Entering another step starts with help hidden.
- Discover help explains the recommended setup. Choose help describes all available editions, when to use each, and the enabled/skipped Runtime Profiles choices.
- Other steps explain their visible settings and actions, without showing unrelated settings.
- Keep Node and OpenTUI behavior consistent, including compact layouts and keyboard navigation.

### R2: Discover
- Remove the `[r]` suffix/prefix from the “Use recommended setup” label.
- Keep the existing `r` keyboard action compatible.
- Hide the Memory connection status row without changing discovery or recommendations.

### R3: Choose
- Display an obvious alternatives indicator (left/right arrows) on Edition, keeping the current value legible.
- Preserve existing edition selection behavior.

### R4: Safety and verification
- Preserve preview/apply approval gates and model setup exclusion.
- Deterministic setup must make zero provider calls.
- Cover help visibility/toggling/reset, contextual content, Discover labels, and Edition indicators in both renderers with focused regression tests.
- Run relevant tests, checks, and suite installer validation; report any unrelated failures.

### R5: Bottom indicators and vertical keyboard hints
- Remove the bottom Phase/layout/provider-calls status row and Preview summary row. Remove equivalent bottom status/safety summaries in OpenTUI.
- Render keyboard hints directly below the main container, with one shortcut/action per line under a Keys label. No bottom anchoring separated from the panel by viewport filler.
- Use contextual hints for normal navigation, text editing, and overlays; preserve `?` and existing shortcuts.
- Keep overlay page numbers visible in the panel heading/subtitle after removing the status row.
- Reserve actual space for the vertical list so focused controls remain reachable and help/preview pages remain fully readable, including 80x24 and narrow supported sizes.
- Apply consistently to Node inline/fullscreen, OpenTUI frame, and the native OpenTUI renderer. Preserve header/step navigation and the wide view's separate live preview panel.

### R6: Hints follow the focused control
- Compute keyboard hints from the currently focused control, not just the phase.
- Selectors show change actions; harness checkboxes show toggle actions; name/path fields show edit actions; buttons show their activation action.
- Do not advertise keys that are no-ops on the focused control, including Enter on selectors under current handlers.
- Preserve applicable global shortcuts and contextual editing/overlay hints. Refresh immediately after keyboard or mouse focus changes.
- Keep both renderers on the shared hint list, preserving vertical placement and dynamic height, pagination, and approval gates.

### R7: Consistent selector indicators
- Show the same left/right arrow indicators as Edition around the current Profiles value in Choose and Intent value in Configure.
- Apply to Node and OpenTUI; preserve values, change markers, focus-specific keys, and selection behavior.

### R8: Focused and grouped configuration explanations
- Remove Provider calls from the contextual What this configuration changes view in every step.
- Read-only help/preview overlay Keys show only Pages and Close; preserve dynamic keys in the underlying steps and editing mode.
- Choose help groups edition descriptions under Editions (Coding, Memory, Full) and applicable profile descriptions under Runtime profiles (Enabled, Skipped), with visibly indented list items. Remove Harnesses and Continue from Choose help.
- Configure help displays Install name derived from the final directory segment of the effective target path, including explicit custom paths and trailing separators. This is an explanation display change; do not alter saved name or path decisions.
- Configure help removes Continue and labels execution intent as Intent.
- Preserve help paging, readable grouping across wrapped lines, full content accessibility in both renderers, and existing approval behavior.

## Completion conditions
- [x] R8 explanation content and overlay Keys are implemented and verified.
- [x] R7 selector indicators are rendered and verified in both adapters.
- [x] R6 focus-specific hints are implemented and regression-checked.
- [x] R5 is implemented and regression-checked in both renderers.
- [x] Both renderers satisfy R1–R3.
- [x] Focused Pathfinder/OpenTUI regression tests and syntax checks pass.
- [ ] Full suite and installer validator: awaiting protected-path read authorization.
- [x] Draft PR #192 links Closes #191.

## References
- Issue: https://github.com/GOI17/alfred/issues/191
- Draft PR: https://github.com/GOI17/alfred/pull/192
- Prior spec: `.ai/execution/setup-onboarding-explanations.md`
- Shared state machine: `scripts/tui/install-pathfinder.mjs`
- OpenTUI renderer: `packages/installer-tui/src/installer-opentui.mjs`
