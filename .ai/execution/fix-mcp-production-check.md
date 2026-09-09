---
id: execution/fix-mcp-production-check
description: Keep the production MCP dependency check aligned with the required Memory client contract.
phase: issue-215-fix-mcp-production-check
author: core
issue: 215
---

# Fix MCP production dependency check

## Goal

Restore Fly deployments after proactive memory introduced the required
`captureMemory` client operation.

## Root cause

The MCP server correctly requires six Memory client methods, but
`scripts/check-memory-mcp-production.mjs` still supplied the previous five.
The full validation suite passed because the stale production-only check ran
inside the Docker build, after the deploy job had already staged secrets.

## Changes

1. Supply `captureMemory` through the same storage-blocking stub as every other
   client operation in the production dependency check.
2. Run the production dependency check in the validation job, before any Fly
   secret or deployment operation.

## Acceptance criteria

- [x] The production dependency check initializes the MCP server without
      calling storage.
- [x] Focused MCP tests pass.
- [ ] A local Docker image builds successfully.
- [ ] Fly deployment, health, and MCP discovery checks pass.

<!-- Trace: task_classified=production-build-contract-fix; isolation=issue-215-native-git-worktree; provider_request_avoided=local-only; permission_allowed=production-check-workflow-and-sdd-spec; delegation=none-small-bounded-fix -->
