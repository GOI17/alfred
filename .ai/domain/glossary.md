# Glossary

- Agent: autonomous role operating under permissions and eval contracts.
- Orchestrator: primary agent that classifies tasks, avoids unnecessary delegation, and records decisions.
- Specialist: focused subagent role used only when it improves outcome or reduces risk.
- Skill: lazy-loaded capability package activated by project signals or explicit task need.
- Harness: runtime that executes or assists agents.
- Adapter: translation layer from Alfred core to a harness.
- PermissionPolicy: explicit action rules for agents, skills, and runtime tools.
- TraceEvent: machine-readable event emitted for audit and observability.
- EvalCase: reproducible test case for agent, skill, policy, or adapter behavior.
- Baseline: approved result set used to detect regressions.
- LocalCapability: deterministic local tool/script used before provider calls.
