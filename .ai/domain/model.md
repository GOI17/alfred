# Domain Model

## Entities

- Agent
- Specialist
- Skill
- Harness
- PermissionPolicy
- TraceEvent
- EvalCase
- EvalResult
- Baseline
- TemporaryAgent
- ProviderRequestPolicy
- LocalCapability
- ModelAssignmentPolicy
- ModelFallbackChain
- DelegationDecision
- TaskClassification
- RoutingPolicy
- PermissionEvaluation
- ProtectedPathRule
- DestructiveCommandRule
- EvalBaseline
- EvalCurrentResult
- RegressionGatePolicy
- RegressionComparison
- VersionLockSet
- SkillPack
- SkillActivationDecision
- ProjectSignal
- Roadmap
- ReleaseReadinessEvaluation
- EvalRunner
- CurrentEvalResultSet
- AdapterHardeningContract
- AdapterReadiness
- ReleaseCandidateArtifact
- ReleaseValidation

## Value Objects

- AgentId
- SkillId
- HarnessId
- PromptVersion
- PolicyVersion
- TraceId
- EvalCaseId
- FixtureHash
- PromptHash
- PermissionAction
- ExecutionStrategy
- ModelAssignment
- RetryBudget
- TaskComplexity
- TemporaryAgentProposal
- PermissionDecision
- ProtectedPathPattern
- CommandPattern
- MetricRule
- RegressionFinding
- BaselineUpdateDecision
- SkillTrigger
- SkillScope
- LazyLoadDecision
- RoadmapMilestone
- ReleaseCandidate
- EvalBaselinePath
- EvalResultSummary
- AdapterInvariant
- HardenedAdapterStatus
- ReleaseVersion
- ValidatedCommit

## Use Cases

- OrchestrateTask
- ClassifyTask
- SelectSpecialist
- DetectRequiredSkills
- EvaluatePermission
- CreateTemporaryAgentProposal
- PromoteTemporaryAgent
- RecordTraceEvent
- DecideExecutionStrategy
- RunLocalPreprocessor
- ReduceProviderPayload
- ResolveModelAssignment
- RetryProviderRequest
- SwitchFallbackModel
- ExplainProviderFailure
- RunEvaluationSuite
- CompareEvaluationRuns
- DetectRegression
- UpdateBaselineAfterApproval
- RouteTask
- EnforceNoDelegationForSmallTask
- ProposeTemporaryAgent
- EnforceDenyByDefault
- DenyProtectedPathAccess
- DenyDestructiveCommand
- DenyPermissionBroadening
- CompareEvalBaseline
- EvaluateRegressionGate
- EmitRegressionGateTrace
- RequireHumanApprovalForBaselineUpdate
- DetectProjectSignals
- NormalizeSkillMetadata
- SelectLazySkills
- EmitSkillActivationTrace
- LoadPostPhase7Roadmap
- EvaluateReleaseReadiness
- EmitRoadmapReadinessTrace
- ListEvalBaselines
- LoadEvalBaselines
- ComputeCurrentEvalResults
- RunEvalRunner
- LoadAdapterHardeningContract
- EvaluateAdapterHardening
- BuildAdapterReadiness
- LoadReleaseCandidate
- EvaluateReleaseCandidate
- EmitReleaseCandidateTrace

## Ports

- HarnessAdapter
- AgentRegistry
- SkillRegistry
- PermissionStore
- TraceSink
- EvalDatasetStore
- BaselineStore
- ProviderGateway
- ModelAssignmentStore
- LocalToolRunner
- TokenEstimator
- ProjectDetector
- RoutingPolicyStore
- SecurityPolicyStore
- VersionLockStore
- RegressionReportSink
- SkillPackStore
- RoadmapStore
- EvalRunnerStore
- AdapterHardeningStore
- ReleaseCandidateStore

## Phase 7: Harness Portability

Entities:

- `HarnessCompatibilityMatrix`: source-of-truth mapping from Alfred capabilities to harness preservation strategies.
- `HarnessPortabilityEvaluation`: deterministic result proving whether a harness preserves all required capabilities.
- `AdapterArtifactPreview`: generated harness-specific artifact preview derived from Alfred core metadata.

Value objects:

- `HarnessCapability`: required semantic capability such as `primary_control`, `lazy_skills`, or `permission_enforcement`.
- `PortabilityStrategy`: one of `native`, `adapter`, `generated`, or `external-script`.
- `AdapterStatus`: executable spike, executable translation spike, or compatibility contract.

Use cases:

- `LoadHarnessCompatibility`: read the matrix from `.ai/harnesses/compatibility-matrix.json`.
- `EvaluateHarnessPortability`: verify every target harness preserves all required capabilities.
- `BuildOpencodeAdapterPreview`: translate Alfred metadata into opencode-compatible artifact previews.
- `EmitHarnessPortabilityTrace`: record zero-provider-call portability evaluation.

Ports:

- `HarnessCompatibilityStore`: loads the compatibility matrix.
- `AdapterArtifactSink`: writes generated adapter previews or traces.

## Post-Phase-7: Roadmap + Release Readiness

Entities:

- `Roadmap`: model-readable source of truth for completed phases and next milestones.
- `ReleaseReadinessEvaluation`: deterministic result proving whether the current architecture kernel is ready for a release candidate.

Value objects:

- `RoadmapMilestone`: concrete next work item with owner, goal, and validation.
- `ReleaseCandidate`: named candidate, currently `architecture-kernel-0.1.0`.

Use cases:

- `LoadPostPhase7Roadmap`: read `.ai/execution/post-phase-7-roadmap.json`.
- `EvaluateReleaseReadiness`: verify completed phases, governance, validation, and next work.
- `EmitRoadmapReadinessTrace`: record zero-provider-call roadmap readiness evaluation.

Ports:

- `RoadmapStore`: loads roadmap and release-readiness source-of-truth artifacts.

## Milestone: Eval Runner Package

Entities:

- `EvalRunner`: package-level API that discovers baselines, computes current results, and runs regression gates.
- `CurrentEvalResultSet`: deterministic current results derived from generated traces and model-readable artifacts.

Value objects:

- `EvalBaselinePath`: local baseline path under `.ai/evals/baselines`.
- `EvalResultSummary`: normalized result metrics for a phase or milestone.

Use cases:

- `ListEvalBaselines`: discover local baseline files.
- `LoadEvalBaselines`: load baseline records by phase.
- `ComputeCurrentEvalResults`: compute current results from generated traces without provider calls.
- `RunEvalRunner`: execute current-result computation and preserve existing regression gates.

Ports:

- `EvalRunnerStore`: reads local eval artifacts and generated trace files.

## Milestone: Adapter Hardening

Entities:

- `AdapterHardeningContract`: model-readable contract for executable adapter readiness.
- `AdapterReadiness`: deterministic readiness result emitted by an executable adapter.

Value objects:

- `AdapterInvariant`: required invariant such as core agnosticism, user-owned model assignment, lazy skills, or deny-by-default permissions.
- `HardenedAdapterStatus`: `hardened` when all adapter invariants pass.

Use cases:

- `LoadAdapterHardeningContract`: read `.ai/harnesses/adapter-hardening.json`.
- `EvaluateAdapterHardening`: compare Pi and opencode readiness against the hardening contract.
- `BuildAdapterReadiness`: expose adapter readiness without writing harness-specific config.

Ports:

- `AdapterHardeningStore`: reads adapter hardening contracts and readiness traces.

## Milestone: Release 0.1.0

Entities:

- `ReleaseCandidateArtifact`: model-readable release candidate under `.ai/releases`.
- `ReleaseValidation`: deterministic proof that all required local validators pass.

Value objects:

- `ReleaseVersion`: semantic version for the release candidate.
- `ValidatedCommit`: validated commit source recorded in the generated trace without pinning a squash-merge-sensitive hash.

Use cases:

- `LoadReleaseCandidate`: read `.ai/releases/release-0.1.0.json`.
- `EvaluateReleaseCandidate`: verify required validators, local-only execution, and release metadata.
- `EmitReleaseCandidateTrace`: record the validated commit source and zero-provider-call release status.

Ports:

- `ReleaseCandidateStore`: reads local release candidate artifacts and generated release traces.
