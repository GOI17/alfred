---
id: execution/setup-settings-review
description: Keep the final alfred setup review actionable inside the guided TUI.
phase: issue-136-setup-settings-review
author: core
issue: 136
---

# Alfred setup settings review

## Goal

Make the final interactive settings review a complete decision surface. A user
must be able to apply the reviewed safe steps, finish with a preview only,
return to edit choices, or cancel without leaving the TUI to discover what to
do next.

## Context

The recommended path currently selects the preview-only execution intent. From
Review, the default Continue and Confirm actions finish that preview, exit the
TUI, and print the full install plan in the shell. The behavior is safe and
writes no files, but accepting the reviewed changes requires backtracking to an
execution-intent field in Configure. That acceptance path is not discoverable
from the final review itself.

## Requirements

### R1: Cohesive interactive review

1. Review must remain a Pathfinder phase owned by both the Node and OpenTUI
   terminal adapters.
2. Review must present explicit actions to apply the reviewed safe steps, keep
   the result preview-only, edit the configuration, and cancel setup.
3. The apply action must set apply intent explicitly and continue to the
   existing final confirmation phase; it must not itself perform writes.
4. The preview action must likewise continue to final confirmation without
   performing writes.
5. Back from final confirmation must return to Review with the reviewed choices
   intact.

### R2: Approval and cancellation safety

1. No install, profile, model, or live harness file may be written from Review.
2. `APPLY=true` may be serialized only after Review was visited and the user
   explicitly confirms apply in the final confirmation phase.
3. Cancel from Review or final confirmation must end with status 130 and emit
   no result assignments.
4. Custom model validation, exact-plan inspection, revision binding, and model
   write approval remain prerequisites for applying a custom model plan.

### R3: Compatibility

1. Existing non-interactive flags and preview-first defaults remain unchanged.
2. Existing playback `CONTINUE` behavior and result assignment names remain
   compatible.
3. Both the dependency-free Node backend and OpenTUI backend must expose the
   same review decisions through the shared Pathfinder transition function.

### R4: Traceability and local execution

1. The selected Review outcome is recorded as an in-memory TraceEvent with the
   action, explicit-approval state, and `provider_calls: 0`.
2. Applied setup continues to persist the existing install-management and
   provider-request-avoided trace events.
3. Deterministic setup review performs zero provider calls.

### R5: Regression coverage

1. Pure Pathfinder tests cover apply, preview-only, edit/back, cancel, and the
   two-step approval boundary.
2. Node and OpenTUI rendering tests assert that all Review actions are visible
   and correctly labelled.
3. Suite installer validation reproduces the former recommended-preview exit
   path and verifies the new explicit apply path while preserving no-write
   preview behavior.

## Completion conditions

- [x] Recommended setup exposes apply directly from Review.
- [x] Apply still requires a separate explicit confirmation.
- [x] Preview-only, edit/back, and cancel remain available in the TUI.
- [x] Non-interactive setup output remains compatible.
- [x] Provider calls remain zero and required traces are preserved.
- [x] `pnpm test`, `pnpm check`, and relevant validators pass.

## References

- Issue: https://github.com/GOI17/alfred/issues/136
- Pathfinder state machine: `scripts/tui/install-pathfinder.mjs`
- Node terminal adapter: `scripts/tui/install-app.mjs`
- OpenTUI adapter: `packages/installer-tui/src/installer-opentui.mjs`
- Installer authority: `install.sh`
- Existing guided design: `.ai/execution/guided-pathfinder-installer/design.md`
- Install policy: `.ai/instructions/install-management.md`
