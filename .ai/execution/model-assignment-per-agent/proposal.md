---
id: execution/model-assignment-per-agent/proposal
description: Proposal for OpenCode resolved-model emission and inheritance
owner: core
phase: proposal
---

# Proposal: OpenCode Model Inheritance

Issue: [#173](https://github.com/GOI17/alfred/issues/173)

## Intent

Make generated OpenCode artifacts honor a user-resolved per-agent primary model without disabling OpenCode's active-model inheritance when no assignment resolves.

## Scope

### In Scope

- Use generated `.opencode/agents/<id>.md` as the single native agent definition.
- Emit a resolved primary as quoted YAML `model`; omit `model` when unresolved.
- Remove custom top-level `model_assignment` from generated `opencode.json`; add no parallel JSON agent bindings.
- Cover resolved, unresolved, policy, and zero-provider-call behavior with adapter tests.
- Repair the Memory OpenAPI test parser's handling of existing folded descriptions,
  as authorized by the user to unblock repository verification.

### Out of Scope

- Core resolution precedence, profile/installer configuration, Codex behavior, baselines, or harness config writes.
- Native OpenCode fallback enforcement; fallback chains remain Alfred runtime behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-agent-generation`: represent a resolved primary in agent markdown while preserving unresolved inheritance.

## Approach

Select the resolved assignment by agent id during preview generation. Pass its primary into markdown rendering, quote it in YAML when present, and otherwise render no `model` key. Keep `opencode.json` limited to consumed OpenCode configuration.

## Affected Areas

| Area | Impact |
|---|---|
| `packages/opencode-adapter/src/runtime.js` | Modified generation |
| `packages/opencode-adapter/test/runtime.test.mjs` | Modified regression coverage |

## Risks

| Risk | Mitigation |
|---|---|
| Unsafe YAML or wrong-agent binding | Quote values and test agent-id mapping. |
| Accidental fallback claim | Assert no fallback/custom binding in native artifacts. |

## Rollback Plan

Revert the adapter and its paired tests; generated previews are non-live artifacts and require approval before installation.

## Success Criteria

- [x] Resolved and unresolved scenarios pass.
- [x] `opencode.json` has no custom/parallel model binding.
- [x] Source agent specs contain no hardcoded models.
- [x] Generation makes zero provider calls and focused tests/checks pass.
