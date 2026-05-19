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
