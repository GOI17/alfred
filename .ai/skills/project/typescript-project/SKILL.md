---
id: typescript-project
name: typescript-project
scope: project
description: Use only when TypeScript project files, package scripts, or ts/js source changes require TypeScript-specific guidance.
---

# TypeScript Project Skill

Keep TypeScript guidance project-scoped and load this body only after registry metadata activation.

Rules:

- Prefer deterministic local checks before provider calls.
- Preserve package boundaries and existing script conventions.
- Do not add framework-specific assumptions from the skill body unless the project signals confirm them.
