# Monorepo Boundaries

Alfred is one product with three autonomous capability families. Sharing a
repository or release does not create a runtime dependency between them.

| Family | Packages | Responsibility |
|---|---|---|
| Composition | `cli`, setup UI and installer scripts | Dispatch product commands and prepare explicitly selected capabilities |
| Workspace | `workspace` | Projects, conversations, local tools, web assets, session contracts |
| Memory | `memory`, `memory-server`, `memory-client`, `memory-mcp`, `console-web`, Memory adapters | Knowledge persistence, tenancy, local API and clients |
| Agent Harness | `agent-harness`, `core`, runtime/skill/profile managers, harness adapters, `evals` | Agent operations and integration with external coding harnesses |

## Dependency direction

`packages/cli` is a neutral composition root. Its lazy dispatcher calls each
capability's public `run(args, env)` entrypoint. A capability's standalone
executable does not import the product CLI or require its peers.

Workspace, Memory, and Agent Harness must not import one another's implementation
or inspect private peer configuration or stores. Optional integrations use
explicit public contracts and caller-provided configuration. Setup selects
capabilities; selection itself does not connect services.

Within Agent Harness, adapters depend on `core`; core never depends on adapters.
This rule does not make `core` the universal domain for all three capabilities.
Memory and Workspace retain their own domains, state, and ports.

Old product launcher paths under `memory-server/scripts/{alfred,runtime,setup}.mjs`
remain compatibility shims only. Standalone Memory does not import them. They do
not make Memory the product entrypoint or a dependency of Workspace or Agent
Harness.

## Public contracts

- Product and standalone command entrypoints expose `run(args, env)`.
- Workspace exposes `SessionPort`/`SessionAdapter`; the composition caller
  explicitly supplies an adapter. A built-in legacy adapter remains compatible.
- Memory exposes HTTP, client, and MCP contracts with explicit endpoint,
  credentials, and tenant scope. Its HTTP service remains local-only.
- Agent Harness exposes its command/runtime/skill/profile contracts without
  requiring Workspace or a persistence provider.

No new Alfred SessionAdapter or ACP execution backend is implied by these
boundaries. See [the capability decision](011-product-capabilities.md).
