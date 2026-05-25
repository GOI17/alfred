# Phase 11: Release 0.2.0

Phase 11 packages Alfred MVP `0.2.0`.

## Required Harnesses

- VSCode
- opencode
- Pi

## opencode Install Preview

The release generates `.ai/generated/opencode-install` as the approval-gated opencode install bundle.

The bundle is intentionally outside `.opencode` so validation never mutates a live opencode configuration.

## Completion Conditions

- `validate:release-0.2.0` passes.
- Required harnesses are validated.
- opencode install preview is generated.
- Provider calls remain `0`.
- `pnpm check` and `pnpm test` pass.
