# Model Assignment Policy

## Principle

Agent specs define behavior, responsibilities, permissions, and handoff rules. They must not require a specific provider or model.

The user owns model assignment. A harness adapter may read user configuration and bind models at runtime, but that binding is not part of the agent identity.

## Why

Hard-coding models such as "Orchestrator must use Claude Opus" leaks vendor preference into the domain. That breaks harness portability, makes evals harder to reproduce across providers, and prevents users from optimizing for cost, latency, privacy, local execution, or availability.

## Runtime Contract

For every provider-backed request:

1. Apply the local-first ProviderRequestPolicy before selecting a model.
2. Resolve the agent's user-configured primary model.
3. Attempt the primary model up to `retries_before_switch` times for recoverable failures.
4. Switch to the next configured fallback model after retry exhaustion.
5. Repeat until a model succeeds or the fallback chain is exhausted.
6. If all configured models fail, stop and explain to the user why Alfred cannot complete the task.

## Failure Explanation

The user-facing failure must include:

- The agent that attempted the task.
- The operation that failed.
- The recoverable failure categories encountered.
- How many attempts were made.
- Which fallback models were exhausted, redacted if the harness marks model names private.
- The safest next action for the user.

## Boundaries

- Core owns the model assignment and fallback policy shape.
- Adapters translate user config into runtime model bindings.
- Agent specs cannot name required model IDs.
- Skills cannot override model assignment policy.
- Temporary agents inherit the same user-owned model assignment rule.
- Install/update may preview smart defaults from local-only provider detection, but must write only `~/.alfred/models.json` after an explicit apply/approval path.
- Model assignment configuration must not write live harness config.
- Provider-qualified IDs such as `anthropic/claude-sonnet-4` are opaque user-owned strings; core does not parse provider semantics from them.
