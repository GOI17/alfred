# Pi Adapter Design

## Goal

Make Pi.dev the first runtime adapter without leaking Pi concepts into core.

## Responsibilities

- Load Alfred registry and policies.
- Map Orchestrator to Pi runtime control flow.
- Simulate/manage specialists through Pi extensions or spawned sessions.
- Load skills on demand.
- Resolve user-owned model assignments without hard-coding provider/model IDs in agent specs.
- Apply retry and fallback model policy for recoverable provider failures.
- Enforce ProviderRequestPolicy before provider calls.
- Enforce PermissionPolicy before tools/actions.
- Emit TraceEvent records.
- Support eval execution and replay.

## Non-Responsibilities

- Do not define domain concepts.
- Do not own security policy.
- Do not own eval semantics.
