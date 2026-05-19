# Hexagonal Architecture

## Dependency Rule

`packages/core` owns domain, application use cases, and ports. It must not import adapters, harness SDKs, provider SDKs, terminal runtimes, filesystem implementations, or network implementations.

Adapters depend on core and implement ports.

## Core

- Domain entities: Agent, Skill, Harness, PermissionPolicy, TraceEvent, EvalCase, Baseline, TemporaryAgent.
- Application use cases: OrchestrateTask, SelectSpecialist, DetectSkills, EvaluatePermission, RecordTraceEvent, RunEvaluationSuite, CompareBaselines, DecideExecutionStrategy.
- Ports: HarnessAdapter, SkillRegistry, AgentRegistry, TraceSink, EvalDatasetStore, BaselineStore, ProviderGateway, LocalToolRunner, TokenEstimator.

## Adapters

- `pi-adapter`: maps Alfred concepts to Pi extensions, skills, templates, and runtime hooks.
- `opencode-adapter`: future mapping to opencode agents, skills, permissions, and plugins.
- Additional adapters must not redefine domain concepts.
