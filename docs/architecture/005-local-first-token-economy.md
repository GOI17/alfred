# Local-First Token Economy

## Rule

Do not call an LLM/provider if deterministic local computation can solve or reduce the task.

## Execution Strategy

- `local-only`: local tools/scripts are enough.
- `hybrid`: local preprocessing reduces provider payload.
- `provider`: semantic judgment or generation requires provider.

## Local Capabilities

Use local computation for file discovery, stack detection, AST extraction, schema validation, frontmatter validation, prompt hashing, policy checks, trace validation, eval comparison, token estimation, duplicate detection, and changed-file detection.

## Provider Request Gate

Every provider request must pass through a gate that checks local capabilities, preprocesses context, estimates cost, chooses strategy, and emits trace events.
