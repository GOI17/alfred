# Phase 4: Security + Permissions Enforcement

Goal: make policy real.

Tasks:

- Implement PermissionPolicy evaluator.
- Enforce deny-by-default.
- Protect secret paths.
- Block destructive commands by default.
- Add security evals.

Runtime artifacts:

- `packages/core/src/index.js#evaluatePermission` evaluates agent intent, protected paths, destructive commands, and deny-by-default without depending on a harness.
- `packages/core/src/index.js#enforcePermission` remains the throwing guard for callers that require hard failure on non-allow decisions.
- `packages/pi-adapter/src/runtime.js#runPiSecuritySpike` runs deterministic allowed/denied scenarios and emits a generated trace.
- `.ai/observability/generated/phase-4-permission-enforcement.json` is produced by code, not hand-written.
- `.ai/evals/baselines/phase-4-security-enforcement.json` records the reproducible Phase 4 baseline.

Completion conditions:

- At least one permission check is allowed.
- Protected path access is denied before agent-specific permissions can allow it.
- Destructive commands are denied before agent-specific permissions can ask/allow them.
- Permission broadening is denied.
- Unknown intents fall back to the default deny policy.
- Provider calls remain `0`.
- `pnpm validate:phase4`, `pnpm check`, and `pnpm test` pass.
