---
id: execution/homebrew-audit-fix
description: Remove the redundant version stanza reported by strict Homebrew audit.
phase: issue-120-homebrew-audit
author: core
issue: 120
---

# Homebrew strict-audit fix

## Finding

After publishing the initial private formula, `brew audit --strict` reported
that `version "0.5.0"` was redundant because Homebrew already infers the same
version from the immutable `v0.5.0` tag.

## Change

The formula generator continues to require a semantic version for source pin
generation, but no longer renders an explicit `version` stanza. Tests reject a
regression in both the generator and Homebrew contract validator.

## Completion conditions

- [x] Generator tests pass.
- [x] Homebrew contract validator passes.
- [x] Generated formula passes `brew style`.
- [x] Published formula passes `brew audit --strict`.
- [x] Published formula installs and passes `brew test`.
- [x] Provider calls remain 0.
