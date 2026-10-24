# Product capabilities and explicit composition

Status: accepted for issue #240; implementation and release validation are tracked
in `.ai/execution/workspace-product-packages.md`.

## Decision

Alfred offers Workspace, Memory, and Agent Harness. Each capability has its own
entrypoint, lifecycle, state, domain, and configuration. All three can be used
alone; all seven nonempty combinations can be selected. A shared repository or
installer must not introduce required peer dependencies or invisible connections.

`packages/cli` owns product command composition. It dispatches lazily to public
`run(args, env)` entrypoints for `alfred workspace`, `alfred memory`, and
`alfred harness`. Standalone commands are `alfred-workspace`, `alfred-memory`, and
`alfred-agent-harness`. Existing global aliases remain compatible. Deprecated
launcher paths under Memory are compatibility shims, excluded from Memory's
standalone dependency path.

## Optional integration contracts

Workspace exposes `SessionPort` / `SessionAdapter`. An external composition caller
supplies the adapter to `createApp`; injected runtimes do not inherit legacy
permissions, tools, credentials, or recovery. The existing legacy adapter remains
compatible. No Alfred Agent Harness adapter or ACP execution backend is added
merely by placing Workspace in the monorepo.

Memory exposes HTTP/client/MCP contracts with explicit caller-selected endpoint,
credentials, and scope. Its service remains loopback-only even with a remote
Postgres storage backend. Agent instructions may use an explicitly configured
persistence capability, without requiring a named product or a sibling service.
Proactive persistence safeguards and human authorization remain unchanged.

Agent Harness owns agent operations and integration with external harnesses.
Its core remains harness-agnostic and must not import adapters. Workspace and
Memory do not depend on that core simply because they share the Alfred product.

## Setup and state compatibility

Setup stores approved capability selection in `.alfred/setup/components.json`
(`alfred.setup.components/v1`). Preview and discovery remain write-free. The
existing managed harness receipt `.alfred/setup/installation.json`
(`alfred.setup.installation/v1`) remains compatible with 1.1.0. A capability
preference is not proof of an active project integration.

Historical editions map as follows: `coding` → Agent Harness; `memory` → Memory;
`full` → Agent Harness + Memory. Upgrades never infer Workspace selection. A user
explicitly selects Workspace to add it. Selecting multiple capabilities does not
start services, create tenants, propagate credentials, configure MCP, or install
a session adapter.

A Memory filesystem workspace binding is not the Workspace application. Registry
IDs, table names, and tenant access semantics remain unchanged. No data migration
is required merely to introduce the product capability name.

## Source and release boundary

Workspace is imported from source commit
`1e8c624d65e9814549d8604db181d716bc0dd0f4`, tree
`2683a7993053da9cd3c81293869ba214cdd079ba`. Its 175-file snapshot and transformations
are recorded in `packages/workspace/upstream-snapshot.json`. The original checkout
and repository history remain preserved; no private state or credentials are
imported. Source did not contain a project LICENSE/NOTICE, so none is invented.

The installed 1.1.0 release does not gain Workspace from source edits. Distribution
must validate actual packaged web assets and terminal spawning on macOS/Linux,
x64/arm64 before publishing the new runtime. Browser engines remain opt-in; the
terminal dependency is required and bundled. See
[the migration guide](../workspace-migration.md) for operators and
[monorepo boundaries](003-monorepo-boundaries.md) for implementation ownership.
