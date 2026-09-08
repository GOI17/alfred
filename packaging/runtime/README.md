# Reviewed public runtime distribution

Public installation is not activated. Source and tap are currently private;
there is no approved runtime asset or ready public formula checksum.

This directory prepares a complete end-user CLI and guided setup package,
including coding adapter previews, without exposing the source repository or
its Git history. Distributed JavaScript, shell, HTML, SQL, agent and skill
instructions remain readable. This is not an opaque native binary.

## Preparation status

`allowlist.json` is a provisional explicit runtime inventory. The final core
and kernel metadata closure still requires separately approved reads of
`packages/core/` and `.ai/harnesses/`; those inputs have not been read or copied
for this task. The isolated production install and dedicated
`package-lock.json` are also pending permission. The preparation workflow fails
closed when that lock is absent. Fixture success does not establish that the
actual Alfred archive is complete.

The declared dependencies are exact versions already selected from the source
lock: pg, MCP SDK, Zod and Nodemailer. A dedicated production lock and isolated
`node_modules` must be prepared under explicit installation authorization;
the archive builder never runs a package manager or downloads anything.

After input permissions and dependency preparation, build from exact reviewed
source and builder commits into an output directory outside both inputs:

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
publisher: prepare recovery candidates through a main-branch manual dispatch. PR validation runs fixture tests and
static documentation contracts; it does not install dependencies or build the
actual protected runtime.

Proposed destination, requiring separate explicit human approval:
`GOI17/homebrew-alfred`, with its already-reviewed tree/history made public.
The private `GOI17/alfred` source repository must remain private. No workflow
creates a repository or changes visibility/settings.

The manual publisher accepts one successful trusted main-branch preparation run,
the exact destination, and BOTH approved archive and formula SHA256 values.
The independent repository variables `ALFRED_APPROVED_RUNTIME_SHA256` and
`ALFRED_APPROVED_FORMULA_SHA256` must match those inputs. An environment name
alone does not authorize publication. Configuring these values and the scoped
GitHub App is a separate human operation, not performed by this implementation.

The target App token is restricted to `homebrew-alfred` contents writes. The
publisher verifies private source and public target, source/package provenance,
trusted builder input hashes, current formula version, existing release metadata
and all existing assets before public writes. It refuses downgrades, unexpected
assets and replacement of same-version bytes. It uploads the reviewed archive,
manifest and checksum, verifies the anonymous download, and only then writes the
exact approved formula bytes. A failed anonymous check leaves formula activation
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
