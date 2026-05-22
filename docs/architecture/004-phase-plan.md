# Phase Plan

## Phase 1: Architecture Kernel

Create glossary, domain model, schemas, package boundaries, policy specs, trace schema, eval schema, initial agent specs, Pi adapter design, local-first provider policy, starter evals, and sample traces.

## Phase 2: Pi Runtime Spike

Build minimal Pi adapter/extension. Load one agent. Load one skill. Emit trace events. Run one eval end-to-end.

## Phase 3: Agent/Subagent System

Implement Orchestrator, Developer, QA, Librarian, Architect, Reviewer, delegation policy, and temporary specialist proposal flow.

## Phase 4: Security + Permissions Enforcement

Implement permission evaluator, deny-by-default runtime checks, protected paths, tool/action policy, and security evals.

## Phase 5: Evals + Regression Gates

Implement eval runner, baseline comparison, regression reports, prompt/agent/skill locks, and promotion workflow.

## Phase 6: Skill Packs + Lazy Loading

Integrate external skill packs, import/sync strategy, project detector, and skill activation evals.

## Phase 7: Harness Portability

Add opencode adapter, then Claude/Codex/VSCode/Kiro adapters or compatibility notes.

## Post-Phase-7: Roadmap + Release Readiness

Consolidate completed phases into a model-readable roadmap, preserve issue-driven governance, and make the next release candidate discoverable through deterministic local validation.

## Milestone: Eval Runner Package

Move deterministic eval discovery, current-result computation, and regression gate execution into `packages/evals` while preserving all phase validators and zero-provider-call regression gates.

## Milestone: Adapter Hardening

Turn executable Pi and opencode adapter previews into hardened readiness contracts while keeping core harness-agnostic and requiring human approval before writing harness-specific config.

## Milestone: Release 0.1.0

Package the completed architecture kernel as a reproducible local release candidate with all validators, release metadata, generated trace, and zero provider calls.

## Roadmap 0.2.0

Move from architecture-kernel release to usable local runtime through Phase 8 runtime hardening, Phase 9 adapter generation, Phase 10 eval runner CLI, and Phase 11 release 0.2.0.
