# Alfred Homebrew packaging

Issue `#118` adds a deterministic formula generator for the private
`GOI17/homebrew-tap` repository.

## User install

```sh
gh auth login
gh auth setup-git
brew install GOI17/tap/alfred
alfred version
alfred-install
```

Use the fully qualified formula name. Homebrew already distributes an unrelated
`alfred` macOS application cask.

## Maintainer release flow

The private source mode pins both tag and commit revision, allowing Git to reuse
the collaborator's credential helper without publishing a source archive:

```sh
node scripts/generate-homebrew-formula.mjs \
  --version 0.5.0 \
  --source git \
  --revision <tag-commit-sha> \
  --output /path/to/homebrew-tap/Formula/alfred.rb
```

If Alfred later publishes public release archives, generate the formula with a
SHA-256 instead:

```sh
node scripts/generate-homebrew-formula.mjs \
  --version 0.5.0 \
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
`alfred` and `alfred-install`, and writes no live harness configuration.
`alfred-install` always reuses the packaged source with `--no-clone` and retains
the existing preview/apply approval gates.
