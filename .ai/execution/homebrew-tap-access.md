---
id: execution/homebrew-tap-access
description: Use the canonical private tap and separate install authentication failures from publisher failures.
owner: developer
phase: issue-204-homebrew-tap-access
issue: 204
---

# Homebrew tap access

## Verified findings (2026-09-07)

The authenticated GitHub API resolves `GOI17/homebrew-tap` to
`GOI17/homebrew-alfred` (repository ID 1354233238). Both the tap and source
repository `GOI17/alfred` are private. Anonymous API reads return 404; Git
without a credential helper fails. Authenticated Git reads of both tap names
return `49fcd91b02b8ba7a33395864591be7dce59ce0c7`. The old name still redirects,
so neither its spelling nor changing case establishes the reported cause.

`Formula/alfred.rb` exists and pins `v0.7.2` to
`28f64f4c1afe97390ae29639c15d170087e1a92e`, matching the source tag and stable
release. The publisher job in [run 33956033385](https://github.com/GOI17/alfred/actions/runs/33956033385)
succeeded. Current evidence excludes missing publication; it reproduces an
access failure without credentials. The other computer's exact state has not
been observed, so authentication remains the supported explanation rather
than a confirmed diagnosis of that machine.

The existing local Homebrew tap also reports version `0.7.2`, and its formula
SHA-256 equals the remotely retrieved formula:
`76d19607f15b425c1256a6dad0196bacddeb1909d21dbd52be7883aeaa2bb4c3`.
The installed CLI prints `alfred 0.7.2`. This verifies the existing installation,
not a fresh installation on the other computer.

## Requirements

### R1: Canonical distribution identity

Use `GOI17/homebrew-alfred` in the publisher and `GOI17/alfred/alfred` in active
install/upgrade/uninstall instructions. Explain Homebrew's `homebrew-` prefix
mapping and the old redirect. Keep historical completed specs and release
records as history; update the existing packaging validator to reference this
current spec for the install command while retaining relevant old contracts.

### R2: Actionable authentication and diagnostics

State that collaborators need access to both private repositories and GitHub
CLI, Git, and Homebrew on the target computer. Show hostname-scoped HTTPS
login and credential-helper setup. Provide read-only API checks for repository
identity and formula presence, and Git `ls-remote` checks for both repositories.
Separate API permissions from Git credential configuration, and metadata access
from an absent/stale formula. Explain that a 404 by itself does not establish
that a private repository is missing. Never request or print tokens, recommend
casing as a fix, or change global configuration automatically during diagnosis.
Document maintainer release/tag/publisher checks and preserve the fully qualified
formula to avoid the macOS application cask collision.

### R3: Minimal implementation

Update README, site install guide, active install instructions/context,
publisher target, and relevant validator/test expectations. Keep the immutable
formula source and deploy key unchanged. Extend existing contract checks to
cover the current instructions and repository name. No new runtime subsystem
or broad refactor is needed. The tap README also needs a reviewable update.
The site checker must reject obsolete `/alfred/` prefixes on local navigation
links, while permitting the canonical formula name and GitHub URLs in page
text. Verify both valid text and an invalid local link with isolated fixtures.

### R4: Verification and boundaries

Compare the targeted packaging checks before and after the change, validate
syntax and documentation/site checks that do not access protected paths.
No clone, package installation, protected-path reads/writes, repository visibility
change, release publishing, baseline update, or unrelated checkout changes.
Do not run the full root test/check scripts because they access protected core.
Record precisely which checks ran; never claim a fresh install on the other
computer. Preserve the harness-selected model and trace operational decisions.

## Completion conditions

- [x] Active docs use the canonical formula and cover both private repositories.
- [x] Publisher and relevant contract checks use the canonical repository.
- [x] Published formula/release pins and Git access are verified without installing.
- [x] Pertinent local checks pass and match or improve the pre-change baseline.
- [x] Reviewable changes reference issue #204; no protected paths or unrelated changes are included.

## References

- [Issue 204](https://github.com/GOI17/alfred/issues/204)
- [Tap](https://github.com/GOI17/homebrew-alfred)
- [Release](https://github.com/GOI17/alfred/releases/tag/v0.7.2)
- [Homebrew tap naming](https://docs.brew.sh/Taps)
- [GitHub CLI Git helper](https://cli.github.com/manual/gh_auth_setup-git)

## Validation evidence

- Before and after: generator/workflow tests **9/9 pass**; release automation
  validator **pass**. No baseline files changed.
- Current documentation assertions from `validate-homebrew.mjs`, stopped before
  CLI/setup invocation: **pass**.
- JavaScript syntax and `git diff --check`: **pass**.
- Site build and checker: **pass**, 21 HTML pages. Isolated regression fixtures
  accept the canonical formula/external URLs and reject obsolete local links.
- Remote formula Ruby syntax: **pass**. Source tag/revision, stable release,
  successful publisher, local Homebrew metadata, identical formula SHA-256,
  and installed `alfred version` were verified.
- Local full `homebrew:test`, `validate:homebrew`, root tests/check, and a fresh
  install were not run: installer detection/full suites cross the protected-path
  scope and package installation was not authorized. CI results are reported
  separately in the PR; this evidence does not certify the other computer.
- Companion tap README change: [homebrew-alfred PR #2](https://github.com/GOI17/homebrew-alfred/pull/2).
