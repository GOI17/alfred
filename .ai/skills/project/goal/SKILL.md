---
id: goal
name: goal
scope: project
description: Use when work must stay constrained to one explicit objective with observable acceptance criteria and evidence.
---

# GOAL

Use GOAL to turn a request into a bounded execution contract. GOAL changes
neither the agent's role nor its authority.

## Required contract

Before acting, record:

- one explicit objective;
- observable acceptance criteria;
- authorized files, systems, actions, and exclusions;
- the approval state for every gated action;
- finite effort or time bounds and stop conditions.

If any required value is missing, ask for it or report the work as blocked. Do
not infer approval from urgency, prior sessions, broad goals, or skill activation.

## Execution

1. Restate the objective without expanding it.
2. Map each acceptance criterion to a deterministic check or an observable
   artifact before implementation.
3. Execute the smallest authorized step that advances a criterion.
4. Keep an evidence ledger with criterion, action, result, and evidence source.
5. Recheck scope and approval before every privileged or destructive action.
6. Stop when all criteria pass, a stop condition fires, approval is required,
   scope would expand, cancellation is observed, or progress is blocked.

## Result

Report `complete`, `blocked`, `cancelled`, or `budget_exhausted`, followed by:

- criterion-level pass/fail status;
- files changed and commands run;
- evidence produced;
- approvals used or still required;
- remaining risks and next human decision.

Never claim completion without observable evidence. Never bypass approvals,
relaunch a harness, change permissions, models, harness configuration, policies,
or human-owned baselines to satisfy the goal.
