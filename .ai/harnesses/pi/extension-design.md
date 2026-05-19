# Pi Extension Design

## Extension Hooks Required

- pre-message context injection for selected skills.
- provider request gate.
- tool/action permission gate.
- trace sink integration.
- command for running evals.
- command for reloading Alfred registry.

## Runtime Flow

1. Receive task.
2. Load registry and policy.
3. Run local-first provider gate.
4. Invoke Orchestrator.
5. Delegate to specialist only when policy says useful.
6. Emit trace events.
7. Return result and pending human decisions.
