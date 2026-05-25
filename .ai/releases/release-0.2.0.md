# Release 0.2.0

`0.2.0` is the Alfred MVP release candidate.

## MVP Definition

Alfred is usable from VSCode, opencode, and Pi through local-first adapter artifacts and deterministic eval reporting.

## Included Work

- Phase 8: Runtime Hardening
- Phase 9: Adapter Generation
- Phase 10: Eval Runner CLI
- MVP Release Plan

## Required Harnesses

- VSCode
- opencode
- Pi

## opencode Install Mode

The opencode adapter generates an install preview under `.ai/generated/opencode-install`.

It does not write `.opencode` files by default. Copying preview files into a real opencode project requires explicit human approval.

After installing or changing opencode agents, skills, or config, restart opencode because opencode loads config at startup.

## Validation

- `pnpm validate:release-0.2.0`
- `pnpm check`
- `pnpm test`
