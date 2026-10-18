# Delegation Policy

The Orchestrator delegates every task except a quick, single conversational question whose answer is already available in context and requires no analysis, coding, commands, external-state lookup, tools or other action. Size, simplicity, formatting or a one-file change never establishes this exception. Unknown classification is not quick. This supersedes the former small/simple-task direct-handling rule.

## Tool necessity and product precedence

Consult applicable Alfred instructions first within the platform's instruction hierarchy. Alfred governs product behavior it can mediate; it cannot override host system instructions, sandbox, approvals or security controls.

Do not execute or call tools when the requested result can be produced without them. For a qualifying quick answer, respond directly without tools, delegation or a worktree. For other tasks, necessary delegation and native Git worktree lifecycle tools are permitted to honor the explicit orchestration obligations; so are tools needed for requested actions and required verification. This does not authorize optional searches, business actions, memory writes or provider calls merely because tools exist. ProviderRequestPolicy and existing permissions still apply.

## Explicit resolution of the worktree ambiguity

“Every new task gets a worktree” applies to every independent substantive task, including read-only analysis. The sole conversational exception above is interpreted as a plain answer, not a repository task: creating its worktree would contradict the explicit no-tools exception. This is an explicit architecture resolution, not a general read-only exemption.

Create a fresh native Git worktree and task branch for a new independent task. Continuations and delegated subtasks retain the parent task identity and reuse its verified dedicated worktree. Reuse requires matching task ownership, repository, canonical path and branch; an unrelated worktree or a caller's unsupported continuation claim is insufficient. Do not create a new issue or branch merely because an existing task gains another requirement.

At task completion ask whether the user wants its worktree removed. No answer means no removal. A choice to remove the worktree is not permission to delete branches/remotes or discard user changes. Preserve uncommitted/unmerged work and changes belonging to others; never force cleanup. The parent Orchestrator asks once for the completed parent task, not after each specialist handoff.

## Delegation and scheduling

The Orchestrator selects the appropriate specialist and decides parallel or sequential execution. Delegated specialists retain their roles; this policy does not require recursive delegation of their assigned work.

Run in parallel only when tasks are explicitly independent, have no dependency edge between concurrently executing work, and have known disjoint write scopes. Shared read-only inputs are allowed. Unknown independence or scope means sequential scheduling; overlapping scopes and dependencies require sequencing. Invalid dependency graphs block scheduling. Pass the same verified parent-task worktree to its specialists and assign disjoint ownership when parallel.

If no specialist fits, create a TemporaryAgent proposal. Do not promote without human approval. Missing specialist capability never enables direct execution by the Orchestrator; report the blocker/proposal while preserving the task.

Every delegation decision records reason, target, skills considered/loaded, permissions requested, task identity, tool necessity, scheduling mode and worktree creation/reuse decision. A no-tool conversational answer uses the existing response/session trace channel; do not call a logging tool solely to record the exception. Never claim a persistent trace was written when it was not.
