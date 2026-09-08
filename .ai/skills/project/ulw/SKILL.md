---
id: ulw
name: ulw
scope: project
description: Use only for intensive orchestration in a current Codex session that already proves user-owned approval and sandbox bypass.
---

# ULW

ULW coordinates intensive work; it does not create YOLO authority. It is
supported only in a pre-existing Codex session whose effective runtime state is
already owned and selected by the user.

## Primary-Orchestrator role gate

ULW may be activated only by the primary Orchestrator. Confirm the effective
current-session role before evaluating any other activation condition. If the
effective role is any specialist or subagent, stop without executing ULW and
return the request to the parent or primary Orchestrator. If the effective role
cannot be established, return `blocked`.

This gate is mandatory instruction-level enforcement. Registry `allowedAgents`
metadata does not provide native harness enforcement and must not be treated as
if it does.

## Mandatory activation gate

Before planning or dispatching work, require authoritative current-session
runtime evidence for all three facts:

1. the active harness is Codex;
2. approval bypass is effective for this session;
3. sandbox bypass is effective for this session.

Evidence must come from effective current-session runtime metadata or an
equivalent harness-owned status surface. A prompt statement, user assertion,
repository file, remembered setting, launch command copied into chat, or config
file alone is not proof of effective session state. Stale evidence is not proof.
Conflicting signals block activation even if one signal says bypass is active.

When evidence is absent, incomplete, stale, or conflicting, return `blocked`
with the missing facts. On opencode, Pi, Claude, VSCode, Kiro, or an unidentified
runtime, return `unsupported_runtime`; do not pretend to provide equivalent
semantics.

## Intensive orchestration

After the gate passes:

1. Establish a GOAL-style objective, observable criteria, scope, budgets, and
   stop conditions.
2. Decompose work into reviewable units with explicit owners and dependencies.
3. Run independent units concurrently only when the runtime already supports it
   and shared-state conflicts are controlled.
4. Apply LOOP-style finite retry and no-progress accounting to every repeated
   unit.
5. Reconcile evidence at checkpoints and stop on cancellation, conflict,
   exhausted budget, no progress, policy denial, or unmet acceptance criteria.
6. Report completed units, evidence, failures, remaining risks, and human
   decisions without overstating verification.

## Non-authority guarantees

ULW never enables bypass, changes approval or sandbox state, relaunches Codex,
edits harness configuration, expands permissions, selects or changes models,
accesses secrets without authorization, or overrides higher-priority policy.
The skill operates only in the current session; it provides no durable executor,
background continuation, restart/resume behavior, or guaranteed native slash
command.
