# DDD Glossary

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
