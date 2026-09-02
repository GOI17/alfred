---
id: execution/console-api-status
description: Prevent the Memory console from crashing after a successful tenant bootstrap.
phase: issue-132-console-api-status
author: core
issue: 132
---

# Console API status

## Goal

Ensure every unlock path can update the console status after a tenant is
created, an existing key is entered, or a recovery key is issued.

## Requirements

1. The HTML must declare the `apiStatus` element referenced by all unlock
   flows.
2. The status must be visible and exposed as an accessible live region.
3. The static HTML check must reject literal `getElementById` references whose
   matching HTML IDs are absent.
4. The production console artifact must be rebuilt and deployed.
5. Provider calls remain 0.

## Completion conditions

- [x] `apiStatus` exists in source HTML.
- [x] Missing literal DOM IDs fail validation.
- [x] Console build and site validation pass.
- [ ] Production artifact contains `apiStatus`.
- [x] Provider calls remain 0.
