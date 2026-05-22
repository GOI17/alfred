# Alfred MVP Release Plan

The MVP is release `0.2.0`.

## Definition

A local-first agent operations runtime that is usable from VSCode, opencode, and Pi, can run deterministic eval reports, and can package a reproducible release candidate without provider calls.

## Required MVP Harnesses

- VSCode
- opencode
- Pi

Claude, Codex, and Kiro remain preview and portability targets unless they are promoted in a later release.

## Scope

- Phase 9: Adapter Generation for VSCode, opencode, and Pi
- Phase 10: Eval Runner CLI
- Phase 11: Release 0.2.0

## Non-Goals

- No automatic writes to harness config directories.
- No provider calls for generation, eval, roadmap, or release validation.
- No production package publishing workflow before `0.2.0`.
- No permission escalation without explicit human approval.
- No adapter behavior embedded in `packages/core`.

## Release Gates

- `validate:phase9` passes.
- `validate:phase10` passes.
- `validate:release-0.2.0` passes.
- `pnpm check` passes.
- `pnpm test` passes.
- Eval runner includes all MVP plan targets.
- VSCode, opencode, and Pi are validated as required MVP harnesses.
- Generated traces record `provider_calls: 0`.
