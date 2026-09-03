# Alfred Homebrew packaging

Issue `#118` adds a deterministic formula generator for the private
`GOI17/homebrew-tap` repository.

## User install

```sh
gh auth login
gh auth setup-git
brew install GOI17/tap/alfred
alfred version
alfred setup
```

Use the fully qualified formula name. Homebrew already distributes an unrelated
`alfred` macOS application cask.

## Automated maintainer release flow

Feature and fix PRs use Conventional Commit titles. After they are squash
merged, `.github/workflows/release-please.yml` creates or updates a reviewable
release PR and keeps the active version files synchronized. Pre-1.0 features
and fixes produce patch releases.

Merging the release PR creates the stable `vX.Y.Z` GitHub Release and directly
calls `.github/workflows/release-homebrew-tap.yml`. That reusable workflow pins
the formula to the exact tag commit, validates it, and pushes only
`Formula/alfred.rb` to `GOI17/homebrew-tap` with the repository-scoped
`HOMEBREW_TAP_DEPLOY_KEY`.

The tap publisher also supports a manually published stable GitHub Release or
manual dispatch with an existing tag. Re-running it is safe: if the formula
already matches, it exits without another commit.

## Manual formula generation

The private source mode pins both tag and commit revision, allowing Git to reuse
the collaborator's credential helper without publishing a source archive:

```sh
node scripts/generate-homebrew-formula.mjs \
  --version "$(node -p "require('./package.json').version")" \
  --source git \
  --revision <tag-commit-sha> \
  --output /path/to/homebrew-tap/Formula/alfred.rb
```

If Alfred later publishes public release archives, generate the formula with a
SHA-256 instead:

```sh
node scripts/generate-homebrew-formula.mjs \
  --version "$(node -p "require('./package.json').version")" \
  --source archive \
  --sha256 <archive-sha256> \
  --output /path/to/homebrew-tap/Formula/alfred.rb
```

Validate before publishing:

```sh
brew audit --strict --formula GOI17/tap/alfred
brew install --build-from-source GOI17/tap/alfred
brew test GOI17/tap/alfred
```

Formula installation places source under Homebrew `libexec`, installs
the `alfred` command and writes no live harness configuration. `alfred setup`
always reuses the packaged source with `--no-clone` and retains the existing
preview/apply approval gates.
