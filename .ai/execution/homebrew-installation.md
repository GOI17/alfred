---
id: execution/homebrew-installation
description: Package Alfred for reproducible installation through a maintained Homebrew tap.
phase: issue-118-homebrew-installation
author: core
issue: 118
---

# Homebrew installation

## Goal

Allow collaborators to install a versioned Alfred CLI and its guided suite
installer with:

```sh
brew install GOI17/tap/alfred
```

## Context

The existing `curl | sh` entrypoint downloads the installer from `main` and is
useful for bootstrap flows. Homebrew needs a stable package boundary: a formula
must install commands into its keg, declare Node explicitly, avoid modifying
user or harness configuration during `brew install`, and use immutable source.

`GOI17/alfred` is private and has no public distribution license. The initial
tap is therefore private and uses Git source pinned by both tag and commit
revision so Homebrew can reuse a collaborator's GitHub credentials. The formula
generator also supports a public archive mode with SHA-256, but publishing
source or release assets publicly remains a separate human decision.

## Requirements

### R1: Deterministic formula generation

1. Generate the formula locally with no provider requests.
2. Accept a semantic version plus exactly one immutable source mode:
   - private Git: tag plus 40-character commit revision;
   - public archive: tag URL plus 64-character SHA-256.
3. Reject unknown arguments, malformed versions, digests, revisions, and
   non-Homebrew output filenames.
4. Write the formula atomically through a same-directory temporary file and
   rename.

### R2: Package boundary

1. Install the tagged Alfred source under Homebrew `libexec`.
2. Declare `node` as a runtime dependency.
3. Install `alfred` as the Memory/runtime CLI.
4. Install `alfred-install` as the guided suite installer.
5. Keep `alfred-install` on the packaged source using `--no-clone`; a formula
   install or preview must never clone `main` implicitly.

### R3: Safety and compatibility

1. `brew install` must not write live `.opencode`, `.codex`, `.agents`, or other
   harness configuration.
2. `alfred-install` remains preview-first and requires the existing explicit
   Apply/handoff decisions before writes.
3. The formula test runs a deterministic installer preview with
   `provider_calls: 0` and no user configuration writes.
4. `alfred version` reads the release version from the packaged root manifest
   instead of carrying a stale hard-coded value.

### R4: Tap and lifecycle

1. Publish `Formula/alfred.rb` in private repository `GOI17/homebrew-tap`.
2. Document GitHub authentication required for the private tap.
3. Document install, guided setup, upgrade, and uninstall commands.
4. Require the fully qualified formula name because `brew install alfred`
   resolves to the unrelated Alfred macOS application cask.
5. Test formula syntax, audit, install, functional preview, and uninstall before
   declaring the tap ready.

### R5: Release and traceability

1. Release this packaging boundary as `0.5.0`.
2. Record issue, branch, tests, source pin, tap publication, and provider calls
   in generated trace artifacts.
3. Keep provider calls at `0`; Homebrew/GitHub network operations are packaging
   transport, not LLM provider requests.

## Completion conditions

- [x] Formula generator tests pass.
- [ ] Suite installer regression validation passes.
- [x] `alfred version` reports `0.5.0` from the packaged manifest.
- [ ] The private formula passes `brew audit`, installation, and `brew test`.
- [ ] `alfred-install` previews the packaged version without cloning or live
      harness writes.
- [x] Private tap documentation explains authentication and the cask collision.
- [ ] `GOI17/homebrew-tap` contains the verified formula.
- [ ] Release and operation traces report `provider_calls: 0`.

## References

- Issue: `#118`
- Installer: `install.sh`
- Install policy: `.ai/instructions/install-management.md`
- Component manifest: `.ai/install/components.json`
- Homebrew Formula Cookbook: `https://docs.brew.sh/Formula-Cookbook`
- Homebrew tap guide: `https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap`
- Homebrew language-specific formulae: `https://docs.brew.sh/Language-Specific-Formulae`
