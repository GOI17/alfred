---
id: execution/memory-console-session-controls
description: Let authenticated Memory Console users inspect, copy, and locally clear their active API key.
owner: core
phase: issue-161-memory-console-session-controls
author: core
issue: 161
---

# Memory Console session controls

## Goal

Give users who already unlocked the Alfred Memory Console a clear way to
consult their current `alk_...` credential and end the browser session.

## Context

The Console restores the active API key from browser `localStorage`, but the
unlocked interface does not expose that value after the one-time issuance
banner disappears. It also has no logout action, so users cannot remove the
credential through the UI. The server stores only a key hash and therefore
cannot recover a secret that is no longer present in the browser.

## Requirements

### R1: Current-session credential

1. The unlocked view shows a dedicated Current session panel.
2. The panel receives only the API key already held in the browser; it does not
   call a new endpoint or reconstruct a key from its public prefix.
3. The key is masked by default and is revealed only after a deliberate user
   action.
4. The user can hide the key again without changing the active session.

### R2: Clipboard behavior

1. A Copy action writes the active key directly to the browser clipboard.
2. Copy success and failure are reported through an accessible live region.
3. Clipboard failure leaves the key available for deliberate reveal and manual
   copy; the value is never logged, traced, or sent to another endpoint.

### R3: Local logout

1. Logout removes `alfred_api_key` from `localStorage` and clears the in-memory
   credential.
2. Logout clears the credential input, current-session field, generated key
   banners, tenant/key results, and tenant selection state.
3. The Console returns to its locked state and a later page reload does not
   restore the prior session.
4. Logout is local to the browser and does not revoke the API key for agents or
   other browsers.

### R4: Compatibility and safety

1. Signup, manual unlock, recovery, tenant listing, key issuance, and key
   revocation behavior remain unchanged.
2. The static Console, bundled distribution, and public Memory app share the
   same session-control behavior.
3. Deterministic checks cover the required DOM controls and secret-clearing
   behavior.
4. Provider calls remain `0`.

## Completion conditions

- [x] The active key is masked by default and can be shown, hidden, and copied.
- [x] Copy feedback is accessible and never contains the credential.
- [x] Logout clears all browser-held session state and secret-bearing UI.
- [x] Reload after logout stays locked.
- [x] Console checks, tests, and public-site validation pass.
- [x] Generated artifacts are synchronized and provider calls remain `0`.

## References

- Issue: https://github.com/GOI17/alfred/issues/161
- Console source: `packages/console-web/src/index.html`
- Console tests: `packages/console-web/test/build.test.mjs`
- Public Memory app: `site/memory/app/index.html`
