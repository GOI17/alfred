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

## Runtime support boundary

Alfred skills are instruction bodies loaded into the current session. They do
not provide a durable executor, background continuation, scheduled repetition,
or restart/resume state. Names such as GOAL, LOOP, and ULW are registry triggers;
they do not promise native slash-command parity on every harness.

The existing opencode and Codex install previews deliver each canonical
`SKILL.md` body to their project-scoped skill artifact path. The preview remains
local-only and does not write active harness configuration without the existing
human approval flow. Pi's current install preview emits lazy registry metadata
only; it has no supported project skill-body target, so body installation and
native invocation are not claimed. Contract-only harnesses are likewise not
presented as executable skill runtimes.

ULW is narrower still: it is supported only for the current Codex session when
Codex-owned effective-session evidence confirms both approval bypass and sandbox
bypass were already selected by the user. Missing or conflicting evidence
blocks activation. ULW cannot enable bypass, relaunch Codex, edit configuration,
change models, or expand permissions.
