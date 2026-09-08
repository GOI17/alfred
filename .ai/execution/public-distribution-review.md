---
id: execution/public-distribution-review
description: Concrete approval record for Alfred anonymous runtime distribution.
owner: orchestrator
phase: issue-204-homebrew-tap-access
status: preparation-in-progress
---

# Public distribution review

This document records what would become public. It is not authorization to
publish. GOI17/alfred remains private throughout preparation and publication.

## Current authorization

- Allowed: private review branches/PRs, packaging and publication code, local
  artifact preparation using authorized inputs, fixtures and announced reads.
- Preparation permission granted explicitly: read/copy packages/core/ and
  .ai/harnesses/ into the local review artifact; isolated production dependency
  resolution and installation with lifecycle scripts disabled. Protected source
  edits remain unauthorized.
- Not authorized: public source/assets, repository visibility changes, public
  repository creation, releases, credential/settings changes, merging PRs, or
  local Homebrew installation/cloning.

## Proposed public surface

Existing repository: `GOI17/homebrew-alfred`.
Proposed Homebrew name: `GOI17/alfred/alfred`.
Proposed asset URL:
`https://github.com/GOI17/homebrew-alfred/releases/download/vX.Y.Z/alfred-X.Y.Z-runtime.tar.gz`.
The archive, content manifest and checksum would be GitHub Release assets there.
The formula would refer exclusively to that asset and its actual SHA256.

Changing the tap's visibility exposes its existing history, other branches,
issues/PRs and contributor metadata. The audited main history contains seven
commits and these six paths (11 distinct file blobs):

- Formula/alfred.rb
- README.md
- .github/dependabot.yml
- .github/workflows/autobump.yml
- .github/workflows/publish.yml
- .github/workflows/tests.yml

The tap also has a Dependabot branch and this task's review branch, two open
PRs (#1 and #2), and no existing tags or releases at the audit time. Their
metadata and branch histories would also become visible. Subsequent reviewed
commits on this task's branch must be included in the final visibility decision.

The private development repository is separate; none of its Git history is
part of this proposed visibility change. This does not imply that distributed
runtime source becomes secret: see the disclosure below.

## Runtime disclosure

The proposed runtime archive contains readable JS/MJS, shell, HTML, SQL/schema,
runtime agent/skill/policy instructions, and production dependencies with license
notices. It is an executable application package using Homebrew's Node runtime,
not a claim that code is hidden in a native binary. Anyone who downloads the
archive can inspect the included first-party runtime code and instructions.
Packaging itself does not assign an open-source license.

The explicit content inventory must name every actual distributed file, size,
mode and SHA256 before public approval is requested. Root .git data, GitHub
workflows, tests, internal execution/release documents, operational traces,
local profiles, user configuration and secrets must be absent. Node guided TUI
is included; optional native OpenTUI executables and Transformers model weights
are excluded. Historical development eval runners are outside the public
CLI/setup contract.

## Exact artifact record

In progress under the explicitly granted local preparation authorization.
Fixture artifacts verify the machinery but will never be presented as the
actual Alfred distribution. The final record must include version, source
revision, builder revision, archive name/size/SHA256, exact formula bytes/SHA256, inventory and validation.

## Preparation checks

The developer implemented the curated builder, safe archive handling, public
release-asset formula mode, local runtime verifier, private preparation workflow,
manual publisher and tap CI template. The public publisher binds the archive and
formula approvals, source/builder provenance, and preparation run commit before
activation. The old automatic tap publisher is replaced by private preparation.

Validation passed 32 tests (23 synthetic runtime cases plus nine formula/workflow
cases) on Node v26.8.1. Documentation/release automation validators, JS/YAML/shell
syntax and whitespace checks passed; the static site built and its 21 HTML files
passed link validation. Final specialist review has no outstanding high/medium
findings within the reviewed scope. Runtime cases cover deterministic
contents, dependency closure, symlink/traversal and archive tampering, explicit
archive/formula approvals, provenance, downgrade/conflicts, failed-upload aborts,
publication order and real anonymous HTTP loopback retrieval with synthetic
credential environment variables. These do not certify the real runtime or an
anonymous GitHub/Homebrew installation. No actual protected runtime files or
production dependencies were read/copied/installed to obtain these results.

Both existing PRs remain drafts. Tap PR #2 has the revised installation status
and disclosure README; its formula still points to private source until a real
runtime checksum exists. The proposed tap CI is reviewable in
`packaging/homebrew/tap-tests.yml` and will be staged with the real formula.
The proposed v0.7.2 asset URL still returns anonymous HTTP 404.

## Operations remaining after preparation

Only after the actual archive and public surface have been reviewed and
specifically authorized:

1. Confirm/merge the reviewed source/tap changes as separately authorized.
2. Change only GOI17/homebrew-alfred to public, exposing the tap history/metadata
   described above; retain GOI17/alfred as private.
3. Configure a GitHub App installation restricted to the target tap with
   Contents write access, and the exact approved artifact/formula checksum controls.
   No credential values belong in code, traces or review documents.
4. Invoke the manual publisher for the reviewed artifact/version/digests and preparation provenance. It must
   upload those exact bytes and manifest, refuse changed-byte replacements,
   verify anonymous download and hash, then activate the matching formula.
5. Verify real anonymous tap/artifact access and a clean Homebrew installation
   using separately authorized installation/cloning, then publish final user
   instructions. Local anonymous fixture/runtime tests cannot substitute for
   that final live check.

No operation above has been executed or authorized by this document.

## Review links

- https://github.com/GOI17/alfred/pull/206
- https://github.com/GOI17/homebrew-alfred/pull/2
- https://github.com/GOI17/alfred/issues/204
