# Reviewed public runtime distribution

Public installation is not activated. Source and tap are currently private.
The final runtime and formula checksums are recorded for review; public
activation still requires explicit approval.

This directory prepares a complete end-user CLI and guided setup package,
including coding adapter previews, without exposing the source repository or
its Git history. Distributed JavaScript, shell, HTML, SQL, agent and skill
instructions remain readable. This is not an opaque native binary.

## Preparation status

`allowlist.json` records the inspected end-user runtime closure. Explicit human
authorization covered reading/copying `packages/core/` and `.ai/harnesses/`, plus
an isolated production install with lifecycle scripts disabled. The dedicated
`package-lock.json` locks 109 production packages from the public npm registry;
vendoring retains their license notices and excludes development material.
The builder never runs a package manager or downloads anything.

The final retained candidate was built reproducibly from source and builder
commit `303ad82c4ba9fdc4641feb0f30e2aef3cd3313c7` and passed independent QA and
review. CLI, SQLite, live server, MCP CRUD/search and all three coding adapter
previews passed locally; the [complete runtime CI on Node 24](https://github.com/GOI17/alfred/actions/runs/34180923580/job/101919705646) also passed.
The [public distribution review](../../.ai/execution/public-distribution-review.md)
records the exact retained artifact, formula hashes and pending activation
operations. Exploratory builds remain ineligible for publication.

Prepare dependencies in a separate temporary directory with the dedicated
package manifest/lock and `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`.
Build from exact reviewed source and builder commits into an output directory
outside both inputs:

```sh
node scripts/build-runtime.mjs \
  --root /path/to/reviewed-source \
  --source-revision FULL_SOURCE_COMMIT \
  --builder-revision FULL_BUILDER_COMMIT \
  --dependencies /path/to/isolated-production/node_modules \
  --output /path/outside-inputs/runtime-candidate
node scripts/verify-runtime.mjs /path/outside-inputs/runtime-candidate
```

Never describe branch bytes as the old release tag's bytes. The inventory binds
the actual source and builder revisions, builder/generator/allowlist/lock hashes,
and transformations. Output includes the normalized tar.gz, embedded and
separate file inventory, archive checksum, generated `alfred.rb` and its separate
checksum. The manifest inventories every payload file except itself; its exact
bytes are stored in the archive and checked against the separate manifest.
Archive approval therefore covers the inventory as well.

Required verification covers anonymous local HTTP retrieval, safe extraction,
CLI version, SQLite tenant lifecycle, server and production dependency loading,
setup preview and coding agent/skill previews. Historical internal eval runners
are excluded. The archive uses the existing Node TUI and keyword-search fallback;
optional private OpenTUI/model downloads are not part of installation.

## Private review and later public activation

`release-homebrew-tap.yml` now only prepares private workflow artifacts. It runs from main through Release Please or manual dispatch. The
builder is pinned to that run's commit and checked against the candidate manifest;
its checkout is separate from the source tag/commit, so selecting an older source
tag cannot remove the new packaging tooling. There is no independent release-event
publisher: prepare recovery candidates through a main-branch manual dispatch.
PR validation runs fixture tests and static documentation contracts. A separate
job, restricted to the private repository and its own PR branches, installs the
locked production dependencies with scripts disabled and verifies the actual
runtime on Node 24. Its candidate stays in private Actions artifact storage.

Proposed destination, requiring separate explicit human approval:
`GOI17/homebrew-alfred`, with its already-reviewed tree/history made public.
The private `GOI17/alfred` source repository must remain private. No workflow
creates a repository or changes visibility/settings.

There are two activation entry points, both requiring separate explicit public
approval:

- **Initial local candidate:** retain the exact reviewed archive, manifest and
  formula from the committed PR revision. The existing
  `scripts/publish-homebrew-runtime.mjs` CLI accepts those files and both hashes;
  the review records the exact destination and independently approved values.
  After approval, existing authorized GitHub credentials can be supplied only
  in memory for the private-source reads and target writes. Never print or
  persist tokens. No new GitHub App is required for this local activation.
- **Future Actions candidates:** the manual workflow accepts one successful
  trusted main-branch preparation run, the exact destination, and both approved
  SHA256 values. Independent repository variables
  `ALFRED_APPROVED_RUNTIME_SHA256` and `ALFRED_APPROVED_FORMULA_SHA256` must match.
  This automation uses a GitHub App token restricted to `homebrew-alfred` contents
  writes; configuring its credentials and approval controls is a separate
  authorized operation. An environment name alone does not authorize publishing.

A later main-branch build records a different builder revision and may produce
different bytes. It requires its own review and hashes; rebuilding after merge
does not preserve approval of the original local candidate. The CLI must receive
the retained files, never a replacement archive rebuilt under an approved hash.

Both entry points verify private source and public target, source/package
provenance, trusted builder input hashes, current formula version, existing
release metadata and all existing assets before public writes. They refuse
exploratory candidates, downgrades, unexpected assets and replacement of
same-version bytes. The publisher uploads the reviewed archive, manifest and
checksum, verifies the anonymous download, and only then writes the exact
approved formula bytes. A failed anonymous check leaves formula activation
blocked; same-byte reruns can recover without overwriting assets.

The public formula URL is exclusively:

```text
https://github.com/GOI17/homebrew-alfred/releases/download/vX.Y.Z/alfred-X.Y.Z-runtime.tar.gz
```

`packaging/homebrew/tap-tests.yml` is a target CI template for the private tap PR.
Stage it together with a concrete formula only after its real checksum exists.
Its PR job checks syntax and the release-asset contract without downloading;
a separate manual job can verify installation after approved public activation.
No fixture hash should be presented as a ready-to-publish formula.
