# Codex Adapter Design

## Goal

Make Alfred agents usable from Codex without leaking Codex concepts into `packages/core`.

## Current Mapping

- Alfred project instructions remain in root `AGENTS.md` for Codex instruction-chain discovery.
- Alfred specialist agents map to Codex project custom agents generated under `.codex/agents/*.toml`.
- Alfred project skills map to Codex repo skills generated under `.agents/skills/*/SKILL.md`.
- Codex subagent execution remains explicit: Codex only spawns custom agents when the user or parent workflow asks for subagents.
- Model assignment stays user-owned; generated custom agent TOML does not set `model` or `model_reasoning_effort`.
- Sandbox and approval controls are inherited from the parent Codex session and cannot be broadened by generated agents.

## Adapter Package

`packages/codex-adapter` owns Codex-specific generation:

- `buildCodexAdapterPreview` returns model-readable generated artifact metadata.
- `buildCodexAdapterReadiness` proves Alfred invariants for Codex.
- `buildCodexStableRuntime` exposes the stable runtime contract used by hardening evals.
- `buildCodexIntegrationPreview` participates in phase-9 adapter generation.
- `buildCodexInstallPreview` / `writeCodexInstallPreview` write preview files only.

## Install Policy

Codex config writes are preview-only by default. Generated files may be copied to
`.codex/agents` and `.agents/skills` only after explicit human approval. Restart
Codex or start a new session after installation so custom agents and skills are rediscovered.

## Boundaries

- Core never imports `packages/codex-adapter`.
- Codex adapter depends on core and reads `.ai/` source of truth.
- Generated artifacts preserve local-first provider policy, deny-by-default security, lazy skill loading, and human decision authority.
