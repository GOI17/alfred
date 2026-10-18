# Alfred Homebrew tap

> Review proposal for the future `GOI17/homebrew-alfred` README. The tap is still
> private and the current Alfred `v0.7.2` release has no new runtime assets.
> Public activation and anonymous installation verification remain pending.
> Keep this availability notice until those steps actually succeed.

[Alfred](https://github.com/GOI17/alfred) handles the operational burden so humans
focus on decisions. This dedicated tap is prepared to distribute its versioned
runtime through Homebrew.

## Install after public activation

```sh
brew install GOI17/alfred/alfred
alfred version
alfred setup
```

Use the qualified formula name to distinguish Alfred from the unrelated macOS
application cask. The intended public installation requires no GitHub login.
Homebrew provides Node and downloads the exact release runtime with its pinned
SHA-256. Production dependencies are bundled; users do not need a source checkout
or an npm install.

Install the runtime once, then configure each project deliberately. Setup shows
previews before changes and uses the packaged Node TUI without cloning `main` or
fetching a different installer. Installing this formula does not activate a live
harness or authorize global configuration changes.

For managed text-loading requests, initialize each project separately:

```sh
alfred runtime init --instructions /absolute/path/to/shared/instructions.json
alfred runtime status
```

The required shared instruction manifest governs Alfred's managed requests.
Project state and content-bound consent stay in that project's `.alfred/runtime/`.
Memory `alfred init` remains a separate operation. See the
[runtime guide](https://github.com/GOI17/alfred/blob/main/docs/runtime-authority.md)
for the current capability and host-integration limits.

## Verify releases

The [Alfred releases](https://github.com/GOI17/alfred/releases) will contain:

- `alfred-X.Y.Z-runtime.tar.gz`
- `runtime-manifest.json`
- `SHA256SUMS`
- `alfred.rb`

Download all four assets from the same approved version, then verify them with
`shasum -a 256 -c SHA256SUMS` in the download directory. The manifest inventories
the archive and records source/build provenance. The package includes readable
runtime code and third-party licenses; it is not an opaque native binary.

## Maintenance

The source repository's Release Please pipeline creates an approved stable
release, validates and uploads its runtime assets, verifies anonymous downloads,
and only then updates this tap's `Formula/alfred.rb` automatically with its
existing repository-scoped deploy key. Identical retries are safe; differing
existing assets are rejected without replacement. Manual formula copying is a
recovery procedure, not the normal release process.

See the [packaging guide](https://github.com/GOI17/alfred/blob/main/packaging/homebrew/README.md)
for verification and recovery. Do not publish a newer candidate over `v0.7.2`
or describe this proposed tap as publicly available before activation succeeds.
