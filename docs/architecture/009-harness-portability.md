# Harness Portability

## Rule

Core concepts are neutral. Harness concepts are adapter-specific.

## Priority

1. Pi.dev adapter.
2. opencode adapter.
3. Claude adapter.
4. Codex adapter.
5. VSCode adapter.
6. Kiro adapter.

## Mapping

- Orchestrator maps to each harness primary control concept.
- Specialist maps to subagent, prompt template, command, extension, or runtime worker depending on harness capability.
- Skill maps to harness-supported skill package or prompt module.
- PermissionPolicy maps to runtime enforcement where available or adapter-side gate where unavailable.
- Model IDs map to user-owned harness/provider runtime configuration, never to agent identity.

## Phase 7 Contract

Harness portability is executable, not aspirational. `.ai/harnesses/compatibility-matrix.json` records the required capabilities and how each target harness preserves them.

Capability strategies:

- `native`: the harness has a first-class feature for the Alfred concept.
- `adapter`: Alfred runtime code preserves the concept.
- `generated`: Alfred emits harness-specific files or prompts from neutral source-of-truth artifacts.
- `external-script`: Alfred preserves the behavior outside the harness through local deterministic scripts.

opencode has the first non-Pi translation spike in `packages/opencode-adapter`. It generates an artifact preview for agents, skills, and permissions while keeping `packages/core` free of opencode imports.
