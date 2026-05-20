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
