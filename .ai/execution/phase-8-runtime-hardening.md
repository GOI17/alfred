# Phase 8: Runtime Hardening

Phase 8 turns executable adapter spikes into stable runtime contracts.

## Scope

- Stabilize Pi and opencode runtime API surfaces.
- Preserve core harness agnosticism.
- Keep harness config writes disabled by default.
- Require human approval before generated harness artifacts become real config.
- Keep all validation local-only with zero provider calls.

## Runtime APIs

- `packages/pi-adapter/src/runtime.js#buildPiStableRuntime`
- `packages/opencode-adapter/src/runtime.js#buildOpencodeStableRuntime`

## Completion

Run `pnpm validate:phase8`, `pnpm check`, and `pnpm test`.
