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
- Homebrew strict audit, upgrade, and test: pending release publication.
- Provider calls: 0.

## Traceability

- Issue: `#124`
- Branch: `issue-124-alfred-setup`
- Specification: `.ai/execution/alfred-setup-command.md`
- Trace: `.ai/observability/generated/release-0.6.0.json`
