# Project Charter

## Identity

Name: Alfred  
Umbrella: AlfredLabs  
Tagline: Alfred handles the operational burden so humans focus on decisions.

## Purpose

Alfred is a local-first product with three independent capabilities: Workspace for projects, conversations, and local tools; Memory for persistent knowledge; and Agent Harness for operating agents, subagents, and skills across coding harnesses. Use each capability on its own, or connect them explicitly through public contracts.

The product CLI is the explicit composition root. Capability implementations do
not depend on each other or assume a peer service exists. See
[Product capabilities](011-product-capabilities.md) for the package boundaries.

Agent Harness manages operational burden for AI coding workflows:

- routing
- delegation
- skill detection
- permissions
- traceability
- evals
- reproducibility
- regression detection
- local-first execution
- harness adaptation

## Non-Goals

- Do not become a prompt dump.
- Do not make opencode, Pi, Claude, Codex, VSCode, or Kiro concepts part of the core domain.
- Do not accept prompt changes without eval evidence.
- Do not call providers when local deterministic work is enough.

## Human Authority

Humans keep decision authority over temporary agent promotion, permission escalation, baseline updates, and regression tradeoffs.
