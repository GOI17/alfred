---
id: execution/model-assignment-per-agent/spec
description: Delta specification for OpenCode model inheritance
owner: core
phase: spec
---

# Delta Specification: OpenCode Agent Generation

Issue: [#173](https://github.com/GOI17/alfred/issues/173)

## MODIFIED Requirements

### R1: Single native agent definition

The adapter **MUST** use generated `.opencode/agents/<id>.md` as each agent's single native OpenCode definition. It **MUST NOT** emit top-level `model_assignment` or parallel JSON agent bindings in `opencode.json`.

#### Scenario: Resolved primary

- **GIVEN** agent `developer` has a user-resolved primary
- **WHEN** the OpenCode install preview is generated
- **THEN** its agent frontmatter contains `model: "<resolved-primary>"`
- **AND** `opencode.json` contains no custom or parallel agent model binding

#### Scenario: Unresolved primary

- **GIVEN** an agent has no resolved primary
- **WHEN** the OpenCode install preview is generated
- **THEN** its markdown omits the `model` key
- **AND** OpenCode may inherit the active model

### R2: Runtime ownership boundaries

Source agent specs **MUST NOT** hardcode model IDs. Fallback chains **MUST** remain Alfred runtime behavior and **MUST NOT** be serialized or claimed as natively enforced by OpenCode.

#### Scenario: Resolved assignment includes fallbacks

- **GIVEN** Alfred resolves a primary and one or more fallbacks
- **WHEN** native OpenCode artifacts are generated
- **THEN** only the primary appears in the matching agent markdown
- **AND** no native artifact claims fallback enforcement

#### Scenario: Model-agnostic source specs

- **GIVEN** the Alfred source agent specifications
- **WHEN** regression checks scan `.ai/agents/*.md`
- **THEN** no source spec contains a hardcoded provider/model assignment

### R3: Local deterministic generation

Preview generation **MUST** make zero provider calls and **MUST** preserve existing approval-gated harness writes and permission output.

#### Scenario: Preview verification

- **GIVEN** resolved or unresolved model input
- **WHEN** adapter tests generate a preview
- **THEN** `provider_calls` equals `0`
- **AND** automated tests cover R1 and R2 without writing live harness config

## Acceptance Gate

### Authorized verification repair

The user approved extending this issue to repair the pre-existing
`packages/memory-openapi/test/openapi.test.js` parser failure. The dependency-free
YAML subset parser must consume the schema's single-paragraph folded (`>-`)
descriptions as strings, stop at the next sibling mapping, and preserve text
that resembles YAML keys. Regression assertions must check the parsed text and
the fields following a description. The published schema remains unchanged.

- `npm run opencode:test` passes.
- `npm run opencode:check` passes.
- Full `npm test` and `npm run check` pass before merge.
