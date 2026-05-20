# Skills

Skills are lazy-loaded capability packages. Do not load skill bodies globally.

Skill activation must be based on project signals, explicit task need, or Orchestrator decision. Skill descriptions must be strict and concrete to avoid context bloat.

External source candidates:

- mattpocock/skills
- Gentleman-Programming/gentle-ai
- Gentleman-Programming/Gentleman-Skills

## Phase 6 Contract

- Registry metadata is loaded first.
- Skill bodies are loaded only after a concrete activation decision.
- Project-scoped skills are allowed by default.
- Global skill promotion requires explicit human approval.
- Activation can use local project signals, explicit task triggers, or Orchestrator routing decisions.
