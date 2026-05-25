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
- RuntimeRoadmap
- RuntimeHardeningContract
- StableRuntimeAdapter
- MvpReleasePlan
- MvpReleaseGate

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
- RoadmapPhaseOrder
- RuntimeTraceContract
- AdapterBoundaryInvariant
- MvpOutcome
- MvpNonGoal

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
- LoadRoadmap020
- EvaluateRoadmap020
- LoadRuntimeHardeningContract
- EvaluateRuntimeHardening
- BuildStableRuntimeAdapter
- LoadMvpReleasePlan
- EvaluateMvpReleasePlan
- EmitMvpReleasePlanTrace

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
- RuntimeRoadmapStore
- RuntimeHardeningStore
- MvpReleasePlanStore

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

## Roadmap 0.2.0

Entities:

- `RuntimeRoadmap`: model-readable roadmap that moves Alfred from architecture kernel to usable local runtime.

Value objects:

- `RoadmapPhaseOrder`: explicit ordering for runtime hardening, adapter generation, eval CLI, and release phases.

Use cases:

- `LoadRoadmap020`: read `.ai/roadmaps/0.2.0.json`.
- `EvaluateRoadmap020`: verify the roadmap is ordered, local-only, and fully validated.

Ports:

- `RuntimeRoadmapStore`: reads runtime roadmap artifacts and generated roadmap traces.

## Phase 8: Runtime Hardening

Entities:

- `RuntimeHardeningContract`: source-of-truth contract for stable adapter runtime APIs.
- `StableRuntimeAdapter`: adapter runtime result that exposes capabilities, trace events, and boundary invariants.

Value objects:

- `RuntimeTraceContract`: required trace events emitted or preserved by the stable runtime.
- `AdapterBoundaryInvariant`: boundary proof such as core agnosticism, local-first execution, and no default harness config writes.

Use cases:

- `LoadRuntimeHardeningContract`: read `.ai/runtime/phase-8-runtime-hardening.json`.
- `EvaluateRuntimeHardening`: verify stable runtime APIs, trace contracts, adapter boundaries, and provider call limits.
- `BuildStableRuntimeAdapter`: expose stable adapter runtime metadata without writing harness config.

Ports:

- `RuntimeHardeningStore`: reads runtime hardening contracts and generated runtime hardening traces.

## MVP Release Plan

Entities:

- `MvpReleasePlan`: model-readable plan for release `0.2.0` as the Alfred MVP.
- `MvpReleaseGate`: explicit condition required before calling the MVP releasable.
- `MvpRequiredHarness`: VSCode, opencode, or Pi harness that must be usable for MVP release.
- `MvpPreviewHarness`: portability target that can generate previews but is not required for MVP usability.

Value objects:

- `MvpOutcome`: user-visible outcome expected from the MVP.
- `MvpNonGoal`: explicit boundary that prevents scope creep.

Use cases:

- `LoadMvpReleasePlan`: read `.ai/roadmaps/mvp-release.json`.
- `EvaluateMvpReleasePlan`: verify required harnesses, phase alignment, non-goals, gates, and local-only execution.
- `EmitMvpReleasePlanTrace`: record deterministic validation of the MVP plan.

Ports:

- `MvpReleasePlanStore`: reads MVP plan artifacts and generated MVP plan traces.

## Phase 9: Adapter Generation

Entities:

- `AdapterGenerationContract`: model-readable contract for required MVP harness previews and preview-only portability targets.
- `HarnessArtifactPreview`: generated artifact set for a harness that is safe to inspect before writing.

Value objects:

- `RequiredMvpHarness`: VSCode, opencode, or Pi.
- `PreviewOnlyHarness`: Claude, Codex, or Kiro.
- `HarnessWriteGate`: explicit approval requirement before writing harness config.

Use cases:

- `LoadAdapterGenerationContract`: read `.ai/adapters/phase-9-adapter-generation.json`.
- `EvaluateAdapterGeneration`: verify required harnesses, preview-only targets, artifact presence, write gates, and provider call limits.
- `BuildHarnessArtifactPreview`: generate local preview artifacts without writing harness config.

Ports:

- `AdapterGenerationStore`: reads adapter generation contracts and generated Phase 9 traces.

## Phase 10: Eval Runner CLI

Entities:

- `EvalRunnerCliContract`: model-readable contract for CLI report formats, outputs, and summary sections.
- `EvalRunnerCliReport`: deterministic report produced from package-level eval runner APIs.

Value objects:

- `ReportFormat`: supported report output such as JSON or text.
- `ReportSummarySection`: required summary section such as status, regression gate, missing results, and provider calls.

Use cases:

- `LoadEvalRunnerCliContract`: read `.ai/evals/cli/phase-10-eval-runner-cli.json`.
- `EvaluateEvalRunnerCli`: verify report outputs, summary sections, regression counts, and provider call limits.
- `BuildEvalRunnerReport`: compute a deterministic report from current baselines, current results, and regression gates.

Ports:

- `EvalRunnerCliReportSink`: writes local JSON and text reports without provider calls.

## Phase 11: Release 0.2.0

Entities:

- `MvpReleaseCandidate`: release candidate for Alfred MVP `0.2.0`.
- `OpencodeInstallPreview`: generated opencode install bundle that does not write live config by default.

Value objects:

- `RequiredHarnessSet`: VSCode, opencode, and Pi.
- `InstallApprovalGate`: explicit human approval required before writing harness config.

Use cases:

- `LoadRelease020Candidate`: read `.ai/releases/release-0.2.0.json`.
- `EvaluateMvpReleaseCandidate`: validate release gates, required harnesses, validator results, and opencode install readiness.
- `BuildOpencodeInstallPreview`: generate opencode files into `.ai/generated/opencode-install`.

Ports:

- `ReleaseCandidateStore`: reads release candidate artifacts and generated release traces.
