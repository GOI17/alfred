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
- RunEvaluationSuite
- CompareEvaluationRuns
- DetectRegression
- UpdateBaselineAfterApproval

## Ports

- HarnessAdapter
- AgentRegistry
- SkillRegistry
- PermissionStore
- TraceSink
- EvalDatasetStore
- BaselineStore
- ProviderGateway
- LocalToolRunner
- TokenEstimator
- ProjectDetector
