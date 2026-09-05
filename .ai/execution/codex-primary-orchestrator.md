---
id: execution/codex-primary-orchestrator
description: Activate Alfred Orchestrator in the main Codex session
owner: codex-adapter
phase: verified
---

# Codex primary Orchestrator

Issue: #181

## Requirements

- R1: The main Codex session loads the source Orchestrator role through its
  discovered project instructions. Delegated specialists keep their assigned roles.
- R2: Generate five specialist TOML files and a self-contained, managed primary
  instruction block. No model defaults or delegated-only Orchestrator artifact.
- R3: Preview writes stay under the requested output directory. The installer's
  existing final handoff approval applies the instruction block atomically,
  preserving user text and making repeated application idempotent.
- R4: Honor non-empty AGENTS.override.md before AGENTS.md; reject malformed
  managed markers and symlink instruction targets before applying Codex artifacts.
- R5: Preserve the existing test-count baselines while expanding meaningful
  coverage for role separation, preview isolation, and installer integration.

## Design

Codex adapter owns the primary-session translation. A standalone helper merges
the generated block into the instruction file Codex will discover. The suite
installer invokes that helper only after the human selects project application.
The Alfred repository entry point also routes main Codex sessions to the source
Orchestrator spec. Existing delegated orchestrator files are not deleted
automatically; they are no longer generated or required for primary startup.

## Verification

- [x] Codex adapter tests and checks: six tests, unchanged baseline count.
- [x] Suite installer end-to-end approval and preservation checks.
- [x] Full npm test/check, all 19 release gates, and diff check.

Real PostgreSQL integration remains opt-in and was skipped without a configured
test database. Validation reused existing installed dependencies through a
temporary worktree symlink; no dependency installation was required.

## Execution trace

Strategy: local-only implementation and deterministic tests; no LLM provider
calls. Direct handling; no specialist delegation needed for adapter plumbing.
Protected core access remains read-only for previously authorized test execution.
Live installed harness configuration is not modified during development.
