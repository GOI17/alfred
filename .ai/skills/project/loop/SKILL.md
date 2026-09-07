---
id: loop
name: loop
scope: project
description: Use when a task needs bounded repetition with explicit iteration, retry, cancellation, and no-progress controls.
---

# LOOP

Use LOOP only for repetition that is finite, observable, and interruptible.
Activation does not grant new permissions or approvals.

## Required contract

Record all of these before the first iteration:

- the objective and observable success condition;
- `max_iterations`, a positive finite integer;
- `retry_budget`, a finite non-negative integer;
- `no_progress_limit`, a positive finite integer no greater than
  `max_iterations`;
- cancellation signal or cancellation check;
- applicable approval, action, cost, or time limits.

Missing or invalid limits block execution. Never translate words such as
"until done" into an unbounded loop.

## Accounting and control

1. Initialize monotonic counters for iterations, retries, and consecutive
   no-progress results. Never reset iteration or retry accounting.
2. Check cancellation, policy, approval state, and all budgets before each
   attempt and after each result.
3. Count every attempt as an iteration. Count an additional retry whenever an
   attempt repeats work after a recoverable failure.
4. Record the attempted change, deterministic observation, counter values, and
   whether measurable progress occurred.
5. Increment the no-progress counter when the observable state does not advance;
   reset only that counter after measured progress.
6. Stop immediately on success, cancellation, policy denial, unmet approval,
   iteration exhaustion, retry exhaustion, no-progress exhaustion, or another
   declared bound.

## Result

Report the stop reason, final counters, per-iteration evidence, unresolved
failures, and the next decision. Do not hide failed attempts or consume retries
without accounting for them.

LOOP must not relaunch a harness, persist itself as a background worker, change
models, broaden permissions, bypass approvals, or weaken higher-priority policy.
