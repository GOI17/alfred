---
id: development
description: Feature development guidelines for Alfred contributors
owner: core
---

# Alfred Development Guidelines

## Feature Development Process

Every feature in Alfred follows this process:

### 1. Create an Issue

Before writing any code, create a GitHub issue that describes:

- **Goal**: What the feature accomplishes
- **Context**: Why this feature is needed
- **Tasks**: Specific implementation steps (checklist format)
- **ACs**: Acceptance criteria that define when the feature is complete

### 2. Create a Branch

Branch names follow the pattern: `issue-{number}-{short-title}`

Examples:
- `issue-48-pi-agent-install-scripts`
- `issue-50-cleanup-phase-files`
- `issue-44-agent-receptionist-readme`

### 3. Follow SDD (Spec-Driven Development)

Before writing code, create or update the SDD spec:

1. **Read existing specs** in `.ai/` to understand patterns
2. **Create spec file** in `.ai/execution/` or relevant directory
3. **Include frontmatter** with `id`, `description`, `owner`, `phase`
4. **Define requirements** using R1, R2, R3... numbering
5. **Define completion conditions** as a checklist
6. **Reference related files** in the spec

### 4. Implement the Feature

- Write code following the SDD spec
- Keep provider calls at zero for deterministic operations
- Use atomic file operations (temp + rename pattern)
- Emit trace events for operations
- Follow hexagonal architecture (core is harness-agnostic)

### 5. Create a PR

Pull requests must:

- **Title**: Clear description of the change
- **Body**: Summary of what was done
- **Link**: Include `Closes #${issue_number}`
- **Labels**: Appropriate labels (enhancement, chore, bug, etc.)

PR checklist:
- [ ] Code follows SDD spec
- [ ] All tests pass (`pnpm test`)
- [ ] Type checking passes (`pnpm check`)
- [ ] Validator script passes (if applicable)
- [ ] Provider calls remain zero (if applicable)
- [ ] Trace events emitted (if applicable)

## SDD Template

```markdown
---
id: execution/feature-name
description: Short description of the feature
phase: feature-phase
author: core
---

# Feature Title

## Goal

What this feature accomplishes.

## Context

Why this feature is needed.

## Requirements

### R1: First Requirement

**Endpoint**: (if applicable)

**Behavior**:
1. First step
2. Second step
3. Third step

**CLI** (if applicable):
\`\`\`
command usage
\`\`\`

## Completion Conditions

- [ ] First condition
- [ ] Second condition
- [ ] Third condition

## References

- Related spec: `.ai/reference/related.md`
- Related code: `packages/related/src/file.js`
```

## Branch Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `issue-{number}-{short-title}` | `issue-48-pi-agent-install-scripts` |
| Chore | `chore/{short-description}` | `chore/cleanup-phase-files` |
| Bug fix | `fix/{short-description}` | `fix/permission-check-bug` |

## Commit Messages

Follow conventional commits:
- `feat: add new feature`
- `fix: correct bug`
- `chore: maintenance task`
- `docs: documentation changes`
- `refactor: code restructuring`
- `test: add or update tests`

## File Locations

| Type | Location |
|------|----------|
| Agent specs | `.ai/agents/` |
| Harness designs | `.ai/harnesses/` |
| Domain model | `.ai/domain/model.md` |
| Policies | `.ai/policies/` |
| Skills | `.ai/skills/` |
| Evals | `.ai/evals/` |
| Releases | `.ai/releases/` |
| Roadmaps | `.ai/roadmaps/` |

## Running Validators

```bash
# Run all tests
pnpm test

# Run type checking
pnpm check

# Run specific validator
node scripts/validate-phase-13.mjs
```

## References

- Context: `.ai/context.md`
- Domain Model: `.ai/domain/model.md`
- Install Instructions: `.ai/instructions/install-management.md`