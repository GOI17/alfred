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
