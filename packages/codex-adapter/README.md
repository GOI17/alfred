# Alfred Codex Adapter

Generates Codex-native Alfred agent artifacts from the `.ai/` source of truth.

## What it generates

- Project custom agents under `.codex/agents/*.toml`.
- Repo-scoped Codex skills under `.agents/skills/*/SKILL.md`.
- No model defaults: model selection remains user-owned in Codex runtime config.
- No direct writes to live Codex config by default: the CLI writes an install preview.

## Usage

```bash
node packages/codex-adapter/src/cli.js --output .ai/generated/codex-install
```

Review the preview, then copy files to their `install_path` only after human approval.
Restart Codex (or start a new session) so custom agents and skills are rediscovered.

## Checks

```bash
npm --prefix packages/codex-adapter run check
npm --prefix packages/codex-adapter test
```
