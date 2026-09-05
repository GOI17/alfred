# Alfred Codex Adapter

Generates Codex-native Alfred agent artifacts from the `.ai/` source of truth.

## What it generates

- Main-session Orchestrator instructions in a managed `AGENTS.md` block.
- Five delegated specialists under `.codex/agents/*.toml`.
- Repo-scoped Codex skills under `.agents/skills/*/SKILL.md`.
- No model defaults: model selection remains user-owned in Codex runtime config.
- No direct writes to live Codex config by default: the CLI writes an install preview.

## Usage

```bash
node packages/codex-adapter/src/cli.js --output .ai/generated/codex-install
```

Review the preview, then use the approved installation flow below.
Restart Codex (or start a new session) so custom agents and skills are rediscovered.

### Activate the main Orchestrator

In guided `alfred setup`, select Codex and approve the final **Apply selected
harness files into this project** step. This merges the generated primary block
into the project's `AGENTS.md`, or its non-empty `AGENTS.override.md` when present,
and installs the specialists and skills. Existing text is preserved and repeat
application replaces only the Alfred block. Symlink instruction targets and
malformed managed markers stop application for review.

For manual installation, do not overwrite an existing `AGENTS.md` with the
preview. After reviewing and approving it, run:

```bash
node packages/codex-adapter/src/primary-instructions.js \
  .ai/generated/codex-install /absolute/path/to/project --approved
```

Then install the preview's specialist and skill directories using the existing
approval flow. Start a new Codex session in that project. The main session loads
the Orchestrator role automatically; no custom primary-agent selector is needed.
Delegated specialists explicitly retain their roles.

Older installations may still contain `orchestrator.toml`. That file is no
longer generated or needed for main-session startup; upgrades preserve existing
files rather than deleting custom configuration. A higher-priority or nested
instruction override can still change the effective role.

Discovery follows the [official AGENTS.md instruction chain](https://learn.chatgpt.com/docs/agent-configuration/agents-md);
custom-agent TOML files define delegated [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).

## Checks

```bash
npm --prefix packages/codex-adapter run check
npm --prefix packages/codex-adapter test
```
