# Release 0.5.0: Homebrew installation

Alfred 0.5.0 introduces a versioned Homebrew distribution path for
collaborators with access to the private Alfred repositories.

## What changes

- `brew install GOI17/tap/alfred` installs the pinned Alfred release.
- The formula exposes `alfred` and the guided `alfred-install` command.
- `alfred-install` always reuses the packaged source with `--no-clone` and
  preserves the existing preview/apply approval gates.
- Formula installation does not write live harness configuration.
- The CLI version is read from the packaged root manifest.
- A deterministic generator supports private Git tag/revision pins now and
  public archive/SHA-256 pins if Alfred is published later.

Use the fully qualified formula name because unqualified
`brew install alfred` resolves to an unrelated macOS application cask.

## Validation

- Formula generator: 4/4 tests pass.
- Homebrew contract validator: pass.
- Ruby formula syntax: pass.
- Homebrew formula style: pass.
- Documentation site build and checks: pass.
- Provider calls: 0.

The private formula was published at
`GOI17/homebrew-tap@18c7254c2548393dc631ef62e8a5169f93f694cc`, pinned to
`GOI17/alfred@ee73a36af68c28ebb305d8290c8254f86cf091fa`. Strict audit,
source installation, `brew test`, `alfred version`, and the packaged installer
preview all pass.

## Traceability

- GitHub issue: `#118`
- Branch: `issue-118-homebrew-installation`
- Specification: `.ai/execution/homebrew-installation.md`
- Packaging guide: `packaging/homebrew/README.md`
- Trace: `.ai/observability/generated/release-0.5.0.json`
