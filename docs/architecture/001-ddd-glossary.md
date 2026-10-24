# DDD Glossary

## Product vocabulary

- ProductCapability: an independently usable Alfred capability: Workspace, Memory, or Agent Harness.
- ProductComposition: explicit command routing or configured integration through public contracts; owned by the composition layer, not a peer capability.
- Workspace capability: the projects, conversations, files, terminals, and local tools application.
- Memory workspace binding: an association between a filesystem directory and Memory tenants; distinct from the Workspace capability. Existing IDs and database tables remain unchanged.
- Agent Harness capability: Alfred's agents, skills, policies, profiles, runtime management, and harness integration family.
- SessionPort / SessionAdapter: Workspace's public session contract and its configured implementation. The legacy adapter is a compatibility implementation, not an automatic Agent Harness integration.
- ComponentSelection: explicit capability preferences in `.alfred/setup/components.json`, written only on approved Apply.
- IntegrationReceipt: the separate managed project integration record in `.alfred/setup/installation.json`; compatible with existing 1.1.0 receipts.

## Agent Harness vocabulary

- Agent: autonomous role capable of handling tasks under a policy.
- Orchestrator: lead agent that classifies work, decides direct execution vs delegation, and records decisions.
- Specialist: subagent with narrow expertise such as QA, Developer, Librarian, Architect, or Reviewer.
- Skill: lazy-loaded capability package with instructions, examples, tools, or scripts.
- Harness: runtime environment such as Pi.dev, opencode, Claude, Codex, VSCode, or Kiro.
- Adapter: implementation that maps Alfred core concepts to a harness.
- PermissionPolicy: rules describing allowed, denied, and approval-gated actions.
- SecurityBoundary: constraints preventing unsafe behavior.
- TraceEvent: auditable record of a decision, action, provider request, skill load, or permission result.
- EvalCase: reproducible test input with expectations and scoring.
- Baseline: approved eval result set used for comparison.
- Regression: behavior worse than baseline.
- TemporaryAgent: ephemeral specialist created to cover a missing capability.
- ProviderRequestGate: policy gate deciding local-only, hybrid, or provider execution.
- LocalCapability: deterministic local script/tool that can solve or reduce work before provider calls.
- ModelAssignmentPolicy: user-owned configuration mapping agents to primary and fallback models without changing agent identity.
- ModelFallbackChain: ordered runtime sequence of user-configured models tried after retry exhaustion.
