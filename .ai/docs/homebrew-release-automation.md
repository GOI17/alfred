# Homebrew release automation

Alfred publishes Homebrew updates from
`.github/workflows/release-homebrew-tap.yml`. Publishing a stable GitHub
Release tagged `vX.Y.Z` regenerates `GOI17/homebrew-tap/Formula/alfred.rb`
with that tag and its exact commit revision, validates it, and pushes the
formula to the tap.

The tap itself does not need a duplicate GitHub Release. Homebrew treats the
formula commit as the available update and pulls it during `brew update`.

## Authentication

The workflow uses a dedicated SSH deploy key:

- the public half is registered on `GOI17/homebrew-tap` with write access;
- the private half is stored in the Alfred repository secret
  `HOMEBREW_TAP_DEPLOY_KEY`;
- the Alfred workflow `GITHUB_TOKEN` remains read-only;
- the key cannot call GitHub APIs or write any other repository.

Rotate the key by creating a replacement pair, adding the new public key to
the tap, replacing the Alfred Actions secret, running the manual smoke test,
and only then deleting the old tap deploy key.

## Manual or recovery run

Use Actions → `release-homebrew-tap` → Run workflow and provide an existing
stable tag such as `v0.6.0`. Manual runs apply the same tag format,
package-version, revision, formula syntax, style, and change-scope checks.

A run is idempotent: when the tap already contains the exact formula it exits
successfully without creating a commit.

## Failure behavior

The workflow fails before publication when the release tag is malformed, the
root package version differs, the checkout does not match the tag, packaging
tests fail, Homebrew rejects the formula style, or generation changes any tap
path other than `Formula/alfred.rb`.
