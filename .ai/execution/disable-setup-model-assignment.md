---
id: execution/disable-setup-model-assignment
description: Disable model assignment in alfred setup while preserving standalone runtime model assignment.
phase: issue-134-disable-setup-model-assignment
author: core
issue: 134
---

# Disable model assignment during Alfred setup

## Goal

Remove model-assignment decisions and effects from `alfred setup` without
changing Alfred's user-owned model-assignment domain, profile, or adapter APIs.

## Context

The guided setup currently detects model capabilities, presents strategy and
editing controls, previews an exact `~/.alfred/models.json`, transports model
approval through setup IPC, and may atomically write the file. Issue #134
temporarily removes that responsibility from setup only. Existing standalone
runtime and update/reconfiguration capabilities remain supported.

## Requirements

### R1: Setup state and presentation

1. Node and OpenTUI setup backends must not prompt for, display, preview, edit,
   inspect, or approve model assignment.
2. Setup phases, focus order, summaries, Review, Apply, overlays, and serialized
   results must omit all model-assignment content.
3. Local discovery may retain its versioned schema for compatibility, but setup
   must not use discovered model data to create a model decision or plan.

### R2: Setup IPC and write boundary

1. Setup result IPC must not emit or accept `MODEL_STRATEGY`,
   `MODEL_WRITE_APPROVED`, or `MODEL_PLAN_SHA256`.
2. `alfred setup` must not allocate, preview, approve, validate for application,
   create, replace, or otherwise modify `~/.alfred/models.json`.
3. Existing model files must remain byte-for-byte unchanged after preview,
   cancellation, and apply; absent model files must remain absent.
4. Legacy or malicious setup output containing model-assignment fields must fail
   closed as unexpected IPC.

### R3: Preserve non-setup model assignment

1. Do not modify `packages/core` or its model-assignment exports.
2. Do not modify profile-manager or harness-adapter model resolution APIs.
3. Keep standalone update/reconfiguration behavior outside `alfred setup`
   available and unchanged.

### R4: Verification and documentation

1. Add focused pure-state, Node backend, OpenTUI, shell integration, and
   `alfred setup` regression coverage.
2. Update setup-facing documentation to state that setup leaves model assignment
   unchanged and never writes `~/.alfred/models.json`.
3. Run focused tests plus repository checks and validators relevant to setup.
4. Record a direct-execution delegation decision and local-only provider decision
   with `provider_calls: 0`.

## Completion Conditions

- [x] Node setup has no model-assignment controls, previews, overlays, or output.
- [x] OpenTUI setup has no model-assignment controls, previews, overlays, or output.
- [x] Setup IPC rejects model-assignment fields and cannot approve a model plan.
- [x] Setup apply never creates or modifies `~/.alfred/models.json`.
- [x] Non-setup model-assignment APIs and reconfiguration remain unchanged.
- [x] Setup-facing documentation reflects the disabled step.
- [x] Focused tests, checks, and validators pass with provider calls at zero.

## References

- Issue: https://github.com/GOI17/alfred/issues/134
- Setup command spec: `.ai/execution/alfred-setup-command.md`
- Guided installer spec: `.ai/execution/complete-guided-pathfinder/design.md`
- OpenTUI spec: `.ai/execution/opentui-installer/design.md`
- Model-assignment design: `.ai/execution/model-assignment-per-agent/design.md`
- Node setup state: `scripts/tui/install-pathfinder.mjs`
- OpenTUI setup adapter: `packages/installer-tui/src/installer-opentui.mjs`
- Setup shell authority: `install.sh`
