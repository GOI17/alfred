# ADR 010: Alfred authority within a managed execution boundary

Status: first managed CLI slice verified after rebase onto main for issue #217. Full tests, checks and existing eval baseline comparison pass. Native host bridges, generic skill invocation and the full objective remain pending. Validation evidence is recorded in the SDD.

## Context

Alfred already defines neutral orchestration and permission functions. The CLI dispatches through `packages/memory-server/scripts/alfred.mjs`; its current init provisions Memory. Pi includes executable spikes, while Codex/OpenCode integrations generate host artifacts. These do not establish universal request interception.

## Decision

Alfred owns the policy and state machine in core. Infrastructure implements instruction lookup, global discovery, project grant storage, consent presentation, execution and trace ports. Introduce executable `alfred runtime init/run/status` as the first managed boundary, without changing Memory init semantics or creating a separate domain in CLI/adapters. The first executor is the reviewed `read-text-v1` file-read contract returning a validated snapshot; arbitrary commands and general host execution are outside this slice.

Every managed request consults Alfred first. Only an explicit absence of applicable instructions permits global discovery. Denials, lookup errors, ambiguity, cancellation and execution failures are terminal and never trigger fallback.

Global option consent offers Permitir (one request), Permitir siempre (specific option/content/action/scope in this project), and Cancelar. Persistent grants bind to the canonical workspace path rather than the shared Git project root. Copied state and sibling worktrees do not inherit consent. Grants are checked against current policy and content before actual execution; they never supersede security policy.

Concrete actions are supplied by future Alfred skills. Examples such as opening a URL do not create action-specific runtime requirements. The runtime owns generic resolution, authorization and invocation; skills own the procedures for their actions.

## Hard platform boundary

Product precedence governs only operations Alfred can mediate. Host system instructions, sandbox, security policy and approval requirements remain authoritative constraints. Alfred may impose additional restrictions but cannot relax host restrictions. Instructions generated into host configuration are advisory integration until a verified bridge intercepts the relevant request and execution lifecycle. Hosts that cannot provide this boundary must report partial or unsupported coverage.

## Consequences and tradeoffs

The first slice provides real execution and auditable consent through a bounded CLI surface, rather than claiming coverage for every native host request. It leaves host bridges and durable loops to later stages. This narrows initial compatibility but makes guarantees testable.

Existing core filesystem helpers are legacy structure, not permission to add infrastructure to the new policy module. Existing `resolveProjectIdentity` intentionally identifies a shared project across worktrees; using it for grants would widen consent incorrectly. Canonical workspace binding trades automatic relocation portability for project isolation; moving or copying a workspace requires renewed consent.

Use minimal injected ports and existing packages. Do not introduce a parallel orchestration domain in Memory, CLI or host adapters. Do not change eval baselines as part of this decision.

## Verification

See [runtime authority SDD](../../.ai/execution/alfred-runtime-authority.md) for API outcomes, integration files and acceptance cases, including real execution, non-TTY denial, copied-project isolation, content-bound grants and revalidation immediately before execution.

## Architecture trace

`issue-217-runtime-authority-v1`: architect selected core-owned decisions, a managed CLI execution boundary, workspace-local grants and staged host integration. Analysis and documentation used local tools; no provider calls were initiated by tools.

## Delegation and lifecycle refinement (R7 core verified; native lifecycle pending)

User policy supersedes small/simple-task direct execution. The Orchestrator delegates all substantive tasks, including read-only analysis, and assigns each independent task a fresh native Git worktree; continuations and specialists share the verified parent-task worktree. Parallel work requires independence and disjoint write scopes; dependencies are sequential. At completion the user chooses whether the worktree is removed; branches, remotes and changes are preserved.

The sole quick single-question exception is a plain answer already available without analysis or actions. Explicitly treating this as no tools/no delegation/no worktree resolves the otherwise conflicting universal worktree and no-tool rules. This does not exempt read-only analysis. Necessary orchestration mechanics remain allowed; optional business tools do not. Product precedence never overrides host controls. See SDD R7 for the implemented decision API and final passing tests/checks/evals. Native host lifecycle integration remains pending; core planning results do not prove host execution.
