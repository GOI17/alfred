---
id: execution/neon-pooling-deploy-gate
description: Add Neon pooled-tenant regressions to the deterministic deployment gate.
phase: issue-130-neon-deploy-gate
author: core
issue: 130
---

# Neon pooling deployment gate

## Goal

Keep deployment validation aligned with the regression tests added for Neon
pooled tenant provisioning and runtime queries.

## Requirements

1. The memory-server console gate must execute both the console tests and the
   focused Neon pooling tests.
2. The exact expected count must be 103: 100 console tests and 3 Neon pooling
   tests.
3. The updated gate must pass before deployment is relaunched.
4. Provider calls remain 0.

## Completion conditions

- [x] Gate includes the focused Neon pooling suite.
- [x] Expected test count is 103.
- [ ] Release validation passes in CI.
- [ ] Fly deploy and health smoke test pass.
- [x] Provider calls remain 0.
