# Release 0.6.0: `alfred setup`

Alfred 0.6.0 makes package installation and product configuration distinct:

```sh
brew install GOI17/tap/alfred
alfred setup
```

## Changes

- Adds `setup` to the main Alfred CLI.
- Removes the standalone `alfred-install` Homebrew executable.
- Preserves the guided, preview-first configuration flow.
- Reuses packaged Homebrew source with `--no-clone`.
- Installs only one public command: `alfred`.

## Compatibility

This is an intentional pre-1.0 breaking CLI change. Scripts invoking the old
standalone command must use `alfred setup`.

## Validation

- CLI setup preview: pass.
- Formula generator and contract tests: pass.
- Generated formula style: pass.
- Homebrew strict audit, 0.5.0 to 0.6.0 upgrade, and test: pass.
- `alfred version`: `alfred 0.6.0`.
- Packaged `alfred setup` preview: pass; no files written.
- Removed command check: `alfred-install` is absent from `PATH`.
- Provider calls: 0.

The formula is pinned to
`GOI17/alfred@6f6a4da5964f1b0cc77c6b27813258269d7abfa9` and published at
`GOI17/homebrew-tap@16de4548f4b3c884f293d1c16015f132a9b6a900`.

## Traceability

- Issue: `#124`
- Branch: `issue-124-alfred-setup`
- Specification: `.ai/execution/alfred-setup-command.md`
- Trace: `.ai/observability/generated/release-0.6.0.json`
