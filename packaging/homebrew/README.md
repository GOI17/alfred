# Alfred Homebrew runtime distribution

## Availability

Issue #219 prepares the public distribution; it does not activate it. Alfred's
source repository `GOI17/alfred` is public. The canonical tap
`GOI17/homebrew-alfred` remains private, and the current `v0.7.2` release has no
new runtime assets. Its existing Git-source formula is not this runtime package.
Do not overwrite that release with a candidate built from newer code. Public tap
activation, a new approved version and anonymous installation verification are
still required. The proposed [tap README](tap-README.md) is reviewable material
for that future publication, not evidence of a completed installation.

## Intended public installation

After activation:

```sh
brew install GOI17/alfred/alfred
alfred version
alfred setup
```

The fully qualified formula avoids the unrelated Alfred macOS application cask.
Public installation uses release asset URLs and requires no GitHub credentials.
Homebrew supplies Node; the archive supplies the selected runtime and its locked
production npm dependencies. Users do not run npm install in the installed tree.

Homebrew installs a shared runtime, not project state or live harness config.
`alfred setup` reuses the installed package with `--no-clone`, selects its bundled
Node TUI, and keeps preview/apply approval gates. It does not clone `main`, fetch
an unrelated OpenTUI binary, change model assignments or silently activate a
profile. Optional OpenTUI and Transformers are not bundled; Node TUI and keyword
search remain available.

Initialize managed execution independently in each project:

```sh
alfred runtime init --instructions /absolute/path/to/shared/instructions.json
alfred runtime status
```

The shared Alfred instruction manifest is required. This does not provision
Memory tenants or API keys; Memory continues to use `alfred init`. Workspace
configuration and grants live in `.alfred/runtime/`, not Homebrew's `libexec`.
Alfred instructions are checked first. Only confirmed instruction absence may
expose a registered external option. `Permitir` applies once, `Permitir siempre`
binds that option/content/action/scope to this project, and `Cancelar` executes
nothing. See the [runtime authority guide](../../docs/runtime-authority.md).
The current managed capability reads approved text; native host interception and
general tool execution remain separate work.

## Release artifacts

Each new stable release publishes these four assets to `GOI17/alfred`:

| Asset | Purpose |
|---|---|
| `alfred-X.Y.Z-runtime.tar.gz` | Selected runtime, workspace modules and reviewed production dependencies with licenses |
| `runtime-manifest.json` | File hashes, normalized modes and source/builder revision and build-input provenance |
| `SHA256SUMS` | SHA-256 checksums for the archive, manifest and formula |
| `alfred.rb` | Formula pointing to the exact release archive with its real SHA-256 |

The builder also emits per-file `.sha256` sidecars for local verification. The
publisher uploads the four named assets above. The archive is deterministic for
the same source, reviewed lockfile, allowlist and build toolchain: ordering,
ownership, timestamps and file modes are normalized. It excludes source history,
workflows, tests, local state and credentials. It contains readable code and
instructions; it is not an opaque native binary.

## Automatic maintainer flow

1. Conventional Commit changes on `main` accumulate in a reviewable Release
   Please PR. Merging it creates the stable `vX.Y.Z` release and directly calls
   `release-homebrew-tap.yml` with that tag.
2. The workflow verifies the stable tag, package version and exact checked-out
   commit. It stages only locked production dependencies outside the checkout,
   builds the runtime, runs its verifier and checks formula syntax.
3. `publish-runtime-assets.mjs` requires an existing public, non-draft, stable
   Alfred release. It compares every existing candidate asset before uploading
   missing ones. Identical retries are accepted; different existing bytes fail
   without replacement. It does not create a release or change visibility.
4. Anonymous downloads of all four assets must match their local bytes before
   the workflow checks out `GOI17/homebrew-alfred` using the existing
   repository-scoped `HOMEBREW_TAP_DEPLOY_KEY`.
5. The already-published formula is copied to `Formula/alfred.rb`, validated, and
   committed/pushed only if changed. Unexpected tap changes are rejected. This
   automatic update is the normal path; manual copying is recovery only.

Published-release events and manual dispatch for an existing stable tag remain
recovery entry points. Release assets use the same-repository GitHub token;
tap writes use only the existing deploy key. No new cross-repository credential
is introduced. Preparing this change performs none of those remote operations.
Before first public activation, review the chosen new version, exact checksums,
tap visibility and formula change, then explicitly authorize publication.

## Build a local candidate

Dependency installation requires explicit human approval. Once approved, use an
isolated temporary stage, never the source checkout. Run this from the intended
source worktree with Node 24, matching the release CI toolchain:

```sh
runtime_stage="$(mktemp -d "${TMPDIR:-/tmp}/alfred-runtime-build.XXXXXX")"
source_root="$(pwd -P)"
source_revision="$(git rev-parse HEAD)"
mkdir -p "$runtime_stage/deps"
cp packaging/runtime/package.json packaging/runtime/package-lock.json "$runtime_stage/deps/"
npm ci --prefix "$runtime_stage/deps" --omit=dev --ignore-scripts --no-audit --no-fund
node scripts/build-runtime.mjs \
  --root "$source_root" \
  --source-revision "$source_revision" \
  --builder-revision "$source_revision" \
  --dependencies "$runtime_stage/deps/node_modules" \
  --output "$runtime_stage/assets" \
  --exploratory
node scripts/verify-runtime.mjs "$runtime_stage/assets"
(cd "$runtime_stage/assets" && shasum -a 256 -c SHA256SUMS)
```

The staging lockfile must match the reviewed lockfile beside the allowlist.
`--exploratory` marks an untagged/local candidate as non-publishable; its formula
URL is a proposal and does not prove an asset exists. The release workflow builds
from the exact stable tag without this flag, binding source and builder to the
same validated revision. Never relabel a local candidate as a historical release.

The verifier exercises actual packaged entrypoints with isolated HOME/project
fixtures, including setup previews, Memory/MCP dependencies and managed text
loading. `--archive-only` checks structure/checksums only and is not a substitute
for those runtime checks. Retain the candidate directory and its checksums for
review; do not upload it or change the tap as part of a local build.

## Recovery and post-publication verification

If automatic tap updating fails after verified asset publication, recover using
the already-published `alfred.rb` and its `SHA256SUMS`, review only the canonical
tap's `Formula/alfred.rb` change, and obtain the required publication approval.
Do not substitute an unverified checksum or use a different archive/source mode.
For generator debugging, the equivalent formula input is `--source release`
with the exact release version and actual archive SHA-256; the runtime builder
normally creates it automatically.

After public activation, validate without GitHub credentials:

```sh
brew audit --strict --formula GOI17/alfred/alfred
brew install GOI17/alfred/alfred
brew test GOI17/alfred/alfred
```

These are post-publication checks, not commands executed by this preparation.
An already-installed collaborator setup is not evidence of anonymous public
installation success.
