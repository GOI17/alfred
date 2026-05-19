# Provider Request Policy

## Rule

Provider requests are forbidden when local deterministic work is enough.

## Gate

Before provider request:

1. Classify task.
2. Check LocalCapability registry.
3. Run local preprocessing when useful.
4. Remove irrelevant context.
5. Estimate tokens and cost.
6. Choose `local-only`, `hybrid`, or `provider`.
7. Emit trace event.

## Required Trace Events

- `provider_request_avoided`
- `provider_request_reduced`
- `provider_request_sent`
