# Alfred capabilities

Alfred offers Workspace, Memory, and Agent Harness as parts of one product.
Each has its own entrypoint, configuration, state, lifecycle, and public
contracts. Each remains useful with the other two absent.

| Capability | Command | Standalone executable | Package family |
|---|---|---|---|
| Workspace | `alfred workspace` | `alfred-workspace` | `@alfred-labs/workspace` |
| Memory | `alfred memory` | `alfred-memory` | `memory`, `memory-server`, clients/adapters/console |
| Agent Harness | `alfred harness` | `alfred-agent-harness` | `agent-harness`, core, runtime/skill/profile managers, harness adapters, evals |

These namespaced entrypoints are available in source and require a release after 1.1.0. The
installed CLI only gains them when its published runtime is upgraded. Existing
`alfred init`, `serve`, `runtime`, and `skills` remain supported aliases.

## Use independently

Workspace provides projects, conversations, files, terminals, and local tools.
`alfred-workspace serve` binds to `127.0.0.1:4310` by default. Configure state
with `--data-dir`, outside the installed package. Browser tools require an
explicit Playwright browser-engine installation when needed; browsers are not
downloaded by Homebrew installation. A missing browser does not prevent ordinary
Workspace operation.

Memory provides persistent knowledge through a local API, MCP, and its own
console. Initialize a tenant with `alfred-memory init`; start the HTTP service
with `alfred-memory serve`. The HTTP service always runs on loopback. SQLite or
user-chosen Postgres storage does not change that hosting rule. The retired
managed hosted service is not restored by product composition.

Agent Harness operates agents, skills, policies, runtime profiles, and harness
integration. For example, `alfred-agent-harness skills list` inventories skills;
`alfred-agent-harness runtime status` reports project runtime state. It can run
without a persistence service or the Workspace application. Agent Harness is a
capability name; a *harness* is the external runtime hosting an agent.

## Configure capabilities without connecting them

`alfred setup` offers three independent selections. Automation can select any
nonempty combination using `--components=workspace,memory,harness`. Selection
prepares the chosen capability configuration; it is not a service start or an
integration authorization.

After approved Apply, `.alfred/setup/components.json` stores product preferences
using `alfred.setup.components/v1`. Discovery and preview do not write this file.
The separate `.alfred/setup/installation.json` receipt continues to describe
managed project harness files using `alfred.setup.installation/v1`. Component
preferences do not prove a harness has loaded those files.

Historical editions remain compatible:

| Existing selection | Capabilities |
|---|---|
| `coding` | Agent Harness |
| `memory` | Memory |
| `full` | Agent Harness + Memory |

An upgrade preserves these mappings and existing 1.1.0 integration receipts. It
does not add Workspace to old `full` selections. Choose Workspace explicitly.
Open setup and review Update to refresh the CLI and then the managed project
integration; saved harness choices avoid repeating the initial questionnaire.
Local edits and ambiguous legacy files remain conflicts requiring review.

## Connect through explicit contracts

The product CLI is the composition root: it knows all three command families and
loads only the one invoked. Capability implementations do not import peer
implementations or inspect their private data stores.

Workspace exposes `SessionPort` / `SessionAdapter` and accepts an explicit
`createApp({ sessionAdapter })` integration. Its runtime descriptor reports the
configured runtime capabilities. The existing legacy adapter remains a
compatibility implementation, not an implicit dependency on Agent Harness.
An injected runtime does not inherit legacy tools, credentials, permissions, or
recovery behavior. This migration does not implement an Alfred Agent Harness
SessionAdapter or claim ACP execution support.

A caller can explicitly configure an authorized Memory endpoint through its
HTTP/client/MCP contract. That caller supplies endpoint, credentials, and scope.
Neither Workspace nor Agent Harness discovers a sibling Memory service, starts
it automatically, copies credentials, or chooses its tenants. Selecting several
setup components does not configure MCP or session adapters.

Agent instructions describe optional persistence generically. For an explicitly
configured Alfred Memory MCP connection, the guarded capture operation is
`memory_capture` (client equivalent `captureMemory`) with `{ candidate, context }`.
Candidate content is an exact minimal excerpt of evidence, with origin `user` or
`verified`; respect the instruction's size, privacy, and opt-out rules. A skipped
or failed capture must not be bypassed with `memory_create`. Other persistence
providers must honor the same safeguards through their advertised contract.
Without an authorized persistence capability, ordinary agent work continues.

## Distinguish application and filesystem workspace

The **Workspace capability** is the projects/conversations/tools application.
A **Memory workspace binding** associates a filesystem directory with a tenant.
The existing registry's workspace IDs, `tenant_access`, and database tables keep
their meanings and names. Installing Workspace neither creates those bindings
nor migrates Memory data.

See [architecture boundaries](architecture/011-product-capabilities.md),
[Workspace migration](workspace-migration.md), and
[distribution requirements](../packaging/runtime/README.md).
