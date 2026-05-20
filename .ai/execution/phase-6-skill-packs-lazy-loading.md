# Phase 6: Skill Packs + Lazy Loading

Goal: integrate external skills without context bloat.

Tasks:

- Define import/sync strategy for external skill packs.
- Add project detector.
- Add skill activation tests.
- Normalize skill frontmatter.
- Keep skills project-scoped unless explicitly approved as global.

## Runtime Artifacts

- Skill registry: `.ai/skills/registry.json`
- Project-scoped skill bodies: `.ai/skills/project/*/SKILL.md`
- Runtime entrypoint: `packages/pi-adapter/src/runtime.js#runPiSkillLoadingSpike`
- Generated trace: `.ai/observability/generated/phase-6-skill-activation.json`
- Validation script: `scripts/validate-phase-6.mjs`

## Completion Conditions

- Skill registry contains concrete project-scoped skill packs.
- Skill bodies are never loaded globally.
- Activation uses local project signals and explicit task triggers.
- Phase 6 emits `skill_activation_decision` with zero provider calls.
- `pnpm check` and `pnpm test` include Phase 6 validation.
