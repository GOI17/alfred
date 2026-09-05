---
id: execution/model-assignment-per-agent/tasks
description: Atomic implementation tasks for issue 173
owner: core
phase: tasks
---

# Tasks: OpenCode Model Inheritance

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | Approximately 550 including SDD docs, adapter, and parser repair |
| 400-line budget risk | Exceeded, primarily by SDD documentation |
| Chained PRs recommended | No |
| Suggested split | Single cohesive PR |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Exceeded, primarily by SDD documentation

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Agent markdown contract plus regression coverage | PR 1 | Keep tests and implementation atomic. |

## Phase 1: RED — Contract Tests

- [x] 1.1 In `packages/opencode-adapter/test/runtime.test.mjs`, replace custom `opencode.json.model_assignment` expectations with a resolved-primary scenario asserting quoted YAML in only the matching agent markdown.
- [x] 1.2 Add an unresolved scenario asserting every unassigned agent omits `model` and the preview reports `provider_calls: 0`.
- [x] 1.3 Assert generated `opencode.json` has neither `model_assignment` nor parallel agent bindings, fallbacks are absent from native artifacts, and `.ai/agents/*.md` remain model-agnostic.

## Phase 2: GREEN — Adapter Generation

- [x] 2.1 In `packages/opencode-adapter/src/runtime.js`, map resolved assignments by `agent_id` and pass the matching primary to agent markdown rendering.
- [x] 2.2 Emit a resolved primary as a quoted YAML `model` value; omit the complete key when unresolved.
- [x] 2.3 Remove custom `model_assignment` construction from `buildOpencodeJsonPreview`; do not add JSON agent bindings or native fallback claims.

## Phase 3: Verification

- [x] 3.1 Run `npm run opencode:test` and `npm run opencode:check`; confirm resolved/unresolved, zero-call, and existing permission tests pass.
- [x] 3.2 Run `npm test` and `npm run check` before merge.
- [x] 3.3 Review the final diff: OpenCode adapter/test plus the authorized Memory OpenAPI test-parser repair; no generated traces, protected-path edits, live harness config, or baselines.

## Authorized Verification Repair

- [x] Consume existing single-paragraph folded descriptions in the dependency-free YAML subset parser.
- [x] Assert description contents, embedded colons/quotes, and following sibling fields.
- [x] Verify Memory OpenAPI tests (15), full `npm test`, and `npm run check` pass.
