# opencode Adapter Design

## Goal

Map Alfred agents and skills to opencode-native project artifacts while keeping opencode-specific behavior out of `packages/core`.

## Current Mapping

- Alfred agents map to opencode project agents under `.opencode/agents/<id>.md`.
- Alfred skills map to opencode skills under `.opencode/skills/<id>/SKILL.md`.
- `opencode.json` is generated as a preview with `default_agent: orchestrator`, root `AGENTS.md` instructions, and conservative permission gates.
- Generated agent prompts quote the corresponding `.ai/agents/*.md` source spec so opencode agents stay aligned with Alfred source of truth without triggering nested frontmatter parsing.
- Model assignment remains user-owned at runtime.

## Adapter Package

`packages/opencode-adapter` owns opencode-specific generation:

- `buildOpencodeAdapterPreview` returns model-readable generated artifact metadata.
- `buildOpencodeAdapterReadiness` proves Alfred invariants for opencode.
- `buildOpencodeStableRuntime` exposes the stable runtime contract used by hardening evals.
- `buildOpencodeIntegrationPreview` participates in phase-9 adapter generation.
- `buildOpencodeInstallPreview` / `writeOpencodeInstallPreview` write preview files only.

## Install Policy

opencode config writes are preview-only by default. Generated files may be copied
to `.opencode/` only after explicit human approval. Restart opencode or start a new
session after installation so agents and skills are rediscovered.

## Boundaries

- Core never imports `packages/opencode-adapter`.
- opencode adapter depends on core and reads `.ai/` source of truth.
- Generated artifacts preserve local-first provider policy, deny-by-default security, lazy skill loading, and human decision authority.
