---
id: execution/simplify-memory-onboarding
description: Remove the agent-kind choice from web signup while preserving the tenant API contract.
owner: core
phase: issue-202-simplify-memory-onboarding
issue: 202
---

# Simplify Memory onboarding

## Intent

Reduce friction in the small web signup flow by removing a choice that web
users do not need to make. Every tenant created through this flow is a human
agent tenant.

## Scope

- Remove the Human agent and Hybrid radio controls from the Console signup UI.
- Send an explicit `human_agent` kind in every web signup request.
- Keep the source, built Console artifact, and public Memory app synchronized.
- Do not change backend tenant kinds, request validation, API behavior,
  persistence, or existing tenants.

## Requirements and scenarios

### R1: Single-path web signup

The web signup flow MUST omit the agent-kind choice and MUST explicitly submit
`kind: "human_agent"`; it MUST NOT depend on an absent form control or an
implicit backend default.

#### Scenario: Create a tenant through web signup

- GIVEN a visitor provides a valid display name and optional recovery email
- WHEN the visitor creates their Memory tenant
- THEN the request includes the explicit kind `human_agent`
- AND no agent-kind choice is shown before submission

#### Scenario: Signup markup has no kind selection

- GIVEN the source, built Console, and public Memory app are synchronized
- WHEN their signup UI is inspected
- THEN Human agent and Hybrid radio controls are absent
- AND signup still submits `human_agent`

### R2: Compatibility boundary

The backend tenant-kind enum and signup API MUST remain unchanged. Existing
tenants MUST retain their stored kind, and non-web API clients MAY continue to
use any kind already accepted by the backend contract.

#### Scenario: Existing tenant compatibility

- GIVEN tenants created before issue #202, including hybrid tenants
- WHEN the simplified web signup is released
- THEN no tenant is migrated or reclassified
- AND backend enum and API behavior remain unchanged

## Implementation files

- `packages/console-web/src/index.html` — canonical signup UI and request.
- `packages/console-web/dist/index.html` — synchronized built Console artifact.
- `site/memory/app/index.html` — synchronized public Memory app.
- `packages/console-web/test/build.test.mjs` — focused regression coverage.

## Verification

- `node --test packages/console-web/test/build.test.mjs`
- `npm --prefix packages/console-web run check`
- Confirm the source, built artifact, and public app contain no `signupKind`
  control and submit the explicit `human_agent` value.
- Confirm the change set contains no backend enum, API, migration, or tenant-data
  modifications.
- Provider calls remain `0`.

## Completion conditions

- [ ] The web signup presents no agent-kind choice.
- [ ] Every web signup explicitly requests `human_agent`.
- [ ] Existing tenants and the backend tenant-kind contract are unchanged.
- [ ] Focused Console tests and checks pass.

## Reference

- GitHub issue: `#202`
